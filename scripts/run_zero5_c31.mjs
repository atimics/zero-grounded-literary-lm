#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write("error: " + message + "\n");
  process.exit(1);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail("missing value for " + name);
  return process.argv[index + 1];
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(label + " is missing: " + file);
  const observed = artifact(file);
  if (observed.sha256 !== expected) fail(label + " drifted from the contract");
  return observed;
}

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(program + " failed: " + (result.stderr || result.stdout).trim());
  }
  return result.stdout;
}

function runCaptured(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) :
      reject(new Error(program + " failed: " + (stderr || stdout).trim())));
  });
}

function runStreaming(program, args, prefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      const value = chunk.toString();
      stdout += value;
      process.stdout.write(value.split("\n").map((line, index, lines) =>
        index + 1 === lines.length && line === "" ? "" : prefix + line)
        .join("\n"));
    });
    child.stderr.on("data", chunk => {
      const value = chunk.toString();
      stderr += value;
      process.stderr.write(prefix + value);
    });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) :
      reject(new Error(program + " failed: " + (stderr || stdout).trim())));
  });
}

function finalJson(output, schema) {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const value = JSON.parse(line);
      if (value.schema === schema) return value;
    } catch {
      // Keep looking for the final structured line.
    }
  }
  fail("command did not return " + schema);
}

function close(observed, expected, tolerance = 0.0001) {
  return Math.abs(observed - expected) <= tolerance;
}

const contractPath = "benchmarks/zero5-c31-v1/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
if (contract.status !== "preregistered-unrun" || !contract.authorized) {
  fail("C3.1 contract is not authorized");
}
if (sha256(fs.readFileSync(contract.implementation.trainer)) !==
    contract.implementation.trainer_sha256 ||
    sha256(fs.readFileSync(contract.implementation.importer)) !==
      contract.implementation.importer_sha256) {
  fail("C3.1 implementation drifted from the contract");
}

const imported = JSON.parse(fs.readFileSync(contract.input.import_manifest));
if (sha256(fs.readFileSync(contract.input.import_manifest)) !==
    contract.input.import_manifest_sha256) {
  fail("C3.1 import manifest drifted");
}
const importDirectory = path.resolve(option("--import-dir",
  "build/zero5-c31-v1/import-final"));
const c0Directory = path.resolve(option("--c0-dir",
  "build/zero5-c0-v1/corpus-one"));
const c2Directory = path.resolve(option("--c2-dir",
  "build/zero5-c2-v1/run"));
const c2ImportDirectory = path.resolve(option("--c2-import-dir",
  "build/zero5-c2-v1/import-final"));
const out = path.resolve(option("--out", "build/zero5-c31-v1/run"));
if (fs.existsSync(out)) fail("output directory already exists: " + out);
fs.mkdirSync(out, { recursive: true });

const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
const initialCheckpoint = path.join(c2Directory, "best.ckpt");
const atlasTrain = path.join(c2ImportDirectory,
  "atlas.train.byte-bpe512.tok");
const atlasValidation = path.join(c2ImportDirectory,
  "atlas.validation.byte-bpe512.tok");
const anchorTrain = path.join(c0Directory, "train.byte-bpe512.tok");
const anchorValidation = path.join(c0Directory,
  "validation.byte-bpe512.tok");
requireArtifact(tokenizer, contract.input.tokenizer_sha256, "tokenizer");
requireArtifact(initialCheckpoint,
  contract.initialization.checkpoint_sha256, "C2 checkpoint");

const files = {
  blocked: path.join(importDirectory, "train.blocked.z5pack"),
  interleaved: path.join(importDirectory, "train.interleaved.z5pack"),
  validation: path.join(importDirectory, "validation.interleaved.z5pack"),
  tasks: Object.fromEntries(["claim", "cloze", "retrieval"].map(task =>
    [task, {
      packed: path.join(importDirectory, task + ".validation.z5pack"),
      completion: path.join(importDirectory,
        task + ".validation.completion-eval.bin"),
    }]))
};
requireArtifact(files.blocked, imported.outputs.train_blocked.sha256,
  "blocked training packs");
requireArtifact(files.interleaved, imported.outputs.train_interleaved.sha256,
  "interleaved training packs");
requireArtifact(files.validation,
  imported.outputs.validation_interleaved.sha256, "validation packs");
for (const task of Object.keys(files.tasks)) {
  requireArtifact(files.tasks[task].packed,
    imported.outputs.validation_tasks[task].sha256,
    task + " validation packs");
  requireArtifact(files.tasks[task].completion,
    imported.outputs.completion_validation[task].sha256,
    task + " completion evaluation");
}

const common = ["--tokenizer", tokenizer];
function evaluatePacked(checkpoint, file, batches) {
  const output = run("./zero5_c31_lm", [
    "--init", checkpoint, ...common,
    "--packed-validation", file, "--eval-only",
    "--validation", String(batches),
  ]);
  const match = output.match(
    /packed-evaluation-only val ([0-9.]+) batches=(\d+)/);
  if (!match || Number(match[2]) !== batches) {
    fail("packed validation measurement did not reproduce");
  }
  return Number(match[1]);
}

function evaluateLegacy(checkpoint, train, validation, batches) {
  const output = run("./zero5_c31_lm", [
    "--init", checkpoint, ...common, "--text", train,
    "--validation-text", validation, "--eval-only",
    "--validation", String(batches),
  ]);
  const match = output.match(/evaluation-only val ([0-9.]+) batches=(\d+)/);
  if (!match || Number(match[2]) !== batches) {
    fail("legacy retention measurement did not reproduce");
  }
  return Number(match[1]);
}

async function evaluateCompletion(checkpoint, file) {
  const output = await runCaptured("./zero5_c31_lm", [
    "--init", checkpoint, ...common, "--completion-eval", file,
  ]);
  return finalJson(output, "zero.c3_completion_eval.v1");
}

async function allCompletion(checkpoint) {
  const entries = await Promise.all(Object.entries(files.tasks).map(
    async ([task, value]) => [task,
      await evaluateCompletion(checkpoint, value.completion)],
  ));
  return Object.fromEntries(entries);
}

process.stdout.write("C3.1 reproducing frozen C2 baselines\n");
const baseline = {
  combined_selection_nats_per_token: evaluatePacked(initialCheckpoint,
    files.validation, contract.evaluation.selection_validation_packs),
  combined_final_nats_per_token: evaluatePacked(initialCheckpoint,
    files.validation, contract.evaluation.final_validation_packs),
  members: Object.fromEntries(Object.entries(files.tasks).map(
    ([task, value]) => [task, evaluatePacked(initialCheckpoint, value.packed,
      contract.evaluation.member_validation_packs)])),
  completion: await allCompletion(initialCheckpoint),
  atlas_nats_per_token: evaluateLegacy(initialCheckpoint, atlasTrain,
    atlasValidation, contract.evaluation.atlas_windows),
  anchor_nats_per_token: evaluateLegacy(initialCheckpoint, anchorTrain,
    anchorValidation, contract.evaluation.anchor_windows),
};
if (!close(baseline.combined_selection_nats_per_token,
      contract.baselines.combined_selection_nats_per_token) ||
    !close(baseline.combined_final_nats_per_token,
      contract.baselines.combined_final_nats_per_token) ||
    !close(baseline.atlas_nats_per_token,
      contract.baselines.atlas_nats_per_token) ||
    !close(baseline.anchor_nats_per_token,
      contract.baselines.anchor_nats_per_token)) {
  fail("C3.1 whole-distribution baseline changed");
}
for (const task of Object.keys(files.tasks)) {
  if (!close(baseline.members[task],
        contract.baselines.members[task].nats_per_token) ||
      !close(baseline.completion[task].nats_per_target_token,
        contract.baselines.completion[task].nats_per_target_token, 1e-7) ||
      !close(baseline.completion[task].last_target_token_accuracy,
        contract.baselines.completion[task].last_target_token_accuracy, 1e-7)) {
    fail(task + " C3.1 answer baseline changed");
  }
}

const armDefinitions = [
  { id: "V", train: files.blocked, answerWeight: 1 },
  { id: "A", train: files.interleaved, answerWeight: 1 },
  { id: "B", train: files.interleaved, answerWeight: 4 },
];
const arms = {};
for (const definition of armDefinitions) {
  const armDirectory = path.join(out, definition.id);
  fs.mkdirSync(armDirectory);
  const bestCheckpoint = path.join(armDirectory, "best.ckpt");
  process.stdout.write("C3.1 arm " + definition.id + " starting\n");
  const training = contract.training;
  const log = await runStreaming("./zero5_c31_lm", [
    "--init", initialCheckpoint, ...common,
    "--packed-train", definition.train,
    "--packed-validation", files.validation,
    "--steps", String(training.updates),
    "--batch", String(training.batch_sequences),
    "--lr", String(training.peak_learning_rate),
    "--weight-decay", String(training.weight_decay),
    "--clip", String(training.gradient_clip),
    "--warmup", String(training.warmup_updates),
    "--schedule-total", String(training.updates), "--cosine",
    "--dropout", String(training.residual_dropout),
    "--report", String(training.report_every_updates),
    "--validation", String(contract.evaluation.selection_validation_packs),
    "--best", bestCheckpoint, "--seed", String(training.seed),
    "--answer-weight", String(definition.answerWeight), "--tokens", "0",
  ], "[" + definition.id + "] ");
  fs.writeFileSync(path.join(armDirectory, "training.log"), log);
  if (!fs.existsSync(bestCheckpoint)) fail(definition.id + " saved no checkpoint");
  const modelMatch = log.match(
    /zero5_lm: backend=([^ ]+).*positions=([^ ]+) parameters=(\d+) trainable-scope=all/,
  );
  const reports = [];
  for (const line of log.split("\n")) {
    const match = line.match(
      /^update\s+(\d+) train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+)/,
    );
    if (match) reports.push({
      update: Number(match[1]),
      train_nats_per_token: Number(match[2]),
      combined_validation_nats_per_token: Number(match[3]),
      gradient_norm: Number(match[4]),
      learning_rate: Number(match[5]),
    });
  }
  const accounting = log.match(
    /packed sampling sequences=(\d+) compute-token-exposures=(\d+) active-targets=(\d+) answer-targets=(\d+) padding-targets=(\d+) wraps=(\d+) answer-weight=(\d+)/,
  );
  const expectedReports = Math.floor(training.updates /
    training.report_every_updates) + 1;
  if (!modelMatch || !accounting || reports.length !== expectedReports ||
      reports.at(-1).update !== training.updates) {
    fail(definition.id + " did not complete its frozen training reports");
  }
  const selectedCombined = evaluatePacked(bestCheckpoint, files.validation,
    contract.evaluation.selection_validation_packs);
  const bestReport = reports.reduce((best, current) =>
    current.combined_validation_nats_per_token <
      best.combined_validation_nats_per_token ? current : best);
  if (!close(selectedCombined,
      bestReport.combined_validation_nats_per_token)) {
    fail(definition.id + " checkpoint selection did not reproduce");
  }
  const validation = {
    combined_selection_nats_per_token: selectedCombined,
    combined_final_nats_per_token: evaluatePacked(bestCheckpoint,
      files.validation, contract.evaluation.final_validation_packs),
    members: Object.fromEntries(Object.entries(files.tasks).map(
      ([task, value]) => [task, evaluatePacked(bestCheckpoint, value.packed,
        contract.evaluation.member_validation_packs)])),
    completion: await allCompletion(bestCheckpoint),
    atlas_nats_per_token: evaluateLegacy(bestCheckpoint, atlasTrain,
      atlasValidation, contract.evaluation.atlas_windows),
    anchor_nats_per_token: evaluateLegacy(bestCheckpoint, anchorTrain,
      anchorValidation, contract.evaluation.anchor_windows),
  };
  validation.combined_relative_improvement =
    1 - validation.combined_final_nats_per_token /
      baseline.combined_final_nats_per_token;
  validation.completion_relative_improvement = Object.fromEntries(
    Object.keys(files.tasks).map(task => [task,
      1 - validation.completion[task].nats_per_target_token /
        baseline.completion[task].nats_per_target_token]),
  );
  validation.atlas_relative_regression =
    validation.atlas_nats_per_token / baseline.atlas_nats_per_token - 1;
  validation.anchor_relative_regression =
    validation.anchor_nats_per_token / baseline.anchor_nats_per_token - 1;
  validation.normalized_answer_score =
    Object.keys(files.tasks).reduce((sum, task) => sum +
      Math.log(validation.completion[task].nats_per_target_token /
        baseline.completion[task].nats_per_target_token), 0) /
      Object.keys(files.tasks).length;
  const gates = {
    full_pack_pass: Number(accounting[1]) === training.pack_sequences &&
      Number(accounting[2]) === training.compute_token_exposures &&
      Number(accounting[3]) === training.active_targets &&
      Number(accounting[4]) === training.answer_targets &&
      Number(accounting[5]) === training.padding_targets &&
      Number(accounting[6]) === 0 &&
      Number(accounting[7]) === definition.answerWeight,
    combined_validation_nats_per_token:
      validation.combined_final_nats_per_token <=
        contract.gates.combined_validation_nats_per_token_maximum,
    combined_relative_improvement:
      validation.combined_relative_improvement >=
        contract.gates.combined_relative_improvement_minimum,
    claims_completion_nats_per_token:
      validation.completion.claim.nats_per_target_token <=
        contract.gates.completion_nats_per_target_token_maximum.claim,
    cloze_completion_nats_per_token:
      validation.completion.cloze.nats_per_target_token <=
        contract.gates.completion_nats_per_target_token_maximum.cloze,
    retrieval_completion_nats_per_token:
      validation.completion.retrieval.nats_per_target_token <=
        contract.gates.completion_nats_per_target_token_maximum.retrieval,
    retrieval_choice_accuracy:
      validation.completion.retrieval.last_target_token_accuracy >=
        contract.gates.retrieval_choice_accuracy_minimum,
    atlas_retention_nats_per_token:
      validation.atlas_nats_per_token <=
        contract.gates.atlas_nats_per_token_maximum,
    atlas_relative_regression:
      validation.atlas_relative_regression <=
        contract.gates.atlas_relative_regression_maximum,
    anchor_retention_nats_per_token:
      validation.anchor_nats_per_token <=
        contract.gates.anchor_nats_per_token_maximum,
    anchor_relative_regression:
      validation.anchor_relative_regression <=
        contract.gates.anchor_relative_regression_maximum,
    finite_metrics: [selectedCombined,
      validation.combined_final_nats_per_token,
      validation.atlas_nats_per_token, validation.anchor_nats_per_token,
      ...Object.values(validation.members),
      ...Object.values(validation.completion).flatMap(value =>
        [value.nats_per_target_token, value.top1_token_accuracy,
          value.last_target_token_accuracy])].every(Number.isFinite),
    test_metrics_opened: false,
  };
  const allGatesPass = Object.entries(gates).every(([name, value]) =>
    name === "test_metrics_opened" ? value === false : value === true);
  arms[definition.id] = {
    definition: {
      pack_order: definition.id === "V" ? "blocked" : "interleaved",
      answer_weight: definition.answerWeight,
    },
    model: { backend: modelMatch[1], positions: modelMatch[2],
      parameters: Number(modelMatch[3]) },
    training: { completed_updates: training.updates,
      best_report_update: bestReport.update, reports,
      pack_sequences: Number(accounting[1]),
      compute_token_exposures: Number(accounting[2]),
      active_targets: Number(accounting[3]),
      answer_targets: Number(accounting[4]),
      padding_targets: Number(accounting[5]), wraps: Number(accounting[6]) },
    validation,
    checkpoint: artifact(bestCheckpoint),
    gates,
    all_gates_pass: allGatesPass,
  };
  fs.writeFileSync(path.join(armDirectory, "result.json"),
    JSON.stringify(arms[definition.id], null, 2) + "\n");
  process.stdout.write("C3.1 arm " + definition.id + " complete gates=" +
    (allGatesPass ? "pass" : "fail") + "\n");
}

const eligible = Object.entries(arms).filter(([, arm]) => arm.all_gates_pass)
  .sort((left, right) =>
    left[1].validation.normalized_answer_score -
      right[1].validation.normalized_answer_score ||
    armDefinitions.findIndex(value => value.id === left[0]) -
      armDefinitions.findIndex(value => value.id === right[0]));
const preferredArm = eligible.length > 0 ? eligible[0][0] : null;
const meanAnswer = arm => arm.validation.normalized_answer_score;
const result = {
  schema: "zero.c31_braid_result.v1",
  experiment: contract.experiment,
  status: "complete",
  contract_sha256: sha256(contractBytes),
  implementation: {
    trainer_sha256: contract.implementation.trainer_sha256,
    importer_sha256: contract.implementation.importer_sha256,
    runner_sha256: sha256(fs.readFileSync(contract.implementation.runner)),
  },
  input: {
    import_manifest_sha256: contract.input.import_manifest_sha256,
    view_id: contract.input.view_id,
    initial_checkpoint_sha256: contract.initialization.checkpoint_sha256,
  },
  baselines: baseline,
  arms,
  comparisons: {
    interleaving_A_minus_V_normalized_answer_score:
      meanAnswer(arms.A) - meanAnswer(arms.V),
    answer_weight_B_minus_A_normalized_answer_score:
      meanAnswer(arms.B) - meanAnswer(arms.A),
    interleaving_benefit_supported:
      arms.A.all_gates_pass && meanAnswer(arms.A) < meanAnswer(arms.V),
    answer_weight_benefit_supported:
      arms.B.all_gates_pass && meanAnswer(arms.B) < meanAnswer(arms.A),
  },
  test: { records: imported.test.records, metrics_opened: false },
  rights: { license: "CC-BY-SA-4.0-derived", dataset_published: false,
    checkpoint_published: false, publication_review_required: true },
  decision: {
    eligible_arms: eligible.map(([id]) => id),
    preferred_arm: preferredArm,
    outcome: preferredArm === null ? "no-go" : "pass-c31-pilot",
    single_seed: true,
    replication_authorized: false,
    broad_model_promotion_authorized: false,
    checkpoint_publication_authorized: false,
  },
};
fs.writeFileSync(path.join(out, "result.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

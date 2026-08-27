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

function runStreaming(program, args, prefix, logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const log = fs.openSync(logFile, "a");
    let closed = false;
    const closeLog = () => {
      if (!closed) {
        fs.closeSync(log);
        closed = true;
      }
    };
    const forward = signal => {
      if (!child.killed) child.kill(signal);
    };
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.stdout.on("data", chunk => {
      const value = chunk.toString();
      stdout += value;
      fs.writeSync(log, value);
      process.stdout.write(value.split("\n").map((line, index, lines) =>
        index + 1 === lines.length && line === "" ? "" : prefix + line)
        .join("\n"));
    });
    child.stderr.on("data", chunk => {
      const value = chunk.toString();
      stderr += value;
      fs.writeSync(log, value);
      process.stderr.write(prefix + value);
    });
    child.on("error", error => {
      closeLog();
      reject(error);
    });
    child.on("close", code => {
      process.removeListener("SIGINT", forward);
      process.removeListener("SIGTERM", forward);
      closeLog();
      if (code === 0) resolve(stdout);
      else reject(new Error(program + " failed: " +
        (stderr || stdout).trim()));
    });
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

const contractPath = "benchmarks/zero5-c32-v1/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contractSha256 = sha256(contractBytes);
const contract = JSON.parse(contractBytes);
if (contract.status !== "preregistered-unrun" || !contract.authorized) {
  fail("C3.2 contract is not authorized");
}
if (sha256(fs.readFileSync(contract.implementation.trainer)) !==
    contract.implementation.trainer_sha256 ||
    sha256(fs.readFileSync(contract.implementation.importer)) !==
      contract.implementation.importer_sha256 ||
    sha256(fs.readFileSync(contract.implementation.runner)) !==
      contract.implementation.runner_sha256) {
  fail("C3.2 implementation drifted from the contract");
}

const imported = JSON.parse(fs.readFileSync(contract.input.import_manifest));
if (sha256(fs.readFileSync(contract.input.import_manifest)) !==
    contract.input.import_manifest_sha256) {
  fail("C3.2 import manifest drifted");
}
const importDirectory = path.resolve(option("--import-dir",
  "build/zero5-c32-v1/import-final"));
const c0Directory = path.resolve(option("--c0-dir",
  "build/zero5-c0-v1/corpus-one"));
const c2Directory = path.resolve(option("--c2-dir",
  "build/zero5-c2-v1/run"));
const c2ImportDirectory = path.resolve(option("--c2-import-dir",
  "build/zero5-c2-v1/import-final"));
const out = path.resolve(option("--out", "build/zero5-c32-v1/run"));
const resumeRun = process.argv.includes("--resume-run");
const executionPath = path.join(out, "execution.json");
if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
  if (!resumeRun) fail("output directory already exists: " + out);
  if (!fs.existsSync(executionPath)) {
    fail("resume output has no execution identity: " + executionPath);
  }
  const execution = JSON.parse(fs.readFileSync(executionPath));
  if (execution.schema !== "zero.c32_execution.v1" ||
      execution.contract_sha256 !== contractSha256) {
    fail("resume output belongs to a different C3.2 contract");
  }
} else {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c32_execution.v1",
    experiment: contract.experiment,
    contract_sha256: contractSha256,
    status: "running",
  }, null, 2) + "\n");
}

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
  interleaved: path.join(importDirectory, "train.interleaved.z5pack"),
  validation: path.join(importDirectory, "validation.interleaved.z5pack"),
  tasks: Object.fromEntries(["claim", "cloze", "retrieval"].map(task =>
    [task, {
      packed: path.join(importDirectory, task + ".validation.z5pack"),
      completion: path.join(importDirectory,
        task + ".validation.completion-eval.bin"),
      paired: task === "cloze" ? null : path.join(importDirectory,
        task + ".validation.paired-eval.bin"),
    }]))
};
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
  if (files.tasks[task].paired) {
    requireArtifact(files.tasks[task].paired,
      imported.outputs.paired_validation[task].sha256,
      task + " paired evaluation");
  }
}

const common = ["--tokenizer", tokenizer];
function evaluatePacked(checkpoint, file, batches) {
  const output = run("./zero5_c32_lm", [
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
  const output = run("./zero5_c32_lm", [
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
  const output = await runCaptured("./zero5_c32_lm", [
    "--init", checkpoint, ...common, "--completion-eval", file,
  ]);
  return finalJson(output, "zero.c3_completion_eval.v1");
}

async function evaluatePaired(checkpoint, file) {
  const output = await runCaptured("./zero5_c32_lm", [
    "--init", checkpoint, ...common, "--paired-eval", file,
  ]);
  return finalJson(output, "zero.c32_paired_choice_eval.v1");
}

async function allCompletion(checkpoint) {
  const entries = await Promise.all(Object.entries(files.tasks).map(
    async ([task, value]) => [task,
      await evaluateCompletion(checkpoint, value.completion)],
  ));
  return Object.fromEntries(entries);
}

const baselinePath = path.join(out, "baseline.json");
let baseline;
if (fs.existsSync(baselinePath)) {
  const cached = JSON.parse(fs.readFileSync(baselinePath));
  if (cached.schema !== "zero.c32_baseline_cache.v1" ||
      cached.contract_sha256 !== contractSha256) {
    fail("cached baseline belongs to a different C3.2 contract");
  }
  baseline = cached.baseline;
  process.stdout.write("C3.2 using verified frozen C2 baseline cache\n");
} else {
  process.stdout.write("C3.2 reproducing frozen C2 baselines\n");
  baseline = {
    combined_selection_nats_per_token: evaluatePacked(initialCheckpoint,
      files.validation, contract.evaluation.selection_validation_packs),
    combined_final_nats_per_token: evaluatePacked(initialCheckpoint,
      files.validation, contract.evaluation.final_validation_packs),
    members: Object.fromEntries(Object.entries(files.tasks).map(
      ([task, value]) => [task, evaluatePacked(initialCheckpoint, value.packed,
        contract.evaluation.member_validation_packs)])),
    completion: await allCompletion(initialCheckpoint),
    paired: Object.fromEntries(await Promise.all(["claim", "retrieval"].map(
      async task => [task,
        await evaluatePaired(initialCheckpoint, files.tasks[task].paired)]))),
    atlas_nats_per_token: evaluateLegacy(initialCheckpoint, atlasTrain,
      atlasValidation, contract.evaluation.atlas_windows),
    anchor_nats_per_token: evaluateLegacy(initialCheckpoint, anchorTrain,
      anchorValidation, contract.evaluation.anchor_windows),
  };
  fs.writeFileSync(baselinePath, JSON.stringify({
    schema: "zero.c32_baseline_cache.v1",
    contract_sha256: contractSha256,
    baseline,
  }, null, 2) + "\n");
}
if (!close(baseline.combined_selection_nats_per_token,
      contract.baselines.combined_selection_nats_per_token) ||
    !close(baseline.combined_final_nats_per_token,
      contract.baselines.combined_final_nats_per_token) ||
    !close(baseline.atlas_nats_per_token,
      contract.baselines.atlas_nats_per_token) ||
    !close(baseline.anchor_nats_per_token,
      contract.baselines.anchor_nats_per_token)) {
  fail("C3.2 whole-distribution baseline changed");
}
for (const task of Object.keys(files.tasks)) {
  if (!close(baseline.members[task],
        contract.baselines.members[task].nats_per_token) ||
      !close(baseline.completion[task].nats_per_target_token,
        contract.baselines.completion[task].nats_per_target_token, 1e-7) ||
      !close(baseline.completion[task].last_target_token_accuracy,
        contract.baselines.completion[task].last_target_token_accuracy, 1e-7)) {
    fail(task + " C3.2 answer baseline changed");
  }
}
for (const task of ["claim", "retrieval"]) {
  for (const metric of ["forced_choice_nats", "choice_accuracy",
    "position_a_accuracy", "position_b_accuracy",
    "swap_consistency_accuracy", "pair_exact_accuracy"]) {
    if (!close(baseline.paired[task][metric],
      contract.baselines.paired[task][metric], 1e-7)) {
      fail(task + " C3.2 paired baseline changed: " + metric);
    }
  }
}

const armDefinitions = [
  { id: "C", weights: contract.arms.C.answer_weights },
  { id: "D", weights: contract.arms.D.answer_weights },
];
const arms = {};
for (const definition of armDefinitions) {
  const armDirectory = path.join(out, definition.id);
  const armResultPath = path.join(armDirectory, "result.json");
  const trainingLog = path.join(armDirectory, "training.log");
  const activeCheckpoint = path.join(armDirectory, "active.ckpt");
  const bestCheckpoint = path.join(armDirectory, "best.ckpt");
  if (fs.existsSync(armResultPath)) {
    const completed = JSON.parse(fs.readFileSync(armResultPath));
    if (completed.definition?.answer_weights == null ||
        JSON.stringify(completed.definition.answer_weights) !==
          JSON.stringify(definition.weights) ||
        !fs.existsSync(bestCheckpoint) ||
        artifact(bestCheckpoint).sha256 !== completed.checkpoint.sha256) {
      fail(definition.id + " completed arm state is corrupt or mismatched");
    }
    arms[definition.id] = completed;
    process.stdout.write("C3.2 arm " + definition.id +
      " already complete; verified cached result\n");
    continue;
  }
  fs.mkdirSync(armDirectory, { recursive: true });
  const resumingArm = fs.existsSync(activeCheckpoint);
  if (resumingArm && !resumeRun) {
    fail(definition.id + " has a partial checkpoint but --resume-run was not set");
  }
  if (resumingArm && !fs.existsSync(bestCheckpoint)) {
    fail(definition.id + " resume is missing its historical best checkpoint");
  }
  if (!resumingArm && fs.existsSync(trainingLog)) {
    fail(definition.id + " has a log without a resumable checkpoint");
  }
  process.stdout.write("C3.2 arm " + definition.id + " starting\n");
  const training = contract.training;
  await runStreaming("./zero5_c32_lm", [
    resumingArm ? "--resume" : "--init",
    resumingArm ? activeCheckpoint : initialCheckpoint, ...common,
    "--packed-train", files.interleaved,
    "--packed-validation", files.validation,
    "--run-contract-sha256", contractSha256,
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
    "--save", activeCheckpoint, "--save-every",
    String(contract.execution.checkpoint_every_updates),
    "--claim-answer-weight", String(definition.weights.claim),
    "--cloze-answer-weight", String(definition.weights.cloze),
    "--retrieval-answer-weight", String(definition.weights.retrieval),
    "--tokens", "0",
  ], "[" + definition.id + "] ", trainingLog);
  const log = fs.readFileSync(trainingLog, "utf8");
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
    /packed sampling sequences=(\d+) compute-token-exposures=(\d+) active-targets=(\d+) answer-targets=(\d+) claim-answer-targets=(\d+) cloze-answer-targets=(\d+) retrieval-answer-targets=(\d+) padding-targets=(\d+) wraps=(\d+) claim-answer-weight=([0-9.e+-]+) cloze-answer-weight=([0-9.e+-]+) retrieval-answer-weight=([0-9.e+-]+)/,
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
    paired: Object.fromEntries(await Promise.all(["claim", "retrieval"].map(
      async task => [task,
        await evaluatePaired(bestCheckpoint, files.tasks[task].paired)]))),
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
  validation.mean_paired_choice_accuracy =
    (validation.paired.claim.choice_accuracy +
      validation.paired.retrieval.choice_accuracy) / 2;
  validation.mean_pair_exact_accuracy =
    (validation.paired.claim.pair_exact_accuracy +
      validation.paired.retrieval.pair_exact_accuracy) / 2;
  const gates = {
    full_pack_pass: Number(accounting[1]) === training.pack_sequences &&
      Number(accounting[2]) === training.compute_token_exposures &&
      Number(accounting[3]) === training.active_targets &&
      Number(accounting[4]) === training.answer_targets &&
      Number(accounting[5]) === training.answer_targets_by_task.claim &&
      Number(accounting[6]) === training.answer_targets_by_task.cloze &&
      Number(accounting[7]) === training.answer_targets_by_task.retrieval &&
      Number(accounting[8]) === training.padding_targets &&
      Number(accounting[9]) === 0 &&
      close(Number(accounting[10]), definition.weights.claim, 1e-7) &&
      close(Number(accounting[11]), definition.weights.cloze, 1e-7) &&
      close(Number(accounting[12]), definition.weights.retrieval, 1e-7),
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
    claim_choice_accuracy: validation.paired.claim.choice_accuracy >=
      contract.gates.paired_choice_accuracy_minimum.claim,
    retrieval_choice_accuracy: validation.paired.retrieval.choice_accuracy >=
      contract.gates.paired_choice_accuracy_minimum.retrieval,
    claim_position_a_accuracy: validation.paired.claim.position_a_accuracy >=
      contract.gates.paired_position_accuracy_minimum,
    claim_position_b_accuracy: validation.paired.claim.position_b_accuracy >=
      contract.gates.paired_position_accuracy_minimum,
    retrieval_position_a_accuracy:
      validation.paired.retrieval.position_a_accuracy >=
        contract.gates.paired_position_accuracy_minimum,
    retrieval_position_b_accuracy:
      validation.paired.retrieval.position_b_accuracy >=
        contract.gates.paired_position_accuracy_minimum,
    claim_position_gap:
      Math.abs(validation.paired.claim.position_a_accuracy -
        validation.paired.claim.position_b_accuracy) <=
          contract.gates.paired_position_gap_maximum,
    retrieval_position_gap:
      Math.abs(validation.paired.retrieval.position_a_accuracy -
        validation.paired.retrieval.position_b_accuracy) <=
          contract.gates.paired_position_gap_maximum,
    claim_swap_consistency:
      validation.paired.claim.swap_consistency_accuracy >=
        contract.gates.swap_consistency_accuracy_minimum,
    retrieval_swap_consistency:
      validation.paired.retrieval.swap_consistency_accuracy >=
        contract.gates.swap_consistency_accuracy_minimum,
    claim_pair_exact: validation.paired.claim.pair_exact_accuracy >=
      contract.gates.pair_exact_accuracy_minimum,
    retrieval_pair_exact: validation.paired.retrieval.pair_exact_accuracy >=
      contract.gates.pair_exact_accuracy_minimum,
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
          value.last_target_token_accuracy]),
      ...Object.values(validation.paired).flatMap(value =>
        [value.forced_choice_nats, value.choice_accuracy,
          value.position_a_accuracy, value.position_b_accuracy,
          value.swap_consistency_accuracy, value.pair_exact_accuracy])]
      .every(Number.isFinite),
    test_metrics_opened: false,
  };
  const allGatesPass = Object.entries(gates).every(([name, value]) =>
    name === "test_metrics_opened" ? value === false : value === true);
  arms[definition.id] = {
    definition: {
      pack_order: "interleaved",
      answer_weights: definition.weights,
    },
    model: { backend: modelMatch[1], positions: modelMatch[2],
      parameters: Number(modelMatch[3]) },
    training: { completed_updates: training.updates,
      best_report_update: bestReport.update, reports,
      pack_sequences: Number(accounting[1]),
      compute_token_exposures: Number(accounting[2]),
      active_targets: Number(accounting[3]),
      answer_targets: Number(accounting[4]),
      answer_targets_by_task: { claim: Number(accounting[5]),
        cloze: Number(accounting[6]), retrieval: Number(accounting[7]) },
      padding_targets: Number(accounting[8]), wraps: Number(accounting[9]) },
    validation,
    checkpoint: artifact(bestCheckpoint),
    gates,
    all_gates_pass: allGatesPass,
  };
  fs.writeFileSync(armResultPath,
    JSON.stringify(arms[definition.id], null, 2) + "\n");
  process.stdout.write("C3.2 arm " + definition.id + " complete gates=" +
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
  schema: "zero.c32_braid_result.v1",
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
    release_id: contract.input.release_id,
    initial_checkpoint_sha256: contract.initialization.checkpoint_sha256,
  },
  baselines: baseline,
  arms,
  comparisons: {
    task_balance_D_minus_C_normalized_answer_score:
      meanAnswer(arms.D) - meanAnswer(arms.C),
    task_balance_D_minus_C_mean_choice_accuracy:
      arms.D.validation.mean_paired_choice_accuracy -
        arms.C.validation.mean_paired_choice_accuracy,
    task_balance_supported: arms.D.all_gates_pass &&
      meanAnswer(arms.D) < meanAnswer(arms.C) &&
      arms.D.validation.mean_paired_choice_accuracy >=
        arms.C.validation.mean_paired_choice_accuracy,
  },
  test: { records: imported.test.records, metrics_opened: false },
  rights: { license: "CC-BY-SA-4.0-derived", dataset_published: false,
    checkpoint_published: false, publication_review_required: true },
  decision: {
    eligible_arms: eligible.map(([id]) => id),
    preferred_arm: preferredArm,
    outcome: preferredArm === null ? "no-go" : "pass-c32-pilot",
    single_seed: true,
    replication_authorized: preferredArm !== null,
    broad_model_promotion_authorized: false,
    checkpoint_publication_authorized: false,
  },
};
fs.writeFileSync(path.join(out, "result.json"),
  JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync(executionPath, JSON.stringify({
  schema: "zero.c32_execution.v1",
  experiment: contract.experiment,
  contract_sha256: contractSha256,
  status: "complete",
  result_sha256: artifact(path.join(out, "result.json")).sha256,
}, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

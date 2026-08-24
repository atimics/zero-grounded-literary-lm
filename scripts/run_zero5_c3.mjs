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
  if (observed.sha256 !== expected)
    fail(label + " does not match the frozen contract");
  return observed;
}

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    fail(program + " failed: " + (result.stderr || result.stdout).trim());
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
    child.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(program + " failed: " +
        (stderr || stdout).trim()));
    });
  });
}

function runStreaming(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", code => {
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
      // Continue looking for the final structured line.
    }
  }
  fail("command did not return " + schema);
}

const contractPath = "benchmarks/zero5-c3-v1/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
if (contract.status !== "preregistered-unrun" || !contract.authorized)
  fail("C3 contract is not preregistered and authorized");
if (sha256(fs.readFileSync(contract.implementation.trainer)) !==
    contract.implementation.trainer_sha256)
  fail("C3 trainer drifted from the contract");
if (sha256(fs.readFileSync(contract.implementation.importer)) !==
    contract.implementation.importer_sha256)
  fail("C3 importer drifted from the contract");

const importDirectory = path.resolve(
  option("--import-dir", "build/zero5-c3-v1/import-final"),
);
const c0Directory = path.resolve(
  option("--c0-dir", "build/zero5-c0-v1/corpus-one"),
);
const c2Directory = path.resolve(
  option("--c2-dir", "build/zero5-c2-v1/run"),
);
const c2ImportDirectory = path.resolve(
  option("--c2-import-dir", "build/zero5-c2-v1/import-final"),
);
const out = path.resolve(option("--out", "build/zero5-c3-v1/run"));
if (fs.existsSync(out)) fail("output directory already exists: " + out);
fs.mkdirSync(out, { recursive: true });

const importBytes = fs.readFileSync(contract.input.import_manifest);
if (sha256(importBytes) !== contract.input.import_manifest_sha256)
  fail("frozen C3 import manifest drifted");
const imported = JSON.parse(importBytes);
const c2ResultBytes = fs.readFileSync(contract.initialization.c2_result);
if (sha256(c2ResultBytes) !== contract.initialization.c2_result_sha256)
  fail("frozen C2 result drifted");

const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
const train = path.join(importDirectory, "c3.train.byte-bpe512.tok");
const validation = path.join(importDirectory,
  "c3.validation.byte-bpe512.tok");
const initialCheckpoint = path.join(c2Directory, "best.ckpt");
const atlasTrain = path.join(c2ImportDirectory,
  "atlas.train.byte-bpe512.tok");
const atlasValidation = path.join(c2ImportDirectory,
  "atlas.validation.byte-bpe512.tok");
const anchorTrain = path.join(c0Directory, "train.byte-bpe512.tok");
const anchorValidation = path.join(c0Directory,
  "validation.byte-bpe512.tok");
requireArtifact(tokenizer, contract.input.tokenizer.sha256, "tokenizer");
requireArtifact(train, contract.input.train.tokens_sha256,
  "C3 training stream");
requireArtifact(validation, contract.input.validation.tokens_sha256,
  "C3 validation stream");
requireArtifact(initialCheckpoint,
  contract.initialization.checkpoint_sha256, "C2 checkpoint");

const memberPaths = Object.fromEntries(["claims", "cloze", "retrieval"].map(
  task => [task, {
    train: path.join(importDirectory, task === "retrieval"
      ? "retrieval.compact.train.byte-bpe512.tok"
      : task + ".train.byte-bpe512.tok"),
    validation: path.join(importDirectory, task === "retrieval"
      ? "retrieval.compact.validation.byte-bpe512.tok"
      : task + ".validation.byte-bpe512.tok"),
    completion: path.join(importDirectory,
      task + ".validation.completion-eval.bin"),
  }],
));
for (const task of Object.keys(memberPaths)) {
  requireArtifact(memberPaths[task].completion,
    contract.input.completion_validation[task].sha256,
    task + " completion evaluation");
}

function evaluate(checkpoint, trainPath, validationPath, windows) {
  const output = run("./zero5_c3_lm", [
    "--init", checkpoint, "--tokenizer", tokenizer,
    "--text", trainPath, "--validation-text", validationPath,
    "--eval-only", "--validation", String(windows),
  ]);
  const match = output.match(/evaluation-only val ([0-9.]+) batches=(\d+)/);
  if (!match || Number(match[2]) !== windows)
    fail("could not reproduce a frozen validation measurement");
  return Number(match[1]);
}

async function evaluateCompletion(checkpoint, file) {
  const output = await runCaptured("./zero5_c3_lm", [
    "--init", checkpoint, "--tokenizer", tokenizer,
    "--completion-eval", file,
  ]);
  return finalJson(output, "zero.c3_completion_eval.v1");
}

async function allCompletionMetrics(checkpoint) {
  const entries = await Promise.all(Object.entries(memberPaths).map(
    async ([task, paths]) => [task,
      await evaluateCompletion(checkpoint, paths.completion)],
  ));
  return Object.fromEntries(entries);
}

const initialCombinedSelection = evaluate(initialCheckpoint, train, validation,
  contract.baselines.combined_selection_windows);
const initialCombinedFinal = evaluate(initialCheckpoint, train, validation,
  contract.baselines.combined_final_windows);
const initialMembers = Object.fromEntries(Object.entries(memberPaths).map(
  ([task, paths]) => [task, evaluate(initialCheckpoint,
    paths.train, paths.validation, contract.baselines.member_windows)],
));
const initialAtlas = evaluate(initialCheckpoint, atlasTrain, atlasValidation,
  contract.baselines.atlas_windows);
const initialAnchor = evaluate(initialCheckpoint, anchorTrain, anchorValidation,
  contract.baselines.anchor_windows);
const initialCompletion = await allCompletionMetrics(initialCheckpoint);

function close(observed, expected, tolerance = 0.0001) {
  return Math.abs(observed - expected) <= tolerance;
}
if (!close(initialCombinedSelection,
      contract.baselines.combined_selection_nats_per_token) ||
    !close(initialCombinedFinal,
      contract.baselines.combined_final_nats_per_token) ||
    !close(initialAtlas, contract.baselines.atlas_nats_per_token) ||
    !close(initialAnchor, contract.baselines.anchor_nats_per_token))
  fail("C3 initialization distribution baselines did not reproduce");
for (const task of Object.keys(memberPaths)) {
  if (!close(initialMembers[task],
        contract.baselines.members[task].nats_per_token) ||
      !close(initialCompletion[task].nats_per_target_token,
        contract.baselines.completion[task].nats_per_target_token, 1e-7) ||
      !close(initialCompletion[task].last_target_token_accuracy,
        contract.baselines.completion[task].last_target_token_accuracy, 1e-7))
    fail(task + " C3 initialization baseline did not reproduce");
}

const bestCheckpoint = path.join(out, "best.ckpt");
const training = contract.training;
const log = await runStreaming("./zero5_c3_lm", [
  "--init", initialCheckpoint,
  "--tokenizer", tokenizer,
  "--text", train,
  "--validation-text", validation,
  "--sequential",
  "--steps", String(training.updates),
  "--batch", String(training.batch_sequences),
  "--lr", String(training.peak_learning_rate),
  "--weight-decay", String(training.weight_decay),
  "--clip", String(training.gradient_clip),
  "--warmup", String(training.warmup_updates),
  "--schedule-total", String(training.updates),
  "--cosine",
  "--dropout", String(training.residual_dropout),
  "--report", String(training.report_every_updates),
  "--validation", String(training.selection_validation_windows),
  "--best", bestCheckpoint,
  "--seed", String(training.seed),
  "--tokens", "0",
]);
fs.writeFileSync(path.join(out, "training.log"), log);
if (!fs.existsSync(bestCheckpoint)) fail("C3 did not save a best checkpoint");

const modelMatch = log.match(
  /zero5_lm: backend=([^ ]+).*positions=([^ ]+) parameters=(\d+) trainable-scope=all/,
);
if (!modelMatch) fail("could not parse C3 model identity");
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
const expectedReports = Math.floor(training.updates /
  training.report_every_updates) + 1;
if (reports.length !== expectedReports ||
    reports.at(-1).update !== training.updates)
  fail("C3 did not complete every frozen report");
const sequential = log.match(
  /sequential sampling windows=(\d+) token-exposures=(\d+) wraps=(\d+)/,
);
if (!sequential) fail("C3 did not report ordered-stream accounting");

const selectedCombined = evaluate(bestCheckpoint, train, validation,
  training.selection_validation_windows);
const bestReport = reports.reduce((best, row) =>
  row.combined_validation_nats_per_token <
      best.combined_validation_nats_per_token ? row : best,
);
if (!close(selectedCombined,
      bestReport.combined_validation_nats_per_token))
  fail("C3 selected checkpoint did not reproduce its validation report");
const finalCombined = evaluate(bestCheckpoint, train, validation,
  training.final_validation_windows);
const finalMembers = Object.fromEntries(Object.entries(memberPaths).map(
  ([task, paths]) => [task, evaluate(bestCheckpoint,
    paths.train, paths.validation, training.final_member_windows)],
));
const finalAtlas = evaluate(bestCheckpoint, atlasTrain, atlasValidation,
  training.final_atlas_windows);
const finalAnchor = evaluate(bestCheckpoint, anchorTrain, anchorValidation,
  training.final_anchor_windows);
const finalCompletion = await allCompletionMetrics(bestCheckpoint);

const combinedRelativeImprovement = 1 - finalCombined / initialCombinedFinal;
const atlasRelativeRegression = finalAtlas / initialAtlas - 1;
const anchorRelativeRegression = finalAnchor / initialAnchor - 1;
const completionRelativeImprovement = Object.fromEntries(
  Object.keys(memberPaths).map(task => [task,
    1 - finalCompletion[task].nats_per_target_token /
      initialCompletion[task].nats_per_target_token],
  ),
);
const millionExposures = training.token_exposures / 1e6;
const learningPerMillion = {
  combined_nats_reduction:
    (initialCombinedFinal - finalCombined) / millionExposures,
  completion_nats_reduction: Object.fromEntries(
    Object.keys(memberPaths).map(task => [task,
      (initialCompletion[task].nats_per_target_token -
        finalCompletion[task].nats_per_target_token) / millionExposures],
    ),
  ),
};

const gates = {
  full_ordered_c3_pass:
    Number(sequential[1]) === training.updates * training.batch_sequences &&
    Number(sequential[2]) === training.token_exposures &&
    Number(sequential[3]) === training.expected_stream_wraps,
  combined_validation_nats_per_token:
    finalCombined <= contract.gates.combined_validation_nats_per_token_maximum,
  combined_relative_improvement:
    combinedRelativeImprovement >=
      contract.gates.combined_relative_improvement_minimum,
  claims_completion_nats_per_token:
    finalCompletion.claims.nats_per_target_token <=
      contract.gates.completion_nats_per_target_token_maximum.claims,
  cloze_completion_nats_per_token:
    finalCompletion.cloze.nats_per_target_token <=
      contract.gates.completion_nats_per_target_token_maximum.cloze,
  retrieval_completion_nats_per_token:
    finalCompletion.retrieval.nats_per_target_token <=
      contract.gates.completion_nats_per_target_token_maximum.retrieval,
  retrieval_choice_accuracy:
    finalCompletion.retrieval.last_target_token_accuracy >=
      contract.gates.retrieval_choice_accuracy_minimum,
  atlas_retention_nats_per_token:
    finalAtlas <= contract.gates.atlas_nats_per_token_maximum,
  atlas_relative_regression:
    atlasRelativeRegression <=
      contract.gates.atlas_relative_regression_maximum,
  anchor_retention_nats_per_token:
    finalAnchor <= contract.gates.anchor_nats_per_token_maximum,
  anchor_relative_regression:
    anchorRelativeRegression <=
      contract.gates.anchor_relative_regression_maximum,
  finite_metrics: [selectedCombined, finalCombined, finalAtlas, finalAnchor,
    ...Object.values(finalMembers),
    ...Object.values(finalCompletion).flatMap(value =>
      [value.nats_per_target_token, value.top1_token_accuracy,
        value.last_target_token_accuracy])].every(Number.isFinite),
  test_metrics_opened: false,
};
const allGatesPass = Object.entries(gates).every(([name, value]) =>
  name === "test_metrics_opened" ? value === false : value === true,
);
const result = {
  schema: "zero.c3_continued_training_result.v1",
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
    initial_checkpoint_sha256: contract.initialization.checkpoint_sha256,
  },
  model: {
    backend: modelMatch[1],
    positions: modelMatch[2],
    parameters: Number(modelMatch[3]),
  },
  baselines: {
    combined_selection_nats_per_token: initialCombinedSelection,
    combined_final_nats_per_token: initialCombinedFinal,
    members: initialMembers,
    completion: initialCompletion,
    atlas_nats_per_token: initialAtlas,
    anchor_nats_per_token: initialAnchor,
  },
  training: {
    seed: training.seed,
    completed_updates: training.updates,
    ordered_windows: Number(sequential[1]),
    token_exposures: Number(sequential[2]),
    ordered_stream_wraps: Number(sequential[3]),
    best_report_update: bestReport.update,
    reports,
  },
  validation: {
    combined_selection_nats_per_token: selectedCombined,
    combined_final_nats_per_token: finalCombined,
    combined_relative_improvement: combinedRelativeImprovement,
    members: finalMembers,
    completion: finalCompletion,
    completion_relative_improvement: completionRelativeImprovement,
    atlas_nats_per_token: finalAtlas,
    atlas_relative_regression: atlasRelativeRegression,
    anchor_nats_per_token: finalAnchor,
    anchor_relative_regression: anchorRelativeRegression,
    learning_per_million_token_exposures: learningPerMillion,
  },
  checkpoint: artifact(bestCheckpoint),
  test: {
    claims_records: imported.test.claims_records,
    cloze_records: imported.test.cloze_records,
    retrieval_records: imported.test.retrieval_records,
    metrics_opened: false,
  },
  rights: {
    license: "CC-BY-SA-4.0-derived",
    dataset_published: false,
    checkpoint_published: false,
    publication_review_required: true,
  },
  gates,
  decision: {
    all_gates_pass: allGatesPass,
    outcome: allGatesPass ? "pass-c3-pilot" : "no-go",
    task_structure_superiority_claim_authorized: false,
    token_matched_atlas_control_authorized: false,
    replication_seeds_authorized: false,
    broad_model_promotion_authorized: false,
    checkpoint_publication_authorized: false,
  },
};
fs.writeFileSync(path.join(out, "result.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

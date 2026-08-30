#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
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
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  const wanted = typeof expected === "string" ? expected : expected.sha256;
  if (observed.sha256 !== wanted ||
      (typeof expected === "object" && expected.bytes !== undefined &&
       observed.bytes !== expected.bytes)) fail(`${label} changed`);
  return observed;
}

function run(program, args, environment = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function runStreaming(program, args, environment, logFile, maximumSeconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...environment },
    });
    const log = fs.openSync(logFile, "a");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 10000);
    }, maximumSeconds * 1000);
    const write = (stream, chunk) => {
      const value = chunk.toString();
      fs.writeSync(log, value);
      stream.write(value);
      return value;
    };
    child.stdout.on("data", chunk => { stdout += write(process.stdout, chunk); });
    child.stderr.on("data", chunk => { stderr += write(process.stderr, chunk); });
    child.on("error", error => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      fs.closeSync(log);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      fs.closeSync(log);
      if (timedOut) reject(new Error(
        `C5.1 local execution exceeded ${maximumSeconds} seconds`));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${program} failed: ${(stderr || stdout).trim()}`));
    });
  });
}

function parseAccounting(log) {
  const match = log.match(/packed sampling sequences=(\d+) compute-token-exposures=(\d+) active-targets=(\d+) answer-targets=(\d+) claim-answer-targets=(\d+) cloze-answer-targets=(\d+) retrieval-answer-targets=(\d+) padding-targets=(\d+) wraps=(\d+)/u);
  if (!match) return null;
  return { pack_sequences: Number(match[1]),
    compute_token_exposures: Number(match[2]),
    active_targets: Number(match[3]), answer_targets: Number(match[4]),
    claim_answer_targets: Number(match[5]),
    cloze_answer_targets: Number(match[6]),
    retrieval_answer_targets: Number(match[7]),
    padding_targets: Number(match[8]), wraps: Number(match[9]) };
}

async function selfTest() {
  const accounting = parseAccounting("packed sampling sequences=37768 " +
    "compute-token-exposures=19337216 active-targets=14850534 " +
    "answer-targets=1589463 claim-answer-targets=447614 " +
    "cloze-answer-targets=430769 retrieval-answer-targets=711080 " +
    "padding-targets=4486682 wraps=0");
  assert.equal(accounting.pack_sequences, 37768);
  assert.equal(accounting.answer_targets, 1589463);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c51-runner-"));
  try {
    await assert.rejects(runStreaming(process.execPath,
      ["-e", "setTimeout(() => {}, 1000)"], {},
      path.join(directory, "timeout.log"), .01), /execution exceeded/u);
  } finally { fs.rmSync(directory, { recursive: true }); }
  process.stdout.write("ZERO.5 C5.1 runner self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
  process.exit(0);
}

const contractPath = path.resolve(option("--contract",
  "benchmarks/zero5-c51-statebridge-v1/contract.json"));
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const contractSha256 = sha256(contractBytes);
if (contract.schema !== "zero.c51_statebridge_contract.v1" ||
    contract.status !== "authorized-unrun" || contract.authorized !== true ||
    contract.authorization?.training_authorized !== true) {
  fail("C5.1 local training is not explicitly authorized");
}
if (contract.execution.venue !== "local" ||
    contract.training.paid_compute_authorized !== false ||
    contract.training.cost_ceiling_usd !== null) {
  fail("C5.1 execution exceeds the local no-cost authorization");
}
if (contract.test.content_present !== false ||
    contract.test.metrics_opened !== false ||
    contract.claim_boundary.structured_content_only !== true) {
  fail("C5.1 claim or sealed-test boundary changed");
}
for (const name of ["trainer", "importer", "evaluator", "runner"]) {
  requireArtifact(contract.implementation[name],
    contract.implementation[`${name}_sha256`], `frozen C5.1 ${name}`);
}

const importDirectory = path.resolve(option("--import-dir",
  "build/zero5-c51-statebridge-v1/import-final"));
const c43Import = path.resolve(option("--c43-import"));
const c0Directory = path.resolve(option("--c0-dir"));
const c2Directory = path.resolve(option("--c2-dir"));
const c2ImportDirectory = path.resolve(option("--c2-import-dir"));
const out = path.resolve(option("--out", "build/zero5-c51-statebridge-v1/run"));
const binary = path.resolve(option("--trainer", "./zero5_c32_lm_vector_math"));
const preflightOnly = process.argv.includes("--preflight-only");
const resumeRun = process.argv.includes("--resume-run");
const importedPath = path.join(importDirectory, "import.json");
const imported = JSON.parse(fs.readFileSync(importedPath));
requireArtifact(importedPath, contract.verified_import.receipt_sha256,
  "C5.1 import receipt");
if (imported.schema !== "zero.c51_statebridge_import.v1" ||
    imported.release.id !== contract.braid.release_id ||
    imported.test.content_present !== false ||
    imported.test.metrics_opened !== false) fail("C5.1 import changed");

const files = {
  tokenizer: path.join(c0Directory, "byte-bpe512.sero"),
  initial: path.join(c2Directory, "best.ckpt"),
  train: path.join(importDirectory, "train.mixed.grouped.z5pack"),
  validation: path.join(c43Import, "frozen-validation", "validation.z5pack"),
  atlasTrain: path.join(c2ImportDirectory, "atlas.train.byte-bpe512.tok"),
  atlasValidation: path.join(c2ImportDirectory,
    "atlas.validation.byte-bpe512.tok"),
  anchorTrain: path.join(c0Directory, "train.byte-bpe512.tok"),
  anchorValidation: path.join(c0Directory, "validation.byte-bpe512.tok"),
};
requireArtifact(files.tokenizer, contract.model.tokenizer_sha256, "tokenizer");
requireArtifact(files.initial, contract.initialization.checkpoint_sha256,
  "C2 checkpoint");
requireArtifact(files.train, contract.verified_import.primary,
  "mixed training packs");
requireArtifact(files.validation,
  contract.evaluation.frozen_c42_validation_sha256, "frozen validation");
const retention = contract.evaluation.retention_inputs;
requireArtifact(files.atlasTrain, retention.atlas_train_sha256,
  "Atlas training tokens");
requireArtifact(files.atlasValidation, retention.atlas_validation_sha256,
  "Atlas validation tokens");
requireArtifact(files.anchorTrain, retention.anchor_train_sha256,
  "C1 anchor training tokens");
requireArtifact(files.anchorValidation, retention.anchor_validation_sha256,
  "C1 anchor validation tokens");
const evaluatorPreflight = JSON.parse(run("node", [
  contract.implementation.evaluator, "--contract", contractPath,
  "--import-dir", importDirectory, "--preflight-only",
]).trim());
if (evaluatorPreflight.evaluator_artifacts_verified !== true ||
    evaluatorPreflight.test_metrics_opened !== false) {
  fail("C5.1 evaluator preflight failed");
}
if (preflightOnly) {
  process.stdout.write(JSON.stringify({
    schema: "zero.c51_statebridge_training_preflight.v1",
    contract_sha256: contractSha256,
    import_receipt_sha256: artifact(importedPath).sha256,
    updates: contract.training.update_groups,
    compute_token_exposures: contract.training.compute_token_exposures,
    paid_compute_authorized: false,
    evaluator_artifacts_verified: true,
    test_metrics_opened: false,
  }) + "\n");
  process.exit(0);
}
if (!fs.existsSync(binary)) fail(`trainer binary is missing: ${binary}`);

fs.mkdirSync(out, { recursive: true });
const executionPath = path.join(out, "execution.json");
const resultPath = path.join(out, "result.json");
if (fs.existsSync(executionPath)) {
  if (!resumeRun) fail("output exists; pass --resume-run to resume it");
  const execution = JSON.parse(fs.readFileSync(executionPath));
  if (execution.contract_sha256 !== contractSha256) {
    fail("resume output belongs to a different contract");
  }
} else {
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c51_statebridge_execution.v1",
    experiment: contract.experiment, contract_sha256: contractSha256,
    status: "running",
  }, null, 2) + "\n");
}

const environment = {
  OPENBLAS_NUM_THREADS: String(contract.execution.blas_threads),
  OMP_NUM_THREADS: String(contract.execution.blas_threads),
  VECLIB_MAXIMUM_THREADS: String(contract.execution.blas_threads),
  OPENBLAS_DYNAMIC: "0",
};
const activeCheckpoint = path.join(out, "active.ckpt");
const bestCheckpoint = path.join(out, "best.ckpt");
const trainingLog = path.join(out, "training.log");
try {
  if (!fs.existsSync(resultPath)) {
    const resuming = fs.existsSync(activeCheckpoint);
    if (resuming && !resumeRun) fail("partial checkpoint requires --resume-run");
    const training = contract.training;
    const started = process.hrtime.bigint();
    await runStreaming(binary, [
      resuming ? "--resume" : "--init",
      resuming ? activeCheckpoint : files.initial,
      "--tokenizer", files.tokenizer,
      "--packed-train", files.train,
      "--packed-validation", files.validation,
      "--run-contract-sha256", contractSha256,
      "--steps", String(training.update_groups),
      "--schedule-total", String(training.update_groups),
      "--batch", String(training.maximum_batch_sequences),
      "--parallel-batch", String(training.parallel_workers),
      "--lr", String(training.peak_learning_rate),
      "--weight-decay", String(training.weight_decay),
      "--clip", String(training.gradient_clip),
      "--warmup", String(training.warmup_updates), "--cosine",
      "--dropout", String(training.residual_dropout),
      "--report", String(training.report_every_updates),
      "--validation", String(training.selection_validation_packs),
      "--best", bestCheckpoint, "--seed", String(training.seed),
      "--save", activeCheckpoint, "--save-every",
      String(contract.execution.checkpoint_every_updates),
      "--claim-answer-weight", String(training.answer_weights.claim),
      "--cloze-answer-weight", String(training.answer_weights.cloze),
      "--retrieval-answer-weight", String(training.answer_weights.retrieval),
      "--tokens", "0",
    ], environment, trainingLog, contract.execution.maximum_execution_seconds);
    const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    const log = fs.readFileSync(trainingLog, "utf8");
    const reports = [...log.matchAll(
      /^update\s+(\d+) train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+) tok\/s (\d+)/gmu,
    )].map(match => ({ update: Number(match[1]),
      train_nats_per_token: Number(match[2]),
      validation_nats_per_token: Number(match[3]),
      gradient_norm: Number(match[4]), learning_rate: Number(match[5]),
      tokens_per_second: Number(match[6]) }));
    if (reports.at(-1)?.update !== training.update_groups) {
      fail("C5.1 training did not reach its final update");
    }
    const accounting = parseAccounting(log);
    const expected = contract.verified_import.primary;
    if (!accounting || accounting.pack_sequences !== expected.packs ||
        accounting.compute_token_exposures !== expected.compute_token_exposures ||
        accounting.active_targets !== expected.active_targets ||
        accounting.answer_targets !== expected.answer_targets ||
        accounting.claim_answer_targets !==
          expected.answer_targets_by_task.claim ||
        accounting.cloze_answer_targets !==
          expected.answer_targets_by_task.cloze ||
        accounting.retrieval_answer_targets !==
          expected.answer_targets_by_task.retrieval ||
        accounting.padding_targets !== expected.padding_targets ||
        accounting.wraps !== 0) fail("C5.1 training accounting changed");
    const validationPath = path.join(out, "validation.json");
    run("node", [contract.implementation.evaluator,
      "--contract", contractPath, "--trainer", binary,
      "--checkpoint", bestCheckpoint,
      "--baseline-checkpoint", files.initial,
      "--tokenizer", files.tokenizer, "--import-dir", importDirectory,
      "--c43-import", c43Import,
      "--atlas-train", files.atlasTrain,
      "--atlas-validation", files.atlasValidation,
      "--anchor-train", files.anchorTrain,
      "--anchor-validation", files.anchorValidation,
      "--out", validationPath], environment);
    const validation = JSON.parse(fs.readFileSync(validationPath));
    fs.writeFileSync(resultPath, JSON.stringify({
      schema: "zero.c51_statebridge_result.v1",
      experiment: contract.experiment, status: "complete",
      contract_sha256: contractSha256,
      training: { completed_updates: reports.at(-1).update,
        elapsed_seconds: elapsedSeconds,
        aggregate_compute_tokens_per_second:
          training.compute_token_exposures / elapsedSeconds,
        reports, accounting },
      checkpoints: { published: false, active: artifact(activeCheckpoint),
        best: artifact(bestCheckpoint) },
      validation,
      decision: { replication_eligible: validation.replication_eligible,
        promotion_eligible: false, test_metrics_opened: false },
      claim_boundary: contract.claim_boundary,
    }, null, 2) + "\n");
  }
} catch (error) {
  fail(error.message);
}

const result = JSON.parse(fs.readFileSync(resultPath));
if (result.training.completed_updates !== contract.training.update_groups ||
    result.decision.test_metrics_opened !== false ||
    result.decision.promotion_eligible !== false) {
  fail("cached C5.1 result is incomplete or unsafe");
}
fs.writeFileSync(executionPath, JSON.stringify({
  schema: "zero.c51_statebridge_execution.v1",
  experiment: contract.experiment, contract_sha256: contractSha256,
  status: "complete", result_sha256: artifact(resultPath).sha256,
}, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
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
  if (observed.sha256 !== expected) fail(`${label} drifted from the contract`);
  return observed;
}

function run(program, args, environment = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function runStreaming(program, args, environment, logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...environment },
    });
    const log = fs.openSync(logFile, "a");
    let stdout = "";
    let stderr = "";
    const write = (stream, chunk) => {
      const value = chunk.toString();
      fs.writeSync(log, value);
      stream.write(value);
      return value;
    };
    child.stdout.on("data", chunk => { stdout += write(process.stdout, chunk); });
    child.stderr.on("data", chunk => { stderr += write(process.stderr, chunk); });
    child.on("error", error => { fs.closeSync(log); reject(error); });
    child.on("close", code => {
      fs.closeSync(log);
      code === 0 ? resolve(stdout) : reject(new Error(
        `${program} failed: ${(stderr || stdout).trim()}`));
    });
  });
}

function close(left, right, tolerance = 0.0001) {
  return Math.abs(left - right) <= tolerance;
}

const contractPath = "benchmarks/zero5-c33-parallel-v1/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const contractSha256 = sha256(contractBytes);
if (contract.schema !== "zero.c33_parallel_replay.v1") {
  fail("unexpected parallel replay contract");
}
if (contract.status !== "preregistered-unrun" || !contract.authorized) {
  fail("parallel replay is not authorized");
}
if (sha256(fs.readFileSync(contract.implementation.trainer)) !==
      contract.implementation.trainer_sha256 ||
    sha256(fs.readFileSync(contract.implementation.runner)) !==
      contract.implementation.runner_sha256) {
  fail("parallel replay implementation drifted from the contract");
}

const imported = JSON.parse(fs.readFileSync(contract.input.import_manifest));
requireArtifact(contract.input.import_manifest,
  contract.input.import_manifest_sha256, "C3.3 import manifest");
if (imported.schema !== "zero.c33_import.v1" ||
    imported.release.id !== contract.input.release_id ||
    imported.paired_training.optimizer_batches !== contract.training.updates ||
    imported.paired_training.pair_cross_batch_leakage !== 0) {
  fail("C3.3 import is not the frozen pair-atomic release");
}

const importDirectory = path.resolve(option("--import-dir",
  "build/zero5-c33-v1/import-final"));
const c0Directory = path.resolve(option("--c0-dir",
  "build/zero5-c0-v1/corpus-one"));
const c2Directory = path.resolve(option("--c2-dir",
  "build/zero5-c2-v1/run"));
const out = path.resolve(option("--out",
  "build/zero5-c33-parallel-v1/run"));
const preflightOnly = process.argv.includes("--preflight-only");
const resumeRun = process.argv.includes("--resume-run");
const binary = "./zero5_c32_lm_fast";

const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
const initialCheckpoint = path.join(c2Directory, "best.ckpt");
const trainPacks = path.join(importDirectory, "train.interleaved.z5pack");
const validationPacks = path.join(importDirectory,
  "validation.interleaved.z5pack");
requireArtifact(tokenizer, contract.input.tokenizer_sha256, "tokenizer");
requireArtifact(initialCheckpoint,
  contract.initialization.checkpoint_sha256, "C2 checkpoint");
requireArtifact(trainPacks, contract.input.train_packs_sha256,
  "training packs");
requireArtifact(validationPacks, contract.input.validation_packs_sha256,
  "validation packs");

if (preflightOnly) {
  process.stdout.write(JSON.stringify({
    schema: "zero.c33_parallel_preflight.v1",
    contract_sha256: contractSha256,
    updates: contract.training.updates,
    parallel_workers: contract.execution.parallel_workers,
    test_metrics_opened: false,
  }) + "\n");
  process.exit(0);
}
if (!fs.existsSync(binary)) fail(`fast trainer is missing: ${binary}`);

fs.mkdirSync(out, { recursive: true });
const executionPath = path.join(out, "execution.json");
if (fs.existsSync(executionPath)) {
  if (!resumeRun) fail("output exists; pass --resume-run to resume it");
  const execution = JSON.parse(fs.readFileSync(executionPath));
  if (execution.contract_sha256 !== contractSha256) {
    fail("resume output belongs to a different contract");
  }
} else {
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c33_parallel_execution.v1",
    experiment: contract.experiment,
    contract_sha256: contractSha256,
    status: "running",
  }, null, 2) + "\n");
}

const common = ["--tokenizer", tokenizer];
const calibrationPath = path.join(out, "calibration.json");
let calibration;
if (fs.existsSync(calibrationPath)) {
  calibration = JSON.parse(fs.readFileSync(calibrationPath));
} else {
  const candidates = [];
  for (const candidate of contract.calibration.candidates) {
    const environment = {
      OPENBLAS_NUM_THREADS: String(candidate.blas_threads),
      OMP_NUM_THREADS: String(candidate.blas_threads),
      OPENBLAS_DYNAMIC: "0",
    };
    const output = run(binary, [
      "--init", initialCheckpoint, ...common,
      "--packed-train", trainPacks,
      "--packed-validation", validationPacks,
      "--steps", String(contract.calibration.updates),
      "--schedule-total", String(contract.calibration.updates),
      "--batch", String(contract.training.batch_sequences),
      "--parallel-batch", String(candidate.parallel_workers),
      "--lr", String(contract.training.peak_learning_rate),
      "--weight-decay", String(contract.training.weight_decay),
      "--clip", String(contract.training.gradient_clip),
      "--warmup", String(Math.min(contract.training.warmup_updates,
        contract.calibration.updates)),
      "--cosine", "--dropout", String(contract.training.residual_dropout),
      "--report", String(contract.calibration.updates),
      "--validation", String(contract.calibration.validation_packs),
      "--claim-answer-weight", String(contract.training.answer_weights.claim),
      "--cloze-answer-weight", String(contract.training.answer_weights.cloze),
      "--retrieval-answer-weight",
      String(contract.training.answer_weights.retrieval),
      "--tokens", "0",
    ], environment);
    const match = output.match(/update\s+\d+ train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr [0-9.e+-]+ tok\/s (\d+)/);
    if (!match) fail("calibration produced no timing report");
    candidates.push({ ...candidate,
      train_nats_per_token: Number(match[1]),
      validation_nats_per_token: Number(match[2]),
      gradient_norm: Number(match[3]), tokens_per_second: Number(match[4]) });
  }
  candidates.sort((left, right) => right.tokens_per_second -
    left.tokens_per_second || left.parallel_workers - right.parallel_workers ||
    left.blas_threads - right.blas_threads);
  calibration = {
    schema: "zero.c33_parallel_calibration.v1",
    candidates,
    selected: candidates[0],
  };
  fs.writeFileSync(calibrationPath,
    JSON.stringify(calibration, null, 2) + "\n");
}

const selected = calibration.selected;
const environment = {
  OPENBLAS_NUM_THREADS: String(selected.blas_threads),
  OMP_NUM_THREADS: String(selected.blas_threads),
  OPENBLAS_DYNAMIC: "0",
};
const activeCheckpoint = path.join(out, "active.ckpt");
const bestCheckpoint = path.join(out, "best.ckpt");
const trainingLog = path.join(out, "training.log");
const resultPath = path.join(out, "result.json");
if (!fs.existsSync(resultPath)) {
  const resuming = fs.existsSync(activeCheckpoint);
  if (resuming && !resumeRun) fail("partial checkpoint requires --resume-run");
  const started = process.hrtime.bigint();
  await runStreaming(binary, [
    resuming ? "--resume" : "--init",
    resuming ? activeCheckpoint : initialCheckpoint, ...common,
    "--packed-train", trainPacks,
    "--packed-validation", validationPacks,
    "--run-contract-sha256", contractSha256,
    "--steps", String(contract.training.updates),
    "--schedule-total", String(contract.training.updates),
    "--batch", String(contract.training.batch_sequences),
    "--parallel-batch", String(selected.parallel_workers),
    "--lr", String(contract.training.peak_learning_rate),
    "--weight-decay", String(contract.training.weight_decay),
    "--clip", String(contract.training.gradient_clip),
    "--warmup", String(contract.training.warmup_updates),
    "--cosine", "--dropout", String(contract.training.residual_dropout),
    "--report", String(contract.training.report_every_updates),
    "--validation", String(contract.evaluation.validation_packs),
    "--best", bestCheckpoint, "--seed", String(contract.training.seed),
    "--save", activeCheckpoint, "--save-every",
    String(contract.execution.checkpoint_every_updates),
    "--claim-answer-weight", String(contract.training.answer_weights.claim),
    "--cloze-answer-weight", String(contract.training.answer_weights.cloze),
    "--retrieval-answer-weight",
    String(contract.training.answer_weights.retrieval),
    "--tokens", "0",
  ], environment, trainingLog);
  const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  const log = fs.readFileSync(trainingLog, "utf8");
  const reports = [...log.matchAll(
    /^update\s+(\d+) train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+) tok\/s (\d+)/gm,
  )].map(match => ({ update: Number(match[1]),
    train_nats_per_token: Number(match[2]),
    validation_nats_per_token: Number(match[3]),
    gradient_norm: Number(match[4]), learning_rate: Number(match[5]),
    tokens_per_second: Number(match[6]) }));
  if (reports.at(-1)?.update !== contract.training.updates) {
    fail("full replay did not reach its final update");
  }
  const accounting = log.match(/packed sampling sequences=(\d+) compute-token-exposures=(\d+) active-targets=(\d+).*padding-targets=(\d+) wraps=(\d+)/);
  if (!accounting || Number(accounting[1]) !== contract.training.pack_sequences ||
      Number(accounting[2]) !== contract.training.compute_token_exposures ||
      Number(accounting[3]) !== contract.training.active_targets ||
      Number(accounting[4]) !== contract.training.padding_targets ||
      Number(accounting[5]) !== 0) {
    fail("full replay accounting changed");
  }
  const evaluate = checkpoint => {
    const output = run(binary, ["--init", checkpoint, ...common,
      "--packed-validation", validationPacks, "--eval-only",
      "--validation", String(contract.evaluation.validation_packs)], environment);
    const match = output.match(/packed-evaluation-only val ([0-9.]+) batches=(\d+)/);
    if (!match || Number(match[2]) !== contract.evaluation.validation_packs) {
      fail("packed validation did not reproduce");
    }
    return Number(match[1]);
  };
  const bestValidation = evaluate(bestCheckpoint);
  const finalValidation = evaluate(activeCheckpoint);
  const finalReport = reports.at(-1);
  const result = {
    schema: "zero.c33_parallel_replay_result.v1",
    experiment: contract.experiment,
    status: "complete",
    contract_sha256: contractSha256,
    implementation: { trainer_sha256: contract.implementation.trainer_sha256,
      runner_sha256: contract.implementation.runner_sha256,
      binary: "fast", backend: "openblas" },
    calibration,
    training: { completed_updates: finalReport.update, reports,
      elapsed_seconds: elapsedSeconds,
      aggregate_compute_tokens_per_second:
        contract.training.compute_token_exposures / elapsedSeconds,
      final_interval_tokens_per_second: finalReport.tokens_per_second,
      final_train_nats_per_token: finalReport.train_nats_per_token,
      best_validation_nats_per_token: bestValidation,
      final_validation_nats_per_token: finalValidation },
    checkpoints: { active: artifact(activeCheckpoint),
      best: artifact(bestCheckpoint) },
    controls: { same_records: true, same_order: true, same_seed: true,
      same_hyperparameters: true, parallel_workers: selected.parallel_workers,
      blas_threads: selected.blas_threads, deterministic_merge_order: true,
      numerically_identical_to_serial: false, test_metrics_opened: false },
    claim_boundary: contract.claim_boundary,
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
}

const result = JSON.parse(fs.readFileSync(resultPath));
if (!close(result.training.completed_updates, contract.training.updates, 0)) {
  fail("cached replay result is incomplete");
}
fs.writeFileSync(executionPath, JSON.stringify({
  schema: "zero.c33_parallel_execution.v1",
  experiment: contract.experiment,
  contract_sha256: contractSha256,
  status: "complete",
  result_sha256: artifact(resultPath).sha256,
}, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ...environment } });
  if (result.status !== 0)
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function runStreaming(program, args, environment, logFile, maximumSeconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...environment } });
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
    const append = (stream, chunk) => {
      const value = chunk.toString();
      fs.writeSync(log, value);
      stream.write(value);
      return value;
    };
    child.stdout.on("data", chunk => { stdout += append(process.stdout, chunk); });
    child.stderr.on("data", chunk => { stderr += append(process.stderr, chunk); });
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
        `Shared-State execution exceeded ${maximumSeconds} seconds`));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${program} failed: ${(stderr || stdout).trim()}`));
    });
  });
}

function parseLog(log) {
  const reports = [...log.matchAll(/^update\s+(\d+) lm ([0-9.]+) aux ([0-9.]+) aux-acc ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+) tok\/s (\d+)/gmu)]
    .map(match => ({ update: Number(match[1]),
      language_nats: Number(match[2]), auxiliary_nats: Number(match[3]),
      auxiliary_accuracy: Number(match[4]), validation_nats: Number(match[5]),
      gradient_norm: Number(match[6]), learning_rate: Number(match[7]),
      tokens_per_second: Number(match[8]) }));
  const accounting = log.match(/Shared-State sampling sequences=(\d+) compute-token-exposures=(\d+) auxiliary-events=(\d+) wraps=(\d+)/u);
  const seconds = log.match(/training time ([0-9.]+) seconds/u);
  if (!accounting || !seconds) fail("Shared-State training accounting is absent");
  return { reports, accounting: { sequences: Number(accounting[1]),
    compute_token_exposures: Number(accounting[2]),
    auxiliary_events: Number(accounting[3]), wraps: Number(accounting[4]) },
    elapsed_seconds: Number(seconds[1]) };
}

function validateAuthorization(file, contractSha256, contract) {
  if (!file) fail("C6.1 training is not authorized; pass --authorization");
  const bytes = fs.readFileSync(file);
  const authorization = JSON.parse(bytes);
  if (authorization.schema !== "zero.c61_training_authorization.v1" ||
      authorization.authorized !== true ||
      authorization.experiment !== contract.experiment ||
      authorization.contract_sha256 !== contractSha256 ||
      authorization.scope?.runs !== 1 ||
      authorization.scope?.seed !== contract.training.seed ||
      authorization.scope?.venue !== contract.execution.venue ||
      authorization.scope?.maximum_execution_seconds !==
        contract.execution.maximum_execution_seconds ||
      authorization.scope?.paid_compute !== false ||
      authorization.ilxyr?.registration_id !== contract.ilxyr.registration_id ||
      authorization.ilxyr?.run_authorized !== true)
    fail("C6.1 authorization does not match the frozen contract");
  return { value: authorization, artifact: { sha256: sha256(bytes),
    bytes: bytes.length } };
}

async function selfTest() {
  const parsed = parseLog("update       10 lm 3.4 aux 2.1 aux-acc 0.5 " +
    "val 2.3 grad 1.0 lr 3e-05 tok/s 12000\n" +
    "Shared-State sampling sequences=37768 compute-token-exposures=19337216 " +
    "auxiliary-events=293606 wraps=0\ntraining time 1.25 seconds\n");
  assert.equal(parsed.accounting.auxiliary_events, 293606);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c61-runner-"));
  try {
    await assert.rejects(runStreaming(process.execPath,
      ["-e", "setTimeout(() => {}, 1000)"], {}, path.join(directory, "x.log"),
      .01), /execution exceeded/u);
  } finally { fs.rmSync(directory, { recursive: true }); }
  process.stdout.write("ZERO.5 C6.1 runner self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
  process.exit(0);
}

const contractPath = path.resolve(option("--contract",
  "benchmarks/zero5-c61-shared-state-v1/contract.json"));
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const contractSha256 = sha256(contractBytes);
if (contract.schema !== "zero.c61_shared_state_contract.v1" ||
    !["frozen-awaiting-ilxyr-authorization", "authorized-unrun"]
      .includes(contract.status))
  fail("C6.1 contract is not a frozen, unrun registration");
if (contract.status === "authorized-unrun" &&
    (contract.authorized !== true || contract.ilxyr.run_authorized !== true))
  fail("authorized-unrun contract must set authorized and run_authorized");
if (contract.execution.venue !== "local Apple Silicon" ||
    contract.execution.paid_compute_authorized !== false ||
    contract.execution.cost_ceiling_usd !== null ||
    contract.execution.independent_retry_authorized !== false)
  fail("C6.1 execution exceeds the local no-cost boundary");
if (contract.test.content_present !== false ||
    contract.test.metrics_opened !== false ||
    contract.claim_boundary.shared_state_bottleneck !== true ||
    contract.claim_boundary.symbolic_serialization !== false)
  fail("C6.1 claim or sealed-test boundary changed");
for (const name of ["trainer", "importer", "evaluator", "runner",
  "c51_evaluator"]) requireArtifact(contract.implementation[name],
  contract.implementation[`${name}_sha256`], `frozen ${name}`);
const authorization = validateAuthorization(option("--authorization"),
  contractSha256, contract);

const targetImport = path.resolve(option("--target-import"));
const c51Import = path.resolve(option("--c51-import"));
const c43Import = path.resolve(option("--c43-import"));
const c0Directory = path.resolve(option("--c0-dir"));
const c2Directory = path.resolve(option("--c2-dir"));
const c2Import = path.resolve(option("--c2-import-dir"));
const controlResult = path.resolve(option("--control-result"));
const out = path.resolve(option("--out",
  "build/zero5-c61-shared-state-v1/run"));
const binary = path.resolve(option("--bottleneck-trainer",
  "./zero5_c61_bottleneck_lm"));
const baseTrainer = path.resolve(option("--trainer",
  "./zero5_c32_lm_vector_math"));
const preflightOnly = process.argv.includes("--preflight-only");
const resumeRun = process.argv.includes("--resume-run");
requireArtifact(path.join(targetImport, "import.json"),
  contract.verified_target_import.receipt, "target import receipt");
requireArtifact(path.join(targetImport, "train.targets.z5aux"),
  contract.verified_target_import.primary, "training target stream");
requireArtifact(path.join(targetImport, "validation.targets.z5aueval"),
  contract.verified_target_import.evaluation, "validation target stream");
requireArtifact(controlResult, contract.control.private_result_sha256,
  "C5.1 matched control result");

const files = {
  tokenizer: path.join(c0Directory, "byte-bpe512.sero"),
  initial: path.join(c2Directory, "best.ckpt"),
  train: path.join(c51Import, "train.mixed.grouped.z5pack"),
  validation: path.join(c43Import, "frozen-validation", "validation.z5pack"),
  atlasTrain: path.join(c2Import, "atlas.train.byte-bpe512.tok"),
  atlasValidation: path.join(c2Import, "atlas.validation.byte-bpe512.tok"),
  anchorTrain: path.join(c0Directory, "train.byte-bpe512.tok"),
  anchorValidation: path.join(c0Directory, "validation.byte-bpe512.tok"),
};
for (const [name, expected] of Object.entries(contract.inputs))
  requireArtifact(files[name], expected, name);
const evaluatorPreflight = JSON.parse(run("node", [
  contract.implementation.evaluator, "--contract", contractPath,
  "--target-import", targetImport, "--control-result", controlResult,
  "--preflight-only",
]).trim());
if (evaluatorPreflight.artifacts_verified !== true ||
    evaluatorPreflight.test_metrics_opened !== false)
  fail("C6.1 evaluator preflight failed");
if (preflightOnly) {
  process.stdout.write(JSON.stringify({
    schema: "zero.c61_shared_state_training_preflight.v1",
    contract_sha256: contractSha256,
    authorization_sha256: authorization.artifact.sha256,
    updates: contract.training.update_groups,
    auxiliary_events: contract.verified_target_import.primary.events,
    paid_compute_authorized: false, test_metrics_opened: false,
  }) + "\n");
  process.exit(0);
}
if (!fs.existsSync(binary) || !fs.existsSync(baseTrainer))
  fail("required trainer binary is missing");

fs.mkdirSync(out, { recursive: true });
const executionPath = path.join(out, "execution.json");
const resultPath = path.join(out, "result.json");
if (fs.existsSync(executionPath)) {
  if (!resumeRun) fail("output exists; pass --resume-run to continue it");
  const execution = JSON.parse(fs.readFileSync(executionPath));
  if (execution.contract_sha256 !== contractSha256 ||
      execution.authorization_sha256 !== authorization.artifact.sha256)
    fail("resume output belongs to a different authorization");
} else {
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c61_shared_state_execution.v1",
    experiment: contract.experiment, contract_sha256: contractSha256,
    authorization_sha256: authorization.artifact.sha256, status: "running",
  }, null, 2) + "\n", { flag: "wx" });
}

const environment = { OPENBLAS_NUM_THREADS: String(contract.execution.blas_threads),
  OMP_NUM_THREADS: String(contract.execution.blas_threads),
  VECLIB_MAXIMUM_THREADS: String(contract.execution.blas_threads),
  OPENBLAS_DYNAMIC: "0" };
const activeCheckpoint = path.join(out, "active.ckpt");
const bestCheckpoint = path.join(out, "best.ckpt");
const trainingLog = path.join(out, "training.log");
try {
  if (!fs.existsSync(resultPath)) {
    const resuming = fs.existsSync(activeCheckpoint);
    if (resuming && !resumeRun) fail("partial checkpoint requires --resume-run");
    const training = contract.training;
    await runStreaming(binary, [
      resuming ? "--resume" : "--init",
      resuming ? activeCheckpoint : files.initial,
      "--packed-train", files.train,
      "--packed-validation", files.validation,
      "--aux-targets", path.join(targetImport, "train.targets.z5aux"),
      "--run-contract-sha256", contractSha256,
      "--steps", String(training.update_groups),
      "--batch", String(training.maximum_batch_sequences),
      "--parallel-batch", String(training.parallel_workers),
      "--lr", String(training.peak_learning_rate),
      "--weight-decay", String(training.weight_decay),
      "--clip", String(training.gradient_clip),
      "--warmup", String(training.warmup_updates),
      "--dropout", String(training.residual_dropout),
      "--report", String(training.report_every_updates),
      "--validation", String(training.selection_validation_packs),
      "--aux-weight", String(training.auxiliary_loss_weight),
      "--bridge-scale", String(training.bridge_scale),
      "--claim-answer-weight", String(training.answer_weights.claim),
      "--cloze-answer-weight", String(training.answer_weights.cloze),
      "--retrieval-answer-weight", String(training.answer_weights.retrieval),
      "--seed", String(training.seed), "--best", bestCheckpoint,
      "--save", activeCheckpoint, "--save-every",
      String(contract.execution.checkpoint_every_updates),
    ], environment, trainingLog, contract.execution.maximum_execution_seconds);
    const parsed = parseLog(fs.readFileSync(trainingLog, "utf8"));
    if (parsed.reports.at(-1)?.update !== training.update_groups ||
        parsed.accounting.sequences !== contract.training.pack_sequences ||
        parsed.accounting.compute_token_exposures !==
          contract.training.compute_token_exposures ||
        parsed.accounting.auxiliary_events !==
          contract.verified_target_import.primary.events ||
        parsed.accounting.wraps !== 0)
      fail("C6.1 completed with different accounting");
    const validationPath = path.join(out, "validation.json");
    run("node", [contract.implementation.evaluator,
      "--contract", contractPath, "--target-import", targetImport,
      "--control-result", controlResult, "--checkpoint", bestCheckpoint,
      "--bottleneck-trainer", binary, "--trainer", baseTrainer,
      "--baseline-checkpoint", files.initial, "--tokenizer", files.tokenizer,
      "--c51-import", c51Import, "--c43-import", c43Import,
      "--atlas-train", files.atlasTrain,
      "--atlas-validation", files.atlasValidation,
      "--anchor-train", files.anchorTrain,
      "--anchor-validation", files.anchorValidation,
      "--out", validationPath], environment);
    const validation = JSON.parse(fs.readFileSync(validationPath));
    const result = { schema: "zero.c61_shared_state_result.v1",
      experiment: contract.experiment, contract_sha256: contractSha256,
      authorization_sha256: authorization.artifact.sha256,
      status: validation.replication_eligible
        ? "go-for-replication-request" : "no-go",
      training: { ...parsed, best_checkpoint: artifact(bestCheckpoint),
        best_bottleneck: artifact(`${bestCheckpoint}.aux`), cost_usd: 0 },
      validation, publication: { checkpoint_published: false,
        result_published: false }, test: { metrics_opened: false } };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" });
  }
  const result = JSON.parse(fs.readFileSync(resultPath));
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c61_shared_state_execution.v1",
    experiment: contract.experiment, contract_sha256: contractSha256,
    authorization_sha256: authorization.artifact.sha256, status: "complete",
    result_sha256: artifact(resultPath).sha256,
  }, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c61_shared_state_execution.v1",
    experiment: contract.experiment, contract_sha256: contractSha256,
    authorization_sha256: authorization.artifact.sha256, status: "failed",
    error: error.message,
  }, null, 2) + "\n");
  fail(error.message);
}

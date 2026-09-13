#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  if (observed.sha256 !== expected.sha256 || observed.bytes !== expected.bytes)
    fail(`${label} changed`);
  return observed;
}

function parseTrainingLog(log) {
  const reports = [...log.matchAll(/^update\s+(\d+) lm ([0-9.]+) aux ([0-9.]+) aux-acc ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+) tok\/s (\d+)/gmu)]
    .map(match => ({ update: Number(match[1]),
      language_nats: Number(match[2]), auxiliary_nats: Number(match[3]),
      auxiliary_accuracy: Number(match[4]), validation_nats: Number(match[5]),
      gradient_norm: Number(match[6]), learning_rate: Number(match[7]),
      tokens_per_second: Number(match[8]) }));
  const accounting = log.match(/Shared-State sampling sequences=(\d+) compute-token-exposures=(\d+) auxiliary-events=(\d+) wraps=(\d+)/u);
  const seconds = [...log.matchAll(/training time ([0-9.]+) seconds/gmu)].at(-1);
  if (!accounting || !seconds) fail("completed C6.1 training accounting is absent");
  return { reports, accounting: { sequences: Number(accounting[1]),
    compute_token_exposures: Number(accounting[2]),
    auxiliary_events: Number(accounting[3]), wraps: Number(accounting[4]) },
    elapsed_seconds: Number(seconds[1]) };
}

function run(program, args, environment = {}) {
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...environment } });
  if (result.status !== 0)
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function selfTest() {
  const parsed = parseTrainingLog(
    "update    28707 lm 1.5 aux 0.2 aux-acc 0.9 val 2.0 grad 1.0 lr 0 tok/s 2000\n" +
    "Shared-State sampling sequences=37768 compute-token-exposures=19337216 " +
    "auxiliary-events=293606 wraps=0\ntraining time 532.00 seconds\n");
  assert.equal(parsed.reports.at(-1).update, 28707);
  assert.equal(parsed.accounting.auxiliary_events, 293606);
  process.stdout.write("ZERO.5 C6.1 evaluation recovery runner self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const recoveryContractPath = path.resolve(option("--recovery-contract",
  "benchmarks/zero5-c61-shared-state-v1/evaluation-recovery-contract-v2.json"));
const recoveryContractBytes = fs.readFileSync(recoveryContractPath);
const recoveryContract = JSON.parse(recoveryContractBytes);
const recoveryContractSha256 = sha256(recoveryContractBytes);
if (recoveryContract.schema !== "zero.c61_evaluation_recovery_contract.v2" ||
    recoveryContract.status !== "evaluation-authorized" ||
    recoveryContract.authorized !== true ||
    recoveryContract.training_authorized !== false)
  fail("C6.1 evaluation recovery contract is not authorized evaluation-only");

const scientificContractPath = path.resolve(option("--scientific-contract",
  "benchmarks/zero5-c61-shared-state-v1/contract.json"));
const scientificContractBytes = fs.readFileSync(scientificContractPath);
const scientificContract = JSON.parse(scientificContractBytes);
if (sha256(scientificContractBytes) !==
    recoveryContract.source_training.scientific_contract_sha256)
  fail("source C6.1 scientific contract changed");
const trainingAuthorization = path.resolve(option("--training-authorization",
  "benchmarks/zero5-c61-shared-state-v1/authorization-aws.json"));
if (artifact(trainingAuthorization).sha256 !==
    recoveryContract.source_training.training_authorization_sha256)
  fail("source C6.1 training authorization changed");

const authorizationPath = path.resolve(option("--authorization",
  "benchmarks/zero5-c61-shared-state-v1/evaluation-authorization-aws-v2.json"));
const authorizationBytes = fs.readFileSync(authorizationPath);
const authorization = JSON.parse(authorizationBytes);
if (authorization.schema !== "zero.c61_evaluation_authorization.v2" ||
    authorization.authorized !== true ||
    authorization.recovery_contract_sha256 !== recoveryContractSha256 ||
    authorization.scope?.evaluations !== 1 ||
    authorization.scope?.training !== false ||
    authorization.scope?.checkpoint_sha256 !==
      recoveryContract.source_training.checkpoint.sha256 ||
    authorization.scope?.venue !== recoveryContract.execution.venue ||
    authorization.scope?.maximum_execution_seconds !==
      recoveryContract.execution.maximum_execution_seconds ||
    authorization.scope?.maximum_ec2_usd !==
      recoveryContract.execution.maximum_ec2_usd ||
    authorization.scope?.maximum_attempts !==
      recoveryContract.execution.maximum_attempts ||
    authorization.scope?.maximum_cumulative_execution_seconds !==
      recoveryContract.execution.maximum_cumulative_execution_seconds ||
    authorization.scope?.maximum_cumulative_ec2_usd !==
      recoveryContract.execution.maximum_cumulative_ec2_usd ||
    authorization.approval?.maximum_compute_usd !== 10 ||
    recoveryContract.execution.maximum_cumulative_ec2_usd >
      authorization.approval.maximum_compute_usd)
  fail("C6.1 evaluation authorization does not match the recovery contract");

const checkpoint = path.resolve(option("--checkpoint"));
const trainingLog = path.resolve(option("--training-log"));
const checkpointArtifact = requireArtifact(checkpoint,
  recoveryContract.source_training.checkpoint, "frozen C6.1 checkpoint");
const bottleneckArtifact = requireArtifact(`${checkpoint}.aux`,
  recoveryContract.source_training.bottleneck, "frozen C6.1 bottleneck");
requireArtifact(trainingLog, recoveryContract.source_training.training_log,
  "completed C6.1 training log");
const training = parseTrainingLog(fs.readFileSync(trainingLog, "utf8"));
if (training.reports.at(-1)?.update !== scientificContract.training.update_groups ||
    training.accounting.sequences !== scientificContract.training.pack_sequences ||
    training.accounting.compute_token_exposures !==
      scientificContract.training.compute_token_exposures ||
    training.accounting.auxiliary_events !==
      scientificContract.verified_target_import.primary.events ||
    training.accounting.wraps !== 0)
  fail("completed C6.1 training accounting changed");

for (const name of ["evaluator", "runner"]) {
  const implementation = recoveryContract.implementation[name];
  requireArtifact(path.resolve(implementation.path), implementation,
    `evaluation recovery ${name}`);
}
const preflightOnly = process.argv.includes("--preflight-only");
if (preflightOnly) {
  process.stdout.write(JSON.stringify({
    schema: "zero.c61_evaluation_recovery_preflight.v1",
    recovery_contract_sha256: recoveryContractSha256,
    authorization_sha256: sha256(authorizationBytes),
    checkpoint: checkpointArtifact,
    bottleneck: bottleneckArtifact,
    training_complete: true,
    training_authorized: false,
    test_metrics_opened: false,
  }) + "\n");
  process.exit(0);
}

const out = path.resolve(option("--out",
  "build/zero5-c61-shared-state-v1/evaluation-recovery"));
const validationPath = path.join(out, "validation.json");
const resultPath = path.join(out, "result.json");
const executionPath = path.join(out, "execution.json");
const cacheDirectory = path.join(out, "cache");
const resumeEvaluation = process.argv.includes("--resume-evaluation");
if (fs.existsSync(resultPath)) fail("C6.1 evaluation result already exists");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(cacheDirectory, { recursive: true });
if (resumeEvaluation && fs.existsSync(executionPath)) {
  const execution = JSON.parse(fs.readFileSync(executionPath, "utf8"));
  if (execution.schema !== "zero.c61_evaluation_recovery_execution.v1" ||
      execution.recovery_contract_sha256 !== recoveryContractSha256 ||
      execution.evaluation_authorization_sha256 !== sha256(authorizationBytes))
    fail("resume execution belongs to a different authorization");
} else {
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.c61_evaluation_recovery_execution.v1",
    status: "running",
    recovery_contract_sha256: recoveryContractSha256,
    evaluation_authorization_sha256: sha256(authorizationBytes),
    source_training_contract_sha256:
      recoveryContract.source_training.scientific_contract_sha256,
    checkpoint: checkpointArtifact,
  }, null, 2) + "\n");
}

const evaluator = recoveryContract.implementation.evaluator.path;
const evaluatorArguments = [
  "--contract", scientificContractPath,
  "--target-import", path.resolve(option("--target-import")),
  "--control-result", path.resolve(option("--control-result")),
  "--checkpoint", checkpoint,
  "--bottleneck-trainer", path.resolve(option("--bottleneck-trainer",
    "./zero5_c61_bottleneck_lm")),
  "--trainer", path.resolve(option("--trainer", "./zero5_c32_lm_vector_math")),
  "--baseline-checkpoint", path.resolve(option("--baseline-checkpoint")),
  "--tokenizer", path.resolve(option("--tokenizer")),
  "--c51-import", path.resolve(option("--c51-import")),
  "--c43-import", path.resolve(option("--c43-import")),
  "--atlas-train", path.resolve(option("--atlas-train")),
  "--atlas-validation", path.resolve(option("--atlas-validation")),
  "--anchor-train", path.resolve(option("--anchor-train")),
  "--anchor-validation", path.resolve(option("--anchor-validation")),
  "--cache-dir", cacheDirectory,
  "--jobs", String(recoveryContract.execution.evaluation_jobs),
  "--out", validationPath,
];
run("node", [evaluator, ...evaluatorArguments], {
  OPENBLAS_NUM_THREADS: String(recoveryContract.execution.openblas_threads),
  OMP_NUM_THREADS: String(recoveryContract.execution.openblas_threads),
  OPENBLAS_DYNAMIC: "0",
});
const validation = JSON.parse(fs.readFileSync(validationPath));
if (validation.schema !== "zero.c61_shared_state_validation.v1" ||
    validation.experiment !== scientificContract.experiment ||
    validation.contract_sha256 !==
      recoveryContract.source_training.scientific_contract_sha256 ||
    validation.checkpoint.sha256 !== checkpointArtifact.sha256 ||
    validation.bottleneck.sha256 !== bottleneckArtifact.sha256 ||
    validation.promotion_eligible !== false ||
    validation.test?.metrics_opened !== false)
  fail("C6.1 recovered validation has an invalid boundary");
const result = {
  schema: "zero.c61_shared_state_result.v1",
  experiment: scientificContract.experiment,
  contract_sha256: recoveryContract.source_training.scientific_contract_sha256,
  authorization_sha256:
    recoveryContract.source_training.training_authorization_sha256,
  evaluation_recovery_contract_sha256: recoveryContractSha256,
  evaluation_authorization_sha256: sha256(authorizationBytes),
  status: validation.replication_eligible
    ? "go-for-replication-request" : "no-go",
  training: { ...training, best_checkpoint: checkpointArtifact,
    best_bottleneck: bottleneckArtifact, cost_usd: 0 },
  validation,
  evaluation_recovery: {
    evaluation_only: true,
    source_run_id: recoveryContract.source_training.source_run_id,
    cached_atomic_tasks: fs.readdirSync(cacheDirectory)
      .filter(name => name.endsWith(".json")).length,
    resumed_from_prior: resumeEvaluation,
    training_rerun: false,
  },
  publication: { checkpoint_published: false, result_published: false },
  test: { metrics_opened: false },
};
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" });
fs.writeFileSync(executionPath, JSON.stringify({
  schema: "zero.c61_evaluation_recovery_execution.v1",
  status: "complete",
  recovery_contract_sha256: recoveryContractSha256,
  evaluation_authorization_sha256: sha256(authorizationBytes),
  source_training_contract_sha256:
    recoveryContract.source_training.scientific_contract_sha256,
  checkpoint: checkpointArtifact,
  result_sha256: artifact(resultPath).sha256,
}, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

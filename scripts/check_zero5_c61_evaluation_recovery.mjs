#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contractPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-recovery-contract-v2.json";
const authorizationPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-authorization-aws-v2.json";
const historicalContractPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-recovery-contract.json";
const historicalAuthorizationPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-authorization-aws.json";
const budgetPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-budget.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const authorization = JSON.parse(fs.readFileSync(authorizationPath));

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: digest(bytes), bytes: bytes.length };
}

function checkArtifact(record, label) {
  assert.equal(typeof record.path, "string", `${label} path is absent`);
  assert.deepEqual(artifact(record.path),
    { sha256: record.sha256, bytes: record.bytes }, `${label} changed`);
}

assert.equal(digest(fs.readFileSync(historicalContractPath)),
  "55f56532f1abb545d3b363c7dbf19a9f162fd163999d05c9ff8440f7fcad5dc5",
  "historical recovery contract changed");
assert.equal(digest(fs.readFileSync(historicalAuthorizationPath)),
  "6f60177bd77c3b44dcfcececc6412db155a03c8b6bd826b165464a3dc721da78",
  "historical evaluation authorization changed");
assert.equal(contract.schema, "zero.c61_evaluation_recovery_contract.v2");
assert.equal(contract.experiment, "zero5-c61-shared-state-v1");
assert.equal(contract.status, "evaluation-authorized");
assert.equal(contract.authorized, true);
assert.equal(contract.training_authorized, false);
assert.equal(contract.source_training.scientific_contract_sha256,
  artifact(contract.source_training.scientific_contract).sha256);
assert.equal(contract.source_training.training_authorization_sha256,
  artifact(contract.source_training.training_authorization).sha256);
assert.equal(contract.source_training.source_run_id,
  "zero5-c61-aws-20260831-e977b63r1");
for (const name of ["checkpoint", "bottleneck", "training_log"]) {
  const record = contract.source_training[name];
  assert.match(record.key, /^experiments\/zero5-c61-shared-state-v1\//u);
  assert.match(record.sha256, /^[0-9a-f]{64}$/u);
  assert(record.bytes > 0);
}
assert.deepEqual(contract.source_training.completed_accounting, {
  update_groups: 28707,
  pack_sequences: 37768,
  compute_token_exposures: 19337216,
  auxiliary_events: 293606,
  wraps: 0,
});

const scientific = JSON.parse(fs.readFileSync(
  contract.source_training.scientific_contract));
assert.equal(digest(Buffer.from(JSON.stringify(scientific.gates))),
  contract.evaluation.scientific_gates_sha256);
assert.equal(contract.evaluation.atomic_tasks, 18);
assert.equal(contract.evaluation.sealed_test_opened, false);
assert.equal(contract.evaluation.training_updates, 0);
// Keep the executed source hashes intact. Bind the resumable source separately.
const safety = JSON.parse(fs.readFileSync(
  "benchmarks/zero5-c61-shared-state-v1/runtime-safety-amendment.json"));
assert.equal(safety.schema, "zero.c61_runtime_safety_amendment.v1");
assert.equal(safety.execution_authorized, true);
assert.equal(safety.recovery_contract, contractPath);
assert.equal(safety.recovery_contract_sha256, digest(contractBytes));
assert.equal(safety.historical_recovery_contract_sha256,
  digest(fs.readFileSync(historicalContractPath)));
assert.equal(safety.approval_id, contract.authorization.approval_id);
assert.equal(safety.current.path, contract.implementation.user_data.path);
assert.equal(safety.current.sha256, contract.implementation.user_data.sha256);
assert.equal(safety.current.bytes, contract.implementation.user_data.bytes);
checkArtifact(safety.historical, "executed user-data");
checkArtifact(safety.current, "current user-data");
for (const [name, record] of Object.entries(contract.implementation)) {
  if (name !== "user_data") checkArtifact(record, name);
}

assert.equal(contract.execution.venue,
  "aws us-east-1 c6i.4xlarge on-demand");
assert.equal(contract.execution.maximum_execution_seconds, 9000);
assert.equal(contract.execution.maximum_ec2_usd, 1.7);
assert.equal(contract.execution.evaluation_jobs, 4);
assert.equal(contract.execution.cache_sync_seconds, 30);
assert.equal(contract.execution.independent_retry_authorized, false);
assert.equal(contract.execution.budget,
  "benchmarks/zero5-c61-shared-state-v1/evaluation-budget.json");
assert.equal(contract.execution.budget_sha256,
  digest(fs.readFileSync(budgetPath)));
assert.equal(contract.execution.measured_full_cycle_seconds, 18300);
assert.equal(contract.execution.measured_full_cycle_ec2_usd, 3.46);
assert.equal(contract.execution.maximum_attempts, 5);
assert.equal(contract.execution.maximum_cumulative_execution_seconds, 45000);
assert.equal(contract.execution.maximum_cumulative_ec2_usd, 8.5);
assert.equal(contract.execution.approved_outer_maximum_ec2_usd, 10);
assert.equal(contract.execution.continuation_requires_prior_recoverable_status,
  true);
assert.equal(contract.execution.resumable_evaluation, true);
assert.equal(authorization.scope.maximum_attempts, 5);
assert.equal(authorization.scope.maximum_cumulative_execution_seconds, 45000);
assert.equal(authorization.scope.maximum_cumulative_ec2_usd, 8.5);
assert.equal(authorization.approval.maximum_compute_usd, 10);
assert.equal(authorization.scope.resumable_evaluation, true);
assert.equal(contract.claim_boundary.evaluation_only, true);
assert.equal(contract.claim_boundary.training_rerun, false);
assert.equal(contract.claim_boundary.scientific_gates_changed, false);
assert.equal(contract.claim_boundary.promotion_authorized, false);
assert.equal(contract.claim_boundary.replication_authorized, false);
assert.equal(contract.claim_boundary.sealed_test_access_authorized, false);

assert.equal(authorization.schema, "zero.c61_evaluation_authorization.v2");
assert.equal(authorization.authorization_id,
  contract.authorization.approval_id);
assert.equal(authorization.authorized, true);
assert.equal(authorization.experiment, contract.experiment);
assert.equal(authorization.recovery_contract_sha256, digest(contractBytes));
assert.equal(authorization.budget_sha256,
  digest(fs.readFileSync(budgetPath)));
assert.equal(authorization.scope.evaluations, 1);
assert.equal(authorization.scope.training, false);
assert.equal(authorization.scope.checkpoint_sha256,
  contract.source_training.checkpoint.sha256);
assert.equal(authorization.scope.venue, contract.execution.venue);
assert.equal(authorization.scope.maximum_execution_seconds,
  contract.execution.maximum_execution_seconds);
assert.equal(authorization.scope.maximum_ec2_usd,
  contract.execution.maximum_ec2_usd);
assert(authorization.not_authorized.includes("training updates"));
assert(authorization.not_authorized.includes("independent scientific retries"));
assert(authorization.not_authorized.includes("sealed-test access"));

const userData = fs.readFileSync(contract.implementation.user_data.path, "utf8");
assert(!userData.includes("run_zero5_c61_shared_state.mjs"),
  "evaluation user-data invokes the training runner");
assert(!userData.includes("--steps"),
  "evaluation user-data contains a training step option");
assert(userData.includes("run_zero5_c61_evaluation_recovery.mjs"));
assert(userData.includes("preflight_zero5_c61_evaluator.mjs"),
  "evaluation user-data does not run the evaluator preflight");
const launcher = fs.readFileSync(contract.implementation.launcher.path, "utf8");
assert(launcher.includes("evaluation-recovery-v2"));
assert(launcher.includes("ZERO5_ATTEMPT"));
assert(launcher.includes("prior_status"));
assert(launcher.includes("--if-none-match '*'"));
assert(launcher.includes("training_authorized:false"));

for (const script of [contract.implementation.evaluator.path,
  contract.implementation.runner.path]) {
  const result = spawnSync("node", [script, "--self-test"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

const bootstrap = spawnSync("node", [
  "scripts/check_zero5_c61_bootstrap_safety.mjs",
], { encoding: "utf8" });
assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout);

process.stdout.write("ZERO.5 C6.1 evaluation-only recovery checks passed\n");

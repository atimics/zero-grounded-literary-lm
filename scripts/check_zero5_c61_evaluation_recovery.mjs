#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contractPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-recovery-contract.json";
const authorizationPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-authorization-aws.json";
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

assert.equal(contract.schema, "zero.c61_evaluation_recovery_contract.v1");
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
for (const [name, record] of Object.entries(contract.implementation))
  checkArtifact(record, name);

assert.equal(contract.execution.venue,
  "aws us-east-1 c6i.4xlarge on-demand");
assert.equal(contract.execution.maximum_execution_seconds, 9000);
assert.equal(contract.execution.maximum_ec2_usd, 1.7);
assert.equal(contract.execution.evaluation_jobs, 4);
assert.equal(contract.execution.cache_sync_seconds, 30);
assert.equal(contract.execution.independent_retry_authorized, false);
assert.equal(contract.claim_boundary.evaluation_only, true);
assert.equal(contract.claim_boundary.training_rerun, false);
assert.equal(contract.claim_boundary.scientific_gates_changed, false);
assert.equal(contract.claim_boundary.promotion_authorized, false);
assert.equal(contract.claim_boundary.replication_authorized, false);
assert.equal(contract.claim_boundary.sealed_test_access_authorized, false);

assert.equal(authorization.schema, "zero.c61_evaluation_authorization.v1");
assert.equal(authorization.authorization_id,
  contract.authorization.approval_id);
assert.equal(authorization.authorized, true);
assert.equal(authorization.experiment, contract.experiment);
assert.equal(authorization.recovery_contract_sha256, digest(contractBytes));
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
assert(authorization.not_authorized.includes("independent retries"));
assert(authorization.not_authorized.includes("sealed-test access"));

const userData = fs.readFileSync(contract.implementation.user_data.path, "utf8");
assert(!userData.includes("run_zero5_c61_shared_state.mjs"),
  "evaluation user-data invokes the training runner");
assert(!userData.includes("--steps"),
  "evaluation user-data contains a training step option");
assert(userData.includes("run_zero5_c61_evaluation_recovery.mjs"));
const launcher = fs.readFileSync(contract.implementation.launcher.path, "utf8");
assert(launcher.includes("evaluation-v1.lock"));
assert(launcher.includes("training_authorized:false"));

for (const script of [contract.implementation.evaluator.path,
  contract.implementation.runner.path]) {
  const result = spawnSync("node", [script, "--self-test"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

process.stdout.write("ZERO.5 C6.1 evaluation-only recovery checks passed\n");

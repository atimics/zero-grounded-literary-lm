#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const authorizationPath =
  "benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json";
const notesPath = "benchmarks/zero5-ht1-mergetree-v1/AUTHORIZATION.md";

const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const authorization = JSON.parse(fs.readFileSync(authorizationPath, "utf8"));

assert.equal(authorization.schema, "zero.ht1_training_authorization.v1");
assert.equal(authorization.authorization_id,
  "zero5-ht1-mergetree-aws-2026-09-04-v1");
assert.equal(authorization.experiment, "zero5-ht1-mergetree-v1");
assert.equal(authorization.status, "authorized-launch-path-pending");
assert.equal(authorization.authorized, true);
assert.equal(authorization.approved_by, "ratimics");
assert.equal(authorization.approved_at, "2026-09-04T08:55:39Z");
assert.equal(authorization.approved_statement,
  "I approve up to $10 of spend on both and the next experiment");

for (const name of ["contract", "series", "implementation",
  "preflight_evidence", "trainer", "evaluator"]) {
  const file = authorization.bindings[name];
  assert.equal(sha256(file), authorization.bindings[`${name}_sha256`],
    `${name} hash`);
}

const contract = JSON.parse(fs.readFileSync(authorization.bindings.contract));
const series = JSON.parse(fs.readFileSync(authorization.bindings.series));
const implementation = JSON.parse(fs.readFileSync(
  authorization.bindings.implementation));
const evidence = JSON.parse(fs.readFileSync(
  authorization.bindings.preflight_evidence));
assert.equal(contract.experiment, authorization.experiment);
assert.equal(contract.authorized, false);
assert.equal(series.execution_order[0], authorization.experiment);
assert.equal(series.shared_training.pilot_seed, authorization.pilot.seed);
assert.equal(series.shared_training.update_groups_per_arm,
  authorization.pilot.update_groups);
assert.equal(series.shared_training.pack_sequences_per_arm,
  authorization.pilot.pack_sequences);
assert.equal(series.shared_training.compute_token_exposures_per_arm,
  authorization.pilot.compute_token_exposures);
assert.equal(series.shared_inputs.initial_checkpoint_sha256,
  authorization.pilot.initial_checkpoint_sha256);
assert.equal(series.shared_inputs.training_packs_sha256,
  authorization.pilot.training_packs_sha256);
assert.equal(series.shared_inputs.combined_validation_sha256,
  authorization.pilot.validation_packs_sha256);
assert.equal(contract.tokenizer.sha256, authorization.pilot.tokenizer_sha256);
assert.equal(contract.control.private_result_sha256,
  authorization.pilot.control_result_sha256);
assert.equal(implementation.status,
  "artifact-preflight-complete-awaiting-training-authorization");
assert.equal(implementation.implementation_complete, true);
assert.equal(evidence.status, "complete-pass");
assert.equal(evidence.eligible_for_pilot_authorization, true);
assert.equal(evidence.experiment_runs_completed, 0);
assert.equal(evidence.pilot_training_run_executed, false);

const budget = authorization.budget;
assert.equal(budget.maximum_approved_compute_usd, 10);
assert.equal(budget.provider, "aws");
assert.equal(budget.region, "us-east-1");
assert.equal(budget.instance_type, "c6i.4xlarge");
assert.equal(budget.market, "on-demand");
assert.equal(budget.maximum_attempts, 5);
assert.equal(budget.maximum_seconds_per_attempt, 9000);
assert.equal(budget.maximum_compute_usd_per_attempt, 1.7);
assert.equal(budget.maximum_cumulative_seconds,
  budget.maximum_attempts * budget.maximum_seconds_per_attempt);
assert.equal(budget.maximum_cumulative_compute_usd,
  budget.maximum_attempts * budget.maximum_compute_usd_per_attempt);
assert.equal(budget.maximum_cumulative_compute_usd + budget.approval_reserve_usd,
  budget.maximum_approved_compute_usd);
assert(budget.maximum_seconds_per_attempt * budget.hourly_price_usd / 3600 <=
  budget.maximum_compute_usd_per_attempt);
for (const name of ["automatic_termination_required",
  "immutable_attempt_lock_required", "state_sync_required",
  "continuations_require_recoverable_status"]) {
  assert.equal(budget[name], true, name);
}

assert.equal(authorization.pilot.training_trajectories, 1);
for (const name of ["training_authorized", "paid_compute_authorized",
  "frozen_validation_authorized"]) assert.equal(authorization.scope[name], true);
for (const name of ["independent_retries_authorized",
  "replication_authorized", "promotion_authorized",
  "publication_authorized", "checkpoint_publication_authorized",
  "corpus_publication_authorized", "sealed_test_access_authorized",
  "source_upload_authorized", "private_artifact_upload_authorized"]) {
  assert.equal(authorization.scope[name], false, name);
}
assert.equal(authorization.launch_readiness.ready, false);
assert.equal(authorization.launch_readiness.status,
  "authorization-recorded-launcher-next");
assert(authorization.launch_readiness.required_before_launch.length >= 5);

for (const file of [authorizationPath, notesPath]) {
  const source = fs.readFileSync(file, "utf8");
  assert.equal(source.includes("/Users/"), false, `${file} exposes a user path`);
  assert.equal(source.includes("/private/"), false,
    `${file} exposes a private path`);
}

process.stdout.write("ZERO.5 HT1 authorization checks passed\n");

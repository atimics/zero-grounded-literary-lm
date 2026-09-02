#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const terminalPath = "benchmarks/zero5-c61-shared-state-v1/terminal.json";
const terminal = JSON.parse(fs.readFileSync(terminalPath, "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

assert.equal(terminal.schema, "zero.c61_terminal_record.v1");
assert.equal(terminal.experiment, "zero5-c61-shared-state-v1");
assert.equal(terminal.status, "complete-no-go");
assert.equal(terminal.decision.replication_eligible, false);
assert.equal(terminal.decision.promotion_eligible, false);
assert.equal(terminal.decision.hierarchical_tokenization_dependency_satisfied,
  true);

for (const name of ["scientific_contract", "training_authorization",
  "evaluation_recovery_contract", "evaluation_authorization"]) {
  assert.equal(sha256(terminal.source[name]), terminal.source[`${name}_sha256`],
    `${name} changed`);
}

const recovery = readJson(terminal.source.evaluation_recovery_contract);
assert.equal(recovery.status, "evaluation-authorized");
assert.equal(recovery.training_authorized, false);
assert.equal(terminal.training.source_run_id,
  recovery.source_training.source_run_id);
assert.deepEqual({
  update_groups: terminal.training.update_groups,
  pack_sequences: terminal.training.pack_sequences,
  compute_token_exposures: terminal.training.compute_token_exposures,
  auxiliary_events: terminal.training.auxiliary_events,
  wraps: terminal.training.wraps,
}, recovery.source_training.completed_accounting);
assert.equal(terminal.training.evaluation_recovery_training_updates, 0);
assert.equal(terminal.selected_checkpoint.sha256,
  recovery.source_training.checkpoint.sha256);
assert.equal(terminal.selected_checkpoint.bytes,
  recovery.source_training.checkpoint.bytes);
assert.equal(terminal.selected_checkpoint.bottleneck_sha256,
  recovery.source_training.bottleneck.sha256);
assert.equal(terminal.selected_checkpoint.bottleneck_bytes,
  recovery.source_training.bottleneck.bytes);
assert.equal(terminal.selected_checkpoint.private, true);

const launchRecord = terminal.evaluation.launch_receipt;
const statusRecord = terminal.evaluation.status_receipt;
assert.equal(sha256(launchRecord.path), launchRecord.sha256);
assert.equal(sha256(statusRecord.path), statusRecord.sha256);
const launch = readJson(launchRecord.path);
const status = readJson(statusRecord.path);
assert.equal(launch.schema, "zero.c61_evaluation_aws_launch.v1");
assert.equal(status.schema, "zero.c61_evaluation_aws_status.v1");
assert.equal(status.status, "complete");
assert.equal(status.phase, "complete");
assert.equal(status.exit_code, 0);
assert.equal(status.training_executed, false);
assert.equal(status.run_id, terminal.evaluation.run_id);
assert.equal(launch.run_id, terminal.evaluation.run_id);
assert.equal(status.instance_id, launch.instance_id);
assert.equal(status.git_commit, launch.source_commit);
assert.equal(status.recovery_contract_sha256,
  terminal.source.evaluation_recovery_contract_sha256);
assert.equal(launch.recovery_contract_sha256,
  terminal.source.evaluation_recovery_contract_sha256);
assert.equal(status.result_key, terminal.evaluation.result.key);
assert.equal(status.result_sha256, terminal.evaluation.result.sha256);
assert.equal(status.elapsed_instance_seconds,
  terminal.evaluation.elapsed_instance_seconds);
assert.equal(status.estimated_ec2_usd,
  terminal.evaluation.estimated_ec2_usd);
assert(status.elapsed_instance_seconds <= launch.maximum_instance_seconds);
assert(status.estimated_ec2_usd <= launch.maximum_ec2_usd);
assert.equal(terminal.evaluation.atomic_tasks_completed,
  recovery.evaluation.atomic_tasks);
assert.equal(terminal.evaluation.result.private, true);
assert.match(terminal.evaluation.result.sha256, /^[0-9a-f]{64}$/u);
assert(terminal.evaluation.result.bytes > 0);

assert.deepEqual(terminal.gates.failed, [
  "retrieval_floor",
  "retrieval_gain_over_c51",
  "pair_floor",
  "pair_gain_over_c51",
  "bridge_retrieval_contribution",
  "bridge_pair_contribution",
]);
for (const name of ["state_nats_reduction", "state_accuracy_gain",
  "claim_retention", "combined_retention", "evidence_retention",
  "atlas_retention", "anchor_retention", "finite_metrics",
  "sealed_test_stayed_closed"]) assert(terminal.gates.passed.includes(name));
assert.equal(terminal.publication.decision_record_public, true);
assert.equal(terminal.publication.detailed_metrics_private, true);
assert.equal(terminal.publication.checkpoint_private, true);
assert.equal(terminal.test.metrics_opened, false);

const publicBytes = fs.readFileSync(terminalPath, "utf8");
for (const privateField of ["candidate", "bridge_off",
  "combined_nats_per_token", "choice_accuracy"])
  assert.equal(publicBytes.includes(`\"${privateField}\"`), false,
    `terminal record exposes private field ${privateField}`);

process.stdout.write("ZERO.5 C6.1 terminal record checks passed\n");

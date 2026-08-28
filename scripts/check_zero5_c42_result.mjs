#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-c42-v1";
const read = name => fs.readFileSync(`${directory}/${name}`);
const parse = name => JSON.parse(read(name));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

const contract = parse("contract.json");
const result = parse("result.json");
const status = parse("status.json");
const launch = parse("launch.json");

assert.equal(result.schema, "zero.c42_result.v1");
assert.equal(result.status, "complete");
assert.equal(status.schema, "zero.c42_aws_status.v1");
assert.equal(status.status, "complete");
assert.equal(status.phase, "complete");
assert.equal(status.exit_code, 0);
assert.equal(launch.schema, "zero.c42_aws_launch.v1");
assert.equal(result.contract_sha256, digest(read("contract.json")));
assert.equal(status.contract_sha256, result.contract_sha256);
assert.equal(launch.contract_sha256, result.contract_sha256);
assert.equal(status.result_sha256, digest(read("result.json")));
assert.equal(status.result_sha256,
  "63e4209b19637e2b09e3798f3cf0c32e84d983f09b33b161b39463c4b3d8c279");
assert.equal(digest(read("status.json")),
  "367b9a358e24a3a28eaf4e4e822bcd4e8841970844d0b35f267309e0c9dac1e5");
assert.equal(digest(read("launch.json")),
  "df5c182bbf63970661a48b6baab0524c1915d112836c4a23bbae1b4d78682545");

assert.equal(status.run_id, launch.run_id);
assert.equal(status.instance_id, launch.instance_id);
assert.equal(status.git_commit, launch.source_commit);
assert.equal(status.git_commit,
  "f1a7195d581140c047eb24f01d306c7cf56346a6");
assert.equal(launch.source_sha256,
  "84a10e302b82061f1f61bbf53b47dd609da2ce13b8c90d3a3f76abf37c61b1b5");
assert.equal(launch.asset_sha256,
  "1dcd1a0c3f623f9ce83aa57073e7ac7be5e575a6354ffa6143c582ad6c5a6be1");
assert.equal(launch.approval_id, contract.authorization.approval_id);
assert.equal(launch.maximum_instance_seconds,
  contract.execution.maximum_instance_seconds);
assert.equal(launch.maximum_ec2_usd,
  contract.execution.maximum_total_ec2_usd);
assert.equal(status.elapsed_instance_seconds, 6085);
assert(close(status.estimated_ec2_usd,
  status.elapsed_instance_seconds *
    contract.execution.on_demand_usd_per_hour / 3600));
assert(status.estimated_ec2_usd <=
  contract.execution.maximum_total_ec2_usd);

const training = result.training;
const expected = contract.verified_import.primary_packs;
assert.equal(training.completed_updates,
  contract.proposed_primary_training.updates);
assert.equal(training.reports.length, 56);
assert.equal(training.reports[0].update, 500);
assert.equal(training.reports.at(-1).update, training.completed_updates);
for (let index = 1; index < training.reports.length; index += 1) {
  assert(training.reports[index].update > training.reports[index - 1].update);
}
assert.equal(training.accounting.pack_sequences, expected.packs);
assert.equal(training.accounting.compute_token_exposures,
  expected.compute_token_exposures);
assert.equal(training.accounting.active_targets, expected.active_targets);
assert.equal(training.accounting.padding_targets, expected.padding_targets);
assert.equal(training.accounting.claim_answer_targets,
  expected.answer_targets_by_task.claim);
assert.equal(training.accounting.cloze_answer_targets,
  expected.answer_targets_by_task.cloze);
assert.equal(training.accounting.retrieval_answer_targets,
  expected.answer_targets_by_task.retrieval);
assert.equal(training.accounting.wraps, 0);
assert.equal(result.implementation.math_backend,
  contract.proposed_primary_training.math_backend);
assert.equal(result.implementation.attention_backend,
  contract.proposed_primary_training.attention_backend);
assert.equal(result.checkpoints.active.sha256, result.checkpoints.best.sha256);
assert.equal(result.checkpoints.best.sha256,
  "1fec9b54677448562a80ef9066341af51947d6ca30ca4aed275204c778748437");

const validation = result.validation;
const candidate = validation.candidate;
const baseline = validation.baseline;
const derived = validation.derived;
assert(close(derived.combined_relative_improvement,
  1 - candidate.combined_nats_per_token / baseline.combined_nats_per_token));
assert(close(derived.evidence_relative_regression,
  candidate.evidence_nats_per_token / baseline.evidence_nats_per_token - 1));
assert(close(derived.atlas_relative_regression,
  candidate.atlas_nats_per_token / baseline.atlas_nats_per_token - 1));
assert(close(derived.anchor_relative_regression,
  candidate.anchor_nats_per_token / baseline.anchor_nats_per_token - 1));
assert(close(derived.cloze_exact_improvement,
  candidate.cloze.teacher_forced_exact_accuracy -
    baseline.cloze.teacher_forced_exact_accuracy));
for (const task of ["claim", "retrieval"]) {
  assert(close(derived.choice_improvement[task],
    candidate.choice[task].choice_accuracy -
      baseline.choice[task].choice_accuracy));
  assert(close(derived.swap_improvement[task],
    candidate.choice[task].swap_consistency_accuracy -
      baseline.choice[task].swap_consistency_accuracy));
  assert(close(derived.pair_exact_improvement[task],
    candidate.choice[task].pair_exact_accuracy -
      baseline.choice[task].pair_exact_accuracy));
}

const passed = [
  "combined_validation_step", "evidence_retention", "atlas_retention",
  "anchor_retention", "claim_choice_accuracy", "claim_position_accuracy",
  "claim_pair_exact", "retrieval_position_accuracy", "retrieval_pair_exact",
  "finite_metrics", "sealed_test_stayed_closed",
];
const failed = [
  "cloze_exact_step", "claim_swap_consistency",
  "retrieval_choice_accuracy", "retrieval_swap_consistency",
  "test_metrics_opened",
];
for (const gate of passed) assert.equal(validation.gates[gate], true, gate);
for (const gate of failed) assert.equal(validation.gates[gate], false, gate);
assert.equal(validation.eligible_for_promotion, false);
assert.equal(result.decision.eligible_for_promotion, false);
assert.equal(result.decision.test_metrics_opened, false);
assert.equal(validation.test.metrics_opened, false);
assert.equal(contract.gates.test_metrics_opened, false);

process.stdout.write("ZERO.5 C4.2 result verified\n");

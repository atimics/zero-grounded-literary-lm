#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-tensor-batch-v1";
const read = name => fs.readFileSync(`${directory}/${name}`);
const parse = name => JSON.parse(read(name));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

const contract = parse("aws-contract.json");
const attempt = parse("attempt-1-status.json");
const status = parse("status.json");
const result = parse("result.json");
const comparison = parse("comparison.json");

assert.equal(result.schema, "zero.aws_tensor_batch_calibration.v1");
assert.equal(status.status, "complete");
assert.equal(status.exit_code, 0);
assert.equal(status.completed_thread_candidates, 5);
assert.equal(attempt.status, "failed");
assert.equal(attempt.completed_thread_candidates, 0);
assert.equal(attempt.estimated_ec2_usd,
  contract.execution_amendment.failed_attempt_ec2_usd);
assert.equal(status.prior_attempt_ec2_usd, attempt.estimated_ec2_usd);
assert.equal(status.result_sha256, digest(read("result.json")));
assert.equal(comparison.attempts.first.status_sha256,
  digest(read("attempt-1-status.json")));
assert.equal(comparison.attempts.retry.status_sha256,
  digest(read("status.json")));
assert.equal(comparison.attempts.retry.result_sha256,
  digest(read("result.json")));
assert.equal(comparison.contract_sha256, digest(read("aws-contract.json")));
assert.equal(result.source_commit, contract.source.git_commit);
assert.equal(result.updates_per_candidate, contract.workload.updates_per_candidate);
assert.equal(result.all_metrics_within_tolerance, true);

const expected = [1, 2, 4, 8, 16];
for (const variant of ["tensor", "tensor-qkv"]) {
  assert.deepEqual(result.candidates.filter(item => item.variant === variant)
    .map(item => item.threads).sort((a, b) => a - b), expected);
}
for (const candidate of result.candidates) {
  assert.equal(candidate.train_loss, result.baseline.train_loss);
  assert.equal(candidate.validation_loss, result.baseline.validation_loss);
  assert.equal(candidate.gradient_norm, result.baseline.gradient_norm);
}

const selected = result.candidates.reduce((best, item) =>
  item.tokens_per_second > best.tokens_per_second ? item : best);
assert.deepEqual(result.selected, selected);
assert.equal(selected.threads, 8);
assert.equal(selected.variant, "tensor");
const speedRatio = selected.tokens_per_second /
  result.baseline.tokens_per_second;
assert(close(speedRatio, comparison.performance.tensor_to_parallel_ratio));
assert(close(1 - speedRatio, comparison.performance.tensor_slower_fraction));
assert.equal(comparison.gates.reported_metrics_match, true);
assert.equal(comparison.gates.tensor_at_least_15_percent_faster, false);
assert(selected.tokens_per_second < result.baseline.tokens_per_second * 1.15);

for (const threads of expected) {
  const tensor = result.candidates.find(item =>
    item.threads === threads && item.variant === "tensor");
  const qkv = result.candidates.find(item =>
    item.threads === threads && item.variant === "tensor-qkv");
  assert(qkv.tokens_per_second <= tensor.tokens_per_second);
}
assert.equal(comparison.performance.qkv_improved_any_candidate, false);
assert.equal(comparison.gates.qkv_fusion_improves_tensor, false);
assert(close(status.estimated_total_ec2_usd,
  attempt.estimated_ec2_usd + status.estimated_retry_ec2_usd));
assert(status.estimated_total_ec2_usd <=
  contract.execution.maximum_total_ec2_usd);
assert.equal(comparison.gates.combined_budget_passed, true);
assert.equal(comparison.claim_boundary.scientific_replication, false);
assert.equal(comparison.claim_boundary.test_metrics_opened, false);

process.stdout.write("ZERO.5 tensor AWS result verified\n");

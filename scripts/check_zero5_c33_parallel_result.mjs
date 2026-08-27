#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-c33-parallel-v1";
const read = name => fs.readFileSync(`${directory}/${name}`);
const parse = name => JSON.parse(read(name));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

const contract = parse("contract.json");
const result = parse("result.json");
const status = parse("status.json");
const comparison = parse("comparison.json");
const parentResultBytes = fs.readFileSync("benchmarks/zero5-c33-v1/result.json");
const parentStatusBytes = fs.readFileSync("benchmarks/zero5-c33-v1/status.json");
const parentContractBytes = fs.readFileSync("benchmarks/zero5-c33-v1/contract.json");
const parent = JSON.parse(parentResultBytes);

assert.equal(result.schema, "zero.c33_parallel_replay_result.v1");
assert.equal(result.status, "complete");
assert.equal(status.status, "complete");
assert.equal(status.exit_code, 0);
assert.equal(status.result_sha256, digest(read("result.json")));
assert.equal(digest(read("status.json")),
  comparison.performance_replay.status_sha256);
assert.equal(result.contract_sha256, digest(read("contract.json")));
assert.equal(status.contract_sha256, result.contract_sha256);
assert.equal(result.training.completed_updates, contract.training.updates);
assert.equal(result.controls.same_records, true);
assert.equal(result.controls.same_order, true);
assert.equal(result.controls.same_seed, true);
assert.equal(result.controls.same_hyperparameters, true);
assert.equal(result.controls.deterministic_merge_order, true);
assert.equal(result.controls.numerically_identical_to_serial, false);
assert.equal(result.controls.test_metrics_opened, false);
assert.equal(result.checkpoints.best.sha256,
  "0e9b4e2f67040e9daabbf2196e8e69e6907b8c9e4809a88159461cfe7c4545f7");
assert.equal(result.checkpoints.active.sha256, result.checkpoints.best.sha256);
assert.equal(status.estimated_ec2_usd, comparison.performance_replay.total_ec2_usd);
assert(status.estimated_ec2_usd <= contract.execution.maximum_total_ec2_usd);
assert.equal(status.prior_compute_usd,
  contract.execution_amendment.failed_attempt_ec2_usd);

const selected = result.calibration.selected;
assert.deepEqual(selected, result.calibration.candidates.reduce((best, item) =>
  item.tokens_per_second > best.tokens_per_second ? item : best));
assert.equal(selected.parallel_workers, 4);
assert.equal(selected.blas_threads, 1);

assert.equal(digest(parentResultBytes), comparison.scientific_parent.result_sha256);
assert.equal(digest(parentStatusBytes), comparison.scientific_parent.status_sha256);
assert.equal(digest(parentContractBytes), comparison.scientific_parent.contract_sha256);
assert.equal(parent.arms.E.checkpoint.sha256,
  comparison.scientific_parent.checkpoint_sha256);
assert.equal(parent.arms.E.validation.combined_final_nats_per_token,
  comparison.scientific_parent.final_validation_nats_per_token);
assert.equal(result.training.final_validation_nats_per_token,
  comparison.performance_replay.final_validation_nats_per_token);

const finalSpeedup = result.training.final_interval_tokens_per_second /
  comparison.scientific_parent.final_interval_tokens_per_second;
const aggregateSpeedup = result.training.aggregate_compute_tokens_per_second /
  comparison.scientific_parent.final_interval_tokens_per_second;
const validationDifference = result.training.final_validation_nats_per_token -
  comparison.scientific_parent.final_validation_nats_per_token;
const savings = comparison.scientific_parent.total_ec2_usd -
  comparison.performance_replay.total_ec2_usd;
const reduction = savings / comparison.scientific_parent.total_ec2_usd;

assert(close(finalSpeedup, comparison.comparison.final_interval_speedup));
assert(close(aggregateSpeedup,
  comparison.comparison.aggregate_to_parent_final_speedup));
assert(close(validationDifference,
  comparison.comparison.validation_nats_difference));
assert(close(savings, comparison.comparison.total_ec2_savings_usd));
assert(close(reduction,
  comparison.comparison.total_ec2_cost_reduction_fraction));
assert(finalSpeedup >= 2);
assert(Math.abs(validationDifference) <= 0.03);
assert.equal(comparison.comparison.speed_gate_passed, true);
assert.equal(comparison.comparison.quality_closeness_gate_passed, true);
assert.equal(comparison.comparison.budget_gate_passed, true);
assert.equal(comparison.claim_boundary.scientific_replication, false);
assert.equal(comparison.claim_boundary.test_metrics_opened, false);

process.stdout.write("ZERO.5 C3.3 parallel replay result verified\n");

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-vector-math-v1";
const read = name => fs.readFileSync(`${directory}/${name}`);
const parse = name => JSON.parse(read(name));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;

const contract = parse("aws-contract.json");
const launch = parse("launch.json");
const status = parse("status.json");
const result = parse("result.json");
const comparison = parse("comparison.json");

assert.equal(contract.status, "authorized");
assert.equal(contract.authorization.status, "authorized");
assert.equal(launch.contract_sha256, digest(read("aws-contract.json")));
assert.equal(launch.source_commit, contract.source.git_commit);
assert.equal(launch.source_sha256, contract.source.archive_sha256);
assert.equal(launch.asset_sha256, contract.assets.archive_sha256);
assert.equal(launch.maximum_ec2_usd,
  contract.execution.proposed_maximum_ec2_usd);

assert.equal(status.status, "complete");
assert.equal(status.exit_code, 0);
assert.equal(status.run_id, launch.run_id);
assert.equal(status.instance_id, launch.instance_id);
assert.equal(status.result_sha256, digest(read("result.json")));
assert(status.estimated_ec2_usd <= launch.maximum_ec2_usd);

assert.equal(result.schema, "zero.vector_math_benchmark.v1");
assert.equal(result.workload.updates, contract.workload.updates_per_run);
assert.equal(result.workload.repetitions, contract.workload.repetitions);
assert.equal(result.workload.parallel_workers,
  contract.workload.parallel_workers);
assert.equal(result.workload.blas_threads_per_worker,
  contract.workload.openblas_threads_per_worker);
assert.equal(result.correctness.all_metrics_within_tolerance, true);
assert.equal(result.correctness.deterministic_checkpoints_per_variant, true);

const variantNames = ["baseline", "vector-tanh", "vector-exp", "vector-both"];
for (const name of variantNames) {
  const variant = result.variants[name];
  assert.equal(variant.runs.length, contract.workload.repetitions);
  assert(close(mean(variant.runs.map(run => run.tokens_per_second)),
    variant.mean_tokens_per_second));
  assert.equal(new Set(variant.runs.map(run => run.checkpoint_sha256)).size, 1);
  for (const run of variant.runs) {
    const reference = result.variants.baseline.runs[0];
    assert(Math.abs(run.train_loss - reference.train_loss) <=
      contract.workload.metric_tolerance.train_loss);
    assert(Math.abs(run.validation_loss - reference.validation_loss) <=
      contract.workload.metric_tolerance.validation_loss);
    assert(Math.abs(run.gradient_norm - reference.gradient_norm) <=
      contract.workload.metric_tolerance.gradient_norm);
  }
}

const baseline = result.variants.baseline.mean_tokens_per_second;
for (const name of variantNames) {
  assert(close(result.variants[name].throughput_change_from_baseline,
    result.variants[name].mean_tokens_per_second / baseline - 1));
}
const selected = variantNames.reduce((best, name) =>
  result.variants[name].mean_tokens_per_second >
    result.variants[best].mean_tokens_per_second ? name : best);
assert.equal(selected, "vector-both");
assert.equal(result.selected.variant, selected);
assert(close(result.selected.mean_tokens_per_second,
  result.variants[selected].mean_tokens_per_second));

assert.equal(comparison.contract_sha256, digest(read("aws-contract.json")));
for (const [file, field] of [["launch.json", "launch_sha256"],
  ["status.json", "status_sha256"], ["result.json", "result_sha256"]]) {
  assert.equal(comparison.artifacts[field], digest(read(file)));
}
assert.equal(comparison.artifacts.source_archive_sha256,
  contract.source.archive_sha256);
assert.equal(comparison.artifacts.asset_archive_sha256,
  contract.assets.archive_sha256);
assert(close(comparison.performance.vector_both_gain_fraction,
  result.variants["vector-both"].throughput_change_from_baseline));
assert(close(comparison.performance.fixed_work_time_reduction_fraction,
  1 - baseline / result.variants["vector-both"].mean_tokens_per_second));

assert.equal(comparison.gates.speed_gain_at_least_fifteen_percent, true);
assert(result.variants["vector-both"].mean_tokens_per_second >= baseline * 1.15);
assert.equal(comparison.gates.reported_metrics_match, true);
assert.equal(comparison.gates.deterministic_checkpoints, true);
assert.equal(comparison.gates.budget_passed, true);
assert.equal(comparison.gates.instance_terminated, true);
assert.equal(comparison.gates.sealed_test_stayed_closed, true);
assert.equal(comparison.cost.estimated_ec2_usd, status.estimated_ec2_usd);
assert(comparison.cost.estimated_ec2_usd <=
  comparison.cost.approved_maximum_ec2_usd);
assert.equal(comparison.decision.promotion_candidate, true);
assert.equal(comparison.decision.production_default_changed, false);
assert.equal(comparison.claim_boundary.scientific_replication, false);
assert.equal(comparison.claim_boundary.test_metrics_opened, false);

process.stdout.write("ZERO.5 vector math AWS result verified\n");

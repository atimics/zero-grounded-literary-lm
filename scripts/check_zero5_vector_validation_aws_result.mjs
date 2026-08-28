#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-vector-validation-v1";
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

const contractSha = digest(read("aws-contract.json"));
assert.equal(contract.status, "authorized");
assert.equal(contract.authorization.status, "authorized");
assert.equal(launch.contract_sha256, contractSha);
assert.equal(launch.source_commit, contract.source.git_commit);
assert.equal(launch.source_sha256, contract.source.archive_sha256);
assert.equal(launch.asset_sha256, contract.assets.archive_sha256);
assert.equal(launch.approval_id, contract.authorization.approval_id);
assert.equal(launch.maximum_instance_seconds,
  contract.execution.maximum_instance_seconds);
assert.equal(launch.maximum_ec2_usd,
  contract.execution.proposed_maximum_ec2_usd);

assert.equal(status.status, "complete");
assert.equal(status.phase, "complete");
assert.equal(status.exit_code, 0);
assert.equal(status.run_id, launch.run_id);
assert.equal(status.instance_id, launch.instance_id);
assert.equal(status.git_commit, contract.source.git_commit);
assert.equal(status.contract_sha256, contractSha);
assert.equal(status.approval_id, contract.authorization.approval_id);
assert.equal(status.result_sha256, digest(read("result.json")));
assert(status.elapsed_instance_seconds <= launch.maximum_instance_seconds);
assert(status.estimated_ec2_usd <= launch.maximum_ec2_usd);

assert.equal(result.schema, "zero.vector_math_validation_replay.v1");
assert.equal(result.status, "performance-validation-only");
assert.equal(result.run_contract_sha256, contractSha);
assert.equal(result.workload.updates_per_arm,
  contract.workload.updates_per_arm);
assert.equal(result.workload.report_every_updates,
  contract.workload.report_every_updates);
assert.equal(result.workload.validation_batches_per_report,
  contract.workload.validation_batches_per_report);
assert.equal(result.workload.sequences_per_update,
  contract.workload.batch_sequences);
assert.equal(result.workload.context_tokens, contract.workload.context_tokens);
assert.equal(result.workload.parallel_workers,
  contract.workload.parallel_workers);
assert.equal(result.workload.blas_threads_per_worker,
  contract.workload.openblas_threads_per_worker);
assert.equal(result.workload.dynamic_threading,
  contract.workload.dynamic_threading);
assert.equal(result.arms.baseline.math_backend,
  contract.workload.arms.baseline.math_backend);
assert.equal(result.arms.vector.math_backend,
  contract.workload.arms.vector.math_backend);
assert.equal(result.arms.baseline.checkpoint_version,
  contract.workload.checkpoint_version);
assert.equal(result.arms.vector.checkpoint_version,
  contract.workload.checkpoint_version);

const expectedPoints = contract.workload.updates_per_arm /
  contract.workload.report_every_updates;
assert.equal(result.arms.baseline.reports.length, expectedPoints);
assert.equal(result.arms.vector.reports.length, expectedPoints);
assert.equal(result.comparison.points.length, expectedPoints);
const finiteFields = ["train_loss", "validation_loss", "gradient_norm",
  "learning_rate", "interval_tokens_per_second",
  "interval_active_targets_per_second"];
for (let index = 0; index < expectedPoints; index += 1) {
  const baseline = result.arms.baseline.reports[index];
  const vector = result.arms.vector.reports[index];
  const point = result.comparison.points[index];
  assert.equal(baseline.update, (index + 1) *
    contract.workload.report_every_updates);
  assert.equal(vector.update, baseline.update);
  assert.equal(point.update, baseline.update);
  for (const field of finiteFields) {
    assert(Number.isFinite(baseline[field]));
    assert(Number.isFinite(vector[field]));
  }
  assert(close(point.baseline_validation_loss, baseline.validation_loss));
  assert(close(point.vector_validation_loss, vector.validation_loss));
  assert(close(point.vector_minus_baseline,
    vector.validation_loss - baseline.validation_loss));
}

const totalTokens = result.workload.total_tokens_per_arm;
const baselineSpeed = totalTokens / result.arms.baseline.elapsed_seconds;
const vectorSpeed = totalTokens / result.arms.vector.elapsed_seconds;
const gain = vectorSpeed / baselineSpeed - 1;
const timeReduction = 1 - baselineSpeed / vectorSpeed;
assert(close(result.comparison.effective_tokens_per_second.baseline,
  baselineSpeed));
assert(close(result.comparison.effective_tokens_per_second.vector,
  vectorSpeed));
assert(close(result.comparison.vector_throughput_gain_fraction, gain));
assert(close(result.comparison.fixed_work_time_reduction_fraction,
  timeReduction));

const deltas = result.comparison.points.map(point =>
  point.vector_minus_baseline);
assert(close(result.comparison.final_validation_loss_delta,
  deltas.at(-1)));
assert(close(result.comparison.mean_validation_loss_delta, mean(deltas)));
assert(close(result.comparison.maximum_validation_loss_delta,
  Math.max(...deltas)));
assert(gain >= contract.workload.gates.minimum_vector_speed_gain_fraction);
assert(deltas.at(-1) <=
  contract.workload.gates.maximum_final_validation_loss_delta);
assert(mean(deltas) <=
  contract.workload.gates.maximum_mean_validation_loss_delta);
assert(Math.max(...deltas) <=
  contract.workload.gates.maximum_single_point_validation_loss_delta);
assert(Object.values(result.gates).every(Boolean));
assert.equal(result.claim_boundary.scientific_replication, false);
assert.equal(result.claim_boundary.new_model_result, false);
assert.equal(result.claim_boundary.test_metrics_opened, false);
assert.equal(result.decision.eligible_to_promote_vector_math_default, true);

assert.equal(comparison.contract_sha256, contractSha);
for (const [file, field] of [["launch.json", "launch_sha256"],
  ["status.json", "status_sha256"], ["result.json", "result_sha256"]]) {
  assert.equal(comparison.artifacts[field], digest(read(file)));
}
assert.equal(comparison.artifacts.run_id, launch.run_id);
assert.equal(comparison.artifacts.instance_id, launch.instance_id);
assert.equal(comparison.artifacts.source_commit, contract.source.git_commit);
assert.equal(comparison.artifacts.source_archive_sha256,
  contract.source.archive_sha256);
assert.equal(comparison.artifacts.asset_archive_sha256,
  contract.assets.archive_sha256);
assert.equal(comparison.artifacts.s3_result_key, status.result_key);
assert(close(comparison.performance.baseline_effective_tokens_per_second,
  baselineSpeed));
assert(close(comparison.performance.vector_effective_tokens_per_second,
  vectorSpeed));
assert(close(comparison.performance.vector_gain_fraction, gain));
assert(close(comparison.performance.fixed_work_time_reduction_fraction,
  timeReduction));
assert.equal(comparison.validation.reported_points, expectedPoints);
assert(close(comparison.validation.final_loss.delta, deltas.at(-1)));
assert(close(comparison.validation.mean_loss_delta, mean(deltas)));
assert(close(comparison.validation.maximum_point_loss_delta,
  Math.max(...deltas)));
assert(Object.values(comparison.gates).every(Boolean));
assert.equal(comparison.cost.elapsed_instance_seconds,
  status.elapsed_instance_seconds);
assert.equal(comparison.cost.estimated_ec2_usd, status.estimated_ec2_usd);
assert.equal(comparison.cost.approved_maximum_ec2_usd,
  launch.maximum_ec2_usd);
assert.equal(comparison.decision.eligible_to_promote_vector_math_default,
  true);
assert.equal(comparison.decision.production_default_changed, false);
assert.equal(comparison.claim_boundary.performance_validation_only, true);
assert.equal(comparison.claim_boundary.scientific_replication, false);
assert.equal(comparison.claim_boundary.new_model_result, false);
assert.equal(comparison.claim_boundary.test_metrics_opened, false);

process.stdout.write("ZERO.5 vector validation AWS result verified\n");

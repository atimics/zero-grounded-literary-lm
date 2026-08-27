#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-cpu-phase-profile-v1";
const read = name => fs.readFileSync(`${directory}/${name}`);
const parse = name => JSON.parse(read(name));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

const contract = parse("aws-contract.json");
const launch = parse("launch.json");
const status = parse("status.json");
const result = parse("result.json");
const comparison = parse("comparison.json");
const perf = read("perf.csv").toString("utf8");

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

assert.equal(result.schema, "zero.cpu_phase_profile_benchmark.v1");
assert.equal(result.workload.updates, contract.workload.updates_per_binary);
assert.equal(result.workload.parallel_workers,
  contract.workload.parallel_workers);
assert.equal(result.workload.blas_threads_per_worker,
  contract.workload.openblas_threads_per_worker);
assert.equal(result.comparison.same_reported_metrics, true);
assert.equal(result.comparison.checkpoint_bit_identical, true);
assert.equal(result.baseline.checkpoint_sha256,
  result.profiled.checkpoint_sha256);
assert(result.comparison.profiler_elapsed_overhead_fraction <=
  contract.workload.profiler_overhead_maximum_fraction);

assert.equal(comparison.contract_sha256, digest(read("aws-contract.json")));
for (const [file, field] of [["launch.json", "launch_sha256"],
  ["status.json", "status_sha256"], ["result.json", "result_sha256"],
  ["perf.csv", "perf_sha256"]]) {
  assert.equal(comparison.artifacts[field], digest(read(file)));
}
assert.equal(comparison.artifacts.source_archive_sha256,
  contract.source.archive_sha256);
assert.equal(comparison.artifacts.asset_archive_sha256,
  contract.assets.archive_sha256);

const wall = result.profiled.phase_profile.wall_seconds;
const wallTotal = wall.input_setup + wall.train_wave + wall.gradient_merge +
  wall.optimizer;
assert(close(wallTotal, comparison.performance.wall_seconds.tracked_total));
for (const [field, fraction] of [["input_setup", "input_setup_fraction"],
  ["train_wave", "train_wave_fraction"],
  ["gradient_merge", "gradient_merge_fraction"],
  ["optimizer", "optimizer_fraction"]]) {
  assert(close(wall[field] / wallTotal,
    comparison.performance.wall_seconds[fraction]));
}

const worker = result.profiled.phase_profile.worker_cpu_seconds;
const workerTotal = worker.forward + worker.backward;
const phases = {
  linear: worker.linear_forward + worker.linear_backward,
  attention: worker.attention_forward + worker.attention_backward,
  gelu: worker.gelu_forward + worker.gelu_backward,
  rmsnorm: worker.norm_forward + worker.norm_backward,
};
assert(close(workerTotal,
  comparison.performance.worker_cpu_seconds.tracked_total));
for (const [name, seconds] of Object.entries(phases)) {
  assert(close(seconds, comparison.performance.worker_cpu_seconds[name]));
  assert(close(seconds / workerTotal,
    comparison.performance.worker_cpu_seconds[`${name}_fraction`]));
}
assert(close(worker.rope / workerTotal,
  comparison.performance.worker_cpu_seconds.rope_fraction));
assert(close(worker.output_softmax_loss / workerTotal,
  comparison.performance.worker_cpu_seconds.output_softmax_loss_fraction));
assert(close(worker.unattributed / workerTotal,
  comparison.performance.worker_cpu_seconds.unattributed_fraction));

assert.equal(comparison.gates.reported_metrics_match, true);
assert.equal(comparison.gates.checkpoints_bit_identical, true);
assert.equal(comparison.gates.profiler_overhead_below_five_percent, true);
assert.equal(comparison.gates.budget_passed, true);
assert.equal(comparison.gates.instance_terminated, true);
assert.equal(comparison.gates.sealed_test_stayed_closed, true);
assert.equal(comparison.cost.estimated_ec2_usd, status.estimated_ec2_usd);
assert(comparison.cost.estimated_ec2_usd <=
  comparison.cost.approved_maximum_ec2_usd);
assert.equal(comparison.claim_boundary.scientific_replication, false);
assert.equal(comparison.claim_boundary.test_metrics_opened, false);
assert.equal(comparison.performance.hardware_counters.available, false);
assert.match(perf, /<not supported>,,cycles/);

process.stdout.write("ZERO.5 CPU profile AWS result verified\n");

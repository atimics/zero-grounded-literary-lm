#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const contractFile =
  "benchmarks/zero5-vector-validation-v1/aws-contract.json";
const benchmarkFile = "scripts/benchmark_zero5_vector_validation.mjs";
const userDataFile = "scripts/aws/zero5-vector-validation-user-data.sh";
const launcherFile = "scripts/aws/zero5-vector-validation-run-instance.sh";
const read = file => fs.readFileSync(file, "utf8");
const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const contract = JSON.parse(read(contractFile));
const benchmark = read(benchmarkFile);
const userData = read(userDataFile);
const launcher = read(launcherFile);

assert.equal(contract.schema, "zero.aws_vector_validation_contract.v1");
assert.ok(["awaiting-explicit-authorization", "authorized"]
  .includes(contract.status));
assert.equal(contract.source.git_commit,
  "a0645209d53184f7d87247e5b15c0d6f09523fca");
assert.deepEqual(execFileSync("git", ["show",
  `${contract.source.git_commit}:${benchmarkFile}`]),
fs.readFileSync(benchmarkFile));
assert.equal(contract.source.archive_sha256,
  "7fefc72b40cdd5eec03488ccfe08648f2d3ba52e724a3f3c84edf53b5c76c28c");
assert.equal(contract.workload.updates_per_arm, 1000);
assert.equal(contract.workload.report_every_updates, 100);
assert.equal(contract.workload.validation_batches_per_report, 16);
assert.equal(contract.workload.arms.baseline.math_backend, "scalar-array");
assert.equal(contract.workload.arms.vector.math_backend,
  "gnu-libmvec-tanh-exp");
assert.equal(contract.workload.checkpoint_version, 6);
assert.equal(contract.workload.openblas_threads_per_worker, 1);
assert.equal(contract.workload.dynamic_threading, false);
assert.equal(contract.workload.gates.minimum_vector_speed_gain_fraction, 0.15);
assert.equal(contract.workload.gates.maximum_final_validation_loss_delta, 0.01);
assert.equal(contract.workload.gates.maximum_mean_validation_loss_delta, 0.01);
assert.equal(contract.workload.gates
  .maximum_single_point_validation_loss_delta, 0.02);
assert.equal(contract.workload.test_set_policy,
  "The sealed test set stays closed.");
assert.equal(contract.execution.region, "us-east-1");
assert.equal(contract.execution.instance_type, "c6i.4xlarge");
assert.equal(contract.execution.maximum_instance_seconds, 900);
assert.equal(contract.execution.proposed_maximum_ec2_usd, 0.17);
assert.equal(contract.execution.maximum_computed_ec2_usd, 0.17);
assert.equal(contract.execution.user_data_sha256, sha256(userDataFile));
assert(contract.execution.projected_ec2_usd <
  contract.execution.proposed_maximum_ec2_usd);
assert(contract.execution.maximum_instance_seconds *
  contract.execution.on_demand_usd_per_hour / 3600 <=
  contract.execution.proposed_maximum_ec2_usd);

for (const digest of [contract.source.archive_sha256,
  contract.assets.archive_sha256, contract.assets.tokenizer_sha256,
  contract.assets.initial_checkpoint_sha256,
  contract.assets.train_pack_sha256,
  contract.assets.validation_pack_sha256]) {
  assert.match(digest, /^[0-9a-f]{64}$/);
}
for (const value of ["OPENBLAS_NUM_THREADS", "OPENBLAS_DYNAMIC",
  "option(\"--updates\", \"1000\")",
  "option(\"--report-every\", \"100\")", "--validation\", \"16",
  "scalar-array", "gnu-libmvec-tanh-exp", "checkpoint_version_6",
  "sealed_test_stayed_closed"]) {
  assert.ok(benchmark.includes(value), `benchmark is missing ${value}`);
}
for (const value of ["OPENBLAS_NUM_THREADS=1", "OPENBLAS_DYNAMIC=0",
  "--updates 1000", "--report-every 100", "--require-math-backend",
  "gnu-libmvec-tanh-exp", "timeout --signal=TERM", "shutdown -h now",
  ".claim_boundary.test_metrics_opened == false"]) {
  assert.ok(userData.includes(value), `user data is missing ${value}`);
}
for (const value of ["--instance-type \"$instance_type\"",
  "--instance-initiated-shutdown-behavior terminate",
  "--if-none-match '*'", "--dry-run", "awaiting-explicit-authorization",
  "maximum_ec2_usd"]) {
  assert.ok(launcher.includes(value), `launcher is missing ${value}`);
}
for (const text of [benchmark, userData, launcher]) {
  assert.ok(!text.includes("test.interleaved"));
}

if (contract.status === "authorized") {
  assert.equal(contract.authorization.status, "authorized");
  assert.equal(contract.authorization.approved_by, "ratimics");
  assert.match(contract.authorization.approved_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
} else {
  assert.equal(contract.authorization.status,
    "awaiting-explicit-user-approval");
  assert.equal(contract.authorization.approved_by, null);
  assert.equal(contract.authorization.approved_at, null);
}

process.stdout.write("ZERO.5 vector validation AWS contract checks passed\n");

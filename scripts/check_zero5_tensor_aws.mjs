#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

function text(file) {
  return fs.readFileSync(file, "utf8");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const contractFile = "benchmarks/zero5-tensor-batch-v1/aws-contract.json";
const userDataFile = "scripts/aws/zero5-tensor-calibration-user-data.sh";
const launcherFile = "scripts/aws/zero5-tensor-calibration-run-instance.sh";
const contract = JSON.parse(text(contractFile));
const userData = text(userDataFile);
const launcher = text(launcherFile);

assert.equal(contract.schema, "zero.aws_tensor_batch_calibration_contract.v1");
assert.equal(contract.status, "authorized");
assert.equal(contract.source.git_commit, "ed67d1e114d0b7284107a6c80d2e99cc55d98fd8");
assert.deepEqual(contract.workload.openblas_thread_candidates, [1, 2, 4, 8, 16]);
assert.equal(contract.workload.updates_per_candidate, 50);
assert.equal(contract.workload.dynamic_threading, false);
assert.equal(contract.workload.test_set_policy, "The sealed test set stays closed.");
assert.equal(contract.execution.instance_type, "c6i.4xlarge");
assert.equal(contract.execution.region, "us-east-1");
assert.equal(contract.execution.maximum_instance_seconds, 780);
assert.equal(contract.execution.maximum_total_ec2_usd, 0.15);
assert.ok(contract.execution.maximum_instance_seconds *
  contract.execution.on_demand_usd_per_hour / 3600 <=
  contract.execution.maximum_total_ec2_usd);
assert.equal(contract.execution.user_data_sha256, sha256(userDataFile));
for (const digest of [contract.source.archive_sha256,
  contract.assets.archive_sha256, contract.assets.tokenizer_sha256,
  contract.assets.initial_checkpoint_sha256,
  contract.assets.train_pack_sha256,
  contract.assets.validation_pack_sha256]) {
  assert.match(digest, /^[0-9a-f]{64}$/);
}

for (const value of ["OPENBLAS_DYNAMIC=0", "OMP_DYNAMIC=FALSE",
  "for threads in 1 2 4 8 16", "timeout --signal=TERM",
  "shutdown -h now", "same_reported_metrics"]) {
  assert.ok(userData.includes(value), `user data is missing ${value}`);
}
for (const value of ["--instance-type \"$instance_type\"",
  "--instance-initiated-shutdown-behavior terminate",
  "--if-none-match '*'", "--dry-run", "maximum_ec2_usd"]) {
  assert.ok(launcher.includes(value), `launcher is missing ${value}`);
}
assert.ok(!userData.includes("test.interleaved"));
assert.ok(!launcher.includes("test.interleaved"));

process.stdout.write("ZERO.5 tensor AWS contract checks passed\n");

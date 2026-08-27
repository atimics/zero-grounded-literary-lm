#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const contractFile =
  "benchmarks/zero5-cpu-phase-profile-v1/aws-contract.json";
const userDataFile = "scripts/aws/zero5-cpu-profile-user-data.sh";
const launcherFile = "scripts/aws/zero5-cpu-profile-run-instance.sh";
const read = file => fs.readFileSync(file, "utf8");
const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const contract = JSON.parse(read(contractFile));
const userData = read(userDataFile);
const launcher = read(launcherFile);

assert.equal(contract.schema, "zero.aws_cpu_phase_profile_contract.v1");
assert.ok(["awaiting-explicit-authorization", "authorized"]
  .includes(contract.status));
assert.equal(contract.source.git_commit,
  "756860b3a8d0bdb0b76d719f6b293f7d412959f8");
assert.equal(contract.workload.updates_per_binary, 100);
assert.deepEqual(contract.workload.binaries,
  ["zero5_c32_lm_fast", "zero5_c32_lm_profile"]);
assert.equal(contract.workload.parallel_workers, 4);
assert.equal(contract.workload.openblas_threads_per_worker, 1);
assert.equal(contract.workload.dynamic_threading, false);
assert.equal(contract.workload.checkpoint_bit_identity_required, true);
assert.equal(contract.workload.test_set_policy,
  "The sealed test set stays closed.");
assert.equal(contract.execution.region, "us-east-1");
assert.equal(contract.execution.instance_type, "c6i.4xlarge");
assert.equal(contract.execution.maximum_instance_seconds, 317);
assert.equal(contract.execution.proposed_maximum_ec2_usd, 0.06);
assert.ok(contract.execution.maximum_instance_seconds *
  contract.execution.on_demand_usd_per_hour / 3600 <=
  contract.execution.proposed_maximum_ec2_usd);
assert.equal(contract.execution.user_data_sha256, sha256(userDataFile));
for (const digest of [contract.source.archive_sha256,
  contract.assets.archive_sha256, contract.assets.tokenizer_sha256,
  contract.assets.initial_checkpoint_sha256,
  contract.assets.train_pack_sha256,
  contract.assets.validation_pack_sha256]) {
  assert.match(digest, /^[0-9a-f]{64}$/);
}

for (const value of ["OPENBLAS_NUM_THREADS=1", "OPENBLAS_DYNAMIC=0",
  "--updates 100", "perf stat", "timeout --signal=TERM",
  "shutdown -h now", "checkpoint_bit_identical == true"]) {
  assert.ok(userData.includes(value), `user data is missing ${value}`);
}
for (const value of ["--instance-type \"$instance_type\"",
  "--instance-initiated-shutdown-behavior terminate",
  "--if-none-match '*'", "--dry-run",
  "awaiting-explicit-authorization", "maximum_ec2_usd"]) {
  assert.ok(launcher.includes(value), `launcher is missing ${value}`);
}
assert.ok(!userData.includes("test.interleaved"));
assert.ok(!launcher.includes("test.interleaved"));
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

process.stdout.write("ZERO.5 CPU profile AWS contract checks passed\n");

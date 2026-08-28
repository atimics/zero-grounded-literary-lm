#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const contractFile = "benchmarks/zero5-avx512-linear-v1/aws-contract.json";
const stageFile = "scripts/aws/zero5-avx512-linear-stage.sh";
const userDataFile = "scripts/aws/zero5-avx512-linear-user-data.sh";
const launcherFile = "scripts/aws/zero5-avx512-linear-run-instance.sh";
const read = file => fs.readFileSync(file, "utf8");
const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const contract = JSON.parse(read(contractFile));
const stage = read(stageFile);
const userData = read(userDataFile);
const launcher = read(launcherFile);

assert.equal(contract.schema, "zero.aws_avx512_linear_contract.v1");
assert.equal(contract.status, "authorized");
assert.equal(contract.source.git_commit,
  "50b029bf4420c155d2863c241b4eb4792cba4f91");
assert.equal(contract.workload.updates_per_run, 25);
assert.equal(contract.workload.repetitions, 2);
assert.deepEqual(contract.workload.variants, ["openblas", "avx512"]);
assert.equal(contract.workload.parallel_workers, 4);
assert.equal(contract.workload.openblas_threads_per_worker, 1);
assert.equal(contract.workload.dynamic_threading, false);
assert.equal(contract.workload.deterministic_checkpoint_per_variant_required,
  true);
assert.equal(contract.workload.test_set_policy,
  "The sealed test set stays closed.");
assert.equal(contract.execution.region, "us-east-1");
assert.equal(contract.execution.instance_type, "c6i.4xlarge");
assert.equal(contract.execution.maximum_instance_seconds, 370);
assert.equal(contract.execution.proposed_maximum_ec2_usd, 0.07);
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

for (const value of ["--add-virtual-file=SOURCE_COMMIT:",
  "--if-none-match '*'", "head-object", "asset_sha256"]) {
  assert.ok(stage.includes(value), `stage is missing ${value}`);
}
for (const value of ["grep -qw avx512f", "grep -qw fma",
  "OPENBLAS_NUM_THREADS=1", "OPENBLAS_DYNAMIC=0", "--updates 25",
  "--repetitions 2", "zero5_c32_lm_vector_math",
  "zero5_c32_lm_avx512_linear", "timeout --signal=TERM",
  "shutdown -h now", "deterministic_checkpoints_per_backend == true"]) {
  assert.ok(userData.includes(value), `user data is missing ${value}`);
}
for (const value of ["--instance-type \"$instance_type\"",
  "--instance-initiated-shutdown-behavior terminate",
  "--if-none-match '*'", "--dry-run", "maximum_ec2_usd"]) {
  assert.ok(launcher.includes(value), `launcher is missing ${value}`);
}
assert.ok(!stage.includes("test.interleaved"));
assert.ok(!userData.includes("test.interleaved"));
assert.ok(!launcher.includes("test.interleaved"));
assert.equal(contract.authorization.status, "authorized");
assert.equal(contract.authorization.approved_by, "ratimics");
assert.match(contract.authorization.approved_at,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

process.stdout.write("ZERO.5 AVX-512 linear AWS contract checks passed\n");

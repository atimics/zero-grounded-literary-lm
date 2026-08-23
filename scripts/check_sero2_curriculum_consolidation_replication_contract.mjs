#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const contractPath =
  "benchmarks/sero2-curriculum-consolidation-replication-v1/contract.json";
const executionPath =
  "benchmarks/sero2-curriculum-consolidation-replication-v1/aws-execution.json";
const parentPath = "benchmarks/sero2-curriculum-consolidation-v1/contract.json";
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const execution = JSON.parse(fs.readFileSync(executionPath, "utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hex64 = /^[0-9a-f]{64}$/;

assert.equal(contract.schema, "sero.curriculum_pretrain_replication_contract.v1");
assert.equal(contract.experiment, "sero2-curriculum-consolidation-replication-v1");
assert.equal(contract.status, "replication-seeds-1-and-2-open");
assert.equal(contract.replication_role, "final");
assert.deepEqual(contract.open_seeds, [1, 2]);
assert.equal(contract.parent_contract.path, parentPath);
assert.equal(contract.parent_contract.sha256, sha256(fs.readFileSync(parentPath)));
assert.equal(contract.pilot_decisions.train_from_scratch, false);
assert.equal(contract.pilot_decisions.fresh_optimizer_for_consolidation, true);

for (const seed of ["1", "2"]) {
  assert.match(contract.initialization.checkpoint_sha256_by_seed[seed], hex64);
  assert.match(contract.initialization.parent_contract_sha256_by_seed[seed], hex64);
  assert.match(contract.initialization.parent_schedule_sha256_by_seed[seed], hex64);
  assert.match(contract.initialization.parent_result_sha256_by_seed[seed], hex64);
  assert.match(contract.training.parent_schedule_sha256_by_seed[seed], hex64);
  assert.match(contract.expected_schedule_sha256_by_seed[seed], hex64);
  assert.equal(
    contract.training.parent_schedule_sha256_by_seed[seed],
    contract.initialization.parent_schedule_sha256_by_seed[seed],
  );
}
assert.notEqual(
  contract.initialization.checkpoint_sha256_by_seed["1"],
  contract.initialization.checkpoint_sha256_by_seed["2"],
);
assert.notEqual(
  contract.expected_schedule_sha256_by_seed["1"],
  contract.expected_schedule_sha256_by_seed["2"],
);
assert.deepEqual(execution.seeds, [1, 2]);
assert.equal(execution.full_per_seed.maximum_instance_seconds, 7200);
assert.equal(execution.full_per_seed.maximum_ec2_usd, 2.012);
assert.equal(execution.maximum_ec2_usd, 4.024);

for (const path of [
  "scripts/aws/sero2-curriculum-consolidation-replication-run-instances.sh",
  "scripts/aws/sero2-curriculum-user-data.sh",
]) {
  const source = fs.readFileSync(path, "utf8");
  assert.match(source, /sero2-curriculum-consolidation-replication-v1/);
}

console.log("Sero curriculum consolidation replication contract passed");

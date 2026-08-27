#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contract = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-replication-v1/contract.json", "utf8"));
const execution = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-replication-v1/aws-execution.json", "utf8"));
const parent = fs.readFileSync(contract.parent_contract.path);
const parentDigest = crypto.createHash("sha256").update(parent).digest("hex");

assert.equal(contract.schema, "sero.curriculum_pretrain_replication_contract.v1");
assert.equal(contract.status, "replication-seeds-1-and-2-open");
assert.equal(contract.parent_contract.sha256, parentDigest);
assert.deepEqual(contract.open_seeds, [1, 2]);
assert.equal(contract.replication_role, "parent");
assert.deepEqual(Object.keys(contract.expected_schedule_sha256_by_seed), ["1", "2"]);
for (const digest of Object.values(contract.expected_schedule_sha256_by_seed))
  assert.match(digest, /^[0-9a-f]{64}$/);
assert.equal(contract.seed0_evidence.final_decision, "seed0-passed-open-replication");
assert.equal(contract.seed0_evidence.all_frozen_gates_passed, true);
assert.equal(contract.pilot_decisions.run_exact_recipe_without_retuning, true);
assert.equal(contract.pilot_decisions.train_from_scratch, true);
assert.equal(execution.instance_type, "g5.xlarge");
assert.deepEqual(execution.seeds, [1, 2]);
assert.equal(execution.full.maximum_ec2_usd_two_seeds, 6.036);
assert.equal(execution.controls.seed0_calibration_reused, true);

for (const file of ["scripts/aws/sero2-curriculum-user-data.sh",
  "scripts/aws/sero2-curriculum-replication-run-instances.sh"]) {
  const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
}

const trainer = fs.readFileSync("experiments/sero2-curriculum/train.py", "utf8");
for (const required of ["open_seeds", "replication-parent-ready", "seed_binding",
  "replication schedule hash mismatch",
  "replication parent contract hash mismatch"])
  assert.ok(trainer.includes(required), `replication trainer omits ${required}`);

console.log("Sero curriculum replication contract passed");

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contract = JSON.parse(fs.readFileSync(
  "benchmarks/sero20m-curriculum-v1/contract.json", "utf8",
));
const execution = JSON.parse(fs.readFileSync(
  "benchmarks/sero20m-curriculum-v1/aws-execution.json", "utf8",
));
const parent = fs.readFileSync(contract.parent_contract.path);
const parentDigest = crypto.createHash("sha256").update(parent).digest("hex");

assert.equal(contract.schema, "sero.curriculum_pretrain_replication_contract.v1");
assert.equal(contract.experiment, "sero20m-curriculum-v1");
assert.equal(contract.status, "scale-seed0-open");
assert.equal(contract.parent_contract.sha256, parentDigest);
assert.deepEqual(contract.open_seeds, [0]);
assert.equal(contract.replication_role, "parent");
assert.deepEqual(contract.model, {
  architecture: "dense-causal-tied-embedding-transformer",
  token_context: 512,
  dimension: 384,
  heads: 8,
  layers: 10,
  feed_forward: 1600,
  dropout: 0,
  position: "learned-absolute",
  normalization: "pre-norm-plus-final-rmsnorm",
  private_input_bos: true,
  expected_parameters: 20011136,
});
assert.deepEqual(contract.expected_schedule_sha256_by_seed, {
  "0": "79139c590c044befe176e818210baf82b311393c8dffa3fcb203317a2053215f",
});
assert.equal(contract.scale_hypothesis.total_training_tokens_expected, 377031062);
assert.equal(contract.scale_hypothesis.training_tokens_per_parameter_expected,
  377031062 / 20011136);
assert.equal(contract.scale_hypothesis.primary_falsifier,
  "consolidated test content bits per byte above 1.2620724986051812");
assert(contract.evaluation.sample_prompts.includes(
  "a mountain is an extremely high space is a flicker",
));
assert.equal(contract.pilot_decisions.scale_is_only_model_change, true);
assert.equal(contract.pilot_decisions.train_from_scratch, true);
assert.equal(execution.instance_type, "g5.xlarge");
assert.equal(execution.calibration.maximum_ec2_usd, 1.006);
assert.equal(execution.full.maximum_ec2_usd, 6.036);
assert.equal(execution.controls.seeds_1_and_2_closed, true);

for (const file of [
  "scripts/aws/sero2-curriculum-user-data.sh",
  "scripts/aws/sero20m-curriculum-run-instances.sh",
]) {
  const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
}
const bootstrap = fs.readFileSync("scripts/aws/sero2-curriculum-user-data.sh", "utf8");
for (const required of ["sero20m-curriculum-v1", "sero20m-consolidation-v1",
  "21600", "6.036", "14400", "4.024"])
  assert(bootstrap.includes(required), `scale bootstrap omits ${required}`);

console.log("Sero 20M curriculum contract passed");

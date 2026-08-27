#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const base = "benchmarks/sero20m-consolidation-v1";
const contract = JSON.parse(fs.readFileSync(`${base}/contract.json`, "utf8"));
const execution = JSON.parse(fs.readFileSync(`${base}/aws-execution.json`, "utf8"));
const parentResultRaw = fs.readFileSync(`${base}/parent-result.json`);
const parentResult = JSON.parse(parentResultRaw);
const parentStatus = JSON.parse(fs.readFileSync(`${base}/parent-status.json`, "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const hex64 = /^[0-9a-f]{64}$/;

assert.equal(contract.schema, "sero.curriculum_pretrain_replication_contract.v1");
assert.equal(contract.experiment, "sero20m-consolidation-v1");
assert.equal(contract.status, "scale-seed0-final-open");
assert.deepEqual(contract.open_seeds, [0]);
assert.equal(contract.replication_role, "final");
assert.equal(contract.parent_contract.sha256,
  sha256(fs.readFileSync(contract.parent_contract.path)));
assert.equal(contract.model.expected_parameters, 20011136);
assert.equal(contract.model.dimension, 384);
assert.equal(contract.model.layers, 10);
assert.equal(contract.model.feed_forward, 1600);
assert.match(contract.initialization.checkpoint_sha256, hex64);
assert.equal(contract.initialization.checkpoint_sha256,
  parentResult.model.artifact_sha256);
assert.equal(contract.initialization.parent_contract_sha256,
  parentResult.contract.sha256);
assert.equal(contract.initialization.parent_schedule_sha256,
  parentResult.data.schedule_sha256);
assert.equal(contract.initialization.parent_result_sha256, sha256(parentResultRaw));
assert.equal(contract.initialization.optimizer_state_reused, false);
assert.equal(parentStatus.status, "complete");
assert.equal(parentStatus.result_sha256, sha256(parentResultRaw));
assert.equal(parentStatus.model_artifact_sha256,
  contract.initialization.checkpoint_sha256);
assert.equal(parentResult.decision, "replication-parent-ready");
assert.equal(parentResult.final_test.content_bits_per_byte, 1.2415911961719);

assert.equal(contract.training.total_target_raw_bytes, 400000000);
assert.equal(contract.training.parent_schedule_sha256,
  contract.initialization.parent_schedule_sha256);
assert.deepEqual(contract.training.stages[0].domain_weights,
  {foundation: 0.60, general: 0.30, technical: 0.05, dialogue: 0.03, reasoning: 0.02});
assert.deepEqual(contract.expected_schedule_sha256_by_seed, {
  "0": "c889af19be110b9fd905bb7fec6679fb1eda01cb27911b6e5b883e35c54b33d0",
});
assert.equal(contract.success_gates.maximum_test_content_bits_per_byte,
  1.3284973669528224 * 0.95);
assert.equal(contract.success_gates.minimum_test_end_of_document_top1_accuracy, 0.88);
assert(contract.evaluation.sample_prompts.includes(
  "a mountain is an extremely high space is a flicker",
));
assert.equal(contract.pilot_decisions.model_scale_is_the_only_recipe_change, true);
assert.equal(contract.pilot_decisions.no_lineage_promotion_without_replication, true);

assert.equal(execution.instance_type, "g5.xlarge");
assert.equal(execution.full.maximum_instance_seconds, 14400);
assert.equal(execution.full.maximum_ec2_usd, 4.024);
assert.equal(execution.controls.immutable_parent_checkpoint, true);
assert.equal(execution.controls.fresh_optimizer, true);
for (const file of [
  "scripts/aws/sero2-curriculum-user-data.sh",
  "scripts/aws/sero20m-consolidation-run-instances.sh",
]) {
  const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
}

console.log("Sero 20M consolidation contract passed");

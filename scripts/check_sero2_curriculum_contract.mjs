#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contract = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-v1/contract.json", "utf8"));
const execution = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-v1/aws-execution.json", "utf8"));
const consolidation = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-consolidation-v1/contract.json", "utf8"));
const consolidationExecution = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-consolidation-v1/aws-execution.json", "utf8"));
const tokenizer = fs.readFileSync("tokenizers/sero1-byte-bpe-4096.json");
const tokenizerDigest = crypto.createHash("sha256").update(tokenizer).digest("hex");
const trainer = fs.readFileSync("experiments/sero2-curriculum/train.py", "utf8");
const builder = fs.readFileSync("scripts/build_sero_curriculum_corpus.py", "utf8");

assert.equal(contract.schema, "sero.curriculum_pretrain_contract.v1");
assert.equal(contract.status, "diagnostic-seed0-unrun");
assert.equal(contract.pilot_seed, 0);
assert.equal(contract.data.dataset_digest,
  "dcad26c0cc44f449d87eb8af0d62d0518dc120a62aad049ff541c2fc149a35d8");
assert.ok(contract.data.unique_total_bytes > 100000000);
assert.equal(contract.data.exact_12_word_train_eval_matches, 0);
assert.equal(contract.data.documents_present_in_multiple_splits, 0);
assert.equal(contract.tokenizer.artifact_sha256, tokenizerDigest);
assert.equal(contract.model.expected_parameters, 6021312);
assert.equal(contract.training.total_target_raw_bytes, 600000000);
assert.deepEqual(contract.training.stages.map(stage => stage.id),
  ["foundations", "breadth", "application"]);
for (const stage of contract.training.stages) {
  assert.equal(Object.values(stage.domain_weights).reduce((a, b) => a + b, 0), 1);
  assert.equal(stage.target_raw_bytes, 200000000);
  assert.ok(stage.domain_weights.foundation > 0);
  assert.ok(stage.domain_weights.general > 0);
}
assert.equal(contract.baseline.test_content_bits_per_byte, 1.71145822);
assert.equal(contract.success_gates.maximum_test_content_bits_per_byte, 1.60);
assert.equal(contract.pilot_decisions.train_from_scratch, true);
assert.equal(contract.pilot_decisions.do_not_open_seeds_1_and_2_until_seed0_passes, true);
assert.equal(contract.pilot_decisions.do_not_scale_model_until_seed0_passes, true);

for (const required of ["load_mdn", "load_oasst", "load_gsm", "remove_contamination",
  "remove_repeated_paragraphs", "oasst1-LICENSE", "matches_after_filter"])
  assert.ok(builder.includes(required), `curriculum builder omits ${required}`);
for (const required of ["build_schedule", "domain_indices", "permutation",
  "model-stage-", "success_gates", "seed_everything"])
  assert.ok(trainer.includes(required), `curriculum trainer omits ${required}`);

assert.equal(execution.schema, "sero.curriculum_pretrain_aws_execution.v1");
assert.equal(execution.region, "us-east-1");
assert.equal(execution.instance_type, "g5.xlarge");
assert.equal(execution.calibration.maximum_updates, 128);
assert.equal(execution.pilot_maximum_ec2_usd, 3.521);
assert.equal(execution.controls.calibration_must_pass_before_full, true);
assert.equal(execution.controls.seeds_1_and_2_closed, true);

assert.equal(consolidation.schema, "sero.curriculum_pretrain_contract.v1");
assert.equal(consolidation.status, "diagnostic-seed0-unrun");
assert.equal(consolidation.data.dataset_digest, contract.data.dataset_digest);
assert.equal(consolidation.initialization.checkpoint_sha256,
  "bf91752d5997c780614cee31b747bc40ef1959d8f35d10e1327757c7130a17fc");
assert.equal(consolidation.initialization.parent_schedule_sha256,
  "79139c590c044befe176e818210baf82b311393c8dffa3fcb203317a2053215f");
assert.equal(consolidation.training.total_target_raw_bytes, 400000000);
assert.deepEqual(consolidation.training.stages[0].domain_weights,
  {foundation: 0.60, general: 0.30, technical: 0.05, dialogue: 0.03, reasoning: 0.02});
assert.equal(consolidation.pilot_decisions.train_from_scratch, false);
assert.equal(consolidationExecution.full.maximum_instance_seconds, 7200);
assert.equal(consolidationExecution.controls.immutable_parent_checkpoint, true);

for (const file of ["scripts/aws/sero2-curriculum-user-data.sh",
  "scripts/aws/sero2-curriculum-run-instances.sh",
  "scripts/aws/sero2-curriculum-consolidation-run-instances.sh"]) {
  const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
}

console.log("Sero curriculum contract passed");

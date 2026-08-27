#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const summary = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-eval-v1/SUMMARY.json", "utf8"));
const contract = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-consolidation-v1/contract.json", "utf8"));
const evaluation = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-eval-v1/contract.json", "utf8"));
const report = fs.readFileSync(
  "benchmarks/sero2-curriculum-eval-v1/RESULT.md", "utf8");

assert.equal(summary.schema, "sero.curriculum_seed0_summary.v1");
assert.equal(summary.dataset_digest, contract.data.dataset_digest);
assert.equal(summary.dataset.train_utf8_bytes, contract.data.unique_training_bytes);
assert.equal(summary.dataset.sources, 6);
assert.equal(summary.consolidated_curriculum.decision,
  "seed0-passed-open-replication");
assert.equal(summary.consolidated_curriculum.all_frozen_gates_passed, true);
assert.equal(summary.consolidated_curriculum.model_sha256,
  evaluation.checkpoints["consolidated-curriculum"].sha256);
assert.ok(summary.consolidated_curriculum.test_content_bits_per_byte <=
  contract.success_gates.maximum_test_content_bits_per_byte);
assert.ok(summary.consolidated_curriculum.test_end_of_document_top1_accuracy >=
  contract.success_gates.minimum_test_end_of_document_top1_accuracy);
for (const [source, maximum] of Object.entries(
  contract.success_gates.maximum_test_source_content_bits_per_byte)) {
  assert.ok(summary.consolidated_curriculum.test_source_content_bits_per_byte[source] <=
    maximum, `${source} failed its frozen retention gate`);
}
assert.equal(summary.multi_context_diagnostic.cases_per_prompt_length, 24);
assert.deepEqual(summary.multi_context_diagnostic.prompt_token_lengths, [1, 8, 32, 128]);
assert.ok(summary.multi_context_diagnostic.consolidated_mean_bits_per_byte[3] <
  summary.multi_context_diagnostic.consolidated_mean_bits_per_byte[0]);
assert.equal(summary.generation_diagnostic.sampled_outputs_per_checkpoint, 20);
assert.equal(summary.generation_diagnostic.consolidated_sampled_severe_loop_rate, 0.05);
assert.equal(summary.generation_diagnostic.reliable_reasoning_observed, false);
assert.equal(summary.training.total_raw_bytes,
  summary.training.staged_raw_bytes + summary.training.consolidation_raw_bytes);
assert.equal(summary.training.total_tokens,
  summary.training.staged_tokens + summary.training.consolidation_tokens);
assert.equal(summary.decisions.open_seeds_1_and_2_for_replication, true);
assert.equal(summary.decisions.promote_model_now, false);
assert.equal(summary.decisions.scale_model_now, false);
assert.ok(summary.aws.total_estimated_ec2_usd < 2.0);
for (const required of ["22.4%", "89.2%", "90%", "did not solve generation collapse"])
  assert.ok(report.includes(required), `result report omits ${required}`);

console.log("Sero curriculum seed-0 result passed");

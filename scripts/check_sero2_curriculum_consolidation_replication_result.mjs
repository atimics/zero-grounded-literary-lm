#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const result = JSON.parse(fs.readFileSync(
  "benchmarks/sero2-curriculum-consolidation-replication-v1/result.json", "utf8",
));
const contract = fs.readFileSync(
  "benchmarks/sero2-curriculum-consolidation-replication-v1/contract.json",
);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sampleStddev = (values) => {
  const average = mean(values);
  return Math.sqrt(values.reduce(
    (sum, value) => sum + (value - average) ** 2, 0,
  ) / (values.length - 1));
};
const close = (left, right) => assert(Math.abs(left - right) < 1e-12);

assert.equal(result.schema, "sero.curriculum_consolidation_replication_aggregate.v1");
assert.equal(result.status, "complete-three-seed-pass");
assert.equal(
  result.contracts.consolidation_replication_sha256,
  sha256(contract),
);
assert.deepEqual(result.seeds.map(({ seed }) => seed), [0, 1, 2]);
assert(result.seeds.every(({ final }) => final.all_gates_passed));
assert(result.seeds.every(({ staged, final }) =>
  /^[0-9a-f]{64}$/.test(staged.result_sha256) &&
  /^[0-9a-f]{64}$/.test(staged.model_sha256) &&
  /^[0-9a-f]{64}$/.test(final.result_sha256) &&
  /^[0-9a-f]{64}$/.test(final.model_sha256)));

const staged = result.seeds.map(({ staged: value }) =>
  value.test_content_bits_per_byte);
const final = result.seeds.map(({ final: value }) =>
  value.test_content_bits_per_byte);
const eod = result.seeds.map(({ final: value }) =>
  value.test_end_of_document_top1_accuracy);
close(mean(staged), result.aggregate.staged_test_content_bits_per_byte.mean);
close(sampleStddev(staged),
  result.aggregate.staged_test_content_bits_per_byte.sample_stddev);
close(mean(final), result.aggregate.final_test_content_bits_per_byte.mean);
close(sampleStddev(final),
  result.aggregate.final_test_content_bits_per_byte.sample_stddev);
close(mean(eod), result.aggregate.final_test_end_of_document_top1_accuracy.mean);
assert(final.every((value, index) => value < staged[index]));
assert.equal(result.decision.all_three_seeds_passed_every_frozen_gate, true);
assert.equal(result.decision.promote_two_stage_curriculum_recipe, true);
assert.equal(result.decision.open_model_scale_experiment, true);

console.log("Sero curriculum consolidation replication result passed");

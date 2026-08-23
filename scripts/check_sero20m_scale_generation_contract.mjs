#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const base = "benchmarks/sero20m-scale-generation-v1";
const baselineContractRaw = fs.readFileSync(`${base}/baseline-contract.json`);
const baselineContract = JSON.parse(baselineContractRaw);
const baselineResultRaw = fs.readFileSync(`${base}/baseline-result.json`);
const baselineResult = JSON.parse(baselineResultRaw);
const comparison = JSON.parse(fs.readFileSync(`${base}/comparison-contract.json`));
const evaluator = fs.readFileSync(
  "experiments/sero1-pretrain/evaluate_generation.py", "utf8",
);
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

assert.equal(baselineContract.schema, "sero.generation_eval_contract.v1");
assert.equal(baselineContract.checkpoint_sha256_by_seed["0"],
  comparison.baseline.checkpoint_sha256);
assert.equal(sha256(baselineContractRaw), comparison.baseline.contract_sha256);
assert.equal(sha256(baselineResultRaw), comparison.baseline.result_sha256);
assert.equal(baselineResult.contract_sha256, comparison.baseline.contract_sha256);
assert.equal(baselineResult.checkpoints[0].sha256,
  comparison.baseline.checkpoint_sha256);
assert.equal(baselineResult.dataset_digest,
  "dcad26c0cc44f449d87eb8af0d62d0518dc120a62aad049ff541c2fc149a35d8");
assert(baselineContract.free_generation.prompts.some(({id, text}) =>
  id === "mountain-flicker" &&
  text === "a mountain is an extremely high space is a flicker"));
assert(baselineContract.free_generation.prompts.some(({id}) =>
  id === "mountain-poem"));
assert.equal(baselineContract.free_generation.stop_token_id, 188);

const context128 = baselineResult.summaries.held_out_by_prompt_length.find(
  ({prompt_tokens: value}) => value === 128,
);
const decoders = Object.fromEntries(
  baselineResult.summaries.free_by_decoder.map(row => [row.decoder, row]),
);
assert.equal(context128.mean_reference_bits_per_byte,
  comparison.baseline.context_128_content_bits_per_byte);
assert.equal(decoders.greedy.severe_loop_rate,
  comparison.baseline.greedy_severe_loop_rate);
assert.equal(decoders.greedy.mean_token_distinct_4,
  comparison.baseline.greedy_token_distinct_4);
assert.equal(decoders["sample-t08-p90"].severe_loop_rate,
  comparison.baseline.sample_t08_p90_severe_loop_rate);
assert.equal(decoders["sample-t08-p90-r11"].severe_loop_rate,
  comparison.baseline.sample_t08_p90_r11_severe_loop_rate);

const thresholds = comparison.diagnostic_thresholds;
assert.equal(thresholds.maximum_context_128_content_bits_per_byte,
  comparison.baseline.context_128_content_bits_per_byte * 0.95);
assert.equal(thresholds.maximum_greedy_severe_loop_rate,
  comparison.baseline.greedy_severe_loop_rate - 0.20);
assert.equal(thresholds.minimum_greedy_token_distinct_4,
  comparison.baseline.greedy_token_distinct_4 * 1.25);
assert.equal(thresholds.maximum_sample_t08_p90_severe_loop_rate,
  comparison.baseline.sample_t08_p90_severe_loop_rate - 0.20);
assert.equal(thresholds.maximum_sample_t08_p90_r11_severe_loop_rate,
  comparison.baseline.sample_t08_p90_r11_severe_loop_rate);
assert.equal(comparison.interpretation.thresholds_are_frozen_before_scale_output, true);
for (const required of [
  "sero.curriculum_pretrain_checkpoint.v1",
  "sero.generation_eval_replication_contract.v1",
  "stop_token_id=free_stop_token_id",
]) assert(evaluator.includes(required), `generation evaluator omits ${required}`);

console.log("Sero 20M scale-generation baseline and thresholds passed");

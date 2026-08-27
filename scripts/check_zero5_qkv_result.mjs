#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const result = JSON.parse(fs.readFileSync(
  "benchmarks/zero5-qkv-fusion-v1/result.json", "utf8"));
const digest = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

assert.equal(result.schema, "zero.qkv_fusion_result.v1");
assert.equal(result.status, "measured-local-no-go");
assert.equal(digest(result.source.trainer), result.source.trainer_sha256);
assert.equal(digest(result.source.benchmark), result.source.benchmark_sha256);
assert.equal(result.workload.repetitions, 2);

const baseline = result.variants.baseline.mean_tokens_per_second;
for (const variant of Object.values(result.variants)) {
  assert(close(mean(variant.tokens_per_second),
    variant.mean_tokens_per_second));
  assert(close(variant.throughput_change_from_baseline,
    variant.mean_tokens_per_second / baseline - 1));
}
assert.equal(result.correctness.checkpoints_bit_identical, true);
assert.equal(result.correctness.reported_metrics_match, true);
assert.equal(result.correctness.finite_difference_gradient_checks_per_fused_build,
  35);
assert.equal(result.decision.promote_to_default, false);

process.stdout.write("ZERO.5 Q/K/V fusion result verified\n");

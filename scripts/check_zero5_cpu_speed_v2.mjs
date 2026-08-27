#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const result = JSON.parse(fs.readFileSync(
  "benchmarks/zero5-cpu-speed-v2/result.json", "utf8"));
const digest = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

assert.equal(result.schema, "zero.cpu_speed_result.v2");
assert.equal(result.status, "measured-local");
assert.equal(digest(result.source.trainer),
  result.source.optimized_trainer_sha256);
assert.equal(result.workload.updates_per_run, 500);
assert.equal(result.workload.runs_per_trainer, 2);
assert.equal(result.workload.compute_token_exposures_per_run,
  result.workload.updates_per_run * result.workload.sequences_per_update *
  result.workload.context_tokens);

const previous = result.previous_parallel;
const optimized = result.optimized_parallel;
assert(close(mean(previous.tokens_per_second),
  previous.mean_tokens_per_second));
assert(close(mean(previous.elapsed_seconds), previous.mean_elapsed_seconds));
assert(close(mean(optimized.tokens_per_second),
  optimized.mean_tokens_per_second));
assert(close(mean(optimized.elapsed_seconds), optimized.mean_elapsed_seconds));
assert(close(result.comparison.throughput_change,
  optimized.mean_tokens_per_second / previous.mean_tokens_per_second - 1));
assert(close(result.comparison.elapsed_time_reduction,
  1 - optimized.mean_elapsed_seconds / previous.mean_elapsed_seconds));
assert.equal(result.correctness.previous_checkpoint_sha256,
  result.correctness.optimized_checkpoint_sha256);
assert.equal(result.correctness.checkpoint_bit_identical, true);
assert.equal(result.correctness.reported_metrics_match, true);
assert.equal(result.correctness.finite_difference_gradient_checks_per_build,
  35);
assert.equal(result.correctness.c32_mechanics_tests_passed, true);

process.stdout.write("ZERO.5 CPU speed v2 result verified\n");

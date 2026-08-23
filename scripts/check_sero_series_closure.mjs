#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const readJson = path => JSON.parse(fs.readFileSync(path, "utf8"));
const sha256 = path => crypto
  .createHash("sha256")
  .update(fs.readFileSync(path))
  .digest("hex");
const close = (actual, expected, tolerance = 1e-9) => {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale,
    String(actual) + " != " + String(expected));
};

const base = "benchmarks/sero-series-closure-v1";
const manifest = readJson(base + "/manifest.json");
const costs = readJson(base + "/SCALE-COSTS.json");
const report = fs.readFileSync(base + "/README.md", "utf8");
const resultReport = fs.readFileSync(
  "benchmarks/sero20m-consolidation-v1/RESULT.md", "utf8");

assert.equal(manifest.schema, "sero.series_closure.v1");
assert.equal(manifest.status, "frozen");
assert.equal(manifest.preservation_policy.delete_code_or_evidence, false);
assert.equal(manifest.preservation_policy.new_main_line_training_authorized, false);
assert.equal(
  manifest.preservation_policy.larger_sero_runs_require_paid_separate_scope,
  true,
);

for (const key of ["contract", "parent_result", "parent_status", "result", "status"]) {
  const entry = manifest.terminal_result[key];
  assert.equal(sha256(entry.path), entry.sha256, key + " hash moved");
}

const result = readJson(manifest.terminal_result.result.path);
const status = readJson(manifest.terminal_result.status.path);
const parent = readJson(manifest.terminal_result.parent_result.path);
const parentStatus = readJson(manifest.terminal_result.parent_status.path);
const summary6m = readJson("benchmarks/sero2-curriculum-eval-v1/SUMMARY.json");

assert.equal(result.decision, "replication-seed-passed");
assert.equal(status.status, "complete");
assert.equal(status.exit_code, 0);
assert.equal(status.result_sha256,
  manifest.terminal_result.result.aws_source_sha256);
assert.equal(status.model_artifact_sha256, result.model.artifact_sha256);
assert.equal(parentStatus.status, "complete");
assert.equal(parentStatus.result_sha256,
  sha256(manifest.terminal_result.parent_result.path));
assert.ok(Object.values(result.success_gates.checks).every(check => check.passed));

const totalTokens = parent.training.tokens + result.training.tokens;
const totalBytes = parent.training.raw_bytes + result.training.raw_bytes;
const totalTrainingSeconds = parent.training.seconds + result.training.seconds;
const totalInstanceSeconds =
  parentStatus.elapsed_instance_seconds + status.elapsed_instance_seconds;
const totalCost =
  parentStatus.estimated_ec2_usd + status.estimated_ec2_usd;

assert.equal(totalTokens, manifest.terminal_result.total_training_tokens);
assert.equal(totalBytes, manifest.terminal_result.total_training_raw_bytes);
close(totalTrainingSeconds, manifest.terminal_result.total_training_seconds);
assert.equal(totalInstanceSeconds, manifest.terminal_result.total_instance_seconds);
close(totalCost, manifest.terminal_result.total_estimated_ec2_usd);
close(totalTokens / result.model.parameters,
  manifest.terminal_result.tokens_per_parameter);
assert.equal(summary6m.training.total_tokens, totalTokens);
assert.equal(summary6m.consolidated_curriculum.test_content_bits_per_byte,
  manifest.matched_6m_comparison.test_content_bits_per_byte);

const reduction =
  (summary6m.consolidated_curriculum.test_content_bits_per_byte -
    result.final_test.content_bits_per_byte) /
  summary6m.consolidated_curriculum.test_content_bits_per_byte;
close(reduction, manifest.matched_6m_comparison["20m_relative_bpb_reduction"]);

assert.equal(costs.schema, "sero.dense_scale_cost_estimate.v1");
assert.equal(costs.actual_20m_anchor.parameters,
  String(manifest.terminal_result.parameters));
close(costs.actual_20m_anchor.estimated_ec2_usd,
  manifest.terminal_result.total_estimated_ec2_usd);
assert.equal(costs.estimates.length, 6);

const assumptions = costs.optimized_cluster_assumptions;
const anchorParameters = Number(costs.actual_20m_anchor.parameters);
const anchorCost = costs.actual_20m_anchor.estimated_ec2_usd;
for (const row of costs.estimates) {
  const parameters = BigInt(row.parameters);
  const tokens =
    parameters * BigInt(assumptions.training_tokens_per_parameter);
  const flops = 6n * parameters * tokens;
  assert.equal(row.training_tokens, tokens.toString());
  assert.equal(row.training_flops, flops.toString());

  const hours = Number(flops) /
    assumptions.effective_h100_flops_per_second / 3600;
  const optimized = hours * assumptions.aws_h100_hour_usd *
    assumptions.operational_multiplier;
  const current = anchorCost *
    (Number(parameters) / anchorParameters) ** 2 *
    assumptions.operational_multiplier;
  close(row.h100_hours, hours);
  close(row.optimized_budget_usd, optimized);
  close(row.current_sero_pipeline_budget_usd, current);
  assert.ok(row.current_sero_pipeline_budget_usd >= row.optimized_budget_usd);
}

for (const marker of [
  "9.56%",
  "improved compression",
  "larger Sero run is a separate paid project",
])
  assert.ok(report.includes(marker), "closure report omits " + marker);
for (const marker of ["$2.7475", "1.200848", "earn an intelligence"])
  assert.ok(resultReport.includes(marker), "20M result report omits " + marker);

console.log("Sero series closure passed");

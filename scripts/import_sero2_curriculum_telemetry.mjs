#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assert, parseNamedArgs, stableJson } from "./zero_data_lib.mjs";

const options = parseNamedArgs(process.argv, {
  bucket: "", table: "zero-training-runs", region: process.env.AWS_REGION ?? "us-east-1",
  summary: "benchmarks/sero2-curriculum-eval-v1/SUMMARY.json",
  occurred_at: "2026-08-23T03:37:15Z",
});
assert(options.bucket, "--bucket is required");
const summary = JSON.parse(fs.readFileSync(options.summary, "utf8"));
assert(summary.schema === "sero.curriculum_seed0_summary.v1", "unsupported summary schema");
const result = summary.consolidated_curriculum;
const training = summary.training;
const payload = {
  experiment: "sero2-curriculum-consolidation-v1",
  seed: 0,
  status: "completed",
  update: training.staged_updates + training.consolidation_updates,
  loss: result.test_content_bits_per_byte,
  accuracy: result.test_end_of_document_top1_accuracy,
  decision: result.decision,
  compute_usd: summary.aws.total_estimated_ec2_usd,
  metric_kind: "language-model-bits-per-byte",
  training_bytes: training.total_raw_bytes,
  training_tokens: training.total_tokens,
  epoch: training.total_raw_bytes / summary.dataset.train_utf8_bytes,
  tokens_per_parameter: training.total_tokens / training.model_parameters,
  validation_bits_per_byte: 1.4213338067947667,
  test_bits_per_byte: result.test_content_bits_per_byte,
  note: "Seed 0 passed every frozen source gate after staged curriculum and retention consolidation. Replication is open; model promotion is not.",
};
const temporary = path.join(os.tmpdir(), `sero2-curriculum-import-${process.pid}.json`);
fs.writeFileSync(temporary, stableJson(payload));
const published = spawnSync("node", ["scripts/publish_zero_telemetry.mjs",
  "--run-id", "sero2-consolidation-full-seed0-20260822-81b0d2b",
  "--sequence", "100", "--kind", "run.imported",
  "--dataset-digest", summary.dataset_digest, "--source", "aws-immutable-result",
  "--payload", temporary, "--bucket", options.bucket, "--table", options.table,
  "--region", options.region, "--occurred-at", options.occurred_at],
{ encoding: "utf8" });
fs.rmSync(temporary);
if (published.stdout) process.stdout.write(published.stdout);
if (published.stderr) process.stderr.write(published.stderr);
assert(published.status === 0, `Sero 2 telemetry import failed with status ${published.status}`);

#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assert, parseNamedArgs, stableJson } from "./zero_data_lib.mjs";

const options = parseNamedArgs(process.argv, {
  bucket: "", table: "zero-training-runs", region: process.env.AWS_REGION ?? "us-east-1",
  result: "benchmarks/zero4-q34-semantic-head-v1/results/result.json",
  occurred_at: "2026-08-13T02:22:17.951Z",
});
assert(options.bucket, "--bucket is required");
const result = JSON.parse(fs.readFileSync(options.result, "utf8"));
const final = result.measurements.at(-1);
const payload = {
  experiment: "zero4-q34-semantic-head-v1", seed: 2, status: "completed",
  update: final.update, loss: final.holdout_cross_entropy,
  accuracy: final.holdout_accuracy, decision: result.scientific_decision,
  compute_usd: 0.15, note: "Historical import; this run predates immutable dataset binding.",
  per_class_accuracy: final.per_class_accuracy,
};
const temporary = path.join(os.tmpdir(), `zero-q34-import-${process.pid}.json`);
fs.writeFileSync(temporary, stableJson(payload));
const published = spawnSync("node", ["scripts/publish_zero_telemetry.mjs",
  "--run-id", "zero4-q34-seed2", "--sequence", "100", "--kind", "run.imported",
  "--dataset-digest", "unknown", "--source", "historical-import", "--payload", temporary,
  "--bucket", options.bucket, "--table", options.table, "--region", options.region,
  "--occurred-at", options.occurred_at],
{ encoding: "utf8" });
fs.rmSync(temporary);
if (published.stdout) process.stdout.write(published.stdout);
if (published.stderr) process.stderr.write(published.stderr);
assert(published.status === 0, `Q3.4 import failed with status ${published.status}`);

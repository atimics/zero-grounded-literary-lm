#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assert, parseNamedArgs, stableJson } from "./zero_data_lib.mjs";

const dryRun = process.argv.includes("--dry-run");
const argv = process.argv.filter((argument) => argument !== "--dry-run");
const options = parseNamedArgs(argv, {
  bucket: "", table: "zero-training-runs",
  region: process.env.AWS_REGION ?? "us-east-1",
  result: "benchmarks/sero2-curriculum-consolidation-replication-v1/result.json",
});
assert(options.bucket, "--bucket is required");
const aggregate = JSON.parse(fs.readFileSync(options.result, "utf8"));
assert(aggregate.schema === "sero.curriculum_consolidation_replication_aggregate.v1",
  "unsupported replication result schema");

for (const record of aggregate.seeds.filter(({ seed }) => seed > 0)) {
  for (const [role, run] of [["staged-parent", record.staged], ["final", record.final]]) {
    const isFinal = role === "final";
    const payload = {
      experiment: isFinal ? "sero2-curriculum-consolidation-replication-v1" :
        "sero2-curriculum-replication-v1",
      seed: record.seed,
      status: "completed",
      update: run.completed_updates,
      loss: run.test_content_bits_per_byte,
      accuracy: isFinal ? run.test_end_of_document_top1_accuracy : null,
      decision: run.decision,
      compute_usd: run.estimated_ec2_usd,
      metric_kind: "language-model-bits-per-byte",
      test_bits_per_byte: run.test_content_bits_per_byte,
      all_final_gates_passed: isFinal ? run.all_gates_passed : false,
      role,
      result_sha256: run.result_sha256,
      model_sha256: run.model_sha256,
      note: isFinal ?
        "Replication seed passed every frozen final gate after retention consolidation." :
        "Staged parent reproduced the expected retention failure and was continued into consolidation.",
    };
    const temporary = path.join(
      os.tmpdir(), `sero2-curriculum-replication-import-${process.pid}.json`,
    );
    fs.writeFileSync(temporary, stableJson(payload));
    const args = ["scripts/publish_zero_telemetry.mjs",
      "--run-id", run.run_id, "--sequence", "100", "--kind", "run.imported",
      "--dataset-digest", aggregate.dataset_digest,
      "--source", "aws-immutable-result", "--payload", temporary,
      "--bucket", options.bucket, "--table", options.table,
      "--region", options.region, "--occurred-at", run.finished_at];
    if (dryRun) args.push("--dry-run");
    const published = spawnSync("node", args, { encoding: "utf8" });
    fs.rmSync(temporary);
    if (published.stdout) process.stdout.write(published.stdout);
    if (published.stderr) process.stderr.write(published.stderr);
    assert(published.status === 0,
      `Sero replication telemetry import failed for ${run.run_id}`);
  }
}

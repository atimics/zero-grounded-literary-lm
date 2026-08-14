#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assert, parseNamedArgs, sha256, stableJson,
} from "./zero_data_lib.mjs";

function aws(args, allowFailure = false) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0)
    throw new Error(`aws ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function scalar(name, value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return [name, { N: String(value) }];
  if (typeof value === "boolean") return [name, { BOOL: value }];
  return [name, { S: String(value) }];
}

function getExisting(table, runId, region) {
  const result = aws(["dynamodb", "get-item", "--region", region,
    "--table-name", table, "--key", JSON.stringify({ run_id: { S: runId } }),
    "--output", "json", "--no-cli-pager"]);
  return result.stdout.trim() ? JSON.parse(result.stdout).Item ?? {} : {};
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const argv = process.argv.filter((argument) => argument !== "--dry-run");
  const options = parseNamedArgs(argv, {
    run_id: "", sequence: "", kind: "", dataset_digest: "unknown", source: "training",
    payload: "", occurred_at: "", bucket: "", table: "zero-training-runs",
    region: process.env.AWS_REGION ?? "us-east-1",
  });
  assert(options.run_id && options.sequence !== "" && options.kind && options.payload &&
    options.occurred_at, "--run-id, --sequence, --kind, --payload, and --occurred-at are required");
  assert(options.bucket, "--bucket is required");
  const payload = JSON.parse(fs.readFileSync(options.payload, "utf8"));
  const occurredAt = options.occurred_at;
  assert(!Number.isNaN(Date.parse(occurredAt)), "occurred-at must be an ISO-8601 timestamp");
  const eventBody = { schema: "zero.training_telemetry.v1", run_id: options.run_id,
    sequence: Number(options.sequence), occurred_at: occurredAt, kind: options.kind,
    dataset_digest: options.dataset_digest, source: options.source, payload };
  assert(Number.isSafeInteger(eventBody.sequence) && eventBody.sequence >= 0,
    "sequence must be a non-negative integer");
  assert(["run.started", "phase.started", "metric", "checkpoint", "run.completed",
    "run.failed", "run.imported"].includes(eventBody.kind), "unsupported event kind");
  assert(options.dataset_digest === "unknown" || /^[0-9a-f]{64}$/.test(options.dataset_digest),
    "invalid dataset digest");
  const event = { ...eventBody, event_id: sha256(stableJson(eventBody, 0)) };
  const key = `telemetry/runs/${options.run_id}/${String(event.sequence).padStart(12, "0")}-${event.event_id}.json`;
  if (dryRun) {
    console.log(stableJson(event).trimEnd());
    console.log(`would publish s3://${options.bucket}/${key}`);
    return;
  }
  const eventFile = path.join(os.tmpdir(), `zero-telemetry-${process.pid}.json`);
  fs.writeFileSync(eventFile, stableJson(event));
  const put = aws(["s3api", "put-object", "--region", options.region,
    "--bucket", options.bucket, "--key", key, "--body", eventFile,
    "--content-type", "application/json", "--metadata", `sha256=${sha256(fs.readFileSync(eventFile))}`,
    "--if-none-match", "*"], true);
  if (put.status !== 0 && !/PreconditionFailed|412/.test(put.stderr + put.stdout)) {
    fs.rmSync(eventFile); throw new Error(`telemetry archive failed: ${put.stderr || put.stdout}`);
  }
  fs.rmSync(eventFile);

  const previous = getExisting(options.table, options.run_id, options.region);
  const previousPayload = previous.payload_json?.S ? JSON.parse(previous.payload_json.S) : {};
  const snapshot = { ...previousPayload, ...payload };
  const status = payload.status ?? (event.kind === "run.failed" ? "failed" :
    event.kind === "run.completed" ? "completed" : event.kind === "run.imported" ? "imported" : "running");
  const pairs = [
    scalar("run_id", options.run_id), scalar("latest_sequence", event.sequence),
    scalar("latest_kind", event.kind), scalar("occurred_at", occurredAt),
    scalar("status", status), scalar("dataset_digest", options.dataset_digest),
    scalar("source", options.source), scalar("event_key", key),
    scalar("experiment", snapshot.experiment), scalar("seed", snapshot.seed),
    scalar("update", snapshot.update ?? snapshot.step), scalar("loss", snapshot.loss),
    scalar("accuracy", snapshot.accuracy), scalar("decision", snapshot.decision),
    scalar("compute_usd", snapshot.compute_usd), scalar("payload_json", JSON.stringify(snapshot)),
  ].filter(Boolean);
  const item = Object.fromEntries(pairs);
  const itemFile = path.join(os.tmpdir(), `zero-run-snapshot-${process.pid}.json`);
  fs.writeFileSync(itemFile, stableJson(item));
  const indexed = aws(["dynamodb", "put-item", "--region", options.region,
    "--table-name", options.table, "--item", `file://${itemFile}`,
    "--condition-expression", "attribute_not_exists(run_id) OR latest_sequence < :sequence",
    "--expression-attribute-values", JSON.stringify({ ":sequence": { N: String(event.sequence) } })], true);
  fs.rmSync(itemFile);
  if (indexed.status !== 0 && !/ConditionalCheckFailedException/.test(indexed.stderr + indexed.stdout))
    throw new Error(`telemetry index failed: ${indexed.stderr || indexed.stdout}`);
  console.log(`published ${event.kind} ${event.run_id}#${event.sequence}`);
}

main();

#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assert, parseNamedArgs, sha256, sha256File, stableJson,
} from "./zero_data_lib.mjs";

function aws(args, allowFailure = false) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0)
    throw new Error(`aws ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function contentType(file) {
  if (file.endsWith(".json") || file === "READY") return "application/json";
  if (file.endsWith(".jsonl")) return "application/x-ndjson";
  if (file.endsWith(".txt") || file.endsWith(".bpe")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function putImmutable(bucket, key, file, digest, region, dryRun) {
  if (dryRun) { console.log(`would upload s3://${bucket}/${key}`); return; }
  const existing = aws(["s3api", "head-object", "--region", region,
    "--bucket", bucket, "--key", key], true);
  if (existing.status === 0) {
    const metadata = JSON.parse(existing.stdout).Metadata ?? {};
    if (metadata.sha256) {
      assert(metadata.sha256 === digest, `immutable key collision at s3://${bucket}/${key}`);
      return;
    }
    const downloaded = path.join(os.tmpdir(), `zero-existing-${process.pid}-${sha256(key)}.bin`);
    const get = aws(["s3api", "get-object", "--region", region,
      "--bucket", bucket, "--key", key, downloaded], true);
    assert(get.status === 0, `could not verify existing s3://${bucket}/${key}`);
    const existingDigest = sha256File(downloaded);
    fs.rmSync(downloaded);
    assert(existingDigest === digest, `immutable key collision at s3://${bucket}/${key}`);
    return;
  }
  const result = aws(["s3api", "put-object", "--region", region,
    "--bucket", bucket, "--key", key, "--body", file,
    "--content-type", contentType(file), "--metadata", `sha256=${digest}`,
    "--checksum-algorithm", "SHA256", "--if-none-match", "*"], true);
  if (result.status !== 0) {
    const raced = aws(["s3api", "head-object", "--region", region,
      "--bucket", bucket, "--key", key], true);
    if (raced.status !== 0 || (JSON.parse(raced.stdout).Metadata ?? {}).sha256 !== digest)
      throw new Error(`could not seal s3://${bucket}/${key}: ${result.stderr || result.stdout}`);
  }
}

function verifyBuild(root) {
  const manifestPath = path.join(root, "manifest.json");
  const readyPath = path.join(root, "READY");
  assert(fs.existsSync(manifestPath) && fs.existsSync(readyPath), "build is not sealed");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  assert(manifest.schema === "zero.dataset_manifest.v1", "unsupported manifest schema");
  const { dataset_digest: observed, ...body } = manifest;
  assert(sha256(stableJson(body, 0)) === observed, "dataset digest does not verify");
  assert(ready.dataset_digest === observed, "READY digest does not match manifest");
  assert(ready.manifest_sha256 === sha256File(manifestPath), "READY manifest binding drifted");
  for (const item of manifest.artifacts) {
    const file = path.join(root, item.path);
    assert(fs.existsSync(file), `missing artifact ${item.path}`);
    assert(fs.statSync(file).size === item.bytes, `${item.path} size drifted`);
    assert(sha256File(file) === item.sha256, `${item.path} digest drifted`);
  }
  return { manifest, ready };
}

function readJsonIfPresent(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function catalogItem(manifest, root, bucket, prefix, approvalId, trainTokensOverride,
  promotedAt = "") {
  const documents = Object.values(manifest.splits).reduce((sum, split) => sum + split.documents, 0);
  const splitSources = Object.values(manifest.splits)
    .flatMap((split) => split.sources ?? []);
  const sourceCount = Array.isArray(manifest.sources)
    ? manifest.sources.length
    : new Set(splitSources.map((source) => source.source_id).filter(Boolean)).size;
  const manifestTrainTokens = (manifest.splits.train.sources ?? [])
    .reduce((sum, source) => sum + Number(source.tokens ?? 0), 0);
  const trainTokens = trainTokensOverride === ""
    ? manifestTrainTokens : Number(trainTokensOverride);
  assert(Number.isSafeInteger(trainTokens) && trainTokens >= 0,
    "train-tokens must be a non-negative integer");
  const trainBytes = manifest.splits.train.utf8_bytes;
  const baseQuality = manifest.quality ?? readJsonIfPresent(
    path.join(root, "reports", "quality.json"), {});
  const deduplication = readJsonIfPresent(
    path.join(root, "reports", "deduplication.json"), {});
  const contamination = readJsonIfPresent(
    path.join(root, "reports", "contamination.json"), {});
  const discarded = Array.isArray(deduplication.discarded) ? deduplication.discarded : [];
  const matchesAfterFilter = Array.isArray(contamination.matches_after_filter)
    ? contamination.matches_after_filter : [];
  const quality = {
    ...baseQuality,
    passed: baseQuality.passed ?? matchesAfterFilter.length === 0,
    exact_duplicates_removed: baseQuality.exact_duplicates_removed ??
      discarded.filter((row) => row.kind === "exact").length,
    near_duplicates_removed: baseQuality.near_duplicates_removed ??
      discarded.filter((row) => row.kind === "near").length,
    contamination_matches: baseQuality.contamination_matches ?? matchesAfterFilter.length,
  };
  const releaseDate = manifest.release_date ?? String(manifest.created_at ?? "").slice(0, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(releaseDate),
    "manifest must contain release_date or a dated created_at");
  return {
    dataset_id: { S: manifest.dataset_id }, version: { S: manifest.version },
    dataset_digest: { S: manifest.dataset_digest }, release_date: { S: releaseDate },
    status: { S: "ready" }, bucket: { S: bucket }, prefix: { S: prefix },
    manifest_key: { S: `${prefix}/manifest.json` },
    documents: { N: String(documents) }, train_tokens: { N: String(trainTokens) },
    train_bytes: { N: String(trainBytes) },
    source_count: { N: String(sourceCount) },
    quality_json: { S: JSON.stringify(quality) },
    promoted_at: { S: promotedAt || new Date().toISOString() },
    ...(approvalId ? { approval_id: { S: approvalId } } : {}),
  };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const argv = process.argv.filter((argument) => argument !== "--dry-run");
  const options = parseNamedArgs(argv, {
    build: "build/zero-literary-v1", bucket: "", table: "zero-datasets",
    region: process.env.AWS_REGION ?? "us-east-1", approval_id: "", train_tokens: "",
  });
  assert(options.bucket, "--bucket is required");
  const root = path.resolve(options.build);
  const { manifest, ready } = verifyBuild(root);
  const prefix = `datasets/${manifest.dataset_id}/${manifest.version}/${manifest.dataset_digest}`;
  for (const item of manifest.artifacts)
    putImmutable(options.bucket, `${prefix}/${item.path}`, path.join(root, item.path),
      item.sha256, options.region, dryRun);
  for (const file of ["manifest.json", "READY"])
    putImmutable(options.bucket, `${prefix}/${file}`, path.join(root, file),
      sha256File(path.join(root, file)), options.region, dryRun);
  if (!dryRun) {
    const key = JSON.stringify({
      dataset_id: { S: manifest.dataset_id }, version: { S: manifest.version },
    });
    const existing = aws(["dynamodb", "get-item", "--region", options.region,
      "--table-name", options.table, "--key", key, "--output", "json", "--no-cli-pager"]);
    const existingItem = JSON.parse(existing.stdout).Item;
    if (existingItem) assert(existingItem.dataset_digest?.S === manifest.dataset_digest,
      `catalog version ${manifest.dataset_id}/${manifest.version} already binds another digest`);
    const temporary = path.join(os.tmpdir(), `zero-dataset-catalog-${process.pid}.json`);
    fs.writeFileSync(temporary, stableJson(catalogItem(manifest, root, options.bucket, prefix,
      options.approval_id, options.train_tokens, existingItem?.promoted_at?.S)));
    const put = aws(["dynamodb", "put-item", "--region", options.region,
      "--table-name", options.table, "--item", `file://${temporary}`,
      "--condition-expression", "attribute_not_exists(dataset_id) OR dataset_digest = :digest",
      "--expression-attribute-values", JSON.stringify({
        ":digest": { S: manifest.dataset_digest },
      })], true);
    fs.rmSync(temporary);
    assert(put.status === 0, `catalog write failed: ${put.stderr || put.stdout}`);
  }
  console.log(`${dryRun ? "verified" : "promoted"} ${manifest.dataset_id}/${manifest.version}`);
  console.log(`s3://${options.bucket}/${prefix}/READY`);
  console.log(`dataset digest ${ready.dataset_digest}`);
}

main();

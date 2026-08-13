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
    assert(metadata.sha256 === digest, `immutable key collision at s3://${bucket}/${key}`);
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

function catalogItem(manifest, bucket, prefix, approvalId) {
  const documents = Object.values(manifest.splits).reduce((sum, split) => sum + split.documents, 0);
  const trainTokens = manifest.splits.train.sources.reduce((sum, source) => sum + source.tokens, 0);
  return {
    dataset_id: { S: manifest.dataset_id }, version: { S: manifest.version },
    dataset_digest: { S: manifest.dataset_digest }, release_date: { S: manifest.release_date },
    status: { S: "ready" }, bucket: { S: bucket }, prefix: { S: prefix },
    manifest_key: { S: `${prefix}/manifest.json` },
    documents: { N: String(documents) }, train_tokens: { N: String(trainTokens) },
    source_count: { N: String(manifest.sources.length) },
    quality_json: { S: JSON.stringify(manifest.quality) },
    promoted_at: { S: new Date().toISOString() },
    ...(approvalId ? { approval_id: { S: approvalId } } : {}),
  };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const argv = process.argv.filter((argument) => argument !== "--dry-run");
  const options = parseNamedArgs(argv, {
    build: "build/zero-literary-v1", bucket: "", table: "zero-datasets",
    region: process.env.AWS_REGION ?? "us-east-1", approval_id: "",
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
    const temporary = path.join(os.tmpdir(), `zero-dataset-catalog-${process.pid}.json`);
    fs.writeFileSync(temporary, stableJson(catalogItem(manifest, options.bucket, prefix,
      options.approval_id)));
    const put = aws(["dynamodb", "put-item", "--region", options.region,
      "--table-name", options.table, "--item", `file://${temporary}`,
      "--condition-expression", "attribute_not_exists(dataset_id)"], true);
    fs.rmSync(temporary);
    if (put.status !== 0) {
      const existing = aws(["dynamodb", "get-item", "--region", options.region,
        "--table-name", options.table, "--key",
        JSON.stringify({ dataset_id: { S: manifest.dataset_id }, version: { S: manifest.version } })]);
      const item = JSON.parse(existing.stdout).Item;
      assert(item?.dataset_digest?.S === manifest.dataset_digest,
        `catalog version ${manifest.dataset_id}/${manifest.version} already binds another digest`);
    }
  }
  console.log(`${dryRun ? "verified" : "promoted"} ${manifest.dataset_id}/${manifest.version}`);
  console.log(`s3://${options.bucket}/${prefix}/READY`);
  console.log(`dataset digest ${ready.dataset_digest}`);
}

main();

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parseNamedArgs, sha256, stableJson } from "./zero_data_lib.mjs";

function sha256FileStreaming(file) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => digest.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(digest.digest("hex")));
  });
}

async function verifyDocuments(root, relative, expected) {
  const ids = new Set();
  const content = new Set();
  const sources = new Map();
  let documents = 0; let bytes = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(path.join(root, relative)),
    crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const row = JSON.parse(line);
    assert(!ids.has(row.id), `duplicate document id ${row.id}`); ids.add(row.id);
    assert(!content.has(row.sha256), `duplicate document content ${row.sha256}`); content.add(row.sha256);
    const encoded = Buffer.from(row.text, "utf8");
    assert.equal(encoded.length, row.bytes, `byte drift in ${row.id}`);
    assert.equal(sha256(encoded), row.sha256, `digest drift in ${row.id}`);
    const current = sources.get(row.source_id) ?? { documents: 0, bytes: 0 };
    ++current.documents; current.bytes += row.bytes; sources.set(row.source_id, current);
    ++documents; bytes += row.bytes;
  }
  assert.equal(documents, expected.documents, `${relative} document count drifted`);
  assert.equal(bytes, expected.utf8_bytes, `${relative} byte count drifted`);
  for (const source of expected.sources) {
    const observed = sources.get(source.source_id);
    assert(observed, `${relative} has no ${source.source_id}`);
    assert.equal(observed.documents, source.documents);
    assert.equal(observed.bytes, source.utf8_bytes);
  }
  return { ids, content };
}

async function main() {
  const options = parseNamedArgs(process.argv, { build: "build/sero-pretrain-v1" });
  const root = path.resolve(options.build);
  const manifestPath = path.join(root, "manifest.json");
  const readyPath = path.join(root, "READY");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  assert.equal(manifest.schema, "zero.dataset_manifest.v1");
  assert.equal(manifest.dataset_id, "sero-pretrain");
  const { dataset_digest: digest, ...body } = manifest;
  assert.equal(sha256(stableJson(body, 0)), digest, "dataset seal failed");
  assert.equal(ready.dataset_digest, digest);
  assert.equal(ready.manifest_sha256, await sha256FileStreaming(manifestPath));
  for (const artifact of manifest.artifacts) {
    const file = path.join(root, artifact.path);
    assert.equal(fs.statSync(file).size, artifact.bytes, `${artifact.path} byte count drifted`);
    assert.equal(await sha256FileStreaming(file), artifact.sha256,
      `${artifact.path} digest drifted`);
  }
  assert(manifest.splits.train.utf8_bytes > 100_000_000,
    "training split does not exceed 100M unique bytes");
  assert.equal(manifest.sources.length, 3, "source count drifted");
  assert.equal(manifest.quality.contamination_matches, 0);
  assert.equal(manifest.quality.passed, true);
  const trainSizes = manifest.splits.train.sources.map((source) => source.utf8_bytes);
  assert.equal(trainSizes.length, 3, "every source must reach the training split");
  assert(Math.max(...trainSizes) / Math.min(...trainSizes) <= 1.15,
    "retained training bytes are not source-balanced within 15%");
  for (const source of manifest.sources) {
    assert(source.license && source.license_url, `${source.id} lacks a bound license`);
    assert(source.attribution?.records > 0, `${source.id} lacks per-page attribution`);
    assert(manifest.artifacts.some((item) => item.path === source.attribution.artifact),
      `${source.id} attribution is not sealed`);
  }
  const seenIds = new Set(); const seenContent = new Set();
  for (const split of ["train", "validation", "test"]) {
    const verified = await verifyDocuments(root, `documents/${split}.jsonl`, manifest.splits[split]);
    for (const id of verified.ids) { assert(!seenIds.has(id), `cross-split id ${id}`); seenIds.add(id); }
    for (const digestValue of verified.content) {
      assert(!seenContent.has(digestValue), `cross-split content ${digestValue}`);
      seenContent.add(digestValue);
    }
  }
  console.log(`Sero corpus passed: ${manifest.splits.train.utf8_bytes} unique training bytes`);
  console.log(`dataset digest ${digest}`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

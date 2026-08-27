#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hamming, segmentText, simhash, SimHashIndex } from "./build_zero_corpus.mjs";
import { sha256, sha256File, stableJson } from "./zero_data_lib.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} failed with status ${result.status}`);
}

for (const file of ["schemas/corpus-sources.schema.json", "schemas/dataset-manifest.schema.json",
  "schemas/training-telemetry.schema.json", "corpus/registry/zero-literary-v1.json",
  "docs/dashboard/config.json"])
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")), `${file} must be JSON`);

const registry = JSON.parse(fs.readFileSync("corpus/registry/zero-literary-v1.json", "utf8"));
assert.equal(registry.schema, "zero.corpus_sources.v1");
assert.equal(registry.splits.train_permyriad + registry.splits.validation_permyriad +
  registry.splits.test_permyriad, 10000);
for (const binding of [registry.tokenizer, ...registry.sources, ...registry.contamination_panels])
  assert.equal(sha256File(binding.path), binding.sha256, `${binding.path} drifted`);

const chunks = segmentText("one two three.\n\nfour five six.\n\nseven eight nine.\n",
  { minimum_utf8_bytes: 1, target_utf8_bytes: 20, maximum_utf8_bytes: 32 });
assert(chunks.length >= 2);
assert.equal(hamming(simhash("alpha beta gamma delta epsilon", 2),
  simhash("alpha beta gamma delta epsilon", 2)), 0);
const simhashIndex = new SimHashIndex(3);
const firstFingerprint = 0x0123456789abcdefn;
simhashIndex.add(firstFingerprint);
assert.equal(simhashIndex.find(firstFingerprint ^ 0b111n), 0);
assert.equal(simhashIndex.find(firstFingerprint ^ 0b1111n), -1);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-data-check-"));
const first = path.join(temporary, "first");
const second = path.join(temporary, "second");
try {
  run("node", ["scripts/build_zero_corpus.mjs", "--out", first]);
  run("node", ["scripts/build_zero_corpus.mjs", "--out", second]);
  assert.equal(fs.readFileSync(path.join(first, "manifest.json"), "utf8"),
    fs.readFileSync(path.join(second, "manifest.json"), "utf8"),
    "two builds must produce byte-identical manifests");
  const manifest = JSON.parse(fs.readFileSync(path.join(first, "manifest.json"), "utf8"));
  const { dataset_digest: digest, ...body } = manifest;
  assert.equal(sha256(stableJson(body, 0)), digest);
  assert.equal(digest, "9ac3fcfd15e9e4cea44c0b8504799c9de33672fb0561d620bc1959b27b6ec736",
    "promoted zero-literary digest drifted");
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert(Object.values(manifest.splits).every((split) => split.documents > 0));
  assert(manifest.sources.find((source) => source.id === "shakespeare").retained_documents > 400);
  assert.equal(manifest.quality.passed, true);
  assert.equal(manifest.quality.contamination_matches, 0);
  run("node", ["scripts/promote_zero_dataset.mjs", "--build", first,
    "--bucket", "dry-run", "--dry-run"]);
  const payload = path.join(temporary, "payload.json");
  fs.writeFileSync(payload, "{\"experiment\":\"self-test\",\"accuracy\":0.5}\n");
  run("node", ["scripts/publish_zero_telemetry.mjs", "--run-id", "self-test",
    "--sequence", "0", "--kind", "run.started", "--payload", payload,
    "--occurred-at", "2026-08-12T00:00:00Z", "--bucket", "dry-run", "--dry-run"]);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

for (const script of ["scripts/build_zero_corpus.mjs", "scripts/promote_zero_dataset.mjs",
  "scripts/publish_zero_telemetry.mjs", "scripts/materialize_zero_dataset.mjs",
  "scripts/import_q34_telemetry.mjs", "scripts/import_sero2_curriculum_telemetry.mjs",
  "docs/dashboard/dashboard.js"])
  run("node", ["--check", script]);

const template = fs.readFileSync("infra/zero-data-plane.yaml", "utf8");
for (const required of ["AWS::S3::Bucket", "AWS::DynamoDB::Table", "AWS::Lambda::Function",
  "AWS::ApiGatewayV2::Api", "DeletionPolicy: Retain", "PAY_PER_REQUEST"])
  assert(template.includes(required), `infrastructure template omits ${required}`);
console.log("ZERO data pipeline contract passed");

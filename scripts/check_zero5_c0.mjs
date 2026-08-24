#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function run(program, args, expected = 0) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

function readTokens(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length % 2, 0);
  const tokens = [];
  for (let offset = 0; offset < bytes.length; offset += 2)
    tokens.push(bytes.readUInt16LE(offset));
  return tokens;
}

function loadVocabulary(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString("binary"), "SEROTOK\u0000");
  assert.equal(bytes.readUInt32LE(8), 1);
  assert.equal(bytes.readUInt32LE(12), 264);
  const count = bytes.readUInt32LE(16);
  assert.equal(bytes.length, 24 + count * 4);
  const merges = [];
  for (let index = 0; index < count; ++index) {
    merges.push([
      bytes.readUInt16LE(24 + index * 4),
      bytes.readUInt16LE(26 + index * 4),
    ]);
  }
  return merges;
}

function decodeDocuments(tokenFile, vocabularyFile) {
  const merges = loadVocabulary(vocabularyFile);
  const documents = [];
  let current = [];
  function expand(token) {
    if (token === 256) {
      documents.push(Buffer.from(current));
      current = [];
    } else if (token >= 257 && token <= 263) {
      current.push(token - 256);
    } else if (token <= 255 && !(token >= 1 && token <= 7)) {
      current.push(token);
    } else if (token >= 264 && token < 264 + merges.length) {
      const pair = merges[token - 264];
      expand(pair[0]);
      expand(pair[1]);
    } else {
      assert.fail("invalid token " + token);
    }
  }
  for (const token of readTokens(tokenFile)) expand(token);
  assert.equal(current.length, 0, "stream did not end at a document token");
  return documents;
}

const contract = JSON.parse(
  fs.readFileSync("benchmarks/zero5-c0-v1/contract.json", "utf8"),
);
assert.equal(contract.schema, "zero.corpus_tokenizer_experiment.v1");
assert.equal(contract.status, "complete-selected-byte-bpe512");
assert.equal(contract.implementation_boundary.model_and_training, "C11");
assert.equal(contract.implementation_boundary.python, false);
assert.equal(contract.arms[0].model.parameters, 4852992);
assert.equal(contract.arms[1].model.parameters, 4854016);
assert.equal(contract.arms[2].model.parameters, 4852992);
assert.equal(contract.training_authority.full_model_training_authorized, false);

const mechanics = JSON.parse(
  fs.readFileSync("benchmarks/zero5-c0-v1/status.json", "utf8"),
);
assert.equal(mechanics.schema, "zero.c0_mechanics_status.v1");
assert.equal(mechanics.status, "pass");
assert.equal(mechanics.real_braid_release_evaluated, true);
assert.equal(mechanics.gates.deterministic_real_rerun, true);
assert.equal(mechanics.full_model_training_authorized, false);
for (const [file, expected] of Object.entries(mechanics.source_sha256))
  assert.equal(sha256(fs.readFileSync(file)), expected, file + " drifted");
const frozenResultBytes = fs.readFileSync(mechanics.result.path);
assert.equal(sha256(frozenResultBytes), mechanics.result.sha256);
const frozenResult = JSON.parse(frozenResultBytes);
assert.equal(frozenResult.schema, "zero.c0_tokenizer_result.v2");
assert.equal(frozenResult.status, "complete");
assert.equal(frozenResult.braid.collection_id,
  "braid-corpus-one-v0.1.0-296620cd725547ec5a49a22f28d2816892d5d6c4893518cd48fd83df04804516");
assert.equal(frozenResult.braid.source_commit, "90c78b9");
assert.equal(frozenResult.braid.train.documents, 797);
assert.equal(frozenResult.braid.validation.documents, 101);
assert.equal(frozenResult.braid.test.documents, 101);
assert.equal(frozenResult.braid.test.tokenizer_metrics_opened, false);
assert.equal(frozenResult.tokenizer_training.observed.vocab_size, 512);
assert.equal(frozenResult.tokenizer_training.observed.merge_count, 248);
assert.equal(frozenResult.arms["byte-bpe512"].validation_content_tokens, 9790);
assert.equal(frozenResult.arms.byte264.validation_content_tokens, 22807);
assert.equal(frozenResult.arms["byte-bpe512"].model_parameters, 4852992);
assert.equal(frozenResult.decision.candidate_for_zero5_training,
  "byte-bpe512");
assert.equal(frozenResult.decision.full_model_training_authorized, false);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-c0-"));
try {
  const release = path.join(temporary, "release");
  const dataDirectory = path.join(release, "data");
  const output = path.join(temporary, "output");
  fs.mkdirSync(dataDirectory, { recursive: true });
  const common =
    "The small C model reads exact bytes, preserves document boundaries, " +
    "and tests every claim against a frozen corpus release. Its tokenizer " +
    "learns frequent byte pairs without changing spelling, punctuation, or " +
    "Unicode. A verifier checks the manifest, byte count, record count, and " +
    "cryptographic digest before any training input is accepted. Governed " +
    "train, validation, and test files keep their declared roles. Every learned token expands back to its " +
    "original bytes, including newlines and literal control values. Quoted field " +
    "names such as \"text\" and \"contentHash\" remain ordinary data. This longer " +
    "repeated passage gives the fixture enough structure to exercise the full " +
    "frozen merge budget rather than testing only a tiny vocabulary. ";
  const documents = [];
  for (let index = 0; index < 240; ++index) {
    const text =
      "Record " + index + ". " + common.repeat(4) +
      (index % 3 === 0 ? "Unicode: Καλημέρα 世界 🜁.\n" : "") +
      (index === 7 ? "Control:\u0001 remains data.\n" : "");
    const contentHash = sha256(Buffer.from(text, "utf8"));
    const split = index < 180 ? "train" : index < 210 ? "validation" : "test";
    documents.push({ text, contentHash, split });
  }
  function rowsFor(split) {
    return documents
      .map((document, index) => ({ document, index }))
      .filter(item => item.document.split === split)
      .map(({ document, index }) => JSON.stringify({
        id: "document-" + index,
        text: document.text,
        language: "en",
        domain: index % 2 ? "technical" : "reasoning",
        split,
        metadata: {},
        provenance: {
          sourceId: "fixture-" + split,
          sourceKind: "inline",
          locator: "fixture",
          sourceDocumentId: String(index),
          license: "CC0-1.0",
        },
        contentHash: document.contentHash,
        quality: {
          characters: document.text.length,
          bytes: Buffer.byteLength(document.text),
          approximateTokens: Math.ceil(document.text.length / 4),
          alphabeticRatio: 0.8,
          printableRatio: 0.99,
          urlRatio: 0,
          repeatedLineRatio: 0,
          score: 0.9,
        },
        selectionRank: index,
      })).join("\n") + "\n";
  }
  const splitRows = Object.fromEntries(
    ["train", "validation", "test"].map(split => [split, rowsFor(split)]),
  );
  for (const [split, rows] of Object.entries(splitRows))
    fs.writeFileSync(path.join(dataDirectory, split + ".jsonl"), rows);
  const dataFile = path.join(dataDirectory, "train.jsonl");
  const manifest = {
    schemaVersion: "braid.release/v2",
    releaseId: "zero5-c0-fixture",
    dataset: {
      name: "zero5-c0-fixture",
      version: "v2",
      description: "C0 contract fixture for governed JSONL splits",
      purposes: ["pretraining"],
    },
    status: "RELEASED",
    createdAt: "2026-08-23T00:00:00Z",
    compiler: { name: "braid", version: "0.3.0", node: process.version },
    digests: {
      specification: sha256("specification"),
      membership: sha256(documents.map(item => item.contentHash).join("\n")),
      release: sha256("zero5-c0-fixture-release"),
    },
    counts: {
      passed: true,
      gates: [],
      candidateDocuments: documents.length,
      eligibleDocuments: documents.length,
      selectedDocuments: documents.length,
      rejectedDocuments: 0,
      rejectionRatio: 0,
      approximateTokens: 1,
      domainCounts: { technical: 120, reasoning: 120 },
      splitCounts: { train: 180, validation: 30, test: 30 },
      rejectionReasons: {},
    },
    sources: [],
    generation: {
      enabled: false,
      requests: 0,
      documents: 0,
      exhausted: false,
    },
    artifacts: ["test", "train", "validation"].map(split => ({
      path: "data/" + split + ".jsonl",
      sha256: sha256(splitRows[split]),
      bytes: Buffer.byteLength(splitRows[split]),
      records: documents.filter(document => document.split === split).length,
    })),
    publication: {
      target: "none",
      state: "not-requested",
      requiresApproval: false,
    },
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  fs.writeFileSync(path.join(release, "release.json"), manifestText);

  const execution = run("node", [
    "scripts/run_zero5_c0.mjs",
    "--release", release,
    "--out", output,
    "--collection-id", "zero5-c0-fixture-collection",
    "--braid-commit", "0000000",
    "--maximum-tokenizer-training-tokens", "120000",
  ]);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.schema, "zero.c0_tokenizer_result.v2");
  assert.equal(result.braid.release_id, manifest.releaseId);
  assert.equal(result.braid.release_digest, manifest.digests.release);
  assert.equal(result.braid.release_manifest_sha256, sha256(manifestText));
  assert.equal(result.braid.collection_id, "zero5-c0-fixture-collection");
  assert.equal(result.braid.source_commit, "0000000");
  assert.equal(result.braid.split_authority, "braid");
  assert.equal(result.braid.train.artifact_sha256, sha256(splitRows.train));
  assert.equal(result.braid.validation.artifact_sha256,
    sha256(splitRows.validation));
  assert.equal(result.braid.test.artifact_sha256, sha256(splitRows.test));
  assert.equal(result.braid.train.documents, 180);
  assert.equal(result.braid.validation.documents, 30);
  assert.equal(result.braid.test.documents, 30);
  assert.equal(result.braid.test.tokenizer_metrics_opened, false);
  assert.equal(result.artifacts.byte_bpe512_vocabulary.sha256,
    sha256(fs.readFileSync(path.join(output, "byte-bpe512.sero"))));
  assert.equal(result.arms.byte264.model_parameters, 4854016);
  assert.equal(
    result.arms["ascii128-control"].validation_tokens,
    fs.statSync(path.join(output, "validation.ascii128.tok")).size / 2,
  );
  assert.equal(result.arms["byte-bpe512"].model_parameters, 4852992);
  assert.equal(result.arms["byte-bpe512"].vocabulary_size, 512);
  assert.ok(
    result.arms["byte-bpe512"].validation_content_tokens <
    result.arms.byte264.validation_content_tokens,
  );
  assert.equal(
    result.decision.candidate_for_zero5_training,
    "byte-bpe512",
  );
  assert.equal(result.decision.full_model_training_authorized, false);

  const expectedTrain = documents
    .filter(document => document.split === "train")
    .map(document => Buffer.from(document.text, "utf8"));
  const expectedValidation = documents
    .filter(document => document.split === "validation")
    .map(document => Buffer.from(document.text, "utf8"));
  const byteVocabulary = path.join(output, "byte264.sero");
  const bpeVocabulary = path.join(output, "byte-bpe512.sero");
  assert.deepEqual(
    decodeDocuments(path.join(output, "braid.train.base.tok"), byteVocabulary),
    expectedTrain,
  );
  assert.deepEqual(
    decodeDocuments(
      path.join(output, "validation.byte-bpe512.tok"),
      bpeVocabulary,
    ),
    expectedValidation,
  );
  for (const token of readTokens(path.join(output, "train.byte-bpe512.tok")))
    assert.ok(!(token >= 1 && token <= 7));

  const byteSmoke = run("./zero5_lm", [
    "--context", "8", "--dim", "8", "--heads", "2",
    "--layers", "1", "--ff", "16", "--vocab", "264",
    "--tokenizer", byteVocabulary,
    "--text", path.join(output, "braid.train.base.tok"),
    "--validation-text", path.join(output, "braid.validation.base.tok"),
    "--steps", "1", "--batch", "1", "--report", "1",
    "--validation", "1", "--dropout", "0", "--tokens", "0",
  ]);
  assert.match(byteSmoke.stdout, new RegExp(
    "train=" + readTokens(path.join(output, "braid.train.base.tok")).length +
    " validation=" +
    readTokens(path.join(output, "braid.validation.base.tok")).length,
  ));
  const bpeSmoke = run("./zero5_lm", [
    "--context", "8", "--dim", "8", "--heads", "2",
    "--layers", "1", "--ff", "16", "--vocab", "512",
    "--tokenizer", bpeVocabulary,
    "--text", path.join(output, "train.byte-bpe512.tok"),
    "--validation-text", path.join(output, "validation.byte-bpe512.tok"),
    "--steps", "1", "--batch", "1", "--report", "1",
    "--validation", "1", "--dropout", "0", "--tokens", "0",
  ]);
  assert.match(bpeSmoke.stdout, new RegExp(
    "train=" + readTokens(path.join(output, "train.byte-bpe512.tok")).length +
    " validation=" +
    readTokens(path.join(output, "validation.byte-bpe512.tok")).length,
  ));

  const alteredRows = fs.readFileSync(dataFile, "utf8")
    .replace("technical", "technicol");
  fs.writeFileSync(dataFile, alteredRows);
  const rejected = run("./zero5_braid", [
    "--release", release,
    "--out-prefix", path.join(temporary, "mutated"),
  ], 1);
  assert.match(rejected.stderr, /does not match release.json/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("ZERO.5-C0 Braid and tokenizer mechanics passed");

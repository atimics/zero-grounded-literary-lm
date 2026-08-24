#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write("error: " + message + "\n");
  process.exit(1);
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail("missing value for " + name);
  return process.argv[index + 1];
}

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    fail(program + " failed: " + (result.stderr || result.stdout).trim());
  return result.stdout.trim();
}

function runJson(program, args) {
  const output = run(program, args);
  try {
    return JSON.parse(output.split("\n").at(-1));
  } catch {
    fail(program + " did not return JSON: " + output);
  }
}

function tokenCount(file, width) {
  const bytes = fs.statSync(file).size;
  if (bytes % width !== 0) fail(file + " has an invalid token width");
  return bytes / width;
}

function fileArtifact(file) {
  const bytes = fs.readFileSync(file);
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function parameters(vocabulary, feedForward) {
  const dimension = 256;
  const layers = 6;
  return vocabulary * dimension +
    layers * (4 * dimension * dimension +
      2 * dimension * feedForward + 2 * dimension) +
    dimension;
}

const release = option("--release");
const out = path.resolve(option("--out", "build/zero5-c0-v1"));
const collectionId = option("--collection-id", null);
const braidCommit = option("--braid-commit", null);
const maximumTrainingTokens =
  Number(option("--maximum-tokenizer-training-tokens", "8000000"));
if (!release) fail("--release is required");
if (!collectionId) fail("--collection-id is required");
if (!braidCommit || !/^[0-9a-f]{7,40}$/.test(braidCommit))
  fail("--braid-commit must be a 7-40 character hexadecimal commit id");
if (!Number.isInteger(maximumTrainingTokens) || maximumTrainingTokens < 1)
  fail("--maximum-tokenizer-training-tokens must be positive");
fs.mkdirSync(out, { recursive: true });

const prefix = path.join(out, "braid");
const imported = runJson("./zero5_braid", [
  "--release", path.resolve(release),
  "--out-prefix", prefix,
]);
const trainBase = prefix + ".train.base.tok";
const validationBase = prefix + ".validation.base.tok";
const trainRaw = prefix + ".train.raw";
const validationRaw = prefix + ".validation.raw";
const byteVocabulary = path.join(out, "byte264.sero");
const bpeVocabulary = path.join(out, "byte-bpe512.sero");
const trainBpe = path.join(out, "train.byte-bpe512.tok");
const validationBpe = path.join(out, "validation.byte-bpe512.tok");
const asciiVocabulary = path.join(out, "ascii128.bpe");
const trainAscii = path.join(out, "train.ascii128.tok");
const validationAscii = path.join(out, "validation.ascii128.tok");

run("./sero_tokenizer", ["init", "--vocab", byteVocabulary]);
const byteInspect =
  runJson("./sero_tokenizer", ["inspect", "--vocab", byteVocabulary]);
const bpeTraining = runJson("./sero_tokenizer", [
  "train",
  "--tokens", trainBase,
  "--vocab", bpeVocabulary,
  "--vocab-size", "512",
  "--maximum-tokens", String(maximumTrainingTokens),
]);
const bpeInspect =
  runJson("./sero_tokenizer", ["inspect", "--vocab", bpeVocabulary]);
if (bpeInspect.vocab_size !== 512)
  fail("the training sample did not support all 248 frozen BPE merges");
runJson("./sero_tokenizer", [
  "recode", "--vocab", bpeVocabulary,
  "--tokens", trainBase, "--out", trainBpe,
]);
runJson("./sero_tokenizer", [
  "recode", "--vocab", bpeVocabulary,
  "--tokens", validationBase, "--out", validationBpe,
]);
run("./bpe_tokenizer", [
  "--vocab", asciiVocabulary,
  "--text", trainRaw, "--out", trainAscii,
  "--text", validationRaw, "--out", validationAscii,
]);

const result = {
  schema: "zero.c0_tokenizer_result.v2",
  experiment: "zero5-c0-v1",
  status: "complete",
  braid: {
    ...imported,
    collection_id: collectionId,
    source_commit: braidCommit,
  },
  tokenizer_training: {
    maximum_training_tokens: maximumTrainingTokens,
    observed: bpeTraining,
  },
  artifacts: {
    byte264_vocabulary: fileArtifact(byteVocabulary),
    byte_bpe512_vocabulary: fileArtifact(bpeVocabulary),
    byte_bpe512_train_tokens: fileArtifact(trainBpe),
    byte_bpe512_validation_tokens: fileArtifact(validationBpe),
  },
  arms: {
    "ascii128-control": {
      lossless: false,
      explicit_document_boundary: false,
      vocabulary_size: 128,
      train_tokens: tokenCount(trainAscii, 2),
      validation_tokens: tokenCount(validationAscii, 2),
      validation_raw_bytes: imported.validation.raw_bytes,
      validation_tokens_per_raw_byte:
        tokenCount(validationAscii, 2) / imported.validation.raw_bytes,
      model_parameters: parameters(128, 1056),
    },
    byte264: {
      lossless: true,
      explicit_document_boundary: true,
      vocabulary_size: byteInspect.vocab_size,
      train_tokens: tokenCount(trainBase, 2),
      validation_tokens: tokenCount(validationBase, 2),
      validation_content_tokens:
        tokenCount(validationBase, 2) - imported.validation.documents,
      validation_raw_bytes: imported.validation.raw_bytes,
      validation_content_tokens_per_raw_byte:
        (tokenCount(validationBase, 2) - imported.validation.documents) /
        imported.validation.raw_bytes,
      model_parameters: parameters(264, 1045),
    },
    "byte-bpe512": {
      lossless: true,
      explicit_document_boundary: true,
      vocabulary_size: bpeInspect.vocab_size,
      train_tokens: tokenCount(trainBpe, 2),
      validation_tokens: tokenCount(validationBpe, 2),
      validation_content_tokens:
        tokenCount(validationBpe, 2) - imported.validation.documents,
      validation_raw_bytes: imported.validation.raw_bytes,
      validation_content_tokens_per_raw_byte:
        (tokenCount(validationBpe, 2) - imported.validation.documents) /
        imported.validation.raw_bytes,
      model_parameters: parameters(512, 1024),
    },
  },
  decision: {
    candidate_for_zero5_training:
      tokenCount(validationBpe, 2) < tokenCount(validationBase, 2)
        ? "byte-bpe512"
        : "byte264",
    full_model_training_authorized: false,
  },
};
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify(result, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(result) + "\n");

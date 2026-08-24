#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write("error: " + message + "\n");
  process.exit(1);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail("missing value for " + name);
  return process.argv[index + 1];
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function run(program, args, cwd = process.cwd()) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    fail(program + " failed: " + (result.stderr || result.stdout).trim());
  return result.stdout.trim();
}

function runJson(program, args, cwd) {
  const output = run(program, args, cwd);
  try {
    return JSON.parse(output.split("\n").at(-1));
  } catch {
    fail(program + " did not return JSON: " + output);
  }
}

function requireHash(file, expected, label) {
  const observed = artifact(file);
  if (observed.sha256 !== expected)
    fail(label + " hash mismatch: " + file);
  return observed;
}

function countTokens(file) {
  const bytes = fs.statSync(file).size;
  if (bytes % 2 !== 0) fail("unaligned token stream: " + file);
  return bytes / 2;
}

const collectionDirectory = path.resolve(option("--collection"));
const expectedCollectionId = option("--collection-id");
const braidRoot = path.resolve(option("--braid-root"));
const braidCommit = option("--braid-commit");
const c0Directory = path.resolve(
  option("--c0-dir", "build/zero5-c0-v1/corpus-one"),
);
const out = path.resolve(option("--out", "build/zero5-c2-v1/import"));
if (!expectedCollectionId || !braidCommit)
  fail("--collection-id and --braid-commit are required");
if (fs.existsSync(out)) fail("output directory already exists: " + out);

const c0Path = "benchmarks/zero5-c0-v1/result.json";
const c0Bytes = fs.readFileSync(c0Path);
const c0 = JSON.parse(c0Bytes);
const collectionPath = path.join(collectionDirectory, "collection.json");
const collectionBytes = fs.readFileSync(collectionPath);
const collection = JSON.parse(collectionBytes);
if (collection.schemaVersion !== "braid.collection/v2" ||
    collection.status !== "RELEASED" ||
    collection.collectionId !== expectedCollectionId)
  fail("collection identity or status does not match");
if (collection.digests.collection !== expectedCollectionId.split("-").at(-1))
  fail("collection digest does not match its id");
for (const item of collection.artifacts)
  requireHash(path.join(collectionDirectory, item.path), item.sha256,
    "collection artifact");

const official = run("node", [
  "dist/cli.js", "collection", "verify", collectionDirectory,
  "--expected", expectedCollectionId,
], braidRoot);
if (!official.includes("VALID: " + expectedCollectionId))
  fail("official Braid collection verification did not pass");

const recipePath = path.join(collectionDirectory, "training-recipe.json");
const recipe = JSON.parse(fs.readFileSync(recipePath));
if (recipe.mode !== "sequential" || recipe.stages.length !== 2 ||
    recipe.stages[0].member !== "anchors" ||
    JSON.stringify(recipe.stages[0].splits) !== '["train"]' ||
    recipe.stages[1].member !== "atlas" ||
    JSON.stringify(recipe.stages[1].splits) !== '["train"]')
  fail("Corpus 2 training recipe is not the frozen anchors-then-atlas order");

const members = Object.fromEntries(collection.members.map(member =>
  [member.id, member],
));
for (const id of ["anchors", "atlas"]) {
  const member = members[id];
  if (!member || !member.required || member.status !== "RELEASED")
    fail("required collection member is missing or unreleased: " + id);
}
const anchorDirectory = path.join(collectionDirectory, members.anchors.path);
const atlasDirectory = path.join(collectionDirectory, members.atlas.path);
const anchorRelease = JSON.parse(
  fs.readFileSync(path.join(anchorDirectory, "release.json")),
);
const atlasRelease = JSON.parse(
  fs.readFileSync(path.join(atlasDirectory, "release.json")),
);
if (!anchorRelease.sources.every(source => source.license === "CC0-1.0"))
  fail("anchor member is not uniformly CC0-1.0");
if (!atlasRelease.sources.every(source =>
  source.license === "CC-BY-SA-4.0"))
  fail("Atlas member is not uniformly CC-BY-SA-4.0");

fs.mkdirSync(out, { recursive: true });
const anchors = runJson("./zero5_braid", [
  "--release", anchorDirectory,
  "--out-prefix", path.join(out, "anchors"),
]);
const atlas = runJson("./zero5_braid", [
  "--release", atlasDirectory,
  "--out-prefix", path.join(out, "atlas"),
]);
if (anchors.train.artifact_sha256 !== c0.braid.train.artifact_sha256 ||
    anchors.validation.artifact_sha256 !==
      c0.braid.validation.artifact_sha256 ||
    anchors.test.artifact_sha256 !== c0.braid.test.artifact_sha256)
  fail("Corpus 2 anchors are not byte-identical to the C1 governed splits");

const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
requireHash(tokenizer, c0.artifacts.byte_bpe512_vocabulary.sha256,
  "frozen C1 tokenizer");
const atlasTrainTokens = path.join(out, "atlas.train.byte-bpe512.tok");
const atlasValidationTokens =
  path.join(out, "atlas.validation.byte-bpe512.tok");
const trainRecode = runJson("./sero_tokenizer", [
  "recode", "--vocab", tokenizer,
  "--tokens", path.join(out, "atlas.train.base.tok"),
  "--out", atlasTrainTokens,
]);
const validationRecode = runJson("./sero_tokenizer", [
  "recode", "--vocab", tokenizer,
  "--tokens", path.join(out, "atlas.validation.base.tok"),
  "--out", atlasValidationTokens,
]);

const result = {
  schema: "zero.c2_import.v1",
  collection: {
    id: expectedCollectionId,
    braid_commit: braidCommit,
    collection_json: artifact(collectionPath),
    training_recipe: artifact(recipePath),
    official_verification: true,
  },
  stages: [
    { order: 1, member: "anchors", split: "train" },
    { order: 2, member: "atlas", split: "train" },
  ],
  rights: {
    anchors: "CC0-1.0",
    atlas: "CC-BY-SA-4.0",
    public_dataset_published: false,
    model_publication_requires_review: true,
  },
  members: { anchors, atlas },
  tokenizer: {
    id: "byte-bpe512",
    artifact: artifact(tokenizer),
    retrained: false,
  },
  derived: {
    atlas_train_tokens: {
      ...artifact(atlasTrainTokens),
      tokens: countTokens(atlasTrainTokens),
      recode: trainRecode,
    },
    atlas_validation_tokens: {
      ...artifact(atlasValidationTokens),
      tokens: countTokens(atlasValidationTokens),
      recode: validationRecode,
    },
  },
  test: {
    anchors_records: anchors.test.documents,
    atlas_records: atlas.test.documents,
    tokenizer_metrics_opened: false,
  },
};
fs.writeFileSync(path.join(out, "import.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

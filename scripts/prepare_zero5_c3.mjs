#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const DOCUMENT_TOKEN = 256;
const BASE_TOKENS = 264;
const RETRIEVAL_PREFIX_CODE_POINTS = 210;
const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]);

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

function requireHash(file, expected, label) {
  const observed = artifact(file);
  if (observed.sha256 !== expected)
    fail(label + " hash mismatch: " + file);
  return observed;
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

function countTokens(file) {
  const bytes = fs.statSync(file).size;
  if (bytes % 2 !== 0) fail("unaligned token stream: " + file);
  return bytes / 2;
}

function quantile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function tokenStreamStats(file, context) {
  const bytes = fs.readFileSync(file);
  if (bytes.length % 2 !== 0) fail("unaligned token stream: " + file);
  const lengths = [];
  let current = 0;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const token = bytes.readUInt16LE(offset);
    if (token === DOCUMENT_TOKEN) {
      if (current === 0) fail("empty record in token stream: " + file);
      lengths.push(current);
      current = 0;
    } else {
      current++;
    }
  }
  if (current !== 0) fail("token stream lacks a final document boundary");
  lengths.sort((a, b) => a - b);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  return {
    records: lengths.length,
    content_tokens: total,
    boundary_tokens: lengths.length,
    stream_tokens: total + lengths.length,
    minimum: lengths[0],
    p50: quantile(lengths, 0.5),
    p90: quantile(lengths, 0.9),
    p95: quantile(lengths, 0.95),
    p99: quantile(lengths, 0.99),
    maximum: lengths.at(-1),
    mean: total / lengths.length,
    over_context: lengths.filter(value => value > context).length,
    over_context_fraction:
      lengths.filter(value => value > context).length / lengths.length,
  };
}

function loadTokenByteLengths(tokenizerPath) {
  const bytes = fs.readFileSync(tokenizerPath);
  if (bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from("SEROTOK\0")))
    fail("unsupported tokenizer magic");
  const version = bytes.readUInt32LE(8);
  const baseTokens = bytes.readUInt32LE(12);
  const mergeCount = bytes.readUInt32LE(16);
  const flags = bytes.readUInt32LE(20);
  if (version !== 1 || baseTokens !== BASE_TOKENS || flags !== 1 ||
      bytes.length !== 24 + mergeCount * 4)
    fail("unsupported tokenizer contract");
  const lengths = Array(BASE_TOKENS + mergeCount).fill(0);
  for (let token = 0; token <= 255; token++) lengths[token] = 1;
  for (let token = 257; token <= 263; token++) lengths[token] = 1;
  for (let index = 0; index < mergeCount; index++) {
    const left = bytes.readUInt16LE(24 + index * 4);
    const right = bytes.readUInt16LE(26 + index * 4);
    const token = BASE_TOKENS + index;
    if (!lengths[left] || !lengths[right])
      fail("tokenizer merge has no lossless byte expansion");
    lengths[token] = lengths[left] + lengths[right];
  }
  return lengths;
}

function exactPrefix(text, codePoints) {
  return Array.from(text).slice(0, codePoints).join("");
}

function retrievalView(record) {
  const metadata = record.metadata;
  if (metadata.task !== "retrieval" || metadata.admission.modelGenerated)
    fail("invalid retrieval curriculum record: " + record.id);
  return [
    "Instruction: " + metadata.instruction,
    "Query: " + metadata.query,
    "Passage A exact prefix: " +
      exactPrefix(metadata.passageA, RETRIEVAL_PREFIX_CODE_POINTS),
    "Passage B exact prefix: " +
      exactPrefix(metadata.passageB, RETRIEVAL_PREFIX_CODE_POINTS),
    "Answer: " + metadata.answer,
  ].join("\n");
}

async function writeCompactBase(jsonlPath, outputPath) {
  const input = fs.createReadStream(jsonlPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const output = fs.openSync(outputPath, "wx");
  const boundary = Buffer.alloc(2);
  boundary.writeUInt16LE(DOCUMENT_TOKEN);
  let records = 0;
  let rawBytes = 0;
  try {
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      const text = retrievalView(record);
      const bytes = Buffer.from(text, "utf8");
      const encoded = Buffer.allocUnsafe(bytes.length * 2);
      for (let index = 0; index < bytes.length; index++)
        encoded.writeUInt16LE(bytes[index], index * 2);
      fs.writeSync(output, encoded);
      fs.writeSync(output, boundary);
      records++;
      rawBytes += bytes.length;
    }
  } finally {
    fs.closeSync(output);
  }
  return { records, raw_bytes: rawBytes, base_tokens: rawBytes + records };
}

function nextTokenRecord(stream, state, file) {
  const start = state.offset;
  while (state.offset < stream.length) {
    const token = stream.readUInt16LE(state.offset);
    if (token === DOCUMENT_TOKEN) {
      if (state.offset === start) fail("empty token record in " + file);
      const record = stream.subarray(start, state.offset);
      state.offset += 2;
      return record;
    }
    state.offset += 2;
  }
  fail("missing token record for JSONL input: " + file);
}

function u32Header(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
}

async function buildCompletionEval({
  jsonlPath,
  tokenPath,
  outputPath,
  expectedRecords,
  task,
  view,
  answer,
  tokenByteLengths,
  context,
  vocab,
}) {
  const stream = fs.readFileSync(tokenPath);
  const state = { offset: 0 };
  const input = fs.createReadStream(jsonlPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const output = fs.openSync(outputPath, "wx");
  fs.writeSync(output, COMPLETION_MAGIC);
  fs.writeSync(output, u32Header([1, vocab, context, expectedRecords]));
  const lengths = [];
  let records = 0;
  let targetTokens = 0;
  try {
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (record.metadata.task !== task ||
          record.metadata.admission.modelGenerated)
        fail("invalid " + task + " curriculum record: " + record.id);
      const text = view(record);
      const target = answer(record);
      if (!text.endsWith(target))
        fail(task + " answer is not the final completion: " + record.id);
      const tokens = nextTokenRecord(stream, state, tokenPath);
      const tokenCount = tokens.length / 2;
      if (tokenCount > context)
        fail(task + " record exceeds model context: " + record.id);
      let decodedBytes = 0;
      for (let index = 0; index < tokenCount; index++) {
        const token = tokens.readUInt16LE(index * 2);
        if (token >= tokenByteLengths.length || !tokenByteLengths[token])
          fail("invalid lossless token in " + task + " record");
        decodedBytes += tokenByteLengths[token];
      }
      if (decodedBytes !== Buffer.byteLength(text, "utf8"))
        fail("token bytes do not match " + task + " view: " + record.id);
      const answerBytes = Buffer.byteLength(target, "utf8");
      let covered = 0;
      let targetStart = tokenCount;
      while (targetStart > 0 && covered < answerBytes) {
        targetStart--;
        covered += tokenByteLengths[tokens.readUInt16LE(targetStart * 2)];
      }
      if (targetStart === 0 || covered < answerBytes)
        fail("could not locate " + task + " answer tokens: " + record.id);
      const targetCount = tokenCount - targetStart;
      fs.writeSync(output,
        u32Header([tokenCount, targetStart, targetCount, 0]));
      fs.writeSync(output, tokens);
      lengths.push(tokenCount);
      targetTokens += targetCount;
      records++;
    }
  } finally {
    fs.closeSync(output);
  }
  if (records !== expectedRecords || state.offset !== stream.length)
    fail(task + " evaluation record count does not match its release");
  lengths.sort((a, b) => a - b);
  return {
    ...artifact(outputPath),
    records,
    target_tokens: targetTokens,
    sequence_tokens: {
      minimum: lengths[0],
      p50: quantile(lengths, 0.5),
      p90: quantile(lengths, 0.9),
      p99: quantile(lengths, 0.99),
      maximum: lengths.at(-1),
    },
  };
}

function combineTokenStreams(files, output) {
  const parts = files.map(file => fs.readFileSync(file));
  fs.writeFileSync(output, Buffer.concat(parts));
  return artifact(output);
}

function memberData(collectionDirectory, member, split) {
  return path.join(collectionDirectory, member.path, "data", split + ".jsonl");
}

const collectionDirectory = path.resolve(option("--collection"));
const expectedCollectionId = option("--collection-id");
const braidRoot = path.resolve(option("--braid-root"));
const braidCommit = option("--braid-commit");
const activeC2Directory = path.resolve(option("--active-c2-collection"));
const c0Directory = path.resolve(
  option("--c0-dir", "build/zero5-c0-v1/corpus-one"),
);
const out = path.resolve(option("--out", "build/zero5-c3-v1/import"));
const context = 512;
if (!expectedCollectionId || !braidCommit)
  fail("--collection-id and --braid-commit are required");
if (fs.existsSync(out)) fail("output directory already exists: " + out);

const c0Path = "benchmarks/zero5-c0-v1/result.json";
const c0 = JSON.parse(fs.readFileSync(c0Path));
const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
requireHash(tokenizer, c0.artifacts.byte_bpe512_vocabulary.sha256,
  "frozen byte-BPE512 tokenizer");
const tokenByteLengths = loadTokenByteLengths(tokenizer);
const collectionPath = path.join(collectionDirectory, "collection.json");
const collectionBytes = fs.readFileSync(collectionPath);
const collection = JSON.parse(collectionBytes);
if (collection.schemaVersion !== "braid.collection/v2" ||
    collection.status !== "RELEASED" ||
    collection.collectionId !== expectedCollectionId ||
    collection.digests.collection !== expectedCollectionId.split("-").at(-1))
  fail("Corpus 3 collection identity or status does not match");
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
if (recipe.mode !== "sequential" || recipe.stages.length !== 3 ||
    recipe.stages.map(stage => stage.member).join(",") !==
      "claims,cloze,retrieval" ||
    recipe.stages.some(stage => JSON.stringify(stage.splits) !== '["train"]'))
  fail("Corpus 3 recipe is not claims, cloze, retrieval in order");
const members = Object.fromEntries(collection.members.map(member =>
  [member.id, member],
));
for (const id of ["claims", "cloze", "retrieval"]) {
  const member = members[id];
  if (!member || !member.required || member.status !== "RELEASED")
    fail("required Corpus 3 member is missing or unreleased: " + id);
  const release = JSON.parse(fs.readFileSync(
    path.join(collectionDirectory, member.path, "release.json"),
  ));
  if (!release.sources.every(source => source.license === "CC-BY-SA-4.0"))
    fail("Corpus 3 member is not uniformly CC-BY-SA-4.0: " + id);
}

const activeC2 = JSON.parse(fs.readFileSync(
  path.join(activeC2Directory, "collection.json"),
));
const currentC2Directory = path.resolve(
  braidRoot,
  "datasets/corpus-two/.braid/collections/braid-corpus-two/v0.1.0/" +
    "braid-corpus-two-v0.1.0-d3fb8df48d2ad66b78dee76ec7b26e262554d8b4de12b18f781533ec19eb45b5",
);
const currentC2 = JSON.parse(fs.readFileSync(
  path.join(currentC2Directory, "collection.json"),
));
const lineageBridge = { active_collection_id: activeC2.collectionId,
  c3_upstream_collection_id: currentC2.collectionId, splits: {} };
for (const memberId of ["anchors", "atlas"]) {
  const oldMember = activeC2.members.find(member => member.id === memberId);
  const newMember = currentC2.members.find(member => member.id === memberId);
  lineageBridge.splits[memberId] = {};
  for (const split of ["train", "validation", "test"]) {
    const oldPath = memberData(activeC2Directory, oldMember, split);
    const newPath = memberData(currentC2Directory, newMember, split);
    const oldArtifact = artifact(oldPath);
    const newArtifact = artifact(newPath);
    if (oldArtifact.sha256 !== newArtifact.sha256 ||
        oldArtifact.bytes !== newArtifact.bytes)
      fail("C2 lineage bridge changed " + memberId + " " + split);
    lineageBridge.splits[memberId][split] = oldArtifact;
  }
}

fs.mkdirSync(out, { recursive: true });
const importedMembers = {};
for (const id of ["claims", "cloze", "retrieval"]) {
  importedMembers[id] = runJson("./zero5_braid", [
    "--release", path.join(collectionDirectory, members[id].path),
    "--out-prefix", path.join(out, id),
  ]);
}

const tokenPaths = {};
const recodes = {};
for (const id of ["claims", "cloze", "retrieval"]) {
  tokenPaths[id] = {};
  recodes[id] = {};
  for (const split of ["train", "validation"]) {
    const destination = path.join(out,
      id + "." + split + ".byte-bpe512.tok");
    tokenPaths[id][split] = destination;
    recodes[id][split] = runJson("./sero_tokenizer", [
      "recode", "--vocab", tokenizer,
      "--tokens", path.join(out, id + "." + split + ".base.tok"),
      "--out", destination,
    ]);
  }
}

const retrievalCompact = {};
for (const split of ["train", "validation"]) {
  const basePath = path.join(out, "retrieval.compact." + split + ".base.tok");
  const tokenPath = path.join(out,
    "retrieval.compact." + split + ".byte-bpe512.tok");
  const base = await writeCompactBase(
    memberData(collectionDirectory, members.retrieval, split), basePath,
  );
  const recode = runJson("./sero_tokenizer", [
    "recode", "--vocab", tokenizer,
    "--tokens", basePath, "--out", tokenPath,
  ]);
  const stats = tokenStreamStats(tokenPath, context);
  if (stats.records !== importedMembers.retrieval[split].documents ||
      stats.over_context !== 0 || stats.maximum > context)
    fail("compacted retrieval view does not fit the fixed model context");
  retrievalCompact[split] = {
    base,
    base_artifact: artifact(basePath),
    tokens: { ...artifact(tokenPath), tokens: countTokens(tokenPath) },
    recode,
    record_lengths: stats,
  };
  tokenPaths.retrieval[split] = tokenPath;
}

const originalLengthAudit = {};
for (const id of ["claims", "cloze", "retrieval"]) {
  originalLengthAudit[id] = {};
  for (const split of ["train", "validation"]) {
    const originalPath = path.join(out,
      id + "." + split + ".byte-bpe512.tok");
    originalLengthAudit[id][split] = tokenStreamStats(originalPath, context);
  }
}

const combinedTrain = path.join(out, "c3.train.byte-bpe512.tok");
const combinedValidation = path.join(out,
  "c3.validation.byte-bpe512.tok");
combineTokenStreams([
  tokenPaths.claims.train,
  tokenPaths.cloze.train,
  tokenPaths.retrieval.train,
], combinedTrain);
combineTokenStreams([
  tokenPaths.claims.validation,
  tokenPaths.cloze.validation,
  tokenPaths.retrieval.validation,
], combinedValidation);

const completion = {};
for (const id of ["claims", "cloze", "retrieval"]) {
  const outputPath = path.join(out, id + ".validation.completion-eval.bin");
  completion[id] = await buildCompletionEval({
    jsonlPath: memberData(collectionDirectory, members[id], "validation"),
    tokenPath: tokenPaths[id].validation,
    outputPath,
    expectedRecords: importedMembers[id].validation.documents,
    task: id === "claims" ? "claim" : id,
    view: id === "retrieval" ? retrievalView : record => record.text,
    answer: id === "claims"
      ? record => record.metadata.claim
      : id === "cloze"
        ? record => record.metadata.answer
        : record => record.metadata.answer,
    tokenByteLengths,
    context,
    vocab: tokenByteLengths.length,
  });
}

const result = {
  schema: "zero.c3_import.v1",
  collection: {
    id: expectedCollectionId,
    braid_commit: braidCommit,
    collection_json: artifact(collectionPath),
    training_recipe: artifact(recipePath),
    official_verification: true,
  },
  lineage_bridge: lineageBridge,
  stages: [
    { order: 1, member: "claims", split: "train", view: "official text" },
    { order: 2, member: "cloze", split: "train", view: "official text" },
    { order: 3, member: "retrieval", split: "train",
      view: "query, balanced 210-code-point exact passage prefixes, answer" },
  ],
  rights: {
    claims: "CC-BY-SA-4.0",
    cloze: "CC-BY-SA-4.0",
    retrieval: "CC-BY-SA-4.0",
    public_dataset_published: false,
    model_publication_requires_review: true,
  },
  members: importedMembers,
  tokenizer: {
    id: "byte-bpe512",
    artifact: artifact(tokenizer),
    retrained: false,
  },
  context_audit: {
    model_context: context,
    original: originalLengthAudit,
    retrieval_compaction: {
      passage_prefix_code_points_each: RETRIEVAL_PREFIX_CODE_POINTS,
      preserves: ["instruction", "query", "equal exact prefix from passage A",
        "equal exact prefix from passage B", "answer"],
      train: retrievalCompact.train,
      validation: retrievalCompact.validation,
      test_view_created: false,
    },
  },
  derived: {
    train_tokens: {
      ...artifact(combinedTrain), tokens: countTokens(combinedTrain),
      order: ["claims", "cloze", "retrieval-compact"],
    },
    validation_tokens: {
      ...artifact(combinedValidation), tokens: countTokens(combinedValidation),
      order: ["claims", "cloze", "retrieval-compact"],
    },
    completion_validation: completion,
  },
  test: {
    claims_records: importedMembers.claims.test.documents,
    cloze_records: importedMembers.cloze.test.documents,
    retrieval_records: importedMembers.retrieval.test.documents,
    compact_view_created: false,
    tokenizer_metrics_opened: false,
  },
};
fs.writeFileSync(path.join(out, "import.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

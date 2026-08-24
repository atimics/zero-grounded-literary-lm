#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const DOCUMENT_TOKEN = 256;
const CONTEXT = 512;
const VOCAB = 512;
const BATCH = 4;
const TASKS = ["claim", "cloze", "retrieval"];
const PACK_MAGIC = Buffer.from([90, 53, 80, 75, 86, 49, 0, 0]);
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

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(label + " is missing: " + file);
  const observed = artifact(file);
  if (observed.sha256 !== expected.sha256 ||
      (expected.bytes !== undefined && observed.bytes !== expected.bytes)) {
    fail(label + " does not match the released view: " + file);
  }
  return observed;
}

function run(program, args, cwd = process.cwd()) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(program + " failed: " + (result.stderr || result.stdout).trim());
  }
  return result.stdout.trim();
}

function u32(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
}

function u64(values) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeBigUInt64LE(BigInt(value), index * 8));
  return bytes;
}

function tokenIdsHash(tokens) {
  const bytes = Buffer.alloc(tokens.length * 4);
  for (let index = 0; index < tokens.length; index++) {
    bytes.writeUInt32LE(tokens[index], index * 4);
  }
  return sha256(bytes);
}

function tokenByteLengths(tokenizerPath) {
  const bytes = fs.readFileSync(tokenizerPath);
  if (bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from("SEROTOK\0"))) {
    fail("unsupported tokenizer artifact");
  }
  const version = bytes.readUInt32LE(8);
  const base = bytes.readUInt32LE(12);
  const merges = bytes.readUInt32LE(16);
  const flags = bytes.readUInt32LE(20);
  if (version !== 1 || base !== 264 || flags !== 1 ||
      bytes.length !== 24 + merges * 4 || base + merges !== VOCAB) {
    fail("tokenizer does not match ZERO.5 byte-BPE512");
  }
  const lengths = Array(VOCAB).fill(0);
  for (let token = 0; token <= 255; token++) lengths[token] = 1;
  for (let token = 257; token <= 263; token++) lengths[token] = 1;
  for (let index = 0; index < merges; index++) {
    const left = bytes.readUInt16LE(24 + index * 4);
    const right = bytes.readUInt16LE(26 + index * 4);
    if (!lengths[left] || !lengths[right]) fail("tokenizer merge refers forward");
    lengths[base + index] = lengths[left] + lengths[right];
  }
  return lengths;
}

class BufferedBaseWriter {
  constructor(file) {
    this.file = fs.openSync(file, "wx");
    this.parts = [];
    this.bytes = 0;
  }

  appendText(text) {
    const input = Buffer.from(text, "utf8");
    const output = Buffer.allocUnsafe(input.length * 2 + 2);
    for (let index = 0; index < input.length; index++) {
      const byte = input[index];
      output.writeUInt16LE(byte >= 1 && byte <= 7 ? 256 + byte : byte,
        index * 2);
    }
    output.writeUInt16LE(DOCUMENT_TOKEN, input.length * 2);
    this.parts.push(output);
    this.bytes += output.length;
    if (this.bytes >= 8 * 1024 * 1024) this.flush();
  }

  flush() {
    if (this.parts.length === 0) return;
    fs.writeSync(this.file, Buffer.concat(this.parts));
    this.parts = [];
    this.bytes = 0;
  }

  close() {
    this.flush();
    fs.closeSync(this.file);
  }
}

function answerBytes(record) {
  if (record.task === "claim") {
    const marker = "Supported claim: ";
    const start = record.text.lastIndexOf(marker);
    if (start < 0) fail("claim view lacks its supported-claim marker");
    return Buffer.byteLength(record.text.slice(start + marker.length), "utf8");
  }
  const marker = "\nAnswer: ";
  const start = record.text.lastIndexOf(marker);
  if (start < 0) fail(record.task + " view lacks its answer marker");
  return Buffer.byteLength(record.text.slice(start + marker.length), "utf8");
}

async function loadRows(jsonl, basePath, expectedRecords) {
  const writer = new BufferedBaseWriter(basePath);
  const rows = [];
  const input = fs.createReadStream(jsonl, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (!TASKS.includes(record.task) || record.split === "test" ||
          record.view?.schemaVersion !== "braid.training-record-view/v1" ||
          record.view.maximumContextTokens !== CONTEXT ||
          record.view.tokenizerSha256 !== TOKENIZER_SHA ||
          typeof record.text !== "string" || record.text.length === 0) {
        fail("invalid admitted training-view row: " + (record.id ?? "unknown"));
      }
      const targetBytes = answerBytes(record);
      rows.push({
        id: record.id,
        semanticId: record.semanticId,
        task: record.task,
        expectedTokens: record.view.tokenCount,
        expectedTokenHash: record.view.tokenIdsSha256,
        targetBytes,
        releasedAnswerSpan: record.view.answerTokenSpan ?? null,
      });
      writer.appendText(record.text);
    }
  } finally {
    writer.close();
  }
  if (rows.length !== expectedRecords) {
    fail("view row count changed for " + jsonl);
  }
  return rows;
}

function bindTokens(rows, tokenPath, byteLengths) {
  const stream = fs.readFileSync(tokenPath);
  if (stream.length % 2 !== 0) fail("unaligned recoded token stream");
  let offset = 0;
  let answerTokens = 0;
  for (const row of rows) {
    const start = offset;
    while (offset < stream.length && stream.readUInt16LE(offset) !== DOCUMENT_TOKEN) {
      offset += 2;
    }
    if (offset >= stream.length) fail("recoded stream lacks a record boundary");
    const tokenBytes = stream.subarray(start, offset);
    offset += 2;
    const tokens = new Uint16Array(tokenBytes.length / 2);
    for (let index = 0; index < tokens.length; index++) {
      tokens[index] = tokenBytes.readUInt16LE(index * 2);
    }
    if (tokens.length !== row.expectedTokens ||
        tokenIdsHash(tokens) !== row.expectedTokenHash ||
        tokens.length > CONTEXT - 1) {
      fail("tokenized row changed: " + row.id);
    }
    let covered = 0;
    let targetStart = tokens.length;
    while (targetStart > 0 && covered < row.targetBytes) {
      targetStart--;
      covered += byteLengths[tokens[targetStart]] ?? 0;
    }
    if (targetStart === 0 || covered < row.targetBytes) {
      fail("could not locate answer suffix: " + row.id);
    }
    row.tokens = tokens;
    row.targetStart = targetStart;
    row.targetEnd = tokens.length;
    if (row.releasedAnswerSpan &&
        (row.releasedAnswerSpan.start !== targetStart ||
         row.releasedAnswerSpan.end !== tokens.length)) {
      fail("derived retrieval answer span changed: " + row.id);
    }
    answerTokens += tokens.length - targetStart;
  }
  if (offset !== stream.length) fail("recoded stream has trailing records");
  return answerTokens;
}

function emptyPack(task) {
  const tokens = Buffer.alloc((CONTEXT + 1) * 2);
  for (let index = 0; index <= CONTEXT; index++) {
    tokens.writeUInt16LE(DOCUMENT_TOKEN, index * 2);
  }
  return { task, tokens, classes: Buffer.alloc(CONTEXT), records: 0,
    activeTargets: 0, answerTargets: 0 };
}

function packTask(rows, task) {
  const packs = [];
  let pack = emptyPack(task);
  let length = 1;
  function finish() {
    if (pack.records === 0) return;
    packs.push(pack);
    pack = emptyPack(task);
    length = 1;
  }
  for (const row of rows.filter(value => value.task === task)) {
    const needed = row.tokens.length + 1;
    if (length + needed > CONTEXT + 1) finish();
    const recordStart = length;
    for (let index = 0; index < row.tokens.length; index++) {
      pack.tokens.writeUInt16LE(row.tokens[index], (length + index) * 2);
    }
    length += row.tokens.length;
    pack.tokens.writeUInt16LE(DOCUMENT_TOKEN, length * 2);
    length++;
    for (let target = recordStart - 1; target < length - 1; target++) {
      pack.classes[target] = 1;
      pack.activeTargets++;
    }
    for (let token = row.targetStart; token < row.targetEnd; token++) {
      const target = recordStart + token - 1;
      if (pack.classes[target] !== 1) fail("answer target left its record");
      pack.classes[target] = 2;
      pack.answerTargets++;
    }
    pack.records++;
  }
  finish();
  return packs;
}

function smoothInterleave(groups) {
  const totals = Object.fromEntries(TASKS.map(task => [task, groups[task].length]));
  const used = Object.fromEntries(TASKS.map(task => [task, 0]));
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const output = [];
  for (let position = 0; position < total; position++) {
    let selected = null;
    let selectedDeficit = -Infinity;
    for (const task of TASKS) {
      if (used[task] >= totals[task]) continue;
      const deficit = (position + 1) * totals[task] / total - used[task];
      if (deficit > selectedDeficit) {
        selected = task;
        selectedDeficit = deficit;
      }
    }
    if (selected === null) fail("interleave scheduler exhausted early");
    output.push(groups[selected][used[selected]++]);
  }
  for (const task of TASKS) assert.equal(used[task], totals[task]);
  return output;
}

function padTraining(packs) {
  const output = [...packs];
  while (output.length % BATCH !== 0) output.push(emptyPack("padding"));
  return output;
}

function packStats(packs) {
  const real = packs.filter(pack => pack.records !== 0);
  let runs = 0;
  let previous = null;
  let maximumRun = 0;
  let currentRun = 0;
  for (const pack of real) {
    if (pack.task !== previous) {
      runs++;
      previous = pack.task;
      currentRun = 1;
    } else {
      currentRun++;
    }
    maximumRun = Math.max(maximumRun, currentRun);
  }
  return {
    packs: packs.length,
    real_packs: real.length,
    padding_packs: packs.length - real.length,
    records: real.reduce((sum, pack) => sum + pack.records, 0),
    active_targets: real.reduce((sum, pack) => sum + pack.activeTargets, 0),
    answer_targets: real.reduce((sum, pack) => sum + pack.answerTargets, 0),
    compute_token_exposures: packs.length * CONTEXT,
    padding_targets: packs.length * CONTEXT -
      real.reduce((sum, pack) => sum + pack.activeTargets, 0),
    task_packs: Object.fromEntries(TASKS.map(task =>
      [task, real.filter(pack => pack.task === task).length])),
    task_runs: runs,
    maximum_same_task_pack_run: maximumRun,
  };
}

function writePack(file, packs) {
  const stats = packStats(packs);
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeSync(descriptor, PACK_MAGIC);
    fs.writeSync(descriptor, u32([1, VOCAB, CONTEXT, packs.length]));
    fs.writeSync(descriptor, u64([
      stats.records, stats.active_targets, stats.answer_targets,
    ]));
    for (const pack of packs) fs.writeSync(descriptor, pack.tokens);
    for (const pack of packs) fs.writeSync(descriptor, pack.classes);
  } finally {
    fs.closeSync(descriptor);
  }
  return { ...artifact(file), ...stats };
}

function writeCompletion(file, rows) {
  const descriptor = fs.openSync(file, "wx");
  let targetTokens = 0;
  try {
    fs.writeSync(descriptor, COMPLETION_MAGIC);
    fs.writeSync(descriptor, u32([1, VOCAB, CONTEXT, rows.length]));
    for (const row of rows) {
      const targetCount = row.targetEnd - row.targetStart;
      fs.writeSync(descriptor, u32([
        row.tokens.length, row.targetStart, targetCount, 0,
      ]));
      const bytes = Buffer.alloc(row.tokens.length * 2);
      for (let index = 0; index < row.tokens.length; index++) {
        bytes.writeUInt16LE(row.tokens[index], index * 2);
      }
      fs.writeSync(descriptor, bytes);
      targetTokens += targetCount;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { ...artifact(file), records: rows.length, target_tokens: targetTokens };
}

async function prepareSplit({ view, split, out, tokenizer, expectedRecords,
  byteLengths }) {
  const jsonl = path.join(view, "data", split + ".jsonl");
  const base = path.join(out, split + ".base.tok");
  const recoded = path.join(out, split + ".byte-bpe512.tok");
  const rows = await loadRows(jsonl, base, expectedRecords);
  run("./sero_tokenizer", [
    "recode", "--vocab", tokenizer, "--tokens", base, "--out", recoded,
  ]);
  const answers = bindTokens(rows, recoded, byteLengths);
  fs.unlinkSync(base);
  fs.unlinkSync(recoded);
  const groups = Object.fromEntries(TASKS.map(task =>
    [task, packTask(rows, task)]));
  return { rows, groups, answerTokens: answers };
}

const view = path.resolve(option("--view"));
const expectedViewId = option("--view-id");
const braidRoot = path.resolve(option("--braid-root"));
const braidCommit = option("--braid-commit");
const c0Directory = path.resolve(option("--c0-dir",
  "build/zero5-c0-v1/corpus-one"));
const out = path.resolve(option("--out", "build/zero5-c31-v1/import"));
if (!expectedViewId || !braidCommit) {
  fail("--view-id and --braid-commit are required");
}
if (fs.existsSync(out)) fail("output directory already exists: " + out);
if (run("git", ["rev-parse", "HEAD"], braidRoot) !== braidCommit) {
  fail("Braid checkout does not match the required commit");
}

const manifestPath = path.join(view, "view.json");
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
if (manifest.schemaVersion !== "braid.training-view/v1" ||
    manifest.status !== "RELEASED" || manifest.viewId !== expectedViewId ||
    manifest.context.maximumTokens !== CONTEXT ||
    manifest.context.reservedTokens !== 1 ||
    manifest.context.packing !== "preserve-record" ||
    manifest.tokenizer.vocabularySize !== VOCAB ||
    manifest.counts.recordsBySplit.train !== 79694 ||
    manifest.counts.recordsBySplit.validation !== 10139 ||
    manifest.counts.recordsBySplit.test !== 10167) {
  fail("locked Braid training-view identity or context changed");
}
const TOKENIZER_SHA = manifest.tokenizer.sha256;
for (const item of manifest.artifacts) {
  requireArtifact(path.join(view, item.path), item,
    "training-view artifact " + item.path);
}
const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
requireArtifact(tokenizer, { sha256: TOKENIZER_SHA }, "C0 tokenizer");
requireArtifact(path.join(view, manifest.tokenizer.artifact),
  { sha256: TOKENIZER_SHA }, "view tokenizer");
const byteLengths = tokenByteLengths(tokenizer);
fs.mkdirSync(out, { recursive: true });

const train = await prepareSplit({
  view, split: "train", out, tokenizer,
  expectedRecords: manifest.counts.recordsBySplit.train, byteLengths,
});
const validation = await prepareSplit({
  view, split: "validation", out, tokenizer,
  expectedRecords: manifest.counts.recordsBySplit.validation, byteLengths,
});

const blocked = padTraining(TASKS.flatMap(task => train.groups[task]));
const interleaved = padTraining(smoothInterleave(train.groups));
assert.equal(blocked.length, interleaved.length);
const outputs = {};
outputs.train_blocked = writePack(path.join(out, "train.blocked.z5pack"), blocked);
outputs.train_interleaved = writePack(
  path.join(out, "train.interleaved.z5pack"), interleaved);
outputs.validation_interleaved = writePack(
  path.join(out, "validation.interleaved.z5pack"),
  smoothInterleave(validation.groups));
outputs.validation_tasks = {};
outputs.completion_validation = {};
for (const task of TASKS) {
  outputs.validation_tasks[task] = writePack(
    path.join(out, task + ".validation.z5pack"), validation.groups[task]);
  outputs.completion_validation[task] = writeCompletion(
    path.join(out, task + ".validation.completion-eval.bin"),
    validation.rows.filter(row => row.task === task));
}

if (outputs.train_blocked.records !== manifest.counts.recordsBySplit.train ||
    outputs.train_interleaved.records !== manifest.counts.recordsBySplit.train ||
    outputs.train_blocked.active_targets !==
      outputs.train_interleaved.active_targets ||
    outputs.train_blocked.answer_targets !==
      outputs.train_interleaved.answer_targets ||
    outputs.train_blocked.packs !== outputs.train_interleaved.packs ||
    outputs.train_blocked.task_runs !== 3 ||
    outputs.train_interleaved.maximum_same_task_pack_run > 2 ||
    outputs.validation_interleaved.records !==
      manifest.counts.recordsBySplit.validation) {
  fail("C3.1 packing or braid invariants failed");
}

const result = {
  schema: "zero.c31_import.v1",
  view: {
    id: expectedViewId,
    braid_commit: braidCommit,
    manifest: { ...artifact(manifestPath), digest: manifest.digests.view },
    parent_collection_id: manifest.parent.collectionId,
    train_jsonl: manifest.artifacts.find(item => item.path === "data/train.jsonl"),
    validation_jsonl: manifest.artifacts.find(
      item => item.path === "data/validation.jsonl"),
    test_jsonl: manifest.artifacts.find(item => item.path === "data/test.jsonl"),
    official_artifacts_verified: true,
  },
  tokenizer: { id: manifest.tokenizer.id, sha256: TOKENIZER_SHA,
    vocabulary_size: VOCAB },
  model_target: { context: CONTEXT, reserved_boundary_tokens: 1,
    packing: "complete records only; task-local greedy packs" },
  schedules: {
    V: "claim packs, then cloze packs, then retrieval packs",
    A: "smooth deterministic interleave of the exact V task packs",
    B: "exact A pack order; runtime answer-token weight 4",
  },
  outputs,
  answer_spans: {
    train_target_tokens: train.answerTokens,
    validation_target_tokens: validation.answerTokens,
    claims: "derived from the final Supported claim field",
    cloze: "derived from the final Answer field",
    retrieval: "derived and matched to the released answerTokenSpan",
  },
  test: {
    records: manifest.counts.recordsBySplit.test,
    artifact_hash_verified: true,
    parsed: false,
    tokenized: false,
    packed: false,
    metrics_opened: false,
  },
  rights: { license: manifest.rights.license, published_by_zero: false },
};
fs.writeFileSync(path.join(out, "import.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

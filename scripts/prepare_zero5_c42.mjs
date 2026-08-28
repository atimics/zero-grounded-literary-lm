#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const DOCUMENT_TOKEN = 256;
const CONTEXT = 512;
const VOCAB = 512;
const TASKS = ["claim", "cloze", "retrieval"];
const ALL_TASKS = [...TASKS, "evidence-bundle"];
const PACK_MAGIC_V2 = Buffer.from([90, 53, 80, 75, 86, 50, 0, 0]);
const PACK_MAGIC_V3 = Buffer.from([90, 53, 80, 75, 86, 51, 0, 0]);
const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]);
const SPAN_CHOICE_MAGIC = Buffer.from([90, 53, 83, 67, 86, 49, 0, 0]);

function fail(message) {
  throw new Error(message);
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
    fail(label + " does not match the locked release: " + file);
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
  values.forEach((value, index) => bytes.writeBigUInt64LE(
    BigInt(value), index * 8));
  return bytes;
}

function tokenIdsHash(tokenBytes) {
  const count = tokenBytes.length / 2;
  const bytes = Buffer.alloc(count * 4);
  for (let index = 0; index < count; index++) {
    bytes.writeUInt32LE(tokenBytes.readUInt16LE(index * 2), index * 4);
  }
  return sha256(bytes);
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

function validateSpan(span, tokenCount, label, id) {
  if (!span || !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) || span.start < 0 ||
      span.end <= span.start || span.end > tokenCount) {
    fail(id + " has an invalid " + label + " token span");
  }
}

async function loadAlignedSplit({ release, split, out, tokenizerTool,
  tokenizer, expectedRecords }) {
  const dataPath = path.join(release, "data", split + ".jsonl");
  const metadataPath = path.join(release, "metadata", split + ".jsonl");
  const basePath = path.join(out, split + ".base.tok");
  const tokenPath = path.join(out, split + ".byte-bpe512.tok");
  const dataLines = readline.createInterface({
    input: fs.createReadStream(dataPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })[Symbol.asyncIterator]();
  const metadataLines = readline.createInterface({
    input: fs.createReadStream(metadataPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })[Symbol.asyncIterator]();
  const writer = new BufferedBaseWriter(basePath);
  const rows = [];
  try {
    while (true) {
      const [dataNext, metadataNext] = await Promise.all([
        dataLines.next(), metadataLines.next(),
      ]);
      if (dataNext.done || metadataNext.done) {
        if (dataNext.done !== metadataNext.done) {
          fail(split + " data and metadata line counts differ");
        }
        break;
      }
      const data = JSON.parse(dataNext.value);
      const metadata = JSON.parse(metadataNext.value);
      if (data.schemaVersion !== "braid.c42-text-record/v1" ||
          metadata.schemaVersion !== "braid.c42-metadata-record/v1" ||
          data.id !== metadata.recordId || metadata.split !== split ||
          !ALL_TASKS.includes(metadata.task) ||
          typeof data.text !== "string" || data.text.length === 0 ||
          metadata.view.maximumContextTokens !== CONTEXT ||
          metadata.view.tokenizerSha256 !==
            "90b9ddf7b239b6e48c21b87ca9735cb149c34dcf6f03f49a85410df6efe2cadc" ||
          !Number.isInteger(metadata.view.tokenCount) ||
          metadata.view.tokenCount <= 0 ||
          metadata.view.tokenCount > CONTEXT - 1) {
        fail("invalid aligned C4.2 " + split + " row: " +
          (data.id ?? metadata.recordId ?? "unknown"));
      }
      for (const span of metadata.masks.language) {
        validateSpan(span, metadata.view.tokenCount, "language", data.id);
      }
      for (const span of metadata.masks.answer) {
        validateSpan(span, metadata.view.tokenCount, "answer", data.id);
      }
      if ((metadata.task === "evidence-bundle") !==
          (metadata.masks.answer.length === 0)) {
        fail(data.id + " has inconsistent answer-mask task semantics");
      }
      if (!Array.isArray(metadata.spans?.token) ||
          !Array.isArray(metadata.spans?.answers)) {
        fail(data.id + " has no token-level evaluation spans");
      }
      for (const span of metadata.spans.token) {
        if (!span || typeof span.id !== "string" ||
            !Number.isInteger(span.start) || !Number.isInteger(span.end) ||
            span.start < 0 || span.end < span.start ||
            span.end > metadata.view.tokenCount) {
          fail(data.id + " has an invalid " + span?.id + " token span");
        }
      }
      if (["claim", "retrieval"].includes(metadata.task) &&
          (!Number.isInteger(metadata.objective.correctChoice) ||
           metadata.objective.correctChoice < 0 ||
           metadata.objective.correctChoice > 1)) {
        fail(data.id + " has no binary choice objective");
      }
      writer.appendText(data.text);
      rows.push({
        id: data.id,
        task: metadata.task,
        tokenCount: metadata.view.tokenCount,
        tokenIdsSha256: metadata.view.tokenIdsSha256,
        languageMasks: metadata.masks.language,
        answerMasks: metadata.masks.answer,
        tokenSpans: metadata.spans.token,
        answerSpanIds: metadata.spans.answers,
        correctChoice: metadata.objective.correctChoice ?? null,
        pairId: metadata.pair?.pairId ?? null,
        orientation: metadata.pair?.orientation ?? null,
        updateGroup: metadata.updateGrouping?.updateGroup ?? null,
      });
    }
  } finally {
    writer.close();
  }
  if (rows.length !== expectedRecords) {
    fail(split + " row count changed");
  }
  run(tokenizerTool, [
    "recode", "--vocab", tokenizer, "--tokens", basePath,
    "--out", tokenPath,
  ]);
  const tokenStream = fs.readFileSync(tokenPath);
  let offset = 0;
  for (const row of rows) {
    const start = offset;
    while (offset < tokenStream.length &&
           tokenStream.readUInt16LE(offset) !== DOCUMENT_TOKEN) {
      offset += 2;
    }
    if (offset >= tokenStream.length) {
      fail("token stream lacks a boundary for " + row.id);
    }
    row.tokenBytes = tokenStream.subarray(start, offset);
    offset += 2;
    if (row.tokenBytes.length / 2 !== row.tokenCount ||
        tokenIdsHash(row.tokenBytes) !== row.tokenIdsSha256) {
      fail("tokenized C4.2 row changed: " + row.id);
    }
  }
  if (offset !== tokenStream.length) fail("token stream has trailing rows");
  fs.unlinkSync(basePath);
  fs.unlinkSync(tokenPath);
  return rows;
}

function emptyPack() {
  const tokens = Buffer.alloc((CONTEXT + 1) * 2);
  for (let index = 0; index <= CONTEXT; index++) {
    tokens.writeUInt16LE(DOCUMENT_TOKEN, index * 2);
  }
  return {
    tokens,
    classes: Buffer.alloc(CONTEXT),
    records: 0,
    activeTargets: 0,
    answerTargets: 0,
    answerTargetsByTask: Object.fromEntries(TASKS.map(task => [task, 0])),
    task: null,
    recordIds: [],
  };
}

function addRecord(pack, row, cursor) {
  const needed = row.tokenCount + 1;
  if (cursor + needed > CONTEXT + 1) {
    fail("record does not fit its declared C4.2 pack: " + row.id);
  }
  const recordStart = cursor;
  row.tokenBytes.copy(pack.tokens, recordStart * 2);
  cursor += row.tokenCount;
  pack.tokens.writeUInt16LE(DOCUMENT_TOKEN, cursor * 2);
  cursor++;
  for (const span of row.languageMasks) {
    for (let token = span.start; token < span.end; token++) {
      pack.classes[recordStart + token - 1] = 1;
    }
  }
  pack.classes[recordStart + row.tokenCount - 1] = 1;
  if (row.task !== "evidence-bundle") {
    const answerClass = TASKS.indexOf(row.task) + 2;
    for (const span of row.answerMasks) {
      for (let token = span.start; token < span.end; token++) {
        const target = recordStart + token - 1;
        if (pack.classes[target] === 0) {
          fail("answer mask leaves the language objective: " + row.id);
        }
        pack.classes[target] = answerClass;
      }
    }
  }
  pack.records++;
  pack.recordIds.push(row.id);
  pack.task ??= row.task;
  if (pack.task !== row.task) pack.task = "mixed";
  return cursor;
}

function finishPack(pack) {
  for (const value of pack.classes) {
    if (value !== 0) pack.activeTargets++;
    if (value >= 2) {
      pack.answerTargets++;
      pack.answerTargetsByTask[TASKS[value - 2]]++;
    }
  }
  return pack;
}

function buildPlannedPacks(rows, planRows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const used = new Set();
  const packs = [];
  for (let index = 0; index < planRows.length; index++) {
    const plan = planRows[index];
    if (plan.schemaVersion !== "braid.c42-training-pack/v1" ||
        plan.index !== index + 1 || !ALL_TASKS.includes(plan.task) ||
        !Array.isArray(plan.recordIds) || plan.recordIds.length === 0 ||
        typeof plan.updateGroup !== "string") {
      fail("invalid C4.2 training plan row " + (index + 1));
    }
    const pack = emptyPack();
    let cursor = 1;
    for (const id of plan.recordIds) {
      const row = byId.get(id);
      if (!row || used.has(id) || row.task !== plan.task ||
          row.updateGroup !== plan.updateGroup) {
        fail("training plan membership changed at " + id);
      }
      cursor = addRecord(pack, row, cursor);
      used.add(id);
    }
    finishPack(pack);
    if (pack.activeTargets !== plan.activeTargets ||
        CONTEXT - pack.activeTargets !== plan.paddingTargets) {
      fail("training plan accounting changed at pack " + plan.index);
    }
    pack.updateGroup = plan.updateGroup;
    pack.pairId = plan.pairId ?? null;
    packs.push(pack);
  }
  if (used.size !== rows.length) {
    fail("training plan did not consume every admitted training record");
  }
  return packs;
}

function buildValidationPacks(rows) {
  const packs = [];
  let pack = emptyPack();
  let cursor = 1;
  for (const row of rows) {
    if (cursor + row.tokenCount + 1 > CONTEXT + 1) {
      packs.push(finishPack(pack));
      pack = emptyPack();
      cursor = 1;
    }
    cursor = addRecord(pack, row, cursor);
  }
  if (pack.records > 0) packs.push(finishPack(pack));
  return packs;
}

function updateOffsets(packs) {
  const offsets = [0];
  for (let index = 1; index < packs.length; index++) {
    if (packs[index].updateGroup !== packs[index - 1].updateGroup) {
      offsets.push(index);
    }
  }
  offsets.push(packs.length);
  for (let update = 0; update + 1 < offsets.length; update++) {
    const size = offsets[update + 1] - offsets[update];
    if (size < 1 || size > 2) fail("C4.2 update group size changed");
    const members = packs.slice(offsets[update], offsets[update + 1]);
    if (size === 2 && (!members[0].pairId ||
        members[0].pairId !== members[1].pairId)) {
      fail("two-pack update no longer binds one mirrored pair");
    }
  }
  return offsets;
}

function packStats(packs) {
  const answerTargetsByTask = Object.fromEntries(TASKS.map(task => [task, 0]));
  const stats = {
    packs: packs.length,
    records: 0,
    active_targets: 0,
    answer_targets: 0,
    answer_targets_by_task: answerTargetsByTask,
    compute_token_exposures: packs.length * CONTEXT,
  };
  for (const pack of packs) {
    stats.records += pack.records;
    stats.active_targets += pack.activeTargets;
    stats.answer_targets += pack.answerTargets;
    for (const task of TASKS) {
      stats.answer_targets_by_task[task] += pack.answerTargetsByTask[task];
    }
  }
  stats.padding_targets = stats.compute_token_exposures - stats.active_targets;
  return stats;
}

function writePack(file, packs, offsets = null) {
  const stats = packStats(packs);
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeSync(descriptor, offsets ? PACK_MAGIC_V3 : PACK_MAGIC_V2);
    fs.writeSync(descriptor, u32([
      offsets ? 3 : 2, VOCAB, CONTEXT, packs.length,
    ]));
    fs.writeSync(descriptor, u64([
      stats.records, stats.active_targets, stats.answer_targets,
      ...TASKS.map(task => stats.answer_targets_by_task[task]),
    ]));
    if (offsets) {
      fs.writeSync(descriptor, u32([offsets.length - 1]));
      fs.writeSync(descriptor, u32(offsets));
    }
    for (const pack of packs) fs.writeSync(descriptor, pack.tokens);
    for (const pack of packs) fs.writeSync(descriptor, pack.classes);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    ...artifact(file),
    ...stats,
    update_groups: offsets ? offsets.length - 1 : null,
    maximum_packs_per_update: offsets ? Math.max(...offsets.slice(1)
      .map((value, index) => value - offsets[index])) : null,
  };
}

function writeTokens(descriptor, tokenBytes) {
  fs.writeSync(descriptor, tokenBytes);
}

function tokenSpan(row, id) {
  const matches = row.tokenSpans.filter(span => span.id === id);
  if (matches.length !== 1) {
    fail(row.id + " does not have exactly one " + id + " token span");
  }
  return matches[0];
}

function writeCompletion(file, rows) {
  const descriptor = fs.openSync(file, "wx");
  let targetTokens = 0;
  try {
    fs.writeSync(descriptor, COMPLETION_MAGIC);
    fs.writeSync(descriptor, u32([1, VOCAB, CONTEXT, rows.length]));
    for (const row of rows) {
      const answerId = row.answerSpanIds[0];
      if (row.task !== "cloze" || row.answerSpanIds.length !== 1 ||
          answerId !== "answer") {
        fail(row.id + " is not a valid cloze evaluation row");
      }
      const target = tokenSpan(row, answerId);
      fs.writeSync(descriptor, u32([
        row.tokenCount, target.start, target.end - target.start, 0,
      ]));
      writeTokens(descriptor, row.tokenBytes);
      targetTokens += target.end - target.start;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { ...artifact(file), records: rows.length,
    target_tokens: targetTokens };
}

function writeSpanChoices(file, rows, task) {
  const groups = new Map();
  for (const row of rows.filter(value => value.task === task)) {
    if (!row.pairId || !["original", "mirrored"].includes(row.orientation)) {
      fail(task + " choice row lacks mirrored pair identity: " + row.id);
    }
    if (!groups.has(row.pairId)) groups.set(row.pairId, []);
    groups.get(row.pairId).push(row);
  }
  const pairs = [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right));
  const descriptor = fs.openSync(file, "wx");
  let correctTargetTokens = 0;
  let alternativeTargetTokens = 0;
  try {
    fs.writeSync(descriptor, SPAN_CHOICE_MAGIC);
    fs.writeSync(descriptor, u32([1, VOCAB, CONTEXT, pairs.length]));
    for (const [pairId, members] of pairs) {
      members.sort((left, right) => left.orientation === right.orientation ? 0 :
        left.orientation === "original" ? -1 : 1);
      if (members.length !== 2 || members[0].orientation !== "original" ||
          members[1].orientation !== "mirrored" ||
          members[0].correctChoice === members[1].correctChoice) {
        fail(task + " choice pair is incomplete or did not flip: " + pairId);
      }
      for (const row of members) {
        const correct = tokenSpan(row, "candidate-" + row.correctChoice);
        const alternative = tokenSpan(row,
          "candidate-" + (1 - row.correctChoice));
        if (correct.start === 0 || alternative.start === 0) {
          fail(row.id + " has an unscorable leading candidate span");
        }
        fs.writeSync(descriptor, u32([
          row.tokenCount,
          correct.start, correct.end - correct.start,
          alternative.start, alternative.end - alternative.start,
          row.correctChoice,
        ]));
        writeTokens(descriptor, row.tokenBytes);
        correctTargetTokens += correct.end - correct.start;
        alternativeTargetTokens += alternative.end - alternative.start;
      }
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { ...artifact(file), pairs: pairs.length, records: pairs.length * 2,
    correct_target_tokens: correctTargetTokens,
    alternative_target_tokens: alternativeTargetTokens,
    scoring: "mean causal nats per token over natural candidate spans" };
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
}

function selfTest(trainer = null, trainerMode = "parallel") {
  const tokenBytes = values => {
    const bytes = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
    return bytes;
  };
  const row = (id, task, values, answerMasks, updateGroup, pairId = null,
    orientation = null, tokenSpans = [], answerSpanIds = [],
    correctChoice = null) => ({
    id, task, tokenCount: values.length, tokenBytes: tokenBytes(values),
    languageMasks: [{ start: 0, end: values.length }], answerMasks,
    updateGroup, pairId, orientation, tokenSpans, answerSpanIds, correctChoice,
  });
  const rows = [
    row("a", "claim", [32, 65, 66, 67, 68], [{ start: 1, end: 3 }],
      "u1", "p1", "original", [
        { id: "candidate-0", start: 1, end: 3 },
        { id: "candidate-1", start: 3, end: 5 },
      ], ["candidate-0"], 0),
    row("b", "claim", [32, 67, 68, 65, 66], [{ start: 3, end: 5 }],
      "u1", "p1", "mirrored", [
        { id: "candidate-0", start: 1, end: 3 },
        { id: "candidate-1", start: 3, end: 5 },
      ], ["candidate-1"], 1),
    row("c", "evidence-bundle", [6, 7, 8, 9], [], "u2"),
  ];
  const plans = rows.map((value, index) => ({
    schemaVersion: "braid.c42-training-pack/v1", index: index + 1,
    task: value.task, recordIds: [value.id], updateGroup: value.updateGroup,
    pairId: value.pairId,
    activeTargets: value.tokenCount + 1,
    paddingTargets: CONTEXT - value.tokenCount - 1,
  }));
  const packs = buildPlannedPacks(rows, plans);
  const offsets = updateOffsets(packs);
  assert.deepEqual(offsets, [0, 2, 3]);
  assert.equal(packStats(packs).answer_targets, 4);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c42-self-"));
  const file = path.join(directory, "fixture.z5pack");
  const result = writePack(file, packs, offsets);
  assert.equal(result.update_groups, 2);
  assert.equal(result.maximum_packs_per_update, 2);
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.subarray(0, 8).equals(PACK_MAGIC_V3));
  assert.equal(bytes.readUInt32LE(8), 3);
  assert.equal(bytes.readUInt32LE(72), 2);
  const spanChoiceFile = path.join(directory, "claim.span-choice.bin");
  const spanChoice = writeSpanChoices(spanChoiceFile, rows, "claim");
  assert.equal(spanChoice.pairs, 1);
  const cloze = row("d", "cloze", [65, 66],
    [{ start: 0, end: 2 }], "u3", null, null,
    [{ id: "answer", start: 0, end: 2 }], ["answer"]);
  const completionFile = path.join(directory, "cloze.completion.bin");
  const completion = writeCompletion(completionFile, [cloze]);
  assert.equal(completion.target_tokens, 2);
  if (trainer) {
    if (!["parallel", "tensor"].includes(trainerMode)) {
      fail("--trainer-mode must be parallel or tensor");
    }
    const tokenizer = Buffer.alloc(24 + (VOCAB - 264) * 4);
    Buffer.from("SEROTOK\0").copy(tokenizer);
    tokenizer.writeUInt32LE(1, 8);
    tokenizer.writeUInt32LE(264, 12);
    tokenizer.writeUInt32LE(VOCAB - 264, 16);
    tokenizer.writeUInt32LE(1, 20);
    for (let merge = 0; merge < VOCAB - 264; merge++) {
      tokenizer.writeUInt16LE(97, 24 + merge * 4);
      tokenizer.writeUInt16LE(98, 26 + merge * 4);
    }
    const tokenizerPath = path.join(directory, "tokenizer.bin");
    fs.writeFileSync(tokenizerPath, tokenizer);
    const checkpointPath = path.join(directory, "fixture.ckpt");
    const batchMode = trainerMode === "tensor"
      ? ["--tensor-batch", "2"]
      : ["--parallel-batch", "2"];
    const output = run(path.resolve(trainer), [
      "--context", String(CONTEXT), "--dim", "8", "--heads", "1",
      "--layers", "1", "--ff", "8", "--vocab", String(VOCAB),
      "--tokenizer", tokenizerPath, "--steps", "2", "--batch", "2",
      ...batchMode, "--packed-train", file,
      "--packed-validation", file, "--dropout", "0", "--warmup", "0",
      "--report", "1", "--validation", "1", "--seed", "7",
      "--save", checkpointPath, "--tokens", "0",
      "--run-contract-sha256", "0".repeat(64),
    ]);
    assert.match(output, /update\s+2\s/u);
    assert.match(output,
      /packed sampling sequences=3 compute-token-exposures=1536/u);
    const completionOutput = run(path.resolve(trainer), [
      "--init", checkpointPath, "--tokenizer", tokenizerPath,
      "--completion-eval", completionFile,
    ]);
    assert.match(completionOutput, /"schema":"zero.c3_completion_eval.v1"/u);
    const choiceOutput = run(path.resolve(trainer), [
      "--init", checkpointPath, "--tokenizer", tokenizerPath,
      "--span-choice-eval", spanChoiceFile,
    ]);
    assert.match(choiceOutput,
      /"schema":"zero.c42_span_choice_eval.v1"/u);
  }
  fs.rmSync(directory, { recursive: true });
  process.stdout.write("ZERO.5 C4.2 grouped importer self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest(option("--trainer"), option("--trainer-mode", "parallel"));
  process.exit(0);
}

try {
  const release = path.resolve(option("--release"));
  const braidRoot = path.resolve(option("--braid-root"));
  const expectedBraidHead = option("--braid-head");
  const expectedReleaseId = option("--release-id");
  const expectedManifestSha256 = option("--manifest-sha256");
  const tokenizerTool = path.resolve(option("--tokenizer-tool", "./sero_tokenizer"));
  const out = path.resolve(option("--out", "build/zero5-c42-v1/import"));
  if (!expectedBraidHead || !expectedReleaseId || !expectedManifestSha256) {
    fail("--braid-head, --release-id, and --manifest-sha256 are required");
  }
  if (run("git", ["rev-parse", "HEAD"], braidRoot) !== expectedBraidHead) {
    fail("Braid checkout is not at the pinned C4.2 source commit");
  }
  if (fs.existsSync(out)) fail("output directory already exists: " + out);
  const manifestPath = path.join(release, "release.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (sha256(manifestBytes) !== expectedManifestSha256 ||
      manifest.schemaVersion !== "braid.c42-release/v1" ||
      manifest.status !== "RELEASED" ||
      manifest.releaseId !== expectedReleaseId ||
      manifest.tokenizer.vocabularySize !== VOCAB ||
      manifest.counts.recordsBySplit.train !== 70431 ||
      manifest.counts.recordsBySplit.validation !== 12159 ||
      manifest.counts.recordsBySplit.test !== 12188 ||
      manifest.training.primaryCheckpointPacks !== 37768 ||
      manifest.training.primaryCheckpointComputeTokenExposures !== 19337216 ||
      manifest.training.fullPassPackSequences !== 51145 ||
      manifest.training.fullPassComputeTokenExposures !== 26186240 ||
      manifest.training.testOpened !== false) {
    fail("locked Braid C4.2 release identity or model target changed");
  }
  if (fs.existsSync(path.join(release, "data", "test.jsonl"))) {
    fail("C4.2 test content must remain absent from the import release");
  }
  for (const item of manifest.artifacts) {
    if (item.path === "data/test.jsonl") {
      fail("C4.2 manifest unexpectedly exposes sealed test content");
    }
    requireArtifact(path.join(release, item.path), item,
      "C4.2 release artifact " + item.path);
  }
  const tokenizer = path.join(release, manifest.tokenizer.artifact);
  requireArtifact(tokenizer, {
    sha256: "90b9ddf7b239b6e48c21b87ca9735cb149c34dcf6f03f49a85410df6efe2cadc",
  }, "C4.2 tokenizer");
  fs.mkdirSync(out, { recursive: true });
  const train = await loadAlignedSplit({
    release, split: "train", out, tokenizerTool, tokenizer,
    expectedRecords: manifest.counts.recordsBySplit.train,
  });
  const validation = await loadAlignedSplit({
    release, split: "validation", out, tokenizerTool, tokenizer,
    expectedRecords: manifest.counts.recordsBySplit.validation,
  });
  const planPath = path.join(release, "training", "train-pack-plan.jsonl");
  const planRows = readJsonl(planPath);
  if (planRows.length !== manifest.training.fullPassPackSequences) {
    fail("C4.2 pack plan length changed");
  }
  const fullPacks = buildPlannedPacks(train, planRows);
  const fullOffsets = updateOffsets(fullPacks);
  const primaryPacks = fullPacks.slice(
    0, manifest.training.primaryCheckpointPacks);
  const primaryOffsets = updateOffsets(primaryPacks);
  const validationPacks = buildValidationPacks(validation);
  const outputs = {
    train_primary: writePack(
      path.join(out, "train.primary.grouped.z5pack"),
      primaryPacks, primaryOffsets),
    train_full: writePack(
      path.join(out, "train.full.grouped.z5pack"),
      fullPacks, fullOffsets),
    validation: writePack(
      path.join(out, "validation.z5pack"), validationPacks),
    validation_tasks: Object.fromEntries(ALL_TASKS.map(task => [task,
      writePack(path.join(out, task + ".validation.z5pack"),
        buildValidationPacks(validation.filter(row => row.task === task))),
    ])),
    cloze_completion: writeCompletion(
      path.join(out, "cloze.validation.completion-eval.bin"),
      validation.filter(row => row.task === "cloze")),
    span_choices: Object.fromEntries(["claim", "retrieval"].map(task =>
      [task, writeSpanChoices(
        path.join(out, task + ".validation.span-choice-eval.bin"),
        validation, task)])),
  };
  const full = outputs.train_full;
  const primary = outputs.train_primary;
  if (full.packs !== manifest.training.fullPassPackSequences ||
      full.records !== manifest.counts.recordsBySplit.train ||
      full.compute_token_exposures !==
        manifest.training.fullPassComputeTokenExposures ||
      full.active_targets !== manifest.training.activeTargets ||
      full.padding_targets !== manifest.training.paddingTargets ||
      !TASKS.every(task => full.answer_targets_by_task[task] ===
        manifest.training.answerTargetsByTask[task]) ||
      primary.packs !== manifest.training.primaryCheckpointPacks ||
      primary.compute_token_exposures !==
        manifest.training.primaryCheckpointComputeTokenExposures ||
      primary.active_targets !==
        manifest.training.primaryCheckpointActiveTargets ||
      primary.padding_targets !==
        manifest.training.primaryCheckpointPaddingTargets ||
      outputs.validation.records !== manifest.counts.recordsBySplit.validation) {
    fail("C4.2 packing, masking, or compute invariants failed");
  }
  const weightedPrimary = Object.fromEntries(TASKS.map(task => [task,
    primary.answer_targets_by_task[task] *
      manifest.training.balancedAnswerWeights[task],
  ]));
  for (const task of TASKS) {
    const expected = manifest.training.primaryWeightedAnswerMassByTask[task];
    if (Math.abs(weightedPrimary[task] - expected) > 0.000001) {
      fail("primary weighted answer mass changed for " + task);
    }
  }
  const result = {
    schema: "zero.c42_import.v1",
    release: {
      id: manifest.releaseId,
      braid_head: expectedBraidHead,
      manifest: { ...artifact(manifestPath), digest: manifest.digest },
      membership_digest: manifest.membershipDigest,
      inherited_membership_digest: manifest.inheritedMembershipDigest,
      pack_plan: artifact(planPath),
      official_artifacts_verified: true,
    },
    tokenizer: {
      id: manifest.tokenizer.id,
      sha256: manifest.tokenizer.sha256,
      vocabulary_size: VOCAB,
    },
    format: {
      training: "Z5PKV3 grouped packs with exact update offsets",
      validation: "Z5PKV2 record-safe packs",
      context: CONTEXT,
      reserved_boundary_tokens: 1,
    },
    answer_weights: manifest.training.balancedAnswerWeights,
    outputs,
    primary: {
      update_groups: primaryOffsets.length - 1,
      pair_atomic: true,
      weighted_answer_mass_by_task: weightedPrimary,
    },
    full_pass: {
      update_groups: fullOffsets.length - 1,
      pair_atomic: true,
    },
    test: {
      records: manifest.sealedTest.records,
      sha256: manifest.sealedTest.sha256,
      bytes: manifest.sealedTest.bytes,
      commitment_hash_verified: true,
      content_present: false,
      parsed: false,
      tokenized: false,
      packed: false,
      metrics_opened: false,
    },
    rights: {
      license: manifest.rights.license,
      private_by_default: true,
      published_by_zero: false,
    },
  };
  fs.writeFileSync(path.join(out, "import.json"),
    JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write("error: " + error.message + "\n");
  process.exit(1);
}

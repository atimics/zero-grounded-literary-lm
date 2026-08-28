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
const PACK_MAGIC = Buffer.from([90, 53, 80, 75, 86, 51, 0, 0]);
const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]);
const RELEASE_ID = "braid-corpus-five-statebridge-v0.3.0-" +
  "3ce479213241679af209b402101c24786299f2ff05325838efd42eebf541315c";
const REPRESENTATION_ID = "braid-corpus-five-statebridge-zero5-512-text-" +
  "c52-v0.3.0-88aa4262ef1fcdada6aa36e99aa7d1c6ccb4e347c5e0ce2c6505b6bfc03b5766";
const TOKENIZER_SHA256 =
  "90b9ddf7b239b6e48c21b87ca9735cb149c34dcf6f03f49a85410df6efe2cadc";
const C43_PACK_SHA256 =
  "34d38b1b0ed67f0eb86d04cd9482e507b41d4418ea7e4f86e361452310dca329";
const MIX_PACKS = 9442;
const MIX_GROUPS = MIX_PACKS / 2;
const NEXT_GROUPS = 1574;
const CHOICE_GROUPS = 3147;

function fail(message) { throw new Error(message); }

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

function artifact(file) {
  return { sha256: sha256File(file), bytes: fs.statSync(file).size };
}

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  if (observed.sha256 !== expected) fail(`${label} changed`);
  return observed;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text === "" ? [] : text.split("\n").map(JSON.parse);
}

function run(program, args, cwd = process.cwd()) {
  const result = spawnSync(program, args, {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
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

class BaseTokenWriter {
  constructor(file) {
    this.file = fs.openSync(file, "wx");
    this.parts = [];
    this.bytes = 0;
  }

  append(text) {
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

  close() { this.flush(); fs.closeSync(this.file); }
}

async function loadTextRows(file, split, out, tokenizerTool, tokenizer) {
  const base = path.join(out, `${split}.c52.base.tok`);
  const recoded = path.join(out, `${split}.c52.byte-bpe512.tok`);
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const writer = new BaseTokenWriter(base);
  const rows = [];
  try {
    for await (const line of lines) {
      const row = JSON.parse(line);
      const view = row.view;
      if (row.schemaVersion !== "braid.state-text-record/v2" ||
          row.split !== split ||
          !["next-state", "transition-choice"].includes(row.task) ||
          !["next-state", "choice-a", "choice-b"].includes(row.stream) ||
          typeof row.id !== "string" || typeof row.text !== "string" ||
          typeof row.stateTargetSha256 !== "string" ||
          !Array.isArray(row.stateTargets) || row.stateTargets.length === 0 ||
          view?.profile !== "zero5-512-text-c52" ||
          view.tokenizerSha256 !== TOKENIZER_SHA256 ||
          view.maximumPositions !== CONTEXT || view.reservedPositions !== 1 ||
          !Number.isInteger(view.tokenCount) || view.tokenCount < 1 ||
          view.tokenCount > CONTEXT - 1 ||
          !Number.isInteger(view.targetSpan?.start) ||
          !Number.isInteger(view.targetSpan?.end) ||
          view.targetSpan.start < 1 ||
          view.targetSpan.end <= view.targetSpan.start ||
          view.targetSpan.end > view.tokenCount ||
          view.inputPositions !== view.targetSpan.start) {
        fail(`invalid C5.2 ${split} row: ${row.id ?? "unknown"}`);
      }
      if (row.task === "next-state" && row.stream !== "next-state") {
        fail(`${row.id} changed next-state stream`);
      }
      if (row.task === "transition-choice" &&
          !["choice-a", "choice-b"].includes(row.stream)) {
        fail(`${row.id} changed choice stream`);
      }
      writer.append(row.text);
      rows.push({ ...row, tokenCount: view.tokenCount,
        targetSpan: view.targetSpan, tokenIdsSha256: view.tokenIdsSha256 });
    }
  } finally { writer.close(); }
  const expected = split === "train" ? 118671 : 14772;
  if (rows.length !== expected) fail(`C5.2 ${split} row count changed`);
  run(tokenizerTool, ["recode", "--vocab", tokenizer, "--tokens", base,
    "--out", recoded]);
  const stream = fs.readFileSync(recoded);
  let offset = 0;
  for (const row of rows) {
    const start = offset;
    while (offset < stream.length &&
           stream.readUInt16LE(offset) !== DOCUMENT_TOKEN) offset += 2;
    if (offset >= stream.length) fail(`missing token boundary for ${row.id}`);
    row.tokenBytes = stream.subarray(start, offset);
    offset += 2;
    if (row.tokenBytes.length / 2 !== row.tokenCount ||
        tokenIdsHash(row.tokenBytes) !== row.tokenIdsSha256) {
      fail(`C5.2 token identity changed: ${row.id}`);
    }
  }
  if (offset !== stream.length) fail("C5.2 token stream has trailing rows");
  fs.unlinkSync(base);
  fs.unlinkSync(recoded);
  return rows;
}

function emptyPack(id, stream) {
  const tokens = Buffer.alloc((CONTEXT + 1) * 2);
  for (let index = 0; index <= CONTEXT; index++) {
    tokens.writeUInt16LE(DOCUMENT_TOKEN, index * 2);
  }
  return { id, stream, tokens, classes: Buffer.alloc(CONTEXT),
    targets: Buffer.alloc(CONTEXT), recordIds: [], records: 0,
    activeTargets: 0, targetPositions: 0, cursor: 1 };
}

function canAdd(pack, row) {
  return pack.cursor + row.tokenCount + 1 <= CONTEXT + 1;
}

function addC5Record(pack, row) {
  if (!canAdd(pack, row)) fail(`${row.id} does not fit its ZERO C5 pack`);
  const recordStart = pack.cursor;
  row.tokenBytes.copy(pack.tokens, recordStart * 2);
  pack.cursor += row.tokenCount;
  pack.tokens.writeUInt16LE(DOCUMENT_TOKEN, pack.cursor * 2);
  pack.cursor += 1;
  for (let token = 0; token < row.tokenCount; token++) {
    pack.classes[recordStart + token - 1] = 1;
  }
  for (let token = row.targetSpan.start; token < row.targetSpan.end; token++) {
    const position = recordStart + token - 1;
    pack.targets[position] = 1;
    pack.targetPositions += 1;
  }
  pack.activeTargets += row.tokenCount;
  pack.records += 1;
  pack.recordIds.push(row.id);
}

function makePacks(rows, stream, namespace) {
  const packs = [];
  let pack = emptyPack(`${namespace}-${String(packs.length).padStart(6, "0")}`,
    stream);
  for (const row of rows) {
    if (!canAdd(pack, row) && pack.records > 0) {
      packs.push(pack);
      pack = emptyPack(
        `${namespace}-${String(packs.length).padStart(6, "0")}`, stream);
    }
    addC5Record(pack, row);
  }
  if (pack.records > 0) packs.push(pack);
  return packs;
}

function ranked(values, namespace) {
  return [...values].sort((left, right) => {
    const a = sha256(`${namespace}:${left.id}`);
    const b = sha256(`${namespace}:${right.id}`);
    return a.localeCompare(b) || left.id.localeCompare(right.id);
  });
}

function buildChoiceGroups(rows) {
  const pairs = new Map();
  for (const row of rows.filter(value => value.task === "transition-choice")) {
    if (!row.pairId || !["correct-a", "correct-b"].includes(row.orientation)) {
      fail(`${row.id} lacks a mirrored choice identity`);
    }
    if (!pairs.has(row.pairId)) pairs.set(row.pairId, []);
    pairs.get(row.pairId).push(row);
  }
  const ordered = [...pairs.entries()].map(([id, members]) => {
    if (members.length !== 2) fail(`${id} is not a complete choice pair`);
    const a = members.find(row => row.orientation === "correct-a");
    const b = members.find(row => row.orientation === "correct-b");
    if (!a || !b || a.choiceLabel !== "A" || b.choiceLabel !== "B" ||
        a.canonicalId !== b.canonicalId) {
      fail(`${id} changed mirrored choice semantics`);
    }
    return { id, a, b };
  }).sort((left, right) => sha256(`c51-choice:${left.id}`).localeCompare(
    sha256(`c51-choice:${right.id}`)));
  const groups = [];
  let a = emptyPack(`c51-choice-a-${String(groups.length).padStart(6, "0")}`,
    "choice-a");
  let b = emptyPack(`c51-choice-b-${String(groups.length).padStart(6, "0")}`,
    "choice-b");
  const finish = () => {
    groups.push({ id: `c51-choice-group-${String(groups.length)
      .padStart(6, "0")}`, kind: "choice", packs: [a, b] });
  };
  for (const pair of ordered) {
    if ((!canAdd(a, pair.a) || !canAdd(b, pair.b)) && a.records > 0) {
      finish();
      a = emptyPack(`c51-choice-a-${String(groups.length).padStart(6, "0")}`,
        "choice-a");
      b = emptyPack(`c51-choice-b-${String(groups.length).padStart(6, "0")}`,
        "choice-b");
    }
    addC5Record(a, pair.a);
    addC5Record(b, pair.b);
  }
  if (a.records > 0) finish();
  return groups;
}

function buildNextGroups(rows) {
  const ordered = [...rows.filter(row => row.task === "next-state")].sort(
    (left, right) => sha256(`c51-next:${left.id}`).localeCompare(
      sha256(`c51-next:${right.id}`)));
  const packs = makePacks(ordered, "next-state", "c51-next");
  const groups = [];
  for (let index = 0; index + 1 < packs.length; index += 2) {
    groups.push({ id: `c51-next-group-${String(groups.length)
      .padStart(6, "0")}`, kind: "next-state",
    packs: [packs[index], packs[index + 1]] });
  }
  return groups;
}

function parseC43Pack(file, plan) {
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 8).equals(PACK_MAGIC) ||
      bytes.readUInt32LE(8) !== 3 || bytes.readUInt32LE(12) !== VOCAB ||
      bytes.readUInt32LE(16) !== CONTEXT) fail("invalid C4.3 pack header");
  const packCount = bytes.readUInt32LE(20);
  const records = Number(bytes.readBigUInt64LE(24));
  const activeTargets = Number(bytes.readBigUInt64LE(32));
  const groupCount = bytes.readUInt32LE(72);
  const offsets = [];
  for (let index = 0; index <= groupCount; index++) {
    offsets.push(bytes.readUInt32LE(76 + index * 4));
  }
  const tokenStart = 76 + (groupCount + 1) * 4;
  const classStart = tokenStart + packCount * (CONTEXT + 1) * 2;
  if (plan.length !== packCount || records !== 78039 ||
      activeTargets !== 14850534 || offsets.at(-1) !== packCount ||
      classStart + packCount * CONTEXT !== bytes.length) {
    fail("C4.3 pack accounting changed");
  }
  const packs = [];
  for (let index = 0; index < packCount; index++) {
    const tokens = Buffer.from(bytes.subarray(tokenStart + index * 1026,
      tokenStart + (index + 1) * 1026));
    const classes = Buffer.from(bytes.subarray(classStart + index * 512,
      classStart + (index + 1) * 512));
    packs.push({ id: `c43-${String(index).padStart(6, "0")}`,
      tokens, classes, targets: Buffer.alloc(CONTEXT),
      records: plan[index].recordIds.length,
      activeTargets: classes.reduce((sum, value) => sum + (value !== 0), 0),
      targetPositions: 0 });
  }
  return { packs, offsets, records, activeTargets };
}

function groupHash(packs) {
  const hash = crypto.createHash("sha256");
  for (const pack of packs) hash.update(pack.tokens).update(pack.classes);
  return hash.digest("hex");
}

function trimInputLoss(groups, count) {
  const candidates = [];
  for (const group of groups) {
    for (const pack of group.packs) {
      for (let position = 0; position < CONTEXT; position++) {
        if (pack.classes[position] !== 0 && pack.targets[position] === 0) {
          candidates.push({ pack, position,
            score: sha256(`c51-input-mask:${pack.id}:${position}`) });
        }
      }
    }
  }
  if (count < 0 || count > candidates.length) {
    fail("cannot match the C4.3 active-position budget");
  }
  candidates.sort((left, right) => left.score.localeCompare(right.score));
  for (let index = 0; index < count; index++) {
    candidates[index].pack.classes[candidates[index].position] = 0;
    candidates[index].pack.activeTargets -= 1;
  }
}

function packStats(packs) {
  const stats = { packs: packs.length, records: 0, active_targets: 0,
    answer_targets: 0, answer_targets_by_task: {
      claim: 0, cloze: 0, retrieval: 0,
    }, compute_token_exposures: packs.length * CONTEXT,
    state_target_positions: 0 };
  for (const pack of packs) {
    stats.records += pack.records;
    stats.state_target_positions += pack.targetPositions ?? 0;
    for (const value of pack.classes) {
      if (value !== 0) stats.active_targets += 1;
      if (value >= 2 && value <= 4) {
        stats.answer_targets += 1;
        stats.answer_targets_by_task[["claim", "cloze", "retrieval"]
          [value - 2]] += 1;
      }
    }
  }
  stats.padding_targets = stats.compute_token_exposures - stats.active_targets;
  return stats;
}

function writePack(file, packs, offsets) {
  const stats = packStats(packs);
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeSync(descriptor, PACK_MAGIC);
    fs.writeSync(descriptor, u32([3, VOCAB, CONTEXT, packs.length]));
    fs.writeSync(descriptor, u64([stats.records, stats.active_targets,
      stats.answer_targets, ...["claim", "cloze", "retrieval"].map(
        task => stats.answer_targets_by_task[task])]));
    fs.writeSync(descriptor, u32([offsets.length - 1]));
    fs.writeSync(descriptor, u32(offsets));
    for (const pack of packs) fs.writeSync(descriptor, pack.tokens);
    for (const pack of packs) fs.writeSync(descriptor, pack.classes);
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), ...stats, update_groups: offsets.length - 1,
    maximum_packs_per_update: 2 };
}

function writeCompletion(file, rows) {
  const descriptor = fs.openSync(file, "wx");
  let targetTokens = 0;
  try {
    fs.writeSync(descriptor, COMPLETION_MAGIC);
    fs.writeSync(descriptor, u32([1, VOCAB, CONTEXT, rows.length]));
    for (const row of rows) {
      fs.writeSync(descriptor, u32([row.tokenCount, row.targetSpan.start,
        row.targetSpan.end - row.targetSpan.start, 0]));
      fs.writeSync(descriptor, row.tokenBytes);
      targetTokens += row.targetSpan.end - row.targetSpan.start;
    }
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), records: rows.length,
    target_tokens: targetTokens };
}

function selfTest() {
  const pack = emptyPack("fixture", "next-state");
  const tokenBytes = Buffer.alloc(6);
  [65, 66, 67].forEach((value, index) =>
    tokenBytes.writeUInt16LE(value, index * 2));
  addC5Record(pack, { id: "row", tokenCount: 3, tokenBytes,
    targetSpan: { start: 2, end: 3 } });
  assert.equal(pack.activeTargets, 3);
  assert.equal(pack.targetPositions, 1);
  assert.equal(pack.classes[0], 1);
  assert.equal(pack.classes[2], 1);
  assert.equal(pack.classes[3], 0);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c51-import-"));
  const file = path.join(directory, "fixture.z5pack");
  const result = writePack(file, [pack, pack], [0, 2]);
  assert.equal(result.active_targets, 6);
  fs.rmSync(directory, { recursive: true });
  process.stdout.write("ZERO.5 C5.1 importer self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const releaseDirectory = path.resolve(option("--release"));
  const braidRoot = path.resolve(option("--braid-root"));
  const c43Import = path.resolve(option("--c43-import"));
  const c43Release = path.resolve(option("--c43-release"));
  const tokenizerTool = path.resolve(option("--tokenizer-tool",
    "./sero_tokenizer"));
  const importId = option("--import-id");
  const out = path.resolve(option("--out", "build/zero5-c51-statebridge-v1/import"));
  if (!importId) fail("--import-id is required");
  if (fs.existsSync(out)) fail(`output directory already exists: ${out}`);

  const required = {
    "release.json": "4e021c103b54b4be70bd0ae8201a3ef27233982eb924364e49e84f1e0f524e95",
    "experiment-contract.json": "e8e2f9fa49ea5f82e3a1a4a6b20a6e0fdf632898ba96d516bcc00aeca082dbca",
    "training-recipe.json": "dc7463b3adc10fd2d0cfe215d5b34924adee53960c6260d9e679da4b994f9313",
    "evaluation.json": "d3b7b0b3b111cf0c250aa4d2f161803e6eaf07d9f4cb951e050505e3fb54a14d",
    "tokenizer/tokenizer.bin": TOKENIZER_SHA256,
    "data/text/train.jsonl": "164e9820935ee2dd3f97af6750aef948e8bbedb37b9027c0cc7318836169e7a8",
    "data/text/validation.jsonl": "c83687764ade03e889f9b37e28f5809d28af437b75e95f5513090a793b9b57f2",
    "training/text-pack-plan.jsonl": "0f0e70eef36e02bab04d4562627f3729e32506de492b5ec773553e1bc91f057b",
    "state-target-vocabulary.json": "3923f04459eb3769fce7e133f687758b677bca0e3a9d65444a6407e70e9bb578",
  };
  const verified = {};
  for (const [relative, hash] of Object.entries(required)) {
    verified[relative] = requireArtifact(path.join(releaseDirectory, relative),
      hash, `C5.2 ${relative}`);
  }
  const release = readJson(path.join(releaseDirectory, "release.json"));
  const recipe = readJson(path.join(releaseDirectory, "training-recipe.json"));
  const upstreamContract = readJson(path.join(releaseDirectory,
    "experiment-contract.json"));
  if (release.releaseId !== RELEASE_ID ||
      release.representations?.text?.id !== REPRESENTATION_ID ||
      release.tokenizer?.sha256 !== TOKENIZER_SHA256 ||
      recipe.trainingAuthorized !== false ||
      upstreamContract.trainingAuthorized !== false ||
      upstreamContract.execution?.testSealed !== true) {
    fail("C5.2 release or authorization boundary changed");
  }
  run("git", ["cat-file", "-e",
    "f96fb289b2ddf3c22b755bfa378f8ff70afb0293^{commit}"], braidRoot);
  run("git", ["merge-base", "--is-ancestor",
    "f96fb289b2ddf3c22b755bfa378f8ff70afb0293", "HEAD"], braidRoot);
  requireArtifact(path.join(c43Import, "train.primary.grouped.z5pack"),
    C43_PACK_SHA256, "C4.3 control packs");
  const c43Plan = readJsonl(path.join(c43Release,
    "training/train-pack-plan.jsonl"));

  fs.mkdirSync(out, { recursive: true });
  const tokenizer = path.join(releaseDirectory, "tokenizer/tokenizer.bin");
  const train = await loadTextRows(path.join(releaseDirectory,
    "data/text/train.jsonl"), "train", out, tokenizerTool, tokenizer);
  const validation = await loadTextRows(path.join(releaseDirectory,
    "data/text/validation.jsonl"), "validation", out, tokenizerTool,
  tokenizer);

  const choiceGroups = ranked(buildChoiceGroups(train), "c51-choice-groups")
    .slice(0, CHOICE_GROUPS);
  const nextGroups = ranked(buildNextGroups(train), "c51-next-groups")
    .slice(0, NEXT_GROUPS);
  if (choiceGroups.length !== CHOICE_GROUPS || nextGroups.length !== NEXT_GROUPS) {
    fail("C5.2 does not supply enough boundary-safe groups");
  }
  const c5Groups = [];
  let nextIndex = 0;
  let choiceIndex = 0;
  while (c5Groups.length < MIX_GROUPS) {
    if (nextIndex < nextGroups.length) c5Groups.push(nextGroups[nextIndex++]);
    for (let count = 0; count < 2 && choiceIndex < choiceGroups.length;
         count++) c5Groups.push(choiceGroups[choiceIndex++]);
  }
  if (c5Groups.length !== MIX_GROUPS || nextIndex !== NEXT_GROUPS ||
      choiceIndex !== CHOICE_GROUPS) fail("C5.2 group schedule changed");

  const c43 = parseC43Pack(path.join(c43Import,
    "train.primary.grouped.z5pack"), c43Plan);
  const candidates = [];
  for (let group = 0; group + 1 < c43.offsets.length; group++) {
    const start = c43.offsets[group];
    const end = c43.offsets[group + 1];
    if (end - start === 2) {
      candidates.push({ group, start, end,
        score: groupHash(c43.packs.slice(start, end)) });
    }
  }
  candidates.sort((left, right) => left.score.localeCompare(right.score));
  const replaced = candidates.slice(0, MIX_GROUPS);
  if (replaced.length !== MIX_GROUPS) fail("not enough C4.3 two-pack groups");
  const removedActive = replaced.reduce((sum, value) => sum +
    c43.packs.slice(value.start, value.end).reduce(
      (inner, pack) => inner + pack.activeTargets, 0), 0);
  const rawC5Active = c5Groups.reduce((sum, group) => sum +
    group.packs.reduce((inner, pack) => inner + pack.activeTargets, 0), 0);
  trimInputLoss(c5Groups, rawC5Active - removedActive);

  const replacements = new Map(replaced.sort((left, right) =>
    left.group - right.group).map((value, index) => [value.group,
      c5Groups[index]]));
  const packs = [];
  const offsets = [0];
  let c5Records = 0;
  let removedC43Records = 0;
  let stateTargetPositions = 0;
  for (let group = 0; group + 1 < c43.offsets.length; group++) {
    const replacement = replacements.get(group);
    if (replacement) {
      const start = c43.offsets[group];
      const end = c43.offsets[group + 1];
      removedC43Records += c43.packs.slice(start, end).reduce(
        (sum, pack) => sum + pack.records, 0);
      c5Records += replacement.packs.reduce(
        (sum, pack) => sum + pack.records, 0);
      stateTargetPositions += replacement.packs.reduce(
        (sum, pack) => sum + pack.targetPositions, 0);
      packs.push(...replacement.packs);
    } else {
      packs.push(...c43.packs.slice(c43.offsets[group],
        c43.offsets[group + 1]));
    }
    offsets.push(packs.length);
  }
  const primary = writePack(path.join(out, "train.mixed.grouped.z5pack"),
    packs, offsets);
  if (primary.packs !== 37768 || primary.update_groups !== 28707 ||
      primary.compute_token_exposures !== 19337216 ||
      primary.active_targets !== 14850534 ||
      primary.records !== 78039 - removedC43Records + c5Records ||
      primary.state_target_positions !== stateTargetPositions) {
    fail("C5.1 compute matching failed");
  }

  const evaluation = {
    next_state: writeCompletion(path.join(out,
      "c52.next-state.validation.completion-eval.bin"), validation.filter(
      row => row.task === "next-state")),
    choice_a: writeCompletion(path.join(out,
      "c52.choice-a.validation.completion-eval.bin"), validation.filter(
      row => row.orientation === "correct-a")),
    choice_b: writeCompletion(path.join(out,
      "c52.choice-b.validation.completion-eval.bin"), validation.filter(
      row => row.orientation === "correct-b")),
  };
  const receipt = {
    schema: "zero.c51_statebridge_import.v1",
    import_id: importId,
    release: { id: RELEASE_ID,
      representation_id: REPRESENTATION_ID,
      source_commit: "f96fb289b2ddf3c22b755bfa378f8ff70afb0293",
      verified_artifacts: verified },
    control: { experiment: "zero5-c43-v1",
      pack_sha256: C43_PACK_SHA256, packs: c43.packs.length,
      update_groups: c43.offsets.length - 1,
      active_targets: c43.activeTargets },
    mixture: { c5_pack_fraction: MIX_PACKS / c43.packs.length,
      c5_packs: MIX_PACKS, c5_groups: MIX_GROUPS,
      c5_next_state_packs: NEXT_GROUPS * 2,
      c5_choice_a_packs: CHOICE_GROUPS,
      c5_choice_b_packs: CHOICE_GROUPS,
      c5_records: c5Records, removed_c43_records: removedC43Records,
      raw_c5_active_targets: rawC5Active,
      input_targets_masked_for_exact_match: rawC5Active - removedActive,
      c5_state_target_positions: stateTargetPositions,
      loss_outside_target_span:
        "standard causal weight 1, deterministically thinned to exact active-position match",
      target_span_loss: "standard causal weight 1",
      symbolic_serialization_present: false,
      auxiliary_state_head_present: false },
    outputs: { primary, evaluation },
    policy: { structured_content_claim_only: true,
      symbolic_serialization_claimed: false,
      verified_state_target_loss_claimed: false,
      training_authorized_by_braid: false,
      zero_authorization_required: true },
    test: { content_present: false, parsed: false, tokenized: false,
      packed: false, scored: false, metrics_opened: false },
  };
  fs.writeFileSync(path.join(out, "import.json"),
    JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(receipt) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

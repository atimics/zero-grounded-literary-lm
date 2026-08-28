#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTEXT = 512;
const VOCAB = 512;
const HEAD_VOCAB = 752;
const DOCUMENT_TOKEN = 256;
const PACK_MAGIC = Buffer.from([90, 53, 80, 75, 86, 51, 0, 0]);
const AUX_MAGIC = Buffer.from([90, 53, 65, 85, 88, 49, 0, 0]);
const EVAL_MAGIC = Buffer.from([90, 53, 65, 85, 69, 86, 49, 0]);
const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]);
const RELEASE_ID = "braid-corpus-five-statebridge-v0.3.0-" +
  "3ce479213241679af209b402101c24786299f2ff05325838efd42eebf541315c";
const RELEASE_HASHES = {
  "release.json": "4e021c103b54b4be70bd0ae8201a3ef27233982eb924364e49e84f1e0f524e95",
  "data/text/train.jsonl":
    "164e9820935ee2dd3f97af6750aef948e8bbedb37b9027c0cc7318836169e7a8",
  "data/text/validation.jsonl":
    "c83687764ade03e889f9b37e28f5809d28af437b75e95f5513090a793b9b57f2",
  "state-target-vocabulary.json":
    "3923f04459eb3769fce7e133f687758b677bca0e3a9d65444a6407e70e9bb578",
  "targets/text-train.braidtarget":
    "b70fd9e4e96c54065a5c1a3d496e2c08ba808e291bbd1310ec0048b64cb59522",
  "targets/text-train.index.jsonl":
    "f3f1f0747107af97a8f7ef24e6be19b590f94482eca356be56fbd002465ebdd8",
};

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

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  if (observed.sha256 !== expected) fail(`${label} changed`);
  return observed;
}

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text === "" ? [] : text.split("\n").map(JSON.parse);
}

function u32(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
}

function u16(values) {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  return bytes;
}

function tokenIdsHash(tokens) {
  const expanded = Buffer.alloc(tokens.length * 4);
  tokens.forEach((token, index) => expanded.writeUInt32LE(token, index * 4));
  return sha256(expanded);
}

function parsePack(file) {
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 8).equals(PACK_MAGIC) ||
      bytes.readUInt32LE(8) !== 3 || bytes.readUInt32LE(12) !== VOCAB ||
      bytes.readUInt32LE(16) !== CONTEXT) fail("invalid mixed pack");
  const packCount = bytes.readUInt32LE(20);
  const groupCount = bytes.readUInt32LE(72);
  const tokenStart = 76 + (groupCount + 1) * 4;
  const classStart = tokenStart + packCount * (CONTEXT + 1) * 2;
  if (classStart + packCount * CONTEXT !== bytes.length)
    fail("mixed pack length changed");
  return { bytes, packCount, groupCount, tokenStart };
}

function buildFamilies(vocabulary) {
  if (vocabulary.schemaVersion !== "braid.state-target-vocabulary/v2" ||
      vocabulary.entries.length !== HEAD_VOCAB) fail("target vocabulary changed");
  const byFamily = new Map();
  const byKey = new Map();
  for (const entry of vocabulary.entries) {
    if (entry.id !== byKey.size) fail("target vocabulary IDs are not dense");
    if (!byFamily.has(entry.state_family)) byFamily.set(entry.state_family, []);
    byFamily.get(entry.state_family).push(entry.id);
    byKey.set(`${entry.state_family}\0${entry.state}`, entry.id);
  }
  const names = [...byFamily.keys()].sort();
  const familyByName = new Map(names.map((name, index) => [name, index]));
  const offsets = [0];
  const tags = [];
  for (const name of names) {
    const values = byFamily.get(name).sort((a, b) => a - b);
    tags.push(...values);
    offsets.push(tags.length);
  }
  if (tags.length !== HEAD_VOCAB) fail("families do not cover target vocabulary");
  return { names, familyByName, byFamily, byKey, offsets, tags };
}

function competitiveEvents(row, position, families) {
  return row.stateTargets.flatMap(target => {
    const values = families.byFamily.get(target.state_family);
    const tag = families.byKey.get(`${target.state_family}\0${target.state}`);
    if (!values || tag === undefined) fail(`unknown target in ${row.id}`);
    if (values.length < 2) return [];
    return [{ position, tag,
      family: families.familyByName.get(target.state_family), reserved: 0 }];
  });
}

function writeEvents(descriptor, events) {
  const bytes = Buffer.alloc(events.length * 8);
  events.forEach((event, index) => {
    bytes.writeUInt16LE(event.position, index * 8);
    bytes.writeUInt16LE(event.tag, index * 8 + 2);
    bytes.writeUInt16LE(event.family, index * 8 + 4);
    bytes.writeUInt16LE(0, index * 8 + 6);
  });
  fs.writeSync(descriptor, bytes);
}

function writeTrainTargets(file, pack, rowsByHash, families) {
  const packOffsets = [0];
  const events = [];
  const orientations = { "correct-a": 0, "correct-b": 0, canonical: 0 };
  let matchedRecords = 0;
  let matchedPacks = 0;
  let rawTargets = 0;
  for (let packIndex = 0; packIndex < pack.packCount; packIndex++) {
    const base = pack.tokenStart + packIndex * (CONTEXT + 1) * 2;
    let cursor = 1;
    let matchedThisPack = false;
    while (cursor <= CONTEXT) {
      while (cursor <= CONTEXT &&
             pack.bytes.readUInt16LE(base + cursor * 2) === DOCUMENT_TOKEN)
        cursor++;
      if (cursor > CONTEXT) break;
      const start = cursor;
      const tokens = [];
      while (cursor <= CONTEXT) {
        const token = pack.bytes.readUInt16LE(base + cursor * 2);
        if (token === DOCUMENT_TOKEN) break;
        tokens.push(token);
        cursor++;
      }
      const candidates = rowsByHash.get(tokenIdsHash(tokens));
      if (candidates) {
        const first = candidates[0];
        for (const candidate of candidates) {
          if (candidate.view.inputPositions !== first.view.inputPositions ||
              candidate.stateTargetSha256 !== first.stateTargetSha256)
            fail("duplicate token identity has different state semantics");
        }
        const position = start + first.view.inputPositions - 1;
        if (position >= CONTEXT) fail(`state boundary exceeds pack: ${first.id}`);
        events.push(...competitiveEvents(first, position, families));
        rawTargets += first.stateTargets.length;
        orientations[first.orientation]++;
        matchedRecords++;
        matchedThisPack = true;
      }
    }
    if (matchedThisPack) matchedPacks++;
    packOffsets.push(events.length);
  }
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeSync(descriptor, AUX_MAGIC);
    fs.writeSync(descriptor, u32([1, HEAD_VOCAB, CONTEXT, pack.packCount,
      events.length, families.names.length]));
    fs.writeSync(descriptor, u32(packOffsets));
    fs.writeSync(descriptor, u32(families.offsets));
    fs.writeSync(descriptor, u16(families.tags));
    writeEvents(descriptor, events);
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), packs: pack.packCount, matched_packs: matchedPacks,
    matched_records: matchedRecords, raw_state_targets: rawTargets,
    competitive_state_targets: events.length, orientations };
}

function parseCompletion(file, rows) {
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 8).equals(COMPLETION_MAGIC) ||
      bytes.readUInt32LE(8) !== 1 || bytes.readUInt32LE(12) !== VOCAB ||
      bytes.readUInt32LE(16) !== CONTEXT ||
      bytes.readUInt32LE(20) !== rows.length) fail("completion input changed");
  const records = [];
  let cursor = 24;
  rows.forEach(row => {
    const tokenCount = bytes.readUInt32LE(cursor);
    const targetStart = bytes.readUInt32LE(cursor + 4);
    const targetCount = bytes.readUInt32LE(cursor + 8);
    const label = bytes.readUInt32LE(cursor + 12);
    cursor += 16;
    const tokens = [];
    for (let index = 0; index < tokenCount; index++)
      tokens.push(bytes.readUInt16LE(cursor + index * 2));
    cursor += tokenCount * 2;
    if (tokenCount !== row.view.tokenCount ||
        targetStart !== row.view.targetSpan.start ||
        targetCount !== row.view.targetSpan.end - row.view.targetSpan.start ||
        label !== 0 || tokenIdsHash(tokens) !== row.view.tokenIdsSha256)
      fail(`completion identity changed: ${row.id}`);
    records.push({ row, tokens });
  });
  if (cursor !== bytes.length) fail("completion input has trailing bytes");
  return records;
}

function writeEval(file, records, families) {
  const prepared = records.map(({ row, tokens }) => ({ row, tokens,
    events: competitiveEvents(row, row.view.inputPositions - 1, families) }));
  const targetCount = prepared.reduce((sum, value) => sum + value.events.length, 0);
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeSync(descriptor, EVAL_MAGIC);
    fs.writeSync(descriptor, u32([1, HEAD_VOCAB, CONTEXT, prepared.length,
      targetCount, families.names.length]));
    fs.writeSync(descriptor, u32(families.offsets));
    fs.writeSync(descriptor, u16(families.tags));
    for (const value of prepared) {
      fs.writeSync(descriptor, u32([value.tokens.length,
        value.row.view.inputPositions, value.events.length]));
      fs.writeSync(descriptor, u16(value.tokens));
      writeEvents(descriptor, value.events);
    }
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), records: prepared.length,
    competitive_state_targets: targetCount };
}

function selfTest() {
  const vocabulary = { schemaVersion: "braid.state-target-vocabulary/v2",
    entries: Array.from({ length: HEAD_VOCAB }, (_, id) => ({ id,
      state: String(id), state_family: id < 2 ? "pair" : `single-${id}` })) };
  const families = buildFamilies(vocabulary);
  assert.equal(families.tags.length, HEAD_VOCAB);
  assert.equal(competitiveEvents({ id: "x", stateTargets: [
    { state: "1", state_family: "pair" },
    { state: "2", state_family: "single-2" },
  ] }, 3, families).length, 1);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c52-target-"));
  fs.rmSync(directory, { recursive: true });
  process.stdout.write("ZERO.5 C5.2 target importer self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const release = path.resolve(option("--release"));
  const mixedPack = path.resolve(option("--mixed-pack"));
  const c51Import = path.resolve(option("--c51-import"));
  const out = path.resolve(option("--out"));
  if (fs.existsSync(out)) fail(`output already exists: ${out}`);
  const verified = {};
  for (const [relative, expected] of Object.entries(RELEASE_HASHES))
    verified[relative] = requireArtifact(path.join(release, relative), expected,
      `C5.2 ${relative}`);
  const releaseJson = JSON.parse(fs.readFileSync(path.join(release,
    "release.json")));
  if (releaseJson.releaseId !== RELEASE_ID) fail("C5.2 release changed");
  const receiptPath = path.join(c51Import, "import.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  if (receipt.schema !== "zero.c51_statebridge_import.v1" ||
      receipt.release.id !== RELEASE_ID || receipt.test.content_present !== false)
    fail("C5.1 verified import changed");
  const observedMixed = artifact(mixedPack);
  if (observedMixed.sha256 !== receipt.outputs.primary.sha256)
    fail("mixed pack does not match the C5.1 receipt");
  const vocabulary = JSON.parse(fs.readFileSync(path.join(release,
    "state-target-vocabulary.json")));
  const families = buildFamilies(vocabulary);
  const trainRows = readJsonl(path.join(release, "data/text/train.jsonl"));
  const rowsByHash = new Map();
  for (const row of trainRows) {
    if (!rowsByHash.has(row.view.tokenIdsSha256))
      rowsByHash.set(row.view.tokenIdsSha256, []);
    rowsByHash.get(row.view.tokenIdsSha256).push(row);
  }
  fs.mkdirSync(out, { recursive: true });
  const primary = writeTrainTargets(path.join(out, "train.targets.z5aux"),
    parsePack(mixedPack), rowsByHash, families);
  if (primary.packs !== receipt.outputs.primary.packs ||
      primary.matched_packs !== receipt.mixture.c5_packs ||
      primary.matched_records !== receipt.mixture.c5_records ||
      primary.orientations["correct-a"] !==
        primary.orientations["correct-b"]) fail("C5.2 target alignment changed");
  const validationRows = readJsonl(path.join(release,
    "data/text/validation.jsonl"));
  const sources = [
    ["c52.next-state.validation.completion-eval.bin",
      validationRows.filter(row => row.task === "next-state")],
    ["c52.choice-a.validation.completion-eval.bin",
      validationRows.filter(row => row.orientation === "correct-a")],
    ["c52.choice-b.validation.completion-eval.bin",
      validationRows.filter(row => row.orientation === "correct-b")],
  ];
  const records = sources.flatMap(([name, rows]) =>
    parseCompletion(path.join(c51Import, name), rows));
  const evaluation = writeEval(path.join(out, "validation.targets.z5aueval"),
    records, families);
  const output = { schema: "zero.c52_target_import.v1",
    release_id: RELEASE_ID, source_import: { ...artifact(receiptPath),
      mixed_pack: observedMixed }, target_vocabulary: {
      id: vocabulary.id, families: families.names.length,
      entries: vocabulary.entries.length }, outputs: { primary, evaluation },
    balance: { choice_a_records: primary.orientations["correct-a"],
      choice_b_records: primary.orientations["correct-b"], exact: true },
    policy: { factorized_family_softmax: true,
      singleton_families_excluded_from_loss: true,
      prompt_boundary_hidden_state: true, symbolic_serialization: false },
    test: { content_present: false, parsed: false, tokenized: false,
      packed: false, scored: false, metrics_opened: false }, verified };
  fs.writeFileSync(path.join(out, "import.json"),
    JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(output) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ────────────────────────────────────────────────────────────────────
 * Preflight: verify the evaluator read-set and parse validity for $0
 *
 * Walks every file in the evaluator's complete read set by hash and
 * parses every record in every evaluation binary against the actual
 * parser rules used by the C6.1 trainer (zero5_c61_bottleneck_lm.c) and
 * the base C3.2 trainer (zero5_c32_lm.c).  Supports a --trace mode over
 * fixture data so the whole pipeline is executable for free before it
 * is executable for money.
 * ──────────────────────────────────────────────────────────────────── */

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = file => {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
};

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  const wanted = typeof expected === "string" ? expected : expected.sha256;
  if (observed.sha256 !== wanted ||
      (typeof expected === "object" && expected.bytes !== undefined &&
       observed.bytes !== expected.bytes)) fail(`${label} changed`);
  return observed;
}

/* ── Binary format constants (must mirror the C sources exactly) ── */

const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]); // Z5CEV1
const SPAN_CHOICE_MAGIC = Buffer.from([90, 53, 83, 67, 86, 49, 0, 0]); // Z5SCV1
const PACK_MAGIC_V2 = Buffer.from([90, 53, 80, 75, 86, 50, 0, 0]); // Z5PKV2
const PACK_MAGIC_V3 = Buffer.from([90, 53, 80, 75, 86, 51, 0, 0]); // Z5PKV3
const AUX_TRAIN_MAGIC = Buffer.from([90, 53, 65, 85, 88, 49, 0, 0]); // Z5AUX1
const AUX_EVAL_MAGIC = Buffer.from([90, 53, 65, 85, 69, 86, 49, 0]); // Z5AUEV1

/* ── Little-endian readers (must mirror completion_read_u32/u16 etc.) ── */

function readU32(bytes, offset) {
  assert(offset + 4 <= bytes.length,
    "unexpected end of file while reading u32");
  return bytes.readUInt32LE(offset);
}

function readU64(bytes, offset) {
  assert(offset + 8 <= bytes.length,
    "unexpected end of file while reading u64");
  return bytes.readBigUInt64LE(offset);
}

function readU16(bytes, offset) {
  assert(offset + 2 <= bytes.length,
    "unexpected end of file while reading u16");
  return bytes.readUInt16LE(offset);
}

/* ── Parse-validity scanners — one per evaluation binary format ── */

/* Completion evaluation (zero.c3_completion_eval.v1):
 *   magic[8], version, vocab, context, record_count
 *   per record: token_count, target_start, target_count, reserved,
 *               token_count * u16 tokens
 *
 * The corrected C6.1 parser (and the base C3.2 parser) accept
 * target_start == 0 whenever token_count < context + 1.  Only a
 * full-context record with a zero start underflows and is rejected. */
function scanCompletion(bytes, { vocab, context }, label, trace) {
  assert(bytes.subarray(0, 8).equals(COMPLETION_MAGIC),
    `${label}: bad completion magic`);
  const version = readU32(bytes, 8);
  const declaredVocab = readU32(bytes, 12);
  const declaredContext = readU32(bytes, 16);
  const recordCount = readU32(bytes, 20);
  assert(version === 1, `${label}: unsupported completion version ${version}`);
  assert(declaredVocab === vocab,
    `${label}: vocab ${declaredVocab} != model ${vocab}`);
  assert(declaredContext === context,
    `${label}: context ${declaredContext} != model ${context}`);
  assert(recordCount > 0, `${label}: zero completion records`);
  let cursor = 24;
  let zeroStartRecords = 0;
  let firstZeroStart = -1;
  for (let record = 0; record < recordCount; record++) {
    const tokenCount = readU32(bytes, cursor);
    const targetStart = readU32(bytes, cursor + 4);
    const targetCount = readU32(bytes, cursor + 8);
    const reserved = readU32(bytes, cursor + 12);
    cursor += 16;
    assert(tokenCount >= 2, `${label} record ${record}: token_count < 2`);
    assert(tokenCount <= context + 1,
      `${label} record ${record}: token_count ${tokenCount} > context+1 ${context + 1}`);
    /* Corrected condition: reject zero-start ONLY for full-context records */
    assert(!(targetStart === 0 && tokenCount === context + 1),
      `${label} record ${record}: target_start == 0 with full context`);
    assert(targetCount > 0, `${label} record ${record}: target_count == 0`);
    assert(targetStart + targetCount <= tokenCount,
      `${label} record ${record}: target span exceeds token_count`);
    assert(reserved === 0, `${label} record ${record}: reserved != 0`);
    for (let token = 0; token < tokenCount; token++) {
      const value = readU16(bytes, cursor + token * 2);
      assert(value < vocab, `${label} record ${record}: token ${token} >= vocab`);
    }
    cursor += tokenCount * 2;
    if (targetStart === 0) {
      zeroStartRecords++;
      if (firstZeroStart < 0) firstZeroStart = record;
    }
  }
  assert(cursor === bytes.length, `${label}: trailing bytes after ${recordCount} records`);
  return { records: recordCount, zero_start_records: zeroStartRecords,
    first_zero_start: firstZeroStart,
    trace: trace ? { label, records: recordCount,
      zero_start_records: zeroStartRecords } : null };
}

/* Span-choice evaluation (zero.c42_span_choice_eval.v1):
 *   magic[8], version, vocab, context, pair_count
 *   per pair, per orientation (2):
 *     token_count, correct_start, correct_count,
 *     alternative_start, alternative_count, label,
 *     token_count * u16 tokens
 *
 * The span-choice parser requires start != 0 for both correct and
 * alternative spans (unlike the completion parser which allows it). */
function scanSpanChoice(bytes, { vocab, context }, label, trace) {
  assert(bytes.subarray(0, 8).equals(SPAN_CHOICE_MAGIC),
    `${label}: bad span-choice magic`);
  const version = readU32(bytes, 8);
  const declaredVocab = readU32(bytes, 12);
  const declaredContext = readU32(bytes, 16);
  const pairCount = readU32(bytes, 20);
  assert(version === 1, `${label}: unsupported span-choice version ${version}`);
  assert(declaredVocab === vocab,
    `${label}: vocab ${declaredVocab} != model ${vocab}`);
  assert(declaredContext === context,
    `${label}: context ${declaredContext} != model ${context}`);
  assert(pairCount > 0, `${label}: zero span-choice pairs`);
  let cursor = 24;
  for (let pair = 0; pair < pairCount; pair++) {
    const labels = [];
    for (let orientation = 0; orientation < 2; orientation++) {
      const tokenCount = readU32(bytes, cursor);
      const correctStart = readU32(bytes, cursor + 4);
      const correctCount = readU32(bytes, cursor + 8);
      const alternativeStart = readU32(bytes, cursor + 12);
      const alternativeCount = readU32(bytes, cursor + 16);
      const label = readU32(bytes, cursor + 20);
      cursor += 24;
      assert(tokenCount >= 2,
        `${label} pair ${pair} orient ${orientation}: token_count < 2`);
      assert(tokenCount <= context + 1,
        `${label} pair ${pair} orient ${orientation}: token_count > context+1`);
      assert(correctStart !== 0,
        `${label} pair ${pair} orient ${orientation}: correct_start == 0`);
      assert(correctCount > 0,
        `${label} pair ${pair} orient ${orientation}: correct_count == 0`);
      assert(correctStart + correctCount <= tokenCount,
        `${label} pair ${pair} orient ${orientation}: correct span overflow`);
      assert(alternativeStart !== 0,
        `${label} pair ${pair} orient ${orientation}: alternative_start == 0`);
      assert(alternativeCount > 0,
        `${label} pair ${pair} orient ${orientation}: alternative_count == 0`);
      assert(alternativeStart + alternativeCount <= tokenCount,
        `${label} pair ${pair} orient ${orientation}: alternative span overflow`);
      assert(label <= 1,
        `${label} pair ${pair} orient ${orientation}: label > 1`);
      for (let token = 0; token < tokenCount; token++) {
        const value = readU16(bytes, cursor + token * 2);
        assert(value < vocab,
          `${label} pair ${pair} orient ${orientation}: token >= vocab`);
      }
      cursor += tokenCount * 2;
      labels.push(label);
    }
    assert(labels[0] !== labels[1],
      `${label} pair ${pair}: labels not mirrored`);
  }
  assert(cursor === bytes.length, `${label}: trailing bytes after ${pairCount} pairs`);
  return { pairs: pairCount, records: pairCount * 2,
    trace: trace ? { label, pairs: pairCount } : null };
}

/* Packed evaluation set (Z5PKV2/V3):
 *   magic[8], version, vocab, context, pack_count,
 *   record_count, active_targets, answer_targets,
 *   answer_targets_by_task[3],
 *   [V3: update_count, (update_count+1) * u32 offsets],
 *   pack_count * (context+1) * u16 tokens,
 *   pack_count * context * u8 target_classes
 *
 * Validates accounting (active/answer targets match the class scan). */
function scanPacked(bytes, { vocab, context }, label, trace) {
  const magic = bytes.subarray(0, 8);
  const isV2 = magic.equals(PACK_MAGIC_V2);
  const isV3 = magic.equals(PACK_MAGIC_V3);
  assert(isV2 || isV3, `${label}: bad packed-set magic`);
  const version = readU32(bytes, 8);
  const declaredVocab = readU32(bytes, 12);
  const declaredContext = readU32(bytes, 16);
  const packCount = readU32(bytes, 20);
  const recordCount = Number(readU64(bytes, 24));
  const activeTargets = Number(readU64(bytes, 32));
  const answerTargets = Number(readU64(bytes, 40));
  const answerByTask = [Number(readU64(bytes, 48)),
    Number(readU64(bytes, 56)), Number(readU64(bytes, 64))];
  assert((isV2 && version === 2) || (isV3 && version === 3),
    `${label}: version ${version} / magic mismatch`);
  assert(declaredVocab === vocab,
    `${label}: vocab ${declaredVocab} != model ${vocab}`);
  assert(declaredContext === context,
    `${label}: context ${declaredContext} != model ${context}`);
  assert(packCount > 0, `${label}: zero packs`);
  assert(recordCount > 0, `${label}: zero records`);
  assert(activeTargets > 0, `${label}: zero active targets`);
  assert(answerTargets <= activeTargets,
    `${label}: answer_targets > active_targets`);
  let cursor = 72;
  if (version === 3) {
    const updateCount = readU32(bytes, cursor);
    cursor += 4;
    assert(updateCount > 0, `${label}: zero update groups`);
    assert(updateCount <= packCount,
      `${label}: update_count > pack_count`);
    const offsets = [];
    for (let update = 0; update <= updateCount; update++) {
      const offset = readU32(bytes, cursor);
      cursor += 4;
      offsets.push(offset);
      if (update === 0) assert(offset === 0, `${label}: first update offset != 0`);
      else assert(offset > offsets[update - 1],
        `${label}: update offsets not strictly increasing`);
      assert(offset <= packCount, `${label}: update offset > pack_count`);
    }
    assert(offsets[updateCount] === packCount,
      `${label}: update offsets do not consume all packs`);
  }
  const tokenTotal = packCount * (context + 1);
  const classTotal = packCount * context;
  assert(cursor + tokenTotal * 2 + classTotal === bytes.length,
    `${label}: packed-set length mismatch`);
  for (let index = 0; index < tokenTotal; index++) {
    const value = readU16(bytes, cursor + index * 2);
    assert(value < vocab, `${label}: packed token ${index} >= vocab`);
  }
  cursor += tokenTotal * 2;
  let observedActive = 0, observedAnswers = 0;
  const observedByTask = [0, 0, 0];
  for (let index = 0; index < classTotal; index++) {
    const value = bytes[cursor + index];
    assert(value <= 4, `${label}: target class ${value} > 4`);
    if (value !== 0) observedActive++;
    if (value >= 2) {
      observedAnswers++;
      observedByTask[value - 2]++;
    }
  }
  cursor += classTotal;
  assert(cursor === bytes.length, `${label}: trailing bytes`);
  assert(observedActive === activeTargets,
    `${label}: active_targets ${observedActive} != declared ${activeTargets}`);
  assert(observedAnswers === answerTargets,
    `${label}: answer_targets ${observedAnswers} != declared ${answerTargets}`);
  assert(observedByTask[0] === answerByTask[0],
    `${label}: answer_by_task[0] mismatch`);
  assert(observedByTask[1] === answerByTask[1],
    `${label}: answer_by_task[1] mismatch`);
  assert(observedByTask[2] === answerByTask[2],
    `${label}: answer_by_task[2] mismatch`);
  assert(answerTargets === answerByTask[0] + answerByTask[1] + answerByTask[2],
    `${label}: answer_by_task sum != answer_targets`);
  return { pack_count: packCount, record_count: recordCount,
    active_targets: activeTargets, answer_targets: answerTargets,
    trace: trace ? { label, pack_count: packCount } : null };
}

/* Auxiliary evaluation (zero.c61_state_eval.v1 / Z5AUEV1):
 *   magic[8], version, vocab, context, record_count, target_count,
 *   family_count,
 *   (family_count+1) * u32 family_offsets,
 *   vocab * u16 family_tags,
 *   per record: token_count, input_positions, event_count,
 *               token_count * u16 tokens,
 *               event_count * 8 bytes (position u16, tag u16,
 *                                       family u16, reserved u16)
 *
 * The C6.1 aux_eval_records parser validates:
 *   token_count > 0 && <= context
 *   input_positions > 0 && <= token_count
 *   event_count > 0
 *   per event: position < context, tag < vocab, family < family_count,
 *              reserved == 0
 *   total events == target_count, no trailing bytes */
function scanAuxEval(bytes, { vocab, context }, label, trace) {
  assert(bytes.subarray(0, 8).equals(AUX_EVAL_MAGIC),
    `${label}: bad aux-eval magic`);
  const version = readU32(bytes, 8);
  const declaredVocab = readU32(bytes, 12);
  const declaredContext = readU32(bytes, 16);
  const recordCount = readU32(bytes, 20);
  const targetCount = readU32(bytes, 24);
  const familyCount = readU32(bytes, 28);
  assert(version === 1, `${label}: unsupported aux-eval version ${version}`);
  assert(declaredVocab === vocab,
    `${label}: vocab ${declaredVocab} != model ${vocab}`);
  assert(declaredContext === context,
    `${label}: context ${declaredContext} != model ${context}`);
  assert(recordCount > 0, `${label}: zero aux-eval records`);
  assert(targetCount > 0, `${label}: zero aux-eval targets`);
  assert(familyCount > 0, `${label}: zero aux-eval families`);
  assert(familyCount <= vocab,
    `${label}: family_count > vocab`);
  let cursor = 32;
  const familyOffsets = [];
  for (let family = 0; family <= familyCount; family++) {
    const offset = readU32(bytes, cursor);
    cursor += 4;
    familyOffsets.push(offset);
    if (family === 0) assert(offset === 0, `${label}: first family offset != 0`);
    else assert(offset > familyOffsets[family - 1],
      `${label}: family offsets not strictly increasing`);
    assert(offset <= vocab, `${label}: family offset > vocab`);
  }
  assert(familyOffsets[familyCount] === vocab,
    `${label}: families do not cover the vocabulary`);
  const familyTags = [];
  for (let tag = 0; tag < vocab; tag++) {
    const value = readU16(bytes, cursor);
    cursor += 2;
    familyTags.push(value);
    assert(value < vocab, `${label}: family tag ${value} >= vocab`);
  }
  let totalEvents = 0;
  for (let record = 0; record < recordCount; record++) {
    const tokenCount = readU32(bytes, cursor);
    const inputPositions = readU32(bytes, cursor + 4);
    const eventCount = readU32(bytes, cursor + 8);
    cursor += 12;
    assert(tokenCount > 0, `${label} record ${record}: token_count == 0`);
    assert(tokenCount <= context,
      `${label} record ${record}: token_count > context`);
    assert(inputPositions > 0,
      `${label} record ${record}: input_positions == 0`);
    assert(inputPositions <= tokenCount,
      `${label} record ${record}: input_positions > token_count`);
    assert(eventCount > 0, `${label} record ${record}: event_count == 0`);
    for (let token = 0; token < tokenCount; token++) {
      const value = readU16(bytes, cursor + token * 2);
      assert(value < vocab, `${label} record ${record}: token >= vocab`);
    }
    cursor += tokenCount * 2;
    for (let event = 0; event < eventCount; event++) {
      const eventPos = readU16(bytes, cursor);
      const eventTag = readU16(bytes, cursor + 2);
      const eventFamily = readU16(bytes, cursor + 4);
      const eventReserved = readU16(bytes, cursor + 6);
      cursor += 8;
      const position = inputPositions - 1;
      assert(position < context,
        `${label} record ${record} event ${event}: position >= context`);
      assert(eventTag < vocab,
        `${label} record ${record} event ${event}: tag >= vocab`);
      assert(eventFamily < familyCount,
        `${label} record ${record} event ${event}: family >= family_count`);
      assert(eventReserved === 0,
        `${label} record ${record} event ${event}: reserved != 0`);
    }
    totalEvents += eventCount;
  }
  assert(totalEvents === targetCount,
    `${label}: total events ${totalEvents} != target_count ${targetCount}`);
  assert(cursor === bytes.length, `${label}: trailing bytes`);
  return { records: recordCount, events: totalEvents,
    families: familyCount,
    trace: trace ? { label, records: recordCount, events: totalEvents } : null };
}

/* Auxiliary training targets (Z5AUX1):
 *   magic[8], version, vocab, context, pack_count, target_count,
 *   family_count,
 *   (pack_count+1) * u32 pack_offsets,
 *   (family_count+1) * u32 family_offsets,
 *   vocab * u16 family_tags,
 *   target_count * 8 bytes (position u16, tag u16, family u16, reserved u16) */
function scanAuxTrain(bytes, { vocab, context }, label, trace) {
  assert(bytes.subarray(0, 8).equals(AUX_TRAIN_MAGIC),
    `${label}: bad aux-train magic`);
  const version = readU32(bytes, 8);
  const declaredVocab = readU32(bytes, 12);
  const declaredContext = readU32(bytes, 16);
  const packCount = readU32(bytes, 20);
  const targetCount = readU32(bytes, 24);
  const familyCount = readU32(bytes, 28);
  assert(version === 1, `${label}: unsupported aux-train version ${version}`);
  assert(declaredVocab === vocab,
    `${label}: vocab ${declaredVocab} != model ${vocab}`);
  assert(declaredContext === context,
    `${label}: context ${declaredContext} != model ${context}`);
  assert(packCount > 0, `${label}: zero aux-train packs`);
  assert(targetCount > 0, `${label}: zero aux-train targets`);
  assert(familyCount > 0 && familyCount <= vocab,
    `${label}: invalid aux-train family_count`);
  let cursor = 32;
  const packOffsets = [];
  for (let pack = 0; pack <= packCount; pack++) {
    const offset = readU32(bytes, cursor);
    cursor += 4;
    packOffsets.push(offset);
    if (pack === 0) assert(offset === 0, `${label}: first pack offset != 0`);
    else assert(offset >= packOffsets[pack - 1],
      `${label}: pack offsets not monotonic`);
    assert(offset <= targetCount, `${label}: pack offset > target_count`);
  }
  assert(packOffsets[packCount] === targetCount,
    `${label}: pack offsets do not consume all targets`);
  const familyOffsets = [];
  for (let family = 0; family <= familyCount; family++) {
    const offset = readU32(bytes, cursor);
    cursor += 4;
    familyOffsets.push(offset);
    if (family === 0) assert(offset === 0, `${label}: first family offset != 0`);
    else assert(offset > familyOffsets[family - 1],
      `${label}: family offsets not strictly increasing`);
    assert(offset <= vocab, `${label}: family offset > vocab`);
  }
  assert(familyOffsets[familyCount] === vocab,
    `${label}: families do not cover the vocabulary`);
  for (let tag = 0; tag < vocab; tag++) {
    const value = readU16(bytes, cursor);
    cursor += 2;
    assert(value < vocab, `${label}: family tag ${value} >= vocab`);
  }
  for (let event = 0; event < targetCount; event++) {
    const eventPos = readU16(bytes, cursor);
    const eventTag = readU16(bytes, cursor + 2);
    const eventFamily = readU16(bytes, cursor + 4);
    const eventReserved = readU16(bytes, cursor + 6);
    cursor += 8;
    assert(eventPos < context, `${label} event ${event}: position >= context`);
    assert(eventTag < vocab, `${label} event ${event}: tag >= vocab`);
    assert(eventFamily < familyCount,
      `${label} event ${event}: family >= family_count`);
    assert(eventReserved === 0, `${label} event ${event}: reserved != 0`);
  }
  assert(cursor === bytes.length, `${label}: trailing bytes`);
  return { packs: packCount, targets: targetCount, families: familyCount,
    trace: trace ? { label, packs: packCount, targets: targetCount } : null };
}

/* ── Trace mode: generate synthetic fixture binaries and scan them ── */

function writeU32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

function writeU64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function writeU16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function traceFixtures() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),
    "zero-c61-preflight-trace-"));
  const model = { vocab: 512, context: 512 };
  const parts = [];
  try {
    // Completion fixture with a zero-start record (valid: token_count < context+1)
    {
      const tokens = [65, 66, 67];
      const tokenBytes = Buffer.concat(tokens.map(writeU16));
      const body = Buffer.concat([
        COMPLETION_MAGIC,
        writeU32(1), writeU32(model.vocab), writeU32(model.context),
        writeU32(1),
        writeU32(tokens.length), writeU32(0), writeU32(1), writeU32(0),
        tokenBytes,
      ]);
      const file = path.join(directory, "trace.completion-eval.bin");
      fs.writeFileSync(file, body);
      parts.push({ file, scan: () =>
        scanCompletion(fs.readFileSync(file), model, "trace-completion", true) });
    }
    // Span-choice fixture (one pair, mirrored labels)
    {
      const tokens = [65, 66, 67, 68];
      const tokenBytes = Buffer.concat(tokens.map(writeU16));
      const record = Buffer.concat([
        writeU32(tokens.length),
        writeU32(1), writeU32(2), writeU32(2), writeU32(1), writeU32(0),
        tokenBytes,
      ]);
      const body = Buffer.concat([
        SPAN_CHOICE_MAGIC,
        writeU32(1), writeU32(model.vocab), writeU32(model.context),
        writeU32(1),
        record, // orientation 0 (label 0)
        Buffer.concat([writeU32(tokens.length),
          writeU32(1), writeU32(2), writeU32(2), writeU32(1), writeU32(1),
          tokenBytes]), // orientation 1 (label 1)
      ]);
      const file = path.join(directory, "trace.span-choice-eval.bin");
      fs.writeFileSync(file, body);
      parts.push({ file, scan: () =>
        scanSpanChoice(fs.readFileSync(file), model, "trace-span-choice", true) });
    }
    // Packed-set fixture (V3, 1 pack, 1 active target)
    {
      const tokenTotal = 1 * (model.context + 1);
      const classTotal = 1 * model.context;
      const tokenBytes = Buffer.alloc(tokenTotal * 2);
      for (let i = 0; i < tokenTotal; i++) tokenBytes.writeUInt16LE(1, i * 2);
      const classBytes = Buffer.alloc(classTotal);
      classBytes[0] = 2; // one answer target (task 0)
      const header = Buffer.concat([
        PACK_MAGIC_V3, writeU32(3), writeU32(model.vocab),
        writeU32(model.context), writeU32(1), writeU64(1),
        writeU64(1), writeU64(1),
        writeU64(1), writeU64(0), writeU64(0),
        writeU32(1), writeU32(0), writeU32(1),
      ]);
      const body = Buffer.concat([header, tokenBytes, classBytes]);
      const file = path.join(directory, "trace.packed-eval.z5pack");
      fs.writeFileSync(file, body);
      parts.push({ file, scan: () =>
        scanPacked(fs.readFileSync(file), model, "trace-packed", true) });
    }
    // Aux-eval fixture
    {
      const familyCount = 1;
      const familyOffsets = [0, model.vocab];
      const familyTags = Buffer.alloc(model.vocab * 2);
      for (let i = 0; i < model.vocab; i++) familyTags.writeUInt16LE(i, i * 2);
      const tokenCount = 3;
      const tokenBytes = Buffer.concat([65, 66, 67].map(writeU16));
      const eventBytes = Buffer.concat([
        writeU16(0), writeU16(0), writeU16(0), writeU16(0),
      ]);
      const record = Buffer.concat([
        writeU32(tokenCount), writeU32(1), writeU32(1),
        tokenBytes, eventBytes,
      ]);
      const body = Buffer.concat([
        AUX_EVAL_MAGIC, writeU32(1), writeU32(model.vocab),
        writeU32(model.context), writeU32(1), writeU32(1),
        writeU32(familyCount),
        ...familyOffsets.map(writeU32),
        familyTags,
        record,
      ]);
      const file = path.join(directory, "trace.aux-eval.z5aueval");
      fs.writeFileSync(file, body);
      parts.push({ file, scan: () =>
        scanAuxEval(fs.readFileSync(file), model, "trace-aux-eval", true) });
    }
    const results = parts.map(part => part.scan());
    return results;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/* ── Self-test ── */

function selfTest() {
  // Completion: zero-start with short token_count must pass
  {
    const model = { vocab: 512, context: 512 };
    const tokens = [65, 66, 67];
    const tokenBytes = Buffer.concat(tokens.map(writeU16));
    const body = Buffer.concat([
      COMPLETION_MAGIC,
      writeU32(1), writeU32(model.vocab), writeU32(model.context), writeU32(1),
      writeU32(tokens.length), writeU32(0), writeU32(1), writeU32(0),
      tokenBytes,
    ]);
    const result = scanCompletion(body, model, "selftest-completion", false);
    assert.equal(result.records, 1);
    assert.equal(result.zero_start_records, 1);
  }
  // Completion: zero-start with full-context must fail
  {
    const model = { vocab: 512, context: 4 };
    const tokenCount = 5; // context + 1
    const tokenBytes = Buffer.alloc(tokenCount * 2);
    for (let i = 0; i < tokenCount; i++) tokenBytes.writeUInt16LE(1, i * 2);
    const body = Buffer.concat([
      COMPLETION_MAGIC,
      writeU32(1), writeU32(model.vocab), writeU32(model.context),
      writeU32(1),
      writeU32(tokenCount), writeU32(0), writeU32(1), writeU32(0),
      tokenBytes,
    ]);
    assert.throws(() => scanCompletion(body, model, "selftest-bad", false),
      /target_start == 0 with full context/u);
  }
  // Trace fixtures must all scan cleanly
  const traceResults = traceFixtures();
  assert.equal(traceResults.length, 4);
  assert.equal(traceResults[0].trace.label, "trace-completion");
  assert.equal(traceResults[0].trace.zero_start_records, 1);
  process.stdout.write(
    "ZERO.5 C6.1 evaluator preflight self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

if (process.argv.includes("--trace")) {
  const results = traceFixtures();
  process.stdout.write(JSON.stringify({
    schema: "zero.c61_evaluator_preflight_trace.v1",
    fixtures_scanned: results.length,
    results,
  }, null, 2) + "\n");
  process.exit(0);
}

/* ── Main: walk the evaluator read-set and parse every record ── */

try {
  const recoveryContractPath = option("--recovery-contract");
  const recoveryContract = recoveryContractPath
    ? JSON.parse(fs.readFileSync(path.resolve(recoveryContractPath)))
    : null;
  if (recoveryContract &&
      recoveryContract.schema !== "zero.c61_evaluation_recovery_contract.v1")
    fail("wrong C6.1 evaluation recovery contract");
  const contractPath = path.resolve(option("--scientific-contract",
    option("--contract", recoveryContract?.source_training.scientific_contract ??
      "benchmarks/zero5-c61-shared-state-v1/contract.json")));
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  if (contract.schema !== "zero.c61_shared_state_contract.v1")
    fail("wrong C6.1 contract");
  if (recoveryContract && sha256(contractBytes) !==
      recoveryContract.source_training.scientific_contract_sha256)
    fail("source C6.1 scientific contract changed");

  const model = {
    vocab: contract.model.language_vocabulary,
    context: contract.model.context,
  };

  const targetImport = path.resolve(option("--target-import"));
  const c51Import = path.resolve(option("--c51-import"));
  const c43Import = path.resolve(option("--c43-import"));
  const controlResult = path.resolve(option("--control-result"));
  const checkpoint = option("--checkpoint");
  const bottleneckCheckpoint = option("--bottleneck-checkpoint");
  const trainingLog = option("--training-log");
  const baselineCheckpoint = option("--baseline-checkpoint");
  const tokenizer = option("--tokenizer");
  const atlasTrain = option("--atlas-train");
  const atlasValidation = option("--atlas-validation");
  const anchorTrain = option("--anchor-train");
  const anchorValidation = option("--anchor-validation");

  const verified = {};
  const parsed = {};
  const trace = process.argv.includes("--trace-scan");

  /* 1. Scientific contract + implementations (hash-bound) */
  verified.contract = artifact(contractPath);
  for (const name of ["trainer", "importer", "evaluator", "runner",
    "c51_evaluator"]) {
    requireArtifact(contract.implementation[name],
      contract.implementation[`${name}_sha256`], `frozen ${name}`);
    verified[`impl_${name}`] = artifact(contract.implementation[name]);
  }

  /* 2. C5.2 target import receipt + evaluation targets */
  const targetReceiptPath = path.join(targetImport, "import.json");
  requireArtifact(targetReceiptPath,
    contract.verified_target_import.receipt, "target import receipt");
  verified.target_receipt = artifact(targetReceiptPath);

  const auxEvalFile = path.join(targetImport, "validation.targets.z5aueval");
  requireArtifact(auxEvalFile, contract.verified_target_import.evaluation,
    "state validation");
  verified.aux_eval = artifact(auxEvalFile);
  parsed.aux_eval = scanAuxEval(fs.readFileSync(auxEvalFile), model,
    "validation.targets.z5aueval", trace);

  const auxTrainFile = path.join(targetImport, "train.targets.z5aux");
  requireArtifact(auxTrainFile, contract.verified_target_import.primary,
    "state training targets");
  verified.aux_train = artifact(auxTrainFile);
  parsed.aux_train = scanAuxTrain(fs.readFileSync(auxTrainFile), model,
    "train.targets.z5aux", trace);

  /* 3. C5.1 matched control result */
  requireArtifact(controlResult, contract.control.private_result_sha256,
    "C5.1 matched control result");
  verified.control_result = artifact(controlResult);

  /* 4. C5.1 import receipt + C5.2 completion-eval bins */
  const c51ContractPath = path.resolve(contract.control.c51_contract);
  requireArtifact(c51ContractPath, contract.control.c51_contract_sha256,
    "C5.1 contract");
  const c51Contract = JSON.parse(fs.readFileSync(c51ContractPath));
  verified.c51_contract = artifact(c51ContractPath);
  const c51ReceiptPath = path.join(c51Import, "import.json");
  requireArtifact(c51ReceiptPath, c51Contract.verified_import.receipt_sha256,
    "C5.1 import receipt");
  const c51Receipt = JSON.parse(fs.readFileSync(c51ReceiptPath));
  verified.c51_receipt = artifact(c51ReceiptPath);

  const c51CompletionFiles = {
    "c52.next-state": path.join(c51Import,
      "c52.next-state.validation.completion-eval.bin"),
    "c52.choice-a": path.join(c51Import,
      "c52.choice-a.validation.completion-eval.bin"),
    "c52.choice-b": path.join(c51Import,
      "c52.choice-b.validation.completion-eval.bin"),
  };
  for (const [name, file] of Object.entries(c51CompletionFiles)) {
    const receiptName = name.replace("c52.", "").replace("-", "_");
    requireArtifact(file, c51Receipt.outputs.evaluation[receiptName],
      `C5.2 ${name} completion-eval`);
    verified[`c51_${name}`] = artifact(file);
    parsed[`c51_${name}`] = scanCompletion(fs.readFileSync(file), model,
      `${name}.completion-eval`, trace);
  }

  /* 5. C4.3 import receipt + frozen validation bins */
  const c43ContractPath = path.resolve(c51Contract.control.contract_path);
  requireArtifact(c43ContractPath, c51Contract.control.contract_sha256,
    "C4.3 contract");
  const c43Contract = JSON.parse(fs.readFileSync(c43ContractPath));
  verified.c43_contract = artifact(c43ContractPath);
  const c43ReceiptPath = path.join(c43Import, "import.json");
  requireArtifact(c43ReceiptPath, c43Contract.verified_import.first_receipt_sha256,
    "C4.3 import receipt");
  verified.c43_receipt = artifact(c43ReceiptPath);

  const frozenDir = path.join(c43Import, "frozen-validation");
  const frozenFiles = {
    "validation.z5pack": path.join(frozenDir, "validation.z5pack"),
    "evidence-bundle.validation.z5pack":
      path.join(frozenDir, "evidence-bundle.validation.z5pack"),
    "cloze.validation.completion-eval.bin":
      path.join(frozenDir, "cloze.validation.completion-eval.bin"),
    "claim.validation.span-choice-eval.bin":
      path.join(frozenDir, "claim.validation.span-choice-eval.bin"),
    "retrieval.validation.span-choice-eval.bin":
      path.join(frozenDir, "retrieval.validation.span-choice-eval.bin"),
  };

  /* Verify frozen validation hashes from the hash-bound C4.3 contract */
  const fv = c43Contract.verified_import.frozen_validation;
  requireArtifact(frozenFiles["validation.z5pack"],
    { sha256: fv.combined_sha256 }, "frozen combined validation packs");
  requireArtifact(frozenFiles["evidence-bundle.validation.z5pack"],
    { sha256: fv.evidence_validation_sha256 },
    "frozen evidence validation packs");
  requireArtifact(frozenFiles["cloze.validation.completion-eval.bin"],
    { sha256: fv.cloze_completion_sha256 }, "frozen cloze evaluation");
  requireArtifact(frozenFiles["claim.validation.span-choice-eval.bin"],
    { sha256: fv.claim_span_choices_sha256 },
    "frozen claim span-choice evaluation");
  requireArtifact(frozenFiles["retrieval.validation.span-choice-eval.bin"],
    { sha256: fv.retrieval_span_choices_sha256 },
    "frozen retrieval span-choice evaluation");

  for (const [name, file] of Object.entries(frozenFiles)) {
    if (!fs.existsSync(file)) fail(`frozen validation file missing: ${file}`);
    verified[`frozen_${name}`] = artifact(file);
  }

  /* Parse every frozen evaluation bin */
  parsed.frozen_combined = scanPacked(
    fs.readFileSync(frozenFiles["validation.z5pack"]), model,
    "frozen validation.z5pack", trace);
  parsed.frozen_evidence = scanPacked(
    fs.readFileSync(frozenFiles["evidence-bundle.validation.z5pack"]), model,
    "frozen evidence-bundle.validation.z5pack", trace);
  parsed.frozen_cloze = scanCompletion(
    fs.readFileSync(frozenFiles["cloze.validation.completion-eval.bin"]), model,
    "frozen cloze.validation.completion-eval.bin", trace);
  parsed.frozen_claim = scanSpanChoice(
    fs.readFileSync(frozenFiles["claim.validation.span-choice-eval.bin"]), model,
    "frozen claim.validation.span-choice-eval.bin", trace);
  parsed.frozen_retrieval = scanSpanChoice(
    fs.readFileSync(frozenFiles["retrieval.validation.span-choice-eval.bin"]),
    model, "frozen retrieval.validation.span-choice-eval.bin", trace);

  /* 6. Checkpoint pair + training log (if provided) */
  if (checkpoint) {
    if (recoveryContract)
      requireArtifact(checkpoint, recoveryContract.source_training.checkpoint,
        "C6.1 checkpoint");
    verified.checkpoint = artifact(checkpoint);
    if (bottleneckCheckpoint) {
      if (recoveryContract)
        requireArtifact(bottleneckCheckpoint,
          recoveryContract.source_training.bottleneck,
          "C6.1 bottleneck checkpoint");
      verified.bottleneck_checkpoint = artifact(bottleneckCheckpoint);
    } else if (fs.existsSync(`${checkpoint}.aux`)) {
      if (recoveryContract)
        requireArtifact(`${checkpoint}.aux`,
          recoveryContract.source_training.bottleneck,
          "C6.1 bottleneck checkpoint");
      verified.bottleneck_checkpoint = artifact(`${checkpoint}.aux`);
    }
  }
  if (trainingLog) {
    if (recoveryContract)
      requireArtifact(trainingLog, recoveryContract.source_training.training_log,
        "C6.1 training log");
    verified.training_log = artifact(trainingLog);
  }
  if (baselineCheckpoint) {
    requireArtifact(baselineCheckpoint, contract.inputs.initial,
      "C2 checkpoint");
    verified.baseline_checkpoint = artifact(baselineCheckpoint);
  }
  if (tokenizer) {
    requireArtifact(tokenizer, contract.inputs.tokenizer, "tokenizer");
    verified.tokenizer = artifact(tokenizer);
  }
  for (const [name, file] of [["atlas-train", atlasTrain],
    ["atlas-validation", atlasValidation],
    ["anchor-train", anchorTrain],
    ["anchor-validation", anchorValidation]]) {
    if (file) {
      const contractName = name.replace(/-([a-z])/gu,
        (_, letter) => letter.toUpperCase());
      requireArtifact(file, contract.inputs[contractName], name);
      verified[name.replace(/-/g, "_")] = artifact(file);
    }
  }

  const result = {
    schema: "zero.c61_evaluator_preflight.v1",
    experiment: contract.experiment,
    contract_sha256: sha256(contractBytes),
    artifacts_verified: Object.keys(verified).length,
    records_parsed: Object.keys(parsed).length,
    verified,
    parsed,
    test_metrics_opened: false,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(
    "ZERO.5 C6.1 evaluator preflight passed: all files verified and all records parsed\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

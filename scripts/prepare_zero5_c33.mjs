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
const PACK_MAGIC = Buffer.from([90, 53, 80, 75, 86, 50, 0, 0]);
const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]);
const PAIRED_MAGIC = Buffer.from([90, 53, 80, 69, 86, 49, 0, 0]);

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
  const marker = "\nAnswer: ";
  const start = record.text.lastIndexOf(marker);
  if (start < 0) fail(record.task + " record lacks its answer marker");
  return Buffer.byteLength(record.text.slice(start + marker.length), "utf8");
}

async function loadRows(jsonl, basePath, expectedRecords, expectedSplit) {
  const writer = new BufferedBaseWriter(basePath);
  const rows = [];
  const input = fs.createReadStream(jsonl, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (!TASKS.includes(record.task) || record.split !== expectedSplit ||
          record.schemaVersion !== "braid.c32-repair-record/v1" ||
          record.view.maximumContextTokens !== CONTEXT ||
          record.view.tokenizerSha256 !== TOKENIZER_SHA ||
          typeof record.text !== "string" || record.text.length === 0) {
        fail("invalid admitted C3.2 row: " + (record.id ?? "unknown"));
      }
      if (!record.repair || typeof record.repair.answer !== "string") {
        fail("C3.2 row lacks its repair contract: " + record.id);
      }
      const targetBytes = answerBytes(record);
      rows.push({
        id: record.id,
        text: record.text,
        semanticId: record.semanticId,
        task: record.task,
        expectedTokens: record.view.tokenCount,
        expectedTokenHash: record.view.tokenIdsSha256,
        targetBytes,
        releasedAnswerSpan: record.view.answerTokenSpan,
        answer: record.repair.answer,
        pairId: record.repair.pairId ?? null,
        orientation: record.repair.orientation ?? null,
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
    if ((row.expectedTokens !== null && tokens.length !== row.expectedTokens) ||
        (row.expectedTokenHash !== null &&
          tokenIdsHash(tokens) !== row.expectedTokenHash) ||
        tokens.length > (row.alternative ? CONTEXT : CONTEXT - 1)) {
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
      fail("released C3.2 answer span changed: " + row.id);
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
    activeTargets: 0, answerTargets: 0, members: [] };
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
      pack.classes[target] = TASKS.indexOf(task) + 2;
      pack.answerTargets++;
    }
    pack.members.push({ id: row.id, pairId: row.pairId,
      orientation: row.orientation });
    pack.records++;
  }
  finish();
  return packs;
}

function pairedComponents(packs, task) {
  const parent = packs.map((_, index) => index);
  const find = value => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  const join = (left, right) => {
    left = find(left);
    right = find(right);
    if (left !== right) parent[right] = left;
  };
  const pairs = new Map();
  for (let pack = 0; pack < packs.length; pack++) {
    for (const member of packs[pack].members) {
      if (!member.pairId ||
          !["original", "mirrored"].includes(member.orientation)) {
        fail(task + " training row lacks pair identity: " + member.id);
      }
      if (!pairs.has(member.pairId)) pairs.set(member.pairId, []);
      pairs.get(member.pairId).push({ pack, ...member });
    }
  }
  for (const [pairId, members] of pairs) {
    const orientations = members.map(value => value.orientation).sort();
    if (members.length !== 2 || orientations[0] !== "mirrored" ||
        orientations[1] !== "original") {
      fail(task + " training pair is incomplete: " + pairId);
    }
    join(members[0].pack, members[1].pack);
  }
  const grouped = new Map();
  for (let pack = 0; pack < packs.length; pack++) {
    const root = find(pack);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(packs[pack]);
  }
  const components = [...grouped.values()];
  if (components.some(value => value.length > BATCH)) {
    fail(task + " pair-connected pack component exceeds one batch");
  }
  return components.map((value, index) => ({ task, packs: value,
    key: task + ":" + String(index).padStart(8, "0") }));
}

function atomicBatches(groups) {
  const units = [
    ...pairedComponents(groups.claim, "claim"),
    ...groups.cloze.map((pack, index) => ({ task: "cloze", packs: [pack],
      key: "cloze:" + String(index).padStart(8, "0") })),
    ...pairedComponents(groups.retrieval, "retrieval"),
  ];
  const bySize = new Map([1, 2, 3, 4].map(size => [size, []]));
  for (const unit of units) bySize.get(unit.packs.length).push(unit);
  for (const queue of bySize.values()) queue.sort((left, right) =>
    left.key.localeCompare(right.key));
  const batches = [];
  const takeDifferent = (size, tasks) => {
    const queue = bySize.get(size);
    const index = queue.findIndex(unit => !tasks.has(unit.task));
    if (index < 0) return queue.shift() ?? null;
    return queue.splice(index, 1)[0];
  };
  while ([...bySize.values()].some(queue => queue.length)) {
    const batch = [];
    const tasks = new Set();
    let remaining = BATCH;
    while (remaining > 0) {
      let size = Math.min(remaining, 4);
      while (size > 0 && bySize.get(size).length === 0) size--;
      if (size === 0) fail("pair-atomic units cannot fill an exact batch");
      const unit = takeDifferent(size, tasks);
      batch.push(unit);
      tasks.add(unit.task);
      remaining -= unit.packs.length;
    }
    batches.push(batch);
  }
  const profiles = new Map();
  for (const batch of batches) {
    const counts = Object.fromEntries(TASKS.map(task => [task, 0]));
    for (const unit of batch) counts[unit.task] += unit.packs.length;
    const profile = TASKS.map(task => counts[task]).join(":");
    if (!profiles.has(profile)) profiles.set(profile, []);
    profiles.get(profile).push({ batch, counts });
  }
  const totals = Object.fromEntries(TASKS.map(task => [task,
    groups[task].length]));
  const used = Object.fromEntries(TASKS.map(task => [task, 0]));
  const ordered = [];
  for (let position = 0; position < batches.length; position++) {
    let selected = null;
    let selectedScore = Infinity;
    for (const [profile, queue] of profiles) {
      if (queue.length === 0) continue;
      const score = TASKS.reduce((sum, task) => sum + Math.abs(
        used[task] + queue[0].counts[task] -
        (position + 1) * totals[task] / batches.length), 0);
      if (score < selectedScore ||
          (score === selectedScore && profile < selected)) {
        selected = profile;
        selectedScore = score;
      }
    }
    if (selected === null) fail("pair-atomic batch scheduler exhausted");
    const item = profiles.get(selected).shift();
    ordered.push(item.batch);
    for (const task of TASKS) used[task] += item.counts[task];
  }
  function arrangements(values) {
    if (values.length < 2) return [values];
    return values.flatMap((value, index) => arrangements([
      ...values.slice(0, index), ...values.slice(index + 1),
    ]).map(rest => [value, ...rest]));
  }
  const packs = [];
  const pairBatch = new Map();
  let previousTask = null;
  let previousRun = 0;
  for (let batch = 0; batch < ordered.length; batch++) {
    const next = ordered[batch + 1] ?? [];
    const nextTasks = new Set(next.map(unit => unit.task));
    let unitsInBatch = null;
    let bestScore = null;
    for (const candidate of arrangements(ordered[batch])) {
      let currentTask = previousTask;
      let currentRun = previousRun;
      let maximumRun = currentRun;
      for (const unit of candidate) {
        if (unit.task === currentTask) currentRun += unit.packs.length;
        else {
          currentTask = unit.task;
          currentRun = unit.packs.length;
        }
        maximumRun = Math.max(maximumRun, currentRun);
      }
      let boundaryRun = maximumRun;
      if (nextTasks.size === 1 && nextTasks.has(currentTask)) {
        boundaryRun = Math.max(boundaryRun,
          currentRun + next.reduce((sum, unit) =>
            sum + unit.packs.length, 0));
      }
      const key = candidate.map(unit => unit.key).join("|");
      const score = [boundaryRun, maximumRun, currentRun, key];
      if (bestScore === null || score[0] < bestScore[0] ||
          (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
          (score[0] === bestScore[0] && score[1] === bestScore[1] &&
           score[2] < bestScore[2]) ||
          (score[0] === bestScore[0] && score[1] === bestScore[1] &&
           score[2] === bestScore[2] && score[3] < bestScore[3])) {
        unitsInBatch = candidate;
        bestScore = score;
      }
    }
    for (const unit of unitsInBatch) {
      for (const pack of unit.packs) {
        packs.push(pack);
        for (const member of pack.members) {
          if (!member.pairId) continue;
          if (pairBatch.has(member.pairId) &&
              pairBatch.get(member.pairId) !== batch) {
            fail("training pair crossed an optimizer update: " +
              member.pairId);
          }
          pairBatch.set(member.pairId, batch);
        }
      }
      if (unit.task === previousTask) previousRun += unit.packs.length;
      else {
        previousTask = unit.task;
        previousRun = unit.packs.length;
      }
    }
  }
  if (packs.length !== groups.claim.length + groups.cloze.length +
      groups.retrieval.length || packs.length % BATCH !== 0) {
    fail("pair-atomic schedule changed the pack budget");
  }
  return { packs, batches: ordered.length, pairs: pairBatch.size,
    profiles: Object.fromEntries([...profiles.keys()].sort().map(profile =>
      [profile, batches.filter(batch => {
        const counts = Object.fromEntries(TASKS.map(task => [task, 0]));
        for (const unit of batch) counts[unit.task] += unit.packs.length;
        return TASKS.map(task => counts[task]).join(":") === profile;
      }).length])) };
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
    answer_targets_by_task: Object.fromEntries(TASKS.map(task => [task,
      real.filter(pack => pack.task === task)
        .reduce((sum, pack) => sum + pack.answerTargets, 0)])),
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
    fs.writeSync(descriptor, u32([2, VOCAB, CONTEXT, packs.length]));
    fs.writeSync(descriptor, u64([
      stats.records, stats.active_targets, stats.answer_targets,
      ...TASKS.map(task => stats.answer_targets_by_task[task]),
    ]));
    for (const pack of packs) fs.writeSync(descriptor, pack.tokens);
    for (const pack of packs) fs.writeSync(descriptor, pack.classes);
  } finally {
    fs.closeSync(descriptor);
  }
  return { ...artifact(file), ...stats };
}

function writePaired(file, rows, task) {
  const groups = new Map();
  for (const row of rows.filter(value => value.task === task)) {
    if (!row.pairId || !["original", "mirrored"].includes(row.orientation)) {
      fail(task + " paired row lacks pair identity: " + row.id);
    }
    if (!groups.has(row.pairId)) groups.set(row.pairId, []);
    groups.get(row.pairId).push(row);
  }
  const pairs = [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right));
  const descriptor = fs.openSync(file, "wx");
  let targetTokens = 0;
  try {
    fs.writeSync(descriptor, PAIRED_MAGIC);
    fs.writeSync(descriptor, u32([1, VOCAB, CONTEXT, pairs.length]));
    for (const [pairId, members] of pairs) {
      members.sort((left, right) =>
        left.orientation === right.orientation ? 0 :
          left.orientation === "original" ? -1 : 1);
      if (members.length !== 2 || members[0].orientation !== "original" ||
          members[1].orientation !== "mirrored") {
        fail(task + " pair is incomplete: " + pairId);
      }
      const labelTokens = members.map(row => {
        const match = row.answer.match(/ ([AB])$/u);
        if (!match) fail(task + " pair has a non-choice answer: " + row.id);
        return match[1].charCodeAt(0);
      });
      if (labelTokens[0] === labelTokens[1]) {
        fail(task + " pair labels did not flip: " + pairId);
      }
      for (let index = 0; index < members.length; index++) {
        const row = members[index];
        const targetCount = row.targetEnd - row.targetStart;
        const alternativeTargetCount =
          row.alternativeTargetEnd - row.alternativeTargetStart;
        if (!row.alternativeTokens || alternativeTargetCount <= 0) {
          fail(task + " choice lacks its alternative: " + row.id);
        }
        fs.writeSync(descriptor, u32([
          row.tokens.length, row.targetStart, targetCount, labelTokens[index],
        ]));
        const bytes = Buffer.alloc(row.tokens.length * 2);
        for (let token = 0; token < row.tokens.length; token++) {
          bytes.writeUInt16LE(row.tokens[token], token * 2);
        }
        fs.writeSync(descriptor, bytes);
        fs.writeSync(descriptor, u32([
          row.alternativeTokens.length, row.alternativeTargetStart,
          alternativeTargetCount, 0,
        ]));
        const alternativeBytes = Buffer.alloc(row.alternativeTokens.length * 2);
        for (let token = 0; token < row.alternativeTokens.length; token++) {
          alternativeBytes.writeUInt16LE(
            row.alternativeTokens[token], token * 2);
        }
        fs.writeSync(descriptor, alternativeBytes);
        targetTokens += targetCount;
      }
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { ...artifact(file), pairs: pairs.length, records: pairs.length * 2,
    target_tokens: targetTokens };
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

function attachPairedAlternatives(rows, split, out, tokenizer, byteLengths) {
  const paired = rows.filter(row => row.task !== "cloze");
  const alternatives = paired.map(row => {
    const match = row.answer.match(/^(Claim|Passage) ([AB])$/u);
    if (!match || !row.text.endsWith(row.answer)) {
      fail("paired row has an invalid answer suffix: " + row.id);
    }
    const answer = match[1] + " " + (match[2] === "A" ? "B" : "A");
    return {
      id: row.id + ":alternative",
      text: row.text.slice(0, -row.answer.length) + answer,
      task: row.task,
      expectedTokens: null,
      expectedTokenHash: null,
      targetBytes: Buffer.byteLength(answer, "utf8"),
      releasedAnswerSpan: null,
      alternative: true,
      source: row,
    };
  });
  const base = path.join(out, split + ".paired-alternatives.base.tok");
  const recoded = path.join(out,
    split + ".paired-alternatives.byte-bpe512.tok");
  const writer = new BufferedBaseWriter(base);
  for (const row of alternatives) writer.appendText(row.text);
  writer.close();
  run("./sero_tokenizer", [
    "recode", "--vocab", tokenizer, "--tokens", base, "--out", recoded,
  ]);
  bindTokens(alternatives, recoded, byteLengths);
  fs.unlinkSync(base);
  fs.unlinkSync(recoded);
  for (const row of alternatives) {
    row.source.alternativeTokens = row.tokens;
    row.source.alternativeTargetStart = row.targetStart;
    row.source.alternativeTargetEnd = row.targetEnd;
  }
}

if (process.argv.includes("--self-test-scheduler")) {
  const pairedPack = (task, pairId, orientation) => ({ task, records: 1,
    members: [{ id: pairId + ":" + orientation, pairId, orientation }] });
  const groups = {
    claim: [pairedPack("claim", "c1", "original"),
      pairedPack("claim", "c1", "mirrored")],
    cloze: Array.from({ length: 4 }, (_, index) => ({ task: "cloze",
      records: 1, members: [{ id: "z" + index, pairId: null,
        orientation: null }] })),
    retrieval: [pairedPack("retrieval", "r1", "original"),
      pairedPack("retrieval", "r1", "mirrored")],
  };
  const scheduled = atomicBatches(groups);
  assert.equal(scheduled.batches, 2);
  assert.equal(scheduled.pairs, 2);
  const locations = new Map();
  scheduled.packs.forEach((pack, index) => {
    for (const member of pack.members) {
      if (!member.pairId) continue;
      if (!locations.has(member.pairId)) locations.set(member.pairId, []);
      locations.get(member.pairId).push(Math.floor(index / BATCH));
    }
  });
  assert.ok([...locations.values()].every(value =>
    value.length === 2 && value[0] === value[1]));
  process.stdout.write("C3.3 pair-atomic scheduler self-test passed\n");
  process.exit(0);
}

async function prepareSplit({ view, split, out, tokenizer, expectedRecords,
  byteLengths }) {
  const jsonl = path.join(view, "data", split + ".jsonl");
  const base = path.join(out, split + ".base.tok");
  const recoded = path.join(out, split + ".byte-bpe512.tok");
  const rows = await loadRows(jsonl, base, expectedRecords, split);
  run("./sero_tokenizer", [
    "recode", "--vocab", tokenizer, "--tokens", base, "--out", recoded,
  ]);
  const answers = bindTokens(rows, recoded, byteLengths);
  fs.unlinkSync(base);
  fs.unlinkSync(recoded);
  const groups = Object.fromEntries(TASKS.map(task =>
    [task, packTask(rows, task)]));
  if (split === "validation") {
    attachPairedAlternatives(rows, split, out, tokenizer, byteLengths);
  }
  return { rows, groups, answerTokens: answers };
}

const release = path.resolve(option("--release"));
const expectedReleaseId = option("--release-id");
const expectedManifestSha256 = option("--manifest-sha256");
const expectedBraidHead = option("--braid-head");
const braidRoot = path.resolve(option("--braid-root"));
const c0Directory = path.resolve(option("--c0-dir",
  "build/zero5-c0-v1/corpus-one"));
const out = path.resolve(option("--out", "build/zero5-c33-v1/import"));
if (!expectedReleaseId || !expectedManifestSha256 || !expectedBraidHead) {
  fail("--release-id, --manifest-sha256, and --braid-head are required");
}
if (!/^[0-9a-f]{40}$/u.test(expectedBraidHead) ||
    run("git", ["rev-parse", expectedBraidHead + "^{commit}"], braidRoot) !==
      expectedBraidHead) {
  fail("the pinned Braid source commit is unavailable");
}
if (fs.existsSync(out)) fail("output directory already exists: " + out);

const manifestPath = path.join(release, "release.json");
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
if (sha256(manifestBytes) !== expectedManifestSha256 ||
    manifest.schemaVersion !== "braid.c32-repair-release/v1" ||
    manifest.status !== "RELEASED" ||
    manifest.releaseId !== expectedReleaseId ||
    manifest.tokenizer.vocabularySize !== VOCAB ||
    manifest.counts.recordsBySplit.train !== 55065 ||
    manifest.counts.recordsBySplit.validation !== 10137 ||
    manifest.counts.recordsBySplit.test !== 10166 ||
    manifest.training.targetPackSequences !== 37768 ||
    manifest.training.computeTokenExposures !== 19337216) {
  fail("locked Braid C3.2 release identity or model target changed");
}
const TOKENIZER_SHA = manifest.tokenizer.sha256;
for (const item of manifest.artifacts) {
  requireArtifact(path.join(release, item.path), item,
    "C3.2 release artifact " + item.path);
}
const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
requireArtifact(tokenizer, { sha256: TOKENIZER_SHA }, "C0 tokenizer");
requireArtifact(path.join(release, manifest.tokenizer.artifact),
  { sha256: TOKENIZER_SHA }, "release tokenizer");
const byteLengths = tokenByteLengths(tokenizer);
fs.mkdirSync(out, { recursive: true });

const train = await prepareSplit({
  view: release, split: "train", out, tokenizer,
  expectedRecords: manifest.counts.recordsBySplit.train, byteLengths,
});
const validation = await prepareSplit({
  view: release, split: "validation", out, tokenizer,
  expectedRecords: manifest.counts.recordsBySplit.validation, byteLengths,
});

const atomic = atomicBatches(train.groups);
const interleaved = atomic.packs;
const outputs = {};
outputs.train_interleaved = writePack(
  path.join(out, "train.interleaved.z5pack"), interleaved);
outputs.validation_interleaved = writePack(
  path.join(out, "validation.interleaved.z5pack"),
  smoothInterleave(validation.groups));
outputs.validation_tasks = {};
outputs.completion_validation = {};
outputs.paired_validation = {};
for (const task of TASKS) {
  outputs.validation_tasks[task] = writePack(
    path.join(out, task + ".validation.z5pack"), validation.groups[task]);
  outputs.completion_validation[task] = writeCompletion(
    path.join(out, task + ".validation.completion-eval.bin"),
    validation.rows.filter(row => row.task === task));
  if (task !== "cloze") {
    outputs.paired_validation[task] = writePaired(
      path.join(out, task + ".validation.paired-eval.bin"),
      validation.rows, task);
  }
}

if (outputs.train_interleaved.records !== manifest.counts.recordsBySplit.train ||
    outputs.train_interleaved.packs !== manifest.training.targetPackSequences ||
    outputs.train_interleaved.active_targets !== manifest.training.activeTargets ||
    outputs.train_interleaved.answer_targets !==
      Object.values(manifest.training.answerTargetsByTask)
        .reduce((sum, value) => sum + value, 0) ||
    !TASKS.every(task => outputs.train_interleaved.answer_targets_by_task[task] ===
      manifest.training.answerTargetsByTask[task]) ||
    atomic.batches !== manifest.training.targetPackSequences / BATCH ||
    atomic.pairs !== Object.values(
      manifest.counts.pairsBySplitAndTask.train)
      .reduce((sum, value) => sum + value, 0) ||
    outputs.validation_interleaved.records !==
      manifest.counts.recordsBySplit.validation ||
    outputs.paired_validation.claim.pairs !==
      manifest.counts.pairsBySplitAndTask.validation.claim ||
    outputs.paired_validation.retrieval.pairs !==
      manifest.counts.pairsBySplitAndTask.validation.retrieval) {
  fail("C3.2 packing, weighting, or pairing invariants failed");
}

const result = {
  schema: "zero.c33_import.v1",
  release: {
    id: expectedReleaseId,
    braid_head: expectedBraidHead,
    manifest: { ...artifact(manifestPath), digest: manifest.digest },
    parent_view_id: manifest.parent.viewId,
    train_jsonl: manifest.artifacts.find(item => item.path === "data/train.jsonl"),
    validation_jsonl: manifest.artifacts.find(
      item => item.path === "data/validation.jsonl"),
    test_jsonl: manifest.artifacts.find(item => item.path === "data/test.jsonl"),
    official_artifacts_verified: true,
  },
  tokenizer: { id: manifest.tokenizer.id, sha256: TOKENIZER_SHA,
    vocabulary_size: VOCAB },
  model_target: { context: CONTEXT, reserved_boundary_tokens: 1,
    packing: "C3.2-complete records and Z5PKV2 classes; each mirrored pair is confined to one four-pack optimizer batch" },
  schedules: {
    control_D: "frozen C3.2 independent-pack braid; equal-answer-mass task weights",
    E: "same packs regrouped into pair-atomic, task-smoothed optimizer batches; equal-answer-mass task weights",
  },
  answer_weights: {
    E: manifest.training.balancedAnswerWeights,
  },
  paired_training: {
    objective: "mean cross-entropy of both orientations in one optimizer update",
    optimizer_batches: atomic.batches,
    paired_examples: atomic.pairs,
    pair_cross_batch_leakage: 0,
    batch_profiles_claim_cloze_retrieval: atomic.profiles,
    direct_consistency_penalty: false,
  },
  outputs,
  answer_spans: {
    train_target_tokens: train.answerTokens,
    validation_target_tokens: validation.answerTokens,
    all_tasks: "derived from the final Answer field and matched to the released answerTokenSpan",
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

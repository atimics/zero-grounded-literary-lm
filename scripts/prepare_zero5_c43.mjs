#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import {
  loadBraidC43Release,
  readJson,
  sha256File,
  validateReleaseReport,
} from "./lib/zero5_c43_intake.mjs";

const DOCUMENT_TOKEN = 256;
const CONTEXT = 512;
const VOCAB = 512;
const TASKS = ["claim", "cloze", "retrieval"];
const ALL_TASKS = [...TASKS, "evidence-bundle"];
const PACK_MAGIC = Buffer.from([90, 53, 80, 75, 86, 51, 0, 0]);
const COMPLETION_MAGIC = Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]);
const SPAN_CHOICE_MAGIC = Buffer.from([90, 53, 83, 67, 86, 49, 0, 0]);

function fail(message) { throw new Error(message); }

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifact(file) {
  return { sha256: sha256File(file), bytes: fs.statSync(file).size };
}

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  if (observed.sha256 !== expected.sha256 ||
      (expected.bytes !== undefined && observed.bytes !== expected.bytes)) {
    fail(`${label} changed`);
  }
  return observed;
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

function validateSpan(span, tokenCount, label, id) {
  if (!span || !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) || span.start < 0 ||
      span.end <= span.start || span.end > tokenCount) {
    fail(`${id} has an invalid ${label} token span`);
  }
}

async function loadAlignedSplit({ dataPath, metadataPath, split, out,
  tokenizerTool, tokenizer, expectedRecords }) {
  const basePath = path.join(out, `${split}.base.tok`);
  const tokenPath = path.join(out, `${split}.byte-bpe512.tok`);
  const dataLines = readline.createInterface({
    input: fs.createReadStream(dataPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })[Symbol.asyncIterator]();
  const metadataLines = readline.createInterface({
    input: fs.createReadStream(metadataPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })[Symbol.asyncIterator]();
  const writer = new BaseTokenWriter(basePath);
  const rows = [];
  try {
    while (true) {
      const [dataNext, metadataNext] = await Promise.all([
        dataLines.next(), metadataLines.next(),
      ]);
      if (dataNext.done || metadataNext.done) {
        if (dataNext.done !== metadataNext.done) {
          fail(`${split} data and metadata line counts differ`);
        }
        break;
      }
      const data = JSON.parse(dataNext.value);
      const metadata = JSON.parse(metadataNext.value);
      if (data.schemaVersion !== "braid.c43-text-record/v1" ||
          metadata.schemaVersion !== "braid.c43-metadata-record/v1" ||
          data.id !== metadata.recordId || metadata.split !== split ||
          !ALL_TASKS.includes(metadata.task) ||
          typeof data.text !== "string" || data.text.length === 0 ||
          metadata.view.maximumContextTokens !== CONTEXT ||
          metadata.view.tokenizerSha256 !==
            "90b9ddf7b239b6e48c21b87ca9735cb149c34dcf6f03f49a85410df6efe2cadc" ||
          !Number.isInteger(metadata.view.tokenCount) ||
          metadata.view.tokenCount <= 0 ||
          metadata.view.tokenCount > CONTEXT - 1) {
        fail(`invalid aligned C4.3 ${split} row: ${data.id ?? "unknown"}`);
      }
      for (const span of metadata.masks.language) {
        validateSpan(span, metadata.view.tokenCount, "language", data.id);
      }
      for (const span of metadata.masks.answer) {
        validateSpan(span, metadata.view.tokenCount, "answer", data.id);
      }
      if ((metadata.task === "evidence-bundle") !==
          (metadata.masks.answer.length === 0)) {
        fail(`${data.id} has inconsistent answer-mask semantics`);
      }
      if (!Array.isArray(metadata.spans?.token) ||
          !Array.isArray(metadata.spans?.answers)) {
        fail(`${data.id} has no token-level evaluation spans`);
      }
      for (const span of metadata.spans.token) {
        if (!span || typeof span.id !== "string" ||
            !Number.isInteger(span.start) || !Number.isInteger(span.end) ||
            span.start < 0 || span.end < span.start ||
            span.end > metadata.view.tokenCount) {
          fail(`${data.id} has an invalid evaluation token span`);
        }
      }
      if (["claim", "retrieval"].includes(metadata.task) &&
          ![0, 1].includes(metadata.objective.correctChoice)) {
        fail(`${data.id} has no binary choice objective`);
      }
      writer.append(data.text);
      rows.push({
        id: data.id, task: metadata.task,
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
  if (rows.length !== expectedRecords) fail(`${split} row count changed`);
  run(tokenizerTool, ["recode", "--vocab", tokenizer, "--tokens", basePath,
    "--out", tokenPath]);
  const tokenStream = fs.readFileSync(tokenPath);
  let offset = 0;
  for (const row of rows) {
    const start = offset;
    while (offset < tokenStream.length &&
           tokenStream.readUInt16LE(offset) !== DOCUMENT_TOKEN) offset += 2;
    if (offset >= tokenStream.length) {
      fail(`token stream lacks a boundary for ${row.id}`);
    }
    row.tokenBytes = tokenStream.subarray(start, offset);
    offset += 2;
    if (row.tokenBytes.length / 2 !== row.tokenCount ||
        tokenIdsHash(row.tokenBytes) !== row.tokenIdsSha256) {
      fail(`tokenized C4.3 row changed: ${row.id}`);
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
  return { tokens, classes: Buffer.alloc(CONTEXT), records: 0,
    activeTargets: 0, answerTargets: 0,
    answerTargetsByTask: Object.fromEntries(TASKS.map(task => [task, 0])),
    task: null, recordIds: [] };
}

function addRecord(pack, row, cursor) {
  if (cursor + row.tokenCount + 1 > CONTEXT + 1) {
    fail(`record does not fit its declared C4.3 pack: ${row.id}`);
  }
  const recordStart = cursor;
  row.tokenBytes.copy(pack.tokens, recordStart * 2);
  cursor += row.tokenCount;
  pack.tokens.writeUInt16LE(DOCUMENT_TOKEN, cursor * 2);
  cursor += 1;
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
          fail(`answer mask leaves the language objective: ${row.id}`);
        }
        pack.classes[target] = answerClass;
      }
    }
  }
  pack.records += 1;
  pack.recordIds.push(row.id);
  pack.task ??= row.task;
  if (pack.task !== row.task) pack.task = "mixed";
  return cursor;
}

function finishPack(pack) {
  for (const value of pack.classes) {
    if (value !== 0) pack.activeTargets += 1;
    if (value >= 2) {
      pack.answerTargets += 1;
      pack.answerTargetsByTask[TASKS[value - 2]] += 1;
    }
  }
  return pack;
}

function buildPlannedPacks(rows, planRows, phase) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const used = new Set();
  const packs = [];
  for (let index = 0; index < planRows.length; index++) {
    const plan = planRows[index];
    if (plan.schemaVersion !== "braid.c43-training-pack/v1" ||
        plan.index !== index + 1 || plan.phase !== phase ||
        !ALL_TASKS.includes(plan.task) || !Array.isArray(plan.recordIds) ||
        plan.recordIds.length === 0 || typeof plan.updateGroup !== "string") {
      fail(`invalid C4.3 ${phase} plan row ${index + 1}`);
    }
    const pack = emptyPack();
    let cursor = 1;
    for (const id of plan.recordIds) {
      const row = byId.get(id);
      if (!row || used.has(id) || row.task !== plan.task ||
          row.updateGroup !== plan.updateGroup) {
        fail(`${phase} plan membership changed at ${id}`);
      }
      cursor = addRecord(pack, row, cursor);
      used.add(id);
    }
    finishPack(pack);
    if (pack.activeTargets !== plan.activeTargets ||
        CONTEXT - pack.activeTargets !== plan.paddingTargets) {
      fail(`${phase} plan accounting changed at pack ${plan.index}`);
    }
    pack.updateGroup = plan.updateGroup;
    pack.pairId = plan.pairId ?? null;
    packs.push(pack);
  }
  if (used.size !== rows.length) {
    fail(`${phase} plan did not consume every admitted record`);
  }
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
    const members = packs.slice(offsets[update], offsets[update + 1]);
    if (members.length < 1 || members.length > 2) {
      fail("C4.3 update group exceeds the pair-atomic batch ceiling");
    }
    if (members.length === 2 && (!members[0].pairId ||
        members[0].pairId !== members[1].pairId)) {
      fail("two-pack update no longer binds one mirrored pair");
    }
  }
  return offsets;
}

function packStats(packs) {
  const answerTargets = Object.fromEntries(TASKS.map(task => [task, 0]));
  const stats = { packs: packs.length, records: 0, active_targets: 0,
    answer_targets: 0, answer_targets_by_task: answerTargets,
    compute_token_exposures: packs.length * CONTEXT };
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

function writePack(file, packs, offsets) {
  const stats = packStats(packs);
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeSync(descriptor, PACK_MAGIC);
    fs.writeSync(descriptor, u32([3, VOCAB, CONTEXT, packs.length]));
    fs.writeSync(descriptor, u64([stats.records, stats.active_targets,
      stats.answer_targets,
      ...TASKS.map(task => stats.answer_targets_by_task[task])]));
    fs.writeSync(descriptor, u32([offsets.length - 1]));
    fs.writeSync(descriptor, u32(offsets));
    for (const pack of packs) fs.writeSync(descriptor, pack.tokens);
    for (const pack of packs) fs.writeSync(descriptor, pack.classes);
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), ...stats, update_groups: offsets.length - 1,
    maximum_packs_per_update: Math.max(...offsets.slice(1)
      .map((value, index) => value - offsets[index])) };
}

function tokenSpan(row, id) {
  const matches = row.tokenSpans.filter(span => span.id === id);
  if (matches.length !== 1) {
    fail(`${row.id} does not have exactly one ${id} token span`);
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
      if (row.answerSpanIds.length !== 1 || row.answerSpanIds[0] !== "answer") {
        fail(`${row.id} is not a valid cloze evaluation row`);
      }
      const target = tokenSpan(row, "answer");
      fs.writeSync(descriptor, u32([row.tokenCount, target.start,
        target.end - target.start, 0]));
      fs.writeSync(descriptor, row.tokenBytes);
      targetTokens += target.end - target.start;
    }
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), records: rows.length,
    target_tokens: targetTokens };
}

function writeSpanChoices(file, rows, task) {
  const groups = new Map();
  for (const row of rows.filter(value => value.task === task)) {
    if (!row.pairId || !["original", "mirrored"].includes(row.orientation)) {
      fail(`${task} choice row lacks mirrored identity: ${row.id}`);
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
        fail(`${task} choice pair is incomplete or did not flip: ${pairId}`);
      }
      for (const row of members) {
        const correct = tokenSpan(row, `candidate-${row.correctChoice}`);
        const alternative = tokenSpan(row,
          `candidate-${1 - row.correctChoice}`);
        if (correct.start === 0 || alternative.start === 0) {
          fail(`${row.id} has an unscorable leading candidate span`);
        }
        fs.writeSync(descriptor, u32([row.tokenCount,
          correct.start, correct.end - correct.start,
          alternative.start, alternative.end - alternative.start,
          row.correctChoice]));
        fs.writeSync(descriptor, row.tokenBytes);
        correctTargetTokens += correct.end - correct.start;
        alternativeTargetTokens += alternative.end - alternative.start;
      }
    }
  } finally { fs.closeSync(descriptor); }
  return { ...artifact(file), pairs: pairs.length, records: pairs.length * 2,
    correct_target_tokens: correctTargetTokens,
    alternative_target_tokens: alternativeTargetTokens,
    scoring: "mean causal nats per token over natural candidate spans" };
}

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text.length === 0 ? [] : text.split("\n").map(JSON.parse);
}

function copyFrozenValidation(c42Import, out, c42Contract) {
  const directory = path.join(out, "frozen-validation");
  fs.mkdirSync(directory);
  const entries = {
    combined: ["validation.z5pack",
      c42Contract.verified_import.validation_packs.sha256],
    claim_span_choices: ["claim.validation.span-choice-eval.bin",
      c42Contract.verified_import.evaluation_artifacts
        .claim_span_choices.sha256],
    retrieval_span_choices: ["retrieval.validation.span-choice-eval.bin",
      c42Contract.verified_import.evaluation_artifacts
        .retrieval_span_choices.sha256],
    cloze_completion: ["cloze.validation.completion-eval.bin",
      c42Contract.verified_import.evaluation_artifacts.cloze_completion.sha256],
    evidence_validation: ["evidence-bundle.validation.z5pack",
      c42Contract.verified_import.evaluation_artifacts
        .evidence_validation.sha256],
  };
  const result = {};
  for (const [name, [filename, expectedSha256]] of Object.entries(entries)) {
    const source = path.join(c42Import, filename);
    requireArtifact(source, { sha256: expectedSha256 },
      `frozen C4.2 ${name}`);
    const destination = path.join(directory, filename);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    result[name] = artifact(destination);
  }
  return result;
}

function selfTest() {
  const pack = emptyPack();
  const values = [65, 66, 67];
  const tokenBytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => tokenBytes.writeUInt16LE(value, index * 2));
  addRecord(pack, { id: "fixture", task: "cloze", tokenCount: 3,
    tokenBytes, languageMasks: [{ start: 0, end: 3 }],
    answerMasks: [{ start: 1, end: 3 }] }, 1);
  finishPack(pack);
  assert.equal(pack.activeTargets, 4);
  assert.equal(pack.answerTargetsByTask.cloze, 2);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c43-import-"));
  const file = path.join(directory, "fixture.z5pack");
  const result = writePack(file, [pack], [0, 1]);
  assert.equal(result.update_groups, 1);
  assert.ok(fs.readFileSync(file).subarray(0, 8).equals(PACK_MAGIC));
  fs.rmSync(directory, { recursive: true });
  process.stdout.write("ZERO.5 C4.3 importer self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const proposalPath = path.resolve(option("--proposal",
    "benchmarks/zero5-c43-v1/contract-proposal.json"));
  const proposal = readJson(proposalPath);
  const c42Contract = readJson(path.resolve(proposal.c42_decision.contract));
  const releaseDirectory = path.resolve(option("--release"));
  const handoffPath = path.resolve(option("--handoff"));
  const braidRoot = path.resolve(option("--braid-root"));
  const c42Import = path.resolve(option("--c42-import"));
  const tokenizerTool = path.resolve(option("--tokenizer-tool",
    "./sero_tokenizer"));
  const importId = option("--import-id");
  const out = path.resolve(option("--out", "build/zero5-c43-v1/import"));
  if (!importId) fail("--import-id is required");
  if (fs.existsSync(out)) fail(`output directory already exists: ${out}`);

  const loaded = loadBraidC43Release(releaseDirectory, handoffPath, proposal);
  validateReleaseReport(loaded.report, proposal, c42Contract,
    releaseDirectory);
  run("git", ["cat-file", "-e", `${loaded.handoff.sourceCommit}^{commit}`],
    braidRoot);
  run("git", ["merge-base", "--is-ancestor", loaded.handoff.sourceCommit,
    "HEAD"], braidRoot);
  fs.mkdirSync(out, { recursive: true });
  const tokenizer = path.join(releaseDirectory,
    loaded.manifest.tokenizer.artifact);
  requireArtifact(tokenizer, { sha256: proposal.fixed_model.tokenizer_sha256 },
    "C4.3 tokenizer");

  const train = await loadAlignedSplit({
    dataPath: path.join(releaseDirectory, "data/train.jsonl"),
    metadataPath: path.join(releaseDirectory, "metadata/train.jsonl"),
    split: "train", out, tokenizerTool, tokenizer,
    expectedRecords: loaded.dataReport.counts.trainRecords,
  });
  const development = await loadAlignedSplit({
    dataPath: path.join(releaseDirectory, "development/data.jsonl"),
    metadataPath: path.join(releaseDirectory, "development/metadata.jsonl"),
    split: "development", out, tokenizerTool, tokenizer,
    expectedRecords: loaded.dataReport.counts.developmentRecords,
  });
  const trainPlans = readJsonl(path.join(releaseDirectory,
    "training/train-pack-plan.jsonl"));
  const developmentPlans = readJsonl(path.join(releaseDirectory,
    "development/pack-plan.jsonl"));
  const trainPacks = buildPlannedPacks(train, trainPlans, "primary");
  const developmentPacks = buildPlannedPacks(development,
    developmentPlans, "development");
  const trainOffsets = updateOffsets(trainPacks);
  const developmentOffsets = updateOffsets(developmentPacks);
  const primary = writePack(path.join(out, "train.primary.grouped.z5pack"),
    trainPacks, trainOffsets);
  const developmentPack = writePack(path.join(out,
    "development.grouped.z5pack"), developmentPacks, developmentOffsets);
  const developmentEvaluation = {
    cloze_completion: writeCompletion(path.join(out,
      "cloze.development.completion-eval.bin"),
    development.filter(row => row.task === "cloze")),
    span_choices: Object.fromEntries(["claim", "retrieval"].map(task =>
      [task, writeSpanChoices(path.join(out,
        `${task}.development.span-choice-eval.bin`), development, task)])),
  };

  const expectedAnswers = loaded.report.primary.answer_targets;
  if (primary.packs !== loaded.trainingReport.packs ||
      primary.records !== loaded.dataReport.counts.trainRecords ||
      primary.update_groups !== loaded.trainingReport.optimizerGroups ||
      primary.compute_token_exposures !==
        loaded.trainingReport.computeTokenExposures ||
      primary.active_targets !== loaded.trainingReport.activeTargets ||
      primary.padding_targets !== loaded.trainingReport.paddingTargets ||
      !TASKS.every(task => primary.answer_targets_by_task[task] ===
        expectedAnswers[task]) ||
      developmentPack.packs !== loaded.trainingReport.development.packs ||
      developmentPack.records !== loaded.dataReport.counts.developmentRecords ||
      developmentPack.update_groups !==
        loaded.trainingReport.development.optimizerGroups) {
    fail("C4.3 packing, masking, or compute invariants failed");
  }

  const frozen = copyFrozenValidation(c42Import, out, c42Contract);
  fs.writeFileSync(path.join(out, "release-report.json"),
    JSON.stringify(loaded.report, null, 2) + "\n", { flag: "wx" });
  const receipt = {
    schema: "zero.c43_import_receipt.v1",
    import_id: importId,
    release: {
      id: loaded.manifest.releaseId,
      source_commit: loaded.handoff.sourceCommit,
      manifest_sha256: loaded.handoff.releaseManifestSha256,
      membership_digest: loaded.manifest.membershipDigest,
      pack_plan_sha256: loaded.manifest.packPlanHash,
    },
    outputs: {
      primary: {
        ...primary, wraps: 0,
        answer_targets: { ...primary.answer_targets_by_task,
          total: primary.answer_targets },
      },
      development: {
        ...developmentPack,
        evaluation: developmentEvaluation,
      },
      frozen_validation: {
        combined_sha256: frozen.combined.sha256,
        claim_span_choices_sha256: frozen.claim_span_choices.sha256,
        retrieval_span_choices_sha256:
          frozen.retrieval_span_choices.sha256,
        cloze_completion_sha256: frozen.cloze_completion.sha256,
        evidence_validation_sha256: frozen.evidence_validation.sha256,
      },
    },
    test: {
      records: loaded.handoff.sealedTest.records,
      bytes: loaded.handoff.sealedTest.bytes,
      sha256: loaded.handoff.sealedTest.sha256,
      content_present: false, parsed: false, tokenized: false,
      packed: false, scored: false, metrics_opened: false,
    },
  };
  fs.writeFileSync(path.join(out, "import.json"),
    JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(receipt) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

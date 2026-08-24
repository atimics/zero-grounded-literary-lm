#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function run(program, args, expectedStatus = 0) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result.stdout;
}

function u32(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
}

function u64(values) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) =>
    bytes.writeBigUInt64LE(BigInt(value), index * 8));
  return bytes;
}

function writeTinyPack(file, packs = 4) {
  const context = 512;
  const header = Buffer.concat([
    Buffer.from([90, 53, 80, 75, 86, 50, 0, 0]),
    u32([2, 128, context, packs]),
    u64([packs, packs * 4, 3, 1, 1, 1]),
  ]);
  const tokens = Buffer.alloc(packs * (context + 1) * 2);
  for (let index = 0; index < packs * (context + 1); index++) {
    tokens.writeUInt16LE(32, index * 2);
  }
  const classes = Buffer.alloc(packs * context);
  for (let pack = 0; pack < packs; pack++) {
    const start = pack * context;
    classes[start] = 1;
    classes[start + 1] = pack < 3 ? pack + 2 : 1;
    classes[start + 2] = 1;
    classes[start + 3] = 1;
  }
  fs.writeFileSync(file, Buffer.concat([header, tokens, classes]));
}

function pairedCandidate(tokens, targetStart, label) {
  return Buffer.concat([
    u32([tokens.length, targetStart, tokens.length - targetStart, label]),
    Buffer.from(Uint16Array.from(tokens).buffer),
  ]);
}

function writeTinyPaired(file) {
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([90, 53, 80, 69, 86, 49, 0, 0]),
    u32([1, 128, 512, 1]),
    pairedCandidate([120, 65], 1, 65),
    pairedCandidate([120, 66], 1, 0),
    pairedCandidate([120, 66], 1, 66),
    pairedCandidate([120, 65], 1, 0),
  ]));
}

const contractPath = "benchmarks/zero5-c32-v1/contract.json";
const importPath = "benchmarks/zero5-c32-v1/import.json";
const resultPath = "benchmarks/zero5-c32-v1/result.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const importBytes = fs.readFileSync(importPath);
const imported = JSON.parse(importBytes);

assert.equal(contract.schema, "zero.c32_braid_experiment.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.equal(sha256(fs.readFileSync(contract.implementation.trainer)),
  contract.implementation.trainer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.importer)),
  contract.implementation.importer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.runner)),
  contract.implementation.runner_sha256);
assert.equal(sha256(importBytes), contract.input.import_manifest_sha256);
assert.equal(imported.schema, "zero.c32_import.v1");
assert.equal(imported.release.id, contract.input.release_id);
assert.equal(imported.release.braid_head, contract.input.braid_head);
assert.equal(imported.release.manifest.sha256,
  contract.input.release_manifest_sha256);
assert.equal(imported.tokenizer.sha256, contract.input.tokenizer_sha256);
assert.equal(imported.outputs.train_interleaved.sha256,
  contract.input.train_packs.sha256);
assert.equal(imported.outputs.train_interleaved.packs,
  contract.training.pack_sequences);
assert.equal(imported.outputs.train_interleaved.active_targets,
  contract.training.active_targets);
assert.deepEqual(imported.outputs.train_interleaved.answer_targets_by_task,
  contract.training.answer_targets_by_task);
assert.equal(imported.outputs.train_interleaved.maximum_same_task_pack_run, 2);
assert.equal(contract.training.updates * contract.training.batch_sequences,
  contract.training.pack_sequences);
assert.equal(contract.training.pack_sequences * contract.model.context,
  contract.training.compute_token_exposures);
assert.equal(imported.test.parsed, false);
assert.equal(imported.test.tokenized, false);
assert.equal(imported.test.packed, false);
assert.equal(imported.test.metrics_opened, false);
assert.equal(contract.decision.broad_model_promotion_authorized, false);
assert.equal(contract.decision.checkpoint_publication_authorized, false);
assert.deepEqual(Object.keys(contract.arms), ["C", "D"]);
assert.deepEqual(contract.arms.C.answer_weights,
  { claim: 1, cloze: 1, retrieval: 1 });
assert.deepEqual(contract.arms.D.answer_weights, imported.answer_weights.D);

for (const task of ["claim", "cloze", "retrieval"]) {
  const baseline = contract.baselines.completion[task].nats_per_target_token;
  assert.ok(Math.abs(
    contract.gates.completion_nats_per_target_token_maximum[task] -
      baseline * 0.9) < 1e-9);
}
assert.ok(Math.abs(contract.gates.combined_validation_nats_per_token_maximum -
  contract.baselines.combined_final_nats_per_token * 0.9) < 1e-12);

const localImport = "build/zero5-c32-v1/import-final";
if (fs.existsSync(localImport)) {
  const paths = {
    "train.interleaved.z5pack": imported.outputs.train_interleaved.sha256,
    "validation.interleaved.z5pack":
      imported.outputs.validation_interleaved.sha256,
    "claim.validation.paired-eval.bin":
      imported.outputs.paired_validation.claim.sha256,
    "retrieval.validation.paired-eval.bin":
      imported.outputs.paired_validation.retrieval.sha256,
  };
  for (const [file, expected] of Object.entries(paths)) {
    assert.equal(sha256(fs.readFileSync(path.join(localImport, file))), expected);
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-c32-check-"));
try {
  const packed = path.join(temporary, "tiny.z5pack");
  const paired = path.join(temporary, "tiny.z5pair");
  const checkpoint = path.join(temporary, "best.ckpt");
  writeTinyPack(packed);
  writeTinyPaired(paired);
  const mechanics = run("./zero5_c32_lm", [
    "--preset", "literary", "--context", "512", "--dim", "8",
    "--heads", "2", "--layers", "1", "--ff", "16", "--vocab", "128",
    "--packed-train", packed, "--packed-validation", packed,
    "--steps", "1", "--batch", "4", "--lr", "0.0001",
    "--warmup", "1", "--report", "1", "--validation", "4",
    "--best", checkpoint, "--claim-answer-weight", "3.009199423",
    "--cloze-answer-weight", "1", "--retrieval-answer-weight",
    "1.941452456", "--tokens", "0",
  ]);
  assert.match(mechanics,
    /packed sampling sequences=4 compute-token-exposures=2048 active-targets=16 answer-targets=3 claim-answer-targets=1 cloze-answer-targets=1 retrieval-answer-targets=1 padding-targets=2032 wraps=0 claim-answer-weight=3\.00919938 cloze-answer-weight=1 retrieval-answer-weight=1\.9414525/);
  assert.ok(fs.existsSync(checkpoint));
  assert.match(run("./zero5_c32_lm", [
    "--init", checkpoint, "--paired-eval", paired,
  ]), /"schema":"zero\.c32_paired_choice_eval\.v1"/);
  const corrupt = path.join(temporary, "corrupt.z5pack");
  const corruptBytes = fs.readFileSync(packed);
  corruptBytes[corruptBytes.length - 1] = 5;
  fs.writeFileSync(corrupt, corruptBytes);
  run("./zero5_c32_lm", [
    "--init", checkpoint, "--packed-validation", corrupt,
    "--eval-only", "--validation", "4",
  ], 1);
  assert.match(run("./zero5_c32_lm", ["--self-test"]),
    /35 finite-difference gradient checks passed/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (fs.existsSync(resultPath)) {
  const result = JSON.parse(fs.readFileSync(resultPath));
  assert.equal(result.schema, "zero.c32_braid_result.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.contract_sha256, sha256(contractBytes));
  assert.deepEqual(Object.keys(result.arms), ["C", "D"]);
  for (const arm of Object.values(result.arms)) {
    assert.equal(arm.training.completed_updates, contract.training.updates);
    assert.equal(arm.training.pack_sequences, contract.training.pack_sequences);
    assert.equal(arm.training.wraps, 0);
  }
  assert.equal(result.test.metrics_opened, false);
  assert.equal(result.decision.broad_model_promotion_authorized, false);
  assert.equal(result.decision.checkpoint_publication_authorized, false);
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C3.2 result mechanics passed"
  : "ZERO.5-C3.2 preregistration and paired mechanics passed");

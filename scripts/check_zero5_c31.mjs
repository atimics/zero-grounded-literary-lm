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

function writeTinyPack(file, packs = 4) {
  const context = 512;
  const header = Buffer.alloc(48);
  Buffer.from([90, 53, 80, 75, 86, 49, 0, 0]).copy(header);
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(128, 12);
  header.writeUInt32LE(context, 16);
  header.writeUInt32LE(packs, 20);
  header.writeBigUInt64LE(BigInt(packs), 24);
  header.writeBigUInt64LE(BigInt(packs * 4), 32);
  header.writeBigUInt64LE(BigInt(packs), 40);
  const tokens = Buffer.alloc(packs * (context + 1) * 2);
  for (let index = 0; index < packs * (context + 1); index++) {
    tokens.writeUInt16LE(32, index * 2);
  }
  const classes = Buffer.alloc(packs * context);
  for (let pack = 0; pack < packs; pack++) {
    const start = pack * context;
    classes[start] = 1;
    classes[start + 1] = 2;
    classes[start + 2] = 1;
    classes[start + 3] = 1;
  }
  fs.writeFileSync(file, Buffer.concat([header, tokens, classes]));
}

const contractPath = "benchmarks/zero5-c31-v1/contract.json";
const importPath = "benchmarks/zero5-c31-v1/import.json";
const resultPath = "benchmarks/zero5-c31-v1/result.json";
const frozenResultSha256 =
  "dbe4dd29d5f4ea20180c5cc5b76cb48e77edfba8a013563b1a4b6178205d453f";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const importBytes = fs.readFileSync(importPath);
const imported = JSON.parse(importBytes);

assert.equal(contract.schema, "zero.c31_braid_experiment.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.equal(sha256(fs.readFileSync(contract.implementation.trainer)),
  contract.implementation.trainer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.importer)),
  contract.implementation.importer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.runner)),
  contract.implementation.runner_sha256);
assert.equal(sha256(importBytes), contract.input.import_manifest_sha256);
assert.equal(imported.schema, "zero.c31_import.v1");
assert.equal(imported.view.id, contract.input.view_id);
assert.equal(imported.view.braid_commit, contract.input.braid_commit);
assert.equal(imported.view.manifest.sha256,
  contract.input.view_manifest_sha256);
assert.equal(imported.tokenizer.sha256, contract.input.tokenizer_sha256);
assert.equal(imported.outputs.train_blocked.sha256,
  contract.input.train_packs.blocked_sha256);
assert.equal(imported.outputs.train_interleaved.sha256,
  contract.input.train_packs.interleaved_sha256);
assert.equal(imported.outputs.train_blocked.packs,
  contract.training.pack_sequences);
assert.equal(imported.outputs.train_interleaved.packs,
  contract.training.pack_sequences);
assert.equal(imported.outputs.train_blocked.records,
  imported.outputs.train_interleaved.records);
assert.equal(imported.outputs.train_blocked.active_targets,
  imported.outputs.train_interleaved.active_targets);
assert.equal(imported.outputs.train_blocked.answer_targets,
  imported.outputs.train_interleaved.answer_targets);
assert.equal(imported.outputs.train_blocked.compute_token_exposures,
  imported.outputs.train_interleaved.compute_token_exposures);
assert.equal(imported.outputs.train_blocked.task_runs, 3);
assert.ok(imported.outputs.train_interleaved.task_runs > 36000);
assert.ok(imported.outputs.train_interleaved.maximum_same_task_pack_run <= 2);
assert.equal(contract.training.updates * contract.training.batch_sequences,
  contract.training.pack_sequences);
assert.equal(contract.training.pack_sequences * contract.model.context,
  contract.training.compute_token_exposures);
assert.equal(imported.test.parsed, false);
assert.equal(imported.test.tokenized, false);
assert.equal(imported.test.packed, false);
assert.equal(imported.test.metrics_opened, false);
assert.equal(contract.decision.replication_authorized, false);
assert.equal(contract.decision.broad_model_promotion_authorized, false);

for (const task of ["claim", "cloze", "retrieval"]) {
  const baseline = contract.baselines.completion[task].nats_per_target_token;
  assert.ok(Math.abs(
    contract.gates.completion_nats_per_target_token_maximum[task] -
      baseline * 0.9) < 1e-12);
}

const localImport = "build/zero5-c31-v1/import-final";
if (fs.existsSync(localImport)) {
  const paths = {
    "train.blocked.z5pack": imported.outputs.train_blocked.sha256,
    "train.interleaved.z5pack": imported.outputs.train_interleaved.sha256,
    "validation.interleaved.z5pack":
      imported.outputs.validation_interleaved.sha256,
  };
  for (const [file, expected] of Object.entries(paths)) {
    assert.equal(sha256(fs.readFileSync(path.join(localImport, file))), expected);
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-c31-check-"));
try {
  const packed = path.join(temporary, "tiny.z5pack");
  const checkpoint = path.join(temporary, "best.ckpt");
  writeTinyPack(packed);
  const mechanics = run("./zero5_c31_lm", [
    "--preset", "literary", "--context", "512", "--dim", "8",
    "--heads", "2", "--layers", "1", "--ff", "16", "--vocab", "128",
    "--packed-train", packed, "--packed-validation", packed,
    "--steps", "1", "--batch", "4", "--lr", "0.0001",
    "--warmup", "1", "--report", "1", "--validation", "4",
    "--best", checkpoint, "--answer-weight", "4", "--tokens", "0",
  ]);
  assert.match(mechanics,
    /packed sampling sequences=4 compute-token-exposures=2048 active-targets=16 answer-targets=4 padding-targets=2032 wraps=0 answer-weight=4/);
  assert.ok(fs.existsSync(checkpoint));
  assert.match(run("./zero5_c31_lm", [
    "--init", checkpoint, "--packed-validation", packed,
    "--eval-only", "--validation", "4",
  ]), /packed-evaluation-only val [0-9.]+ batches=4/);
  const corrupt = path.join(temporary, "corrupt.z5pack");
  const corruptBytes = fs.readFileSync(packed);
  corruptBytes[corruptBytes.length - 1] = 3;
  fs.writeFileSync(corrupt, corruptBytes);
  run("./zero5_c31_lm", [
    "--init", checkpoint, "--packed-validation", corrupt,
    "--eval-only", "--validation", "4",
  ], 1);
  assert.match(run("./zero5_c31_lm", ["--self-test"]),
    /35 finite-difference gradient checks passed/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (fs.existsSync(resultPath)) {
  const resultBytes = fs.readFileSync(resultPath);
  const result = JSON.parse(resultBytes);
  assert.equal(sha256(resultBytes), frozenResultSha256);
  assert.equal(result.schema, "zero.c31_braid_result.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.contract_sha256, sha256(contractBytes));
  assert.equal(result.implementation.trainer_sha256,
    contract.implementation.trainer_sha256);
  assert.equal(result.implementation.importer_sha256,
    contract.implementation.importer_sha256);
  assert.equal(result.implementation.runner_sha256,
    contract.implementation.runner_sha256);
  assert.deepEqual(Object.keys(result.arms), ["V", "A", "B"]);
  for (const arm of Object.values(result.arms)) {
    assert.equal(arm.training.completed_updates, contract.training.updates);
    assert.equal(arm.training.pack_sequences,
      contract.training.pack_sequences);
    assert.equal(arm.training.wraps, 0);
    assert.equal(arm.all_gates_pass, false);
  }
  assert.equal(result.arms.V.validation.combined_selection_nats_per_token,
    1.7623);
  assert.equal(result.arms.A.validation.combined_selection_nats_per_token,
    1.5666);
  assert.equal(result.arms.B.validation.combined_selection_nats_per_token,
    1.5694);
  assert.equal(result.arms.B.validation.completion.claim.nats_per_target_token,
    2.25829504);
  assert.equal(result.arms.B.validation.completion.cloze.nats_per_target_token,
    2.13800176);
  assert.equal(
    result.arms.B.validation.completion.retrieval.last_target_token_accuracy,
    0.547701434);
  assert.equal(result.arms.B.checkpoint.sha256,
    "bfadb8195c66a22ac3da4da88eb98648f3c60e7beed723c875cbca496fee330b");
  assert.equal(result.test.metrics_opened, false);
  assert.equal(result.decision.replication_authorized, false);
  assert.equal(result.decision.broad_model_promotion_authorized, false);
  assert.equal(result.decision.checkpoint_publication_authorized, false);
  assert.deepEqual(result.decision.eligible_arms, []);
  assert.equal(result.decision.preferred_arm, null);
  assert.equal(result.decision.outcome, "no-go");
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C3.1 frozen result passed"
  : "ZERO.5-C3.1 preregistration and record-safe mechanics passed");

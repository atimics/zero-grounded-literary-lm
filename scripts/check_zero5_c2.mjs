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

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

const contractPath = "benchmarks/zero5-c2-v1/contract.json";
const importPath = "benchmarks/zero5-c2-v1/import.json";
const resultPath = "benchmarks/zero5-c2-v1/result.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const importBytes = fs.readFileSync(importPath);
const imported = JSON.parse(importBytes);
const c1Bytes = fs.readFileSync(contract.initialization.c1_result);
const c1 = JSON.parse(c1Bytes);

assert.equal(contract.schema, "zero.c_continued_training_experiment.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.equal(sha256(fs.readFileSync(contract.implementation.trainer)),
  contract.implementation.trainer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.importer)),
  contract.implementation.importer_sha256);
assert.equal(sha256(importBytes), contract.input.import_manifest_sha256);
assert.equal(sha256(c1Bytes), contract.initialization.c1_result_sha256);
assert.equal(c1.seeds[0].checkpoint.sha256,
  contract.initialization.checkpoint_sha256);
assert.equal(imported.collection.id, contract.input.collection_id);
assert.equal(imported.collection.braid_commit, contract.input.braid_commit);
assert.deepEqual(imported.stages, [
  { order: 1, member: "anchors", split: "train" },
  { order: 2, member: "atlas", split: "train" },
]);
assert.equal(imported.rights.anchors, "CC0-1.0");
assert.equal(imported.rights.atlas, "CC-BY-SA-4.0");
assert.equal(imported.rights.public_dataset_published, false);
assert.equal(imported.derived.atlas_train_tokens.tokens,
  contract.input.atlas_train.tokens);
assert.equal(imported.derived.atlas_train_tokens.sha256,
  contract.input.atlas_train.tokens_sha256);
assert.equal(imported.derived.atlas_validation_tokens.tokens,
  contract.input.atlas_validation.tokens);
assert.equal(imported.derived.atlas_validation_tokens.sha256,
  contract.input.atlas_validation.tokens_sha256);
assert.equal(imported.test.tokenizer_metrics_opened, false);
assert.equal(contract.training.token_exposures,
  contract.training.updates * contract.training.batch_sequences *
    contract.training.tokens_per_sequence);
assert.ok(Math.abs(contract.training.atlas_stream_equivalents -
  contract.training.token_exposures / contract.input.atlas_train.tokens) <
  1e-12);
assert.equal(contract.after_result.replication_seeds_authorized, false);
assert.equal(contract.after_result.checkpoint_publication_authorized, false);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-c2-check-"));
try {
  const train = path.join(temporary, "train.txt");
  const validation = path.join(temporary, "validation.txt");
  const checkpointA = path.join(temporary, "a.ckpt");
  const checkpointB = path.join(temporary, "b.ckpt");
  fs.writeFileSync(train,
    "ordered source document one. ordered source document two. ".repeat(80));
  fs.writeFileSync(validation,
    "held out source document. coherent validation prose. ".repeat(30));
  function mechanics(checkpoint) {
    return run("./zero5_c2_lm", [
      "--preset", "literary", "--context", "8", "--dim", "8",
      "--heads", "2", "--layers", "1", "--ff", "16",
      "--vocab", "128", "--text", train,
      "--validation-text", validation, "--sequential",
      "--steps", "4", "--batch", "4", "--lr", "0.001",
      "--warmup", "1", "--schedule-total", "4", "--cosine",
      "--dropout", "0.1", "--report", "4", "--validation", "2",
      "--best", checkpoint, "--seed", "7", "--tokens", "0",
    ]);
  }
  const first = mechanics(checkpointA);
  const second = mechanics(checkpointB);
  assert.match(first, /sampling=sequential-ordered/);
  assert.match(first,
    /sequential sampling windows=16 token-exposures=128 wraps=0/);
  assert.equal(sha256(fs.readFileSync(checkpointA)),
    sha256(fs.readFileSync(checkpointB)));
  assert.equal(first.replace(/tok\/s [0-9]+/, "tok/s X")
    .replace(/training time [0-9.]+ seconds/, "training time X seconds")
    .replaceAll(checkpointA, "CHECKPOINT"),
  second.replace(/tok\/s [0-9]+/, "tok/s X")
    .replace(/training time [0-9.]+ seconds/, "training time X seconds")
    .replaceAll(checkpointB, "CHECKPOINT"));
  assert.match(run("./zero5_c2_lm", ["--self-test"]),
    /35 finite-difference gradient checks passed/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (fs.existsSync(resultPath)) {
  const result = JSON.parse(fs.readFileSync(resultPath));
  assert.equal(result.schema, "zero.c_continued_training_result.v1");
  assert.equal(result.contract_sha256, sha256(contractBytes));
  assert.equal(result.implementation.trainer_sha256,
    contract.implementation.trainer_sha256);
  assert.equal(result.implementation.runner_sha256,
    sha256(fs.readFileSync(contract.implementation.runner)));
  assert.equal(result.training.completed_updates, contract.training.updates);
  assert.equal(result.training.ordered_stream_wraps,
    contract.training.expected_stream_wraps);
  assert.equal(result.training.token_exposures,
    contract.training.token_exposures);
  assert.equal(result.model.parameters, contract.model.parameters);
  assert.equal(result.model.positions, contract.model.positions);
  assert.equal(result.test.metrics_opened, false);
  assert.equal(result.rights.checkpoint_published, false);
  assert.equal(result.decision.replication_seeds_authorized, false);
  assert.equal(result.decision.checkpoint_publication_authorized, false);
  assert.equal(result.decision.outcome,
    result.decision.all_gates_pass ? "pass-c2-pilot" : "no-go");
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C2 frozen result passed"
  : "ZERO.5-C2 preregistration and ordered-sampling mechanics passed");

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

const contractPath = "benchmarks/zero5-c3-v1/contract.json";
const importPath = "benchmarks/zero5-c3-v1/import.json";
const resultPath = "benchmarks/zero5-c3-v1/result.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const importBytes = fs.readFileSync(importPath);
const imported = JSON.parse(importBytes);
const c2Bytes = fs.readFileSync(contract.initialization.c2_result);

assert.equal(contract.schema,
  "zero.c3_continued_training_experiment.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.equal(sha256(fs.readFileSync(contract.implementation.trainer)),
  contract.implementation.trainer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.importer)),
  contract.implementation.importer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.runner)),
  contract.implementation.runner_sha256);
assert.equal(sha256(importBytes), contract.input.import_manifest_sha256);
assert.equal(sha256(c2Bytes), contract.initialization.c2_result_sha256);
assert.equal(imported.collection.id, contract.input.collection_id);
assert.equal(imported.collection.braid_commit, contract.input.braid_commit);
assert.deepEqual(imported.stages.map(stage => stage.member),
  ["claims", "cloze", "retrieval"]);
assert.equal(imported.lineage_bridge.active_collection_id,
  contract.input.lineage_bridge.active_c2_collection_id);
assert.equal(imported.lineage_bridge.c3_upstream_collection_id,
  contract.input.lineage_bridge.c3_upstream_c2_collection_id);
assert.equal(imported.lineage_bridge.splits.atlas.train.sha256,
  contract.input.lineage_bridge.atlas_train_jsonl_sha256);
assert.equal(imported.rights.claims, "CC-BY-SA-4.0");
assert.equal(imported.rights.cloze, "CC-BY-SA-4.0");
assert.equal(imported.rights.retrieval, "CC-BY-SA-4.0");
assert.equal(imported.context_audit.original.retrieval.train.over_context,
  contract.input.context_view.original_retrieval_train_records_over_context);
assert.equal(imported.context_audit.retrieval_compaction.train
  .record_lengths.over_context, 0);
assert.ok(imported.context_audit.retrieval_compaction.train
  .record_lengths.maximum <= contract.model.context);
assert.equal(imported.context_audit.retrieval_compaction.test_view_created,
  false);
assert.equal(imported.derived.train_tokens.tokens,
  contract.input.train.tokens);
assert.equal(imported.derived.train_tokens.sha256,
  contract.input.train.tokens_sha256);
assert.equal(imported.derived.validation_tokens.tokens,
  contract.input.validation.tokens);
assert.equal(imported.derived.validation_tokens.sha256,
  contract.input.validation.tokens_sha256);
for (const task of ["claims", "cloze", "retrieval"]) {
  assert.equal(imported.derived.completion_validation[task].sha256,
    contract.input.completion_validation[task].sha256);
  assert.equal(imported.derived.completion_validation[task].records,
    contract.input.completion_validation[task].records);
}
assert.equal(imported.test.compact_view_created, false);
assert.equal(imported.test.tokenizer_metrics_opened, false);
assert.equal(contract.training.token_exposures,
  contract.training.updates * contract.training.batch_sequences *
    contract.training.tokens_per_sequence);
assert.ok(Math.abs(contract.training.c3_stream_equivalents -
  contract.training.token_exposures / contract.input.train.tokens) < 1e-12);
assert.equal(contract.after_result.token_matched_atlas_control_authorized,
  false);
assert.equal(contract.after_result.replication_seeds_authorized, false);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-c3-check-"));
try {
  const train = path.join(temporary, "train.txt");
  const validation = path.join(temporary, "validation.txt");
  const checkpoint = path.join(temporary, "model.ckpt");
  const completion = path.join(temporary, "completion.bin");
  fs.writeFileSync(train,
    "ordered source document one. ordered source document two. ".repeat(80));
  fs.writeFileSync(validation,
    "held out source document. coherent validation prose. ".repeat(30));
  const mechanics = run("./zero5_c3_lm", [
    "--preset", "literary", "--context", "8", "--dim", "8",
    "--heads", "2", "--layers", "1", "--ff", "16",
    "--vocab", "128", "--text", train,
    "--validation-text", validation, "--sequential",
    "--steps", "4", "--batch", "4", "--lr", "0.001",
    "--warmup", "1", "--schedule-total", "4", "--cosine",
    "--dropout", "0.1", "--report", "4", "--validation", "2",
    "--best", checkpoint, "--seed", "7", "--tokens", "0",
  ]);
  assert.match(mechanics, /sampling=sequential-ordered/);
  assert.match(mechanics,
    /sequential sampling windows=16 token-exposures=128 wraps=0/);
  const header = Buffer.alloc(24);
  Buffer.from([90, 53, 67, 69, 86, 49, 0, 0]).copy(header);
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(128, 12);
  header.writeUInt32LE(8, 16);
  header.writeUInt32LE(1, 20);
  const record = Buffer.alloc(20);
  record.writeUInt32LE(2, 0);
  record.writeUInt32LE(1, 4);
  record.writeUInt32LE(1, 8);
  record.writeUInt32LE(0, 12);
  record.writeUInt16LE(32, 16);
  record.writeUInt16LE(97, 18);
  fs.writeFileSync(completion, Buffer.concat([header, record]));
  assert.match(run("./zero5_c3_lm", [
    "--init", checkpoint, "--completion-eval", completion,
  ]), /"schema":"zero\.c3_completion_eval\.v1","records":1/);
  assert.match(run("./zero5_c3_lm", ["--self-test"]),
    /35 finite-difference gradient checks passed/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (fs.existsSync(resultPath)) {
  const resultBytes = fs.readFileSync(resultPath);
  assert.equal(sha256(resultBytes),
    "b3770868cb30017649f5dc662e5a8487c96cf9bb8132ebdcc81817501fef3421");
  const result = JSON.parse(resultBytes);
  assert.equal(result.schema, "zero.c3_continued_training_result.v1");
  assert.equal(result.contract_sha256, sha256(contractBytes));
  assert.equal(result.implementation.trainer_sha256,
    contract.implementation.trainer_sha256);
  assert.equal(result.implementation.importer_sha256,
    contract.implementation.importer_sha256);
  assert.equal(result.implementation.runner_sha256,
    contract.implementation.runner_sha256);
  assert.equal(result.training.completed_updates, contract.training.updates);
  assert.equal(result.training.ordered_stream_wraps,
    contract.training.expected_stream_wraps);
  assert.equal(result.training.token_exposures,
    contract.training.token_exposures);
  assert.equal(result.model.parameters, contract.model.parameters);
  assert.equal(result.test.metrics_opened, false);
  assert.equal(result.decision.task_structure_superiority_claim_authorized,
    false);
  assert.equal(result.decision.token_matched_atlas_control_authorized, false);
  assert.equal(result.decision.replication_seeds_authorized, false);
  assert.equal(result.decision.broad_model_promotion_authorized, false);
  assert.equal(result.decision.checkpoint_publication_authorized, false);
  assert.equal(result.rights.checkpoint_published, false);
  assert.equal(result.checkpoint.sha256,
    "ff19965c63db19fda3f179d9ab33b51ce40b3867f288a456a813f9bf4359487d");
  assert.equal(result.decision.all_gates_pass, false);
  assert.equal(result.gates.combined_validation_nats_per_token, true);
  assert.equal(result.gates.combined_relative_improvement, true);
  assert.equal(result.gates.claims_completion_nats_per_token, false);
  assert.equal(result.gates.cloze_completion_nats_per_token, false);
  assert.equal(result.gates.retrieval_completion_nats_per_token, true);
  assert.equal(result.gates.retrieval_choice_accuracy, false);
  assert.equal(result.gates.atlas_retention_nats_per_token, true);
  assert.equal(result.gates.anchor_retention_nats_per_token, true);
  assert.equal(result.validation.completion.retrieval.records, 2023);
  assert.equal(result.validation.completion.retrieval.teacher_forced_exact_accuracy,
    result.validation.completion.retrieval.last_target_token_accuracy);
  assert.equal(result.decision.outcome,
    result.decision.all_gates_pass ? "pass-c3-pilot" : "no-go");
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C3 frozen result passed"
  : "ZERO.5-C3 preregistration, context, and completion mechanics passed");

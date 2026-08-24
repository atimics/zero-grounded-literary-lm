#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const contractPath = "benchmarks/zero5-c1-v1/contract.json";
const resultPath = "benchmarks/zero5-c1-v1/result.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const c0Bytes = fs.readFileSync(contract.input.c0_result);
const c0 = JSON.parse(c0Bytes);

assert.equal(contract.schema, "zero.c_training_experiment.v1");
assert.equal(contract.experiment, "zero5-c1-v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.deepEqual(contract.training.seeds, [0, 1, 2]);
assert.equal(contract.training.repeat_seed_for_determinism, 0);
assert.equal(contract.model.parameters, 4852992);
assert.equal(contract.model.vocabulary, 512);
assert.equal(contract.training.token_exposures_per_seed,
  contract.training.updates * contract.training.batch_sequences *
    contract.training.tokens_per_sequence);
assert.ok(Math.abs(contract.training.train_stream_equivalents -
  contract.training.token_exposures_per_seed / contract.input.train_tokens) <
  1e-12);
assert.ok(Math.abs(contract.baselines.uniform_validation_nats_per_token -
  Math.log(contract.model.vocabulary)) < 1e-12);
assert.ok(Math.abs(contract.baselines.uniform_validation_bits_per_raw_byte -
  Math.log2(contract.model.vocabulary) * contract.input.validation_tokens /
    contract.input.validation_raw_bytes) < 1e-12);
assert.equal(contract.input.test_policy.includes("sealed"), true);
assert.equal(contract.gates.test_metrics_opened, false);
assert.equal(contract.after_result.broad_pretraining_authorized, false);
assert.equal(contract.after_result.test_evaluation_authorized, false);
assert.equal(sha256(fs.readFileSync("zero5_lm.c")),
  contract.implementation.trainer_sha256);
assert.equal(sha256(c0Bytes), contract.input.c0_result_sha256);
assert.equal(c0.braid.collection_id, contract.input.collection_id);
assert.equal(c0.braid.source_commit, contract.input.braid_commit);
assert.equal(c0.artifacts.byte_bpe512_vocabulary.sha256,
  contract.input.tokenizer_sha256);
assert.equal(c0.artifacts.byte_bpe512_train_tokens.sha256,
  contract.input.train_tokens_sha256);
assert.equal(c0.artifacts.byte_bpe512_validation_tokens.sha256,
  contract.input.validation_tokens_sha256);
assert.equal(c0.arms["byte-bpe512"].train_tokens,
  contract.input.train_tokens);
assert.equal(c0.arms["byte-bpe512"].validation_tokens,
  contract.input.validation_tokens);
assert.equal(c0.arms["byte-bpe512"].validation_raw_bytes,
  contract.input.validation_raw_bytes);
assert.equal(c0.braid.test.tokenizer_metrics_opened, false);

if (fs.existsSync(resultPath)) {
  const result = JSON.parse(fs.readFileSync(resultPath));
  assert.equal(result.schema, "zero.c_training_result.v1");
  assert.equal(result.experiment, contract.experiment);
  assert.equal(result.contract_sha256, sha256(contractBytes));
  assert.equal(result.implementation.trainer_sha256,
    contract.implementation.trainer_sha256);
  assert.equal(result.implementation.runner_sha256,
    sha256(fs.readFileSync(contract.implementation.orchestration)));
  assert.deepEqual(result.seeds.map(row => row.seed), [0, 1, 2]);
  for (const row of result.seeds) {
    assert.equal(row.completed_updates, contract.training.updates);
    assert.equal(row.model_parameters, contract.model.parameters);
    assert.equal(row.positions, contract.model.positions);
    assert.equal(row.validation_windows, contract.training.validation_windows);
    assert.equal(row.reports.length,
      contract.training.updates / contract.training.report_every_updates);
    assert.match(row.checkpoint.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isFinite(row.best_validation_nats_per_token));
    assert.ok(Number.isFinite(row.best_validation_bits_per_raw_byte));
  }
  assert.equal(result.determinism.seed, 0);
  assert.equal(result.determinism.byte_identical_checkpoint, true);
  assert.equal(result.determinism.original_checkpoint_sha256,
    result.determinism.repeat_checkpoint_sha256);
  assert.equal(result.test.metrics_opened, false);
  assert.equal(result.decision.broad_pretraining_authorized, false);
  assert.equal(result.decision.test_evaluation_authorized, false);
  assert.equal(result.decision.outcome,
    result.decision.all_gates_pass
      ? "pass-c-training-signal"
      : "no-go");
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C1 frozen result passed"
  : "ZERO.5-C1 preregistration passed; result not present");

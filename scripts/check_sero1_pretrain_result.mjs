#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

function read(path) { return JSON.parse(fs.readFileSync(path, "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function close(actual, expected, tolerance = 1e-12) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function pstdev(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

const base = "benchmarks/sero1-pretrain-v1";
const resultPaths = [0, 1, 2].map((seed) => `${base}/seed${seed}.json`);
const required = [...resultPaths, `${base}/aggregate.json`, `${base}/aws-runs.json`];
if (required.some((path) => !fs.existsSync(path))) {
  console.log("Sero 1 results are not present yet; frozen result check skipped");
  process.exit(0);
}
const contractBytes = fs.readFileSync(`${base}/contract.json`);
const contractDigest = crypto.createHash("sha256").update(contractBytes).digest("hex");
const contract = JSON.parse(contractBytes);
const results = resultPaths.map(read);
const aggregate = read(`${base}/aggregate.json`);
const receipts = read(`${base}/aws-runs.json`);
const validation = [];
const test = [];
const schedules = new Set();
const commits = new Set();

assert(aggregate.schema === "sero.pretrain_v1_aggregate.v1", "wrong aggregate schema");
assert(aggregate.contract_sha256 === contractDigest, "aggregate contract drifted");
assert(!aggregate.aggregate_override_used, "aggregate override is forbidden");
assert(receipts.schema === "sero.pretrain_v1_aws_runs.v1", "wrong AWS receipt schema");
for (const [index, result] of results.entries()) {
  const seed = contract.seeds[index];
  const receipt = receipts.full_runs[index];
  assert(result.schema === "sero.pretrain_v1_seed_result.v1" && result.mode === "full",
    `seed ${seed} is not a full Sero 1 result`);
  assert(result.seed === seed && result.contract.sha256 === contractDigest,
    `seed ${seed} contract or ordering drifted`);
  assert(result.data.dataset_digest === contract.data.dataset_digest &&
    result.tokenizer.artifact_sha256 === contract.tokenizer.artifact_sha256,
  `seed ${seed} data or tokenizer drifted`);
  assert(result.model.parameters === contract.model.expected_parameters,
    `seed ${seed} model shape drifted`);
  assert(result.data.document_boundaries_crossed === false,
    `seed ${seed} crossed a document boundary`);
  assert(result.training.raw_bytes === contract.data.unique_training_bytes *
    contract.training.epochs, `seed ${seed} did not complete three epochs`);
  assert(result.training.tokens === result.data.token_counts.train * contract.training.epochs,
    `seed ${seed} token exposure drifted`);
  assert(result.checkpoints.length === contract.training.checkpoint_epochs.length,
    `seed ${seed} checkpoint count drifted`);
  assert(result.final_test && result.final_test.split === "test",
    `seed ${seed} has no held-out test`);
  const epochOne = result.checkpoints.find((row) => row.nominal_epoch === 1);
  const expectedGates = {
    validation_bits_per_byte: result.final_validation.bits_per_byte <=
      contract.gates.validation_bits_per_byte_maximum_each_seed,
    test_bits_per_byte: result.final_test.bits_per_byte <=
      contract.gates.test_bits_per_byte_maximum_each_seed,
    final_validation_beats_epoch_one: result.final_validation.bits_per_byte <
      epochOne.validation.bits_per_byte,
  };
  assert(JSON.stringify(result.gates.values) === JSON.stringify(expectedGates),
    `seed ${seed} gates are inconsistent`);
  assert(result.gates.decision === (Object.values(expectedGates).every(Boolean) ? "go" : "no-go"),
    `seed ${seed} decision is inconsistent`);
  assert(receipt.seed === seed && receipt.status === "complete" && receipt.exit_code === 0,
    `seed ${seed} AWS run did not complete cleanly`);
  const resultDigest = crypto.createHash("sha256").update(fs.readFileSync(resultPaths[index]))
    .digest("hex");
  assert(receipt.result_sha256 === resultDigest &&
    receipt.model_artifact_sha256 === result.model.artifact_sha256,
  `seed ${seed} AWS artifacts drifted`);
  assert(/^[0-9a-f]{40}$/u.test(result.runtime.git_commit),
    `seed ${seed} source commit is invalid`);
  schedules.add(result.data.schedule_sha256);
  commits.add(result.runtime.git_commit);
  validation.push(result.final_validation.bits_per_byte);
  test.push(result.final_test.bits_per_byte);
}
assert(schedules.size === 3, "seed schedules are not distinct");
assert(commits.size === 1, "source commit changed between seeds");
assert(close(aggregate.means.validation_bits_per_byte, mean(validation)) &&
  close(aggregate.means.test_bits_per_byte, mean(test)), "aggregate means drifted");
assert(close(aggregate.population_standard_deviations.validation_bits_per_byte,
  pstdev(validation)) && close(aggregate.population_standard_deviations.test_bits_per_byte,
  pstdev(test)), "aggregate deviations drifted");
const allPass = results.every((result) => result.gates.decision === "go");
assert(aggregate.all_seed_conjunction_passed === allPass && aggregate.decision ===
  (allPass ? "promote-sero1" : "do-not-promote-sero1"), "aggregate decision drifted");

console.log(`Sero 1 result accounting passed; decision=${aggregate.decision}`);

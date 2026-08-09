#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ACTIVATION = "benchmarks/zero4-q28-v1/activation-contract.json";
const BUDGET = "benchmarks/zero4-q28-v1/pilot-budget.json";
const Q26 = "benchmarks/zero4-q26-v1/contract.json";
const PROFILE_SHA256 =
  "de858b2cddc21cacb25a831e63ab30eba2e4ea9e944b3010d8ba6759653a0e4e";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} failed`);
}
function runRejected(command, args, expected) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
  assert.match(`${result.stdout}\n${result.stderr}`, expected);
}

export function validateActivation(contract, { checkFiles = true } = {}) {
  assert.equal(contract?.schema, "zero.zero4_q28_activation_contract.v1");
  assert.equal(contract.id, "zero4-q28-seed2-pilot-v1");
  assert.equal(contract.status,
    "implementation_authorized_run_not_authorized");
  assert.equal(contract.lineage.audited_merge_commit,
    "ea5242d0f65dd1e604c553a4d9aca9856347757e");
  assert.equal(contract.lineage.audit_contract.sha256,
    "e850b090abca32e9adf63fe53f5b70375fb2daed8228818fbd683a2904b0b805");
  assert.equal(contract.lineage.profile.sha256, PROFILE_SHA256);
  assert.equal(contract.lineage.initialization.sha256,
    "c865769461ef12374cadf3c5851016efb4bac06cf760e7599f610aa4cd35f137");
  if (checkFiles) {
    for (const binding of [
      contract.lineage.audit_contract,
      contract.lineage.profile,
      contract.lineage.initialization,
    ]) assert.equal(sha256(binding.path), binding.sha256,
      `${binding.path} hash drifted`);
  }
  const mechanics = contract.mechanics;
  assert.equal(mechanics.diagnostic_seed, 2);
  assert.equal(mechanics.maximum_optimizer_updates, 200);
  assert.deepEqual(mechanics.measurement_updates, [0, 100, 200]);
  assert.equal(mechanics.batch_size, 2);
  assert.equal(mechanics.learning_rate, 0.00002);
  assert.equal(mechanics.weight_decay, 0.01);
  assert.equal(mechanics.gradient_clip, 1);
  assert.equal(mechanics.quantity_samples_per_update, 2);
  assert.equal(mechanics.measurement_samples_per_range, 4);
  assert.match(mechanics.weight_update, /including weight decay/);
  assert.match(mechanics.weighted_projection, /every update/);
  assert.equal(mechanics.resume_allowed, false);
  assert.equal(mechanics.dynamic_profile_allowed, false);
  assert.equal(contract.inputs.tokenizer.path, "corpus/literary.bpe");
  assert.equal(contract.inputs.quantity.path,
    "corpus/faculty/q22/quantity-request.tok");
  assert.deepEqual(contract.inputs.replay.map(({ path }) => path), [
    "corpus/bpe/zero-foundation.tok", "corpus/bpe/shakespeare.tok",
    "corpus/bpe/blake.tok", "corpus/bpe/crowley.tok",
    "corpus/bpe/bible-kjv.tok", "corpus/channel/literary-dialogue.tok",
  ]);
  if (checkFiles) {
    const q26 = readJson(Q26);
    assert.equal(contract.inputs.tokenizer.sha256,
      q26.replay_corpus[contract.inputs.tokenizer.path]);
    assert.equal(contract.inputs.quantity.sha256,
      q26.quantity_corpus.tokens_sha256);
    for (const binding of contract.inputs.replay) {
      assert.equal(binding.sha256, q26.replay_corpus[binding.path],
        `${binding.path} differs from the frozen Q2.6 contract`);
    }
    for (const binding of [
      contract.inputs.tokenizer, contract.inputs.quantity,
      ...contract.inputs.replay,
    ]) {
      if (fs.existsSync(binding.path)) {
        assert.equal(sha256(binding.path), binding.sha256,
          `${binding.path} training input hash drifted`);
      }
    }
  }
  assert.equal(contract.inputs.cli_input_overrides_allowed, false);
  const selection = contract.candidate_selection;
  assert.deepEqual(selection.eligible_updates, [100, 200]);
  assert.equal(selection.quantity_training_loss_relative_improvement_minimum,
    0.005);
  assert.equal(selection.replay_training_loss_relative_regression_maximum,
    0.02);
  assert.equal(selection.public_quantity_rows_before_freeze, false);
  assert.equal(selection.language_metrics_before_freeze, false);
  assert.equal(contract.budget.maximum_quantity_compute_usd, 0.5);
  assert.equal(contract.budget.conditional_language_gate_usd, 0.12);
  assert.equal(contract.budget.promotion_authorized, false);
  const implementation = contract.implementation_authorization;
  assert.equal(implementation.issue, 74);
  assert.equal(implementation.authorized, true);
  assert.equal(implementation.base_commit,
    contract.lineage.audited_merge_commit);
  assert.equal(implementation.profile_sha256, PROFILE_SHA256);
  for (const field of [
    "workflow_dispatch", "aws_compute", "parameter_training",
    "language_gate_execution", "promotion",
  ]) assert.equal(implementation[field], false,
    `implementation unexpectedly authorizes ${field}`);
  assert.equal(contract.run_authorization.authorized, false);
  assert.equal(contract.run_authorization.one_execution_only, true);
  assert.deepEqual(contract.run_authorization.required_exact_bindings, [
    "merged activation commit",
    "profile SHA-256",
    "200-update ceiling",
    "$0.50 quantity-compute ceiling",
    "conditional $0.12 language-gate ceiling",
  ]);
  return contract;
}

function selfTest(contract) {
  for (const mutate of [
    (copy) => { copy.mechanics.maximum_optimizer_updates = 201; },
    (copy) => { copy.mechanics.measurement_updates = [0, 50, 200]; },
    (copy) => { copy.inputs.cli_input_overrides_allowed = true; },
    (copy) => { copy.budget.maximum_quantity_compute_usd = 0.51; },
    (copy) => { copy.budget.conditional_language_gate_usd = 0.13; },
    (copy) => { copy.implementation_authorization.parameter_training = true; },
    (copy) => { copy.run_authorization.authorized = true; },
  ]) {
    const copy = structuredClone(contract);
    mutate(copy);
    assert.throws(() => validateActivation(copy, { checkFiles: false }));
  }
  console.log("Q2.8 activation contract mutation self-test passed");
}

function parseArgs(argv) {
  const options = { mechanics: null };
  for (let index = 2; index < argv.length; ++index) {
    if (argv[index] === "--mechanics" && index + 1 < argv.length) {
      options.mechanics = argv[++index];
    } else {
      throw new Error(`unknown or incomplete option ${argv[index]}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv);
const activation = validateActivation(readJson(ACTIVATION));
selfTest(activation);
const budget = readJson(BUDGET);
assert.equal(budget.schema, "zero.q28_graded_plasticity_pilot_budget.v1");
assert.equal(budget.status,
  "activation_implementation_authorized_run_not_authorized");
assert.equal(budget.profile.sha256, PROFILE_SHA256);
assert.equal(budget.proposed.maximum_optimizer_updates, 200);
assert.deepEqual(budget.proposed.checkpoint_updates, [0, 100, 200]);
assert.equal(budget.proposed.maximum_quantity_compute_usd, 0.5);
assert.equal(budget.proposed.conditional_language_gate_usd, 0.12);
assert.equal(budget.implementation_authorization.issue, 74);
assert.equal(budget.implementation_authorization.authorized, true);
assert.equal(budget.implementation_authorization.base_commit,
  activation.lineage.audited_merge_commit);
assert.equal(budget.implementation_authorization.profile_sha256,
  PROFILE_SHA256);
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_quantity_compute_usd, 0);
assert.equal(budget.authorization.conditional_language_gate_usd, 0);
assert.equal(budget.authorization.language_gate_authorized, false);
assert.equal(budget.authorization.promotion_authorized, false);

const mechanicsSource = fs.readFileSync("graded_plasticity_pilot.c", "utf8");
for (const required of [
  "Q28_PILOT_SEED 2", "Q28_PILOT_UPDATES 200",
  "Q28_PILOT_MEASURE_SAMPLES 4", "q28_apply_candidate",
  "q28_project_candidate", "q28_pilot_fresh_moments",
  "measurement_updates\\\":[0,100,200]", "language_gate_run\\\":false",
  "promotion_run\\\":false",
]) assert(mechanicsSource.includes(required), `mechanics lacks ${required}`);
for (const forbidden of [
  "--init", "--quantity", "--profile", "--steps", "--seed", "--resume",
]) assert(!mechanicsSource.includes(forbidden),
  `mechanics exposes forbidden override ${forbidden}`);
const driverSource = fs.readFileSync("scripts/run_zero4_q28_pilot.mjs", "utf8");
for (const required of [
  "validateAuthorization", "validateInputLocks", "selectCandidate",
  "MAXIMUM_UPDATES = 200",
  "MAXIMUM_QUANTITY_COMPUTE_USD = 0.5",
  "CONDITIONAL_LANGUAGE_GATE_USD = 0.12",
  "language_gate_run", "promotion_run",
]) assert(driverSource.includes(required), `driver lacks ${required}`);
const documentation = fs.readFileSync(
  "benchmarks/zero4-q28-v1/ACTIVATION.md", "utf8");
for (const required of [
  "fresh AdamW moments", "updates 0, 100, and 200", "at least 0.5%",
  "no more than 2%", "$0.50", "$0.12", "never executes",
]) assert(documentation.includes(required),
  `activation documentation lacks ${required}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q28-(?:pilot|train):/m.test(makefile),
  "implementation added an unauthorized runnable Make target");
run("node", ["scripts/run_zero4_q28_pilot.mjs", "--self-test"]);
const unauthorizedOutput = `/tmp/zero-q28-unauthorized-${process.pid}`;
assert.equal(fs.existsSync(unauthorizedOutput), false);
runRejected("node", [
  "scripts/run_zero4_q28_pilot.mjs",
  "--authorization", BUDGET,
  "--out", unauthorizedOutput,
  "--mechanics", options.mechanics ?? "./graded_plasticity_pilot",
], /run_authorized/);
assert.equal(fs.existsSync(unauthorizedOutput), false,
  "unauthorized pilot created output");
if (options.mechanics) run(options.mechanics, ["--self-test"]);
console.log("Q2.8 fixed graded-plasticity activation contract passed");

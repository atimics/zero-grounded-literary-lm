#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const DECISION = "benchmarks/zero4-post-q28-v1/decision.json";
const CONTRACT = "benchmarks/zero4-q29-v1/contract.json";
const ACTIVATION = "benchmarks/zero4-q29-v1/activation-contract.json";
const BUDGET = "benchmarks/zero4-q29-v1/pilot-budget.json";
const PREREG = "benchmarks/zero4-q29-v1/PREREGISTRATION.md";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
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
function close(actual, expected, tolerance = 1e-12) {
  assert(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`);
}
function unpackBits(trace) {
  assert.equal(trace.encoding, "base64-packed-lsb-first-v1");
  const packed = Buffer.from(trace.data, "base64");
  assert.equal(packed.length, trace.bytes);
  assert.equal(crypto.createHash("sha256").update(packed).digest("hex"),
    trace.sha256);
  return Array.from({ length: trace.cases }, (_, index) =>
    (packed[Math.floor(index / 8)] >> (index % 8)) & 1);
}
function unpackTiny(trace) {
  assert.equal(trace.encoding, "base64-utf8-tsv-ordinal-bits-bytes-v1");
  const raw = Buffer.from(trace.data, "base64");
  assert.equal(raw.length, trace.bytes);
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"),
    trace.sha256);
  const rows = raw.toString("utf8").trim().split("\n").map((row) => {
    const [ordinal, bits, bytes] = row.split("\t").map(Number);
    return { ordinal, bits, bytes };
  });
  assert.equal(rows.length, trace.cases);
  rows.forEach(({ ordinal }, index) => assert.equal(ordinal, index));
  return rows;
}
function binomialCoefficient(n, k) {
  let value = 1;
  for (let index = 1; index <= k; ++index) {
    value = value * (n - k + index) / index;
  }
  return value;
}
function exactTwoSidedMcNemar(leftOnly, rightOnly) {
  const discordant = leftOnly + rightOnly;
  const lower = Math.min(leftOnly, rightOnly);
  let tail = 0;
  for (let index = 0; index <= lower; ++index) {
    tail += binomialCoefficient(discordant, index) / (2 ** discordant);
  }
  return Math.min(1, 2 * tail);
}
function parseArgs(argv) {
  const options = { mechanics: null };
  for (let index = 2; index < argv.length; ++index) {
    assert.equal(argv[index], "--mechanics");
    assert(index + 1 < argv.length);
    options.mechanics = argv[++index];
  }
  return options;
}

const options = parseArgs(process.argv);
const decision = readJson(DECISION);
assert.equal(decision.schema,
  "zero.post_q28_conservative_exposure_decision.v1");
assert.equal(decision.status,
  "q29_implementation_authorized_run_not_authorized");
assert.equal(decision.implementation_issue, 83);
for (const binding of Object.values(decision.frozen_evidence)) {
  assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} evidence hash drifted`);
}

const quantity = readJson(
  decision.frozen_evidence.q28_quantity_result.path);
const update100Quantity = quantity.selection.candidates.find(
  ({ update }) => update === 100);
const update200Quantity = quantity.selection.candidates.find(
  ({ update }) => update === 200);
close(update100Quantity.quantity_improvement,
  decision.observations.q28_update100.quantity_training_improvement);
close(update100Quantity.replay_regression,
  decision.observations.q28_update100.replay_training_regression);
close(update200Quantity.quantity_improvement,
  decision.observations.q28_update200.quantity_training_improvement);
close(update200Quantity.replay_regression,
  decision.observations.q28_update200.replay_training_regression);

const update100Language = readJson(
  decision.frozen_evidence.q28_update100_language_result.path);
const update200Language = readJson(
  decision.frozen_evidence.q28_update200_language_result.path);
for (const [result, observation] of [
  [update100Language, decision.observations.q28_update100],
  [update200Language, decision.observations.q28_update200],
]) {
  assert.equal(result.decision.pass, false);
  close(result.decision.checks.blimp_raw_accuracy.value,
    observation.blimp_raw_accuracy);
  close(result.decision.checks.tinystories_bits_per_byte.value,
    observation.tinystories_bits_per_byte);
}
const tiny100 = unpackTiny(
  update100Language.tasks.tinystories.paired_trace.target_scores);
const tiny200 = unpackTiny(
  update200Language.tasks.tinystories.paired_trace.target_scores);
const tinyCounts = { better: 0, equal: 0, worse: 0 };
for (let index = 0; index < tiny100.length; ++index) {
  assert.equal(tiny100[index].bytes, tiny200[index].bytes);
  if (tiny100[index].bits < tiny200[index].bits) ++tinyCounts.better;
  else if (tiny100[index].bits === tiny200[index].bits) ++tinyCounts.equal;
  else ++tinyCounts.worse;
}
const paired = decision.observations.paired_update100_vs_update200;
assert.deepEqual(tinyCounts, {
  better: paired.tinystories_update100_better_cases,
  equal: paired.tinystories_equal_cases,
  worse: paired.tinystories_update100_worse_cases,
});
close(update100Language.tasks.tinystories.metrics.bits_per_byte -
  update200Language.tasks.tinystories.metrics.bits_per_byte,
paired.tinystories_bits_per_byte_difference);

const blimp100 = unpackBits(
  update100Language.tasks.blimp.paired_trace.raw_correct);
const blimp200 = unpackBits(
  update200Language.tasks.blimp.paired_trace.raw_correct);
const blimpCounts = {
  both_correct: 0, update100_only: 0, update200_only: 0, both_wrong: 0,
};
for (let index = 0; index < blimp100.length; ++index) {
  if (blimp100[index] && blimp200[index]) ++blimpCounts.both_correct;
  else if (blimp100[index]) ++blimpCounts.update100_only;
  else if (blimp200[index]) ++blimpCounts.update200_only;
  else ++blimpCounts.both_wrong;
}
assert.deepEqual(blimpCounts, {
  both_correct: paired.blimp_both_correct,
  update100_only: paired.blimp_update100_only_correct,
  update200_only: paired.blimp_update200_only_correct,
  both_wrong: paired.blimp_both_wrong,
});
close(exactTwoSidedMcNemar(blimpCounts.update100_only,
  blimpCounts.update200_only), paired.blimp_mcnemar_exact_two_sided_p);

const contract = readJson(CONTRACT);
assert.equal(contract.schema,
  "zero.zero4_q29_conservative_exposure_contract.v1");
assert.equal(contract.status, "implementation_authorized_run_not_authorized");
assert.equal(contract.training_allowed, false);
assert.equal(sha256(contract.lineage.post_q28_decision.path),
  contract.lineage.post_q28_decision.sha256);
for (const binding of Object.values(contract.lineage)) {
  assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} contract lineage drifted`);
}
assert.equal(contract.pilot.authorized, false);
assert.equal(contract.pilot.one_execution_only, true);
assert.equal(contract.pilot.diagnostic_seed, 2);
assert.equal(contract.pilot.maximum_optimizer_updates, 100);
assert.deepEqual(contract.pilot.measurement_updates, [0, 25, 50, 75, 100]);
assert.equal(contract.pilot.stop_rule
  .quantity_training_loss_relative_improvement_minimum, 0.8);
assert.equal(contract.pilot.stop_rule
  .replay_training_loss_relative_regression_maximum, 0.0075);
assert.deepEqual(contract.pilot.stop_rule.evaluation_order,
  ["replay guard", "quantity first hit", "update cap"]);
assert.equal(contract.pilot.stop_rule.stop_immediately, true);
assert.equal(contract.pilot.maximum_quantity_compute_usd, 0.25);
assert.equal(contract.language_gate.authorized, false);
assert.equal(contract.language_gate.maximum_candidates, 1);
assert.equal(contract.pilot.promotion_authorized, false);

const activation = readJson(ACTIVATION);
assert.equal(activation.schema, "zero.zero4_q29_activation_contract.v1");
assert.equal(activation.lineage.contract.path, CONTRACT);
assert.equal(activation.lineage.contract.sha256, sha256(CONTRACT));
assert.equal(activation.candidate_selection.ranking,
  "first eligible checkpoint only");
assert.equal(activation.candidate_selection.replay_guard_evaluated_first,
  true);
assert.equal(activation.candidate_selection.stop_immediately, true);
for (const binding of [activation.lineage.profile,
  activation.lineage.initialization]) {
  assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} activation lineage drifted`);
}
const q26 = readJson("benchmarks/zero4-q26-v1/contract.json");
assert.equal(activation.inputs.tokenizer.sha256,
  q26.replay_corpus[activation.inputs.tokenizer.path]);
assert.equal(activation.inputs.quantity.sha256,
  q26.quantity_corpus.tokens_sha256);
for (const binding of activation.inputs.replay) {
  assert.equal(binding.sha256, q26.replay_corpus[binding.path],
    `${binding.path} differs from the frozen Q2.6 contract`);
}
for (const binding of [activation.inputs.tokenizer,
  activation.inputs.quantity, ...activation.inputs.replay]) {
  if (fs.existsSync(binding.path)) {
    assert.equal(sha256(binding.path), binding.sha256,
      `${binding.path} activation input drifted`);
  }
}

const budget = readJson(BUDGET);
assert.equal(budget.schema,
  "zero.q29_conservative_exposure_pilot_budget.v1");
assert.equal(budget.status,
  "activation_implementation_authorized_run_not_authorized");
assert.equal(budget.implementation_authorization.issue, 83);
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_quantity_compute_usd, 0);
assert.equal(budget.authorization.language_gate_authorized, false);
assert.equal(budget.authorization.promotion_authorized, false);

const source = fs.readFileSync("conservative_exposure_pilot.c", "utf8");
for (const required of [
  "Q29_PILOT_UPDATES 100", "Q29_PILOT_MEASUREMENT_CADENCE 25",
  "Q29_PILOT_QUANTITY_IMPROVEMENT_MINIMUM 0.8",
  "Q29_PILOT_REPLAY_REGRESSION_MAXIMUM 0.0075",
  "q29_pilot_stop_reason", "replay-guard", "first-hit", "update-cap",
  "q28_apply_candidate", "q28_project_candidate",
]) assert(source.includes(required), `pilot mechanics lack ${required}`);
for (const forbidden of ["--seed", "--resume", "--init", "--profile",
  "--quantity", "--replay", "--language", "--promotion"]) {
  assert(!source.includes(`strcmp(argv[index], \"${forbidden}\")`),
    `pilot exposes forbidden override ${forbidden}`);
}
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q29-(?:train|run):/m.test(makefile),
  "Makefile exposes an unauthorized Q2.9 execution target");
assert(!fs.existsSync("benchmarks/zero4-q29-v1/results"),
  "Q2.9 implementation PR must not contain execution results");
const prereg = fs.readFileSync(PREREG, "utf8");
for (const phrase of ["0.75%", "80%", "updates 0, 25, 50, 75, and 100",
  "first eligible", "not authorize a pilot run"]) {
  assert(prereg.includes(phrase), `preregistration lacks ${phrase}`);
}

run("node", ["scripts/materialize_q29_pilot_budget.mjs", "--self-test"]);
run("node", ["scripts/run_zero4_q29_pilot.mjs", "--self-test"]);
const unauthorizedOutput = `/tmp/zero-q29-unauthorized-${process.pid}`;
assert.equal(fs.existsSync(unauthorizedOutput), false);
runRejected("node", [
  "scripts/run_zero4_q29_pilot.mjs",
  "--authorization", BUDGET,
  "--out", unauthorizedOutput,
  "--mechanics", options.mechanics ?? "./conservative_exposure_pilot",
], /run_authorized/);
assert.equal(fs.existsSync(unauthorizedOutput), false,
  "unauthorized Q2.9 pilot created output");
if (options.mechanics) run(options.mechanics, ["--self-test"]);
console.log("Q2.9 conservative-exposure implementation contract passed");

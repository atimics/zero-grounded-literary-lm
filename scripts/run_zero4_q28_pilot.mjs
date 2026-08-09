#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PROFILE = "benchmarks/zero4-q28-v1/audit/profile.tsv";
const ACTIVATION = "benchmarks/zero4-q28-v1/activation-contract.json";
const PROFILE_SHA256 =
  "de858b2cddc21cacb25a831e63ab30eba2e4ea9e944b3010d8ba6759653a0e4e";
const MAXIMUM_UPDATES = 200;
const MEASUREMENT_UPDATES = Object.freeze([0, 100, 200]);
const MAXIMUM_QUANTITY_COMPUTE_USD = 0.5;
const CONDITIONAL_LANGUAGE_GATE_USD = 0.12;
const MINIMUM_QUANTITY_IMPROVEMENT = 0.005;
const MAXIMUM_REPLAY_REGRESSION = 0.02;

function fail(message) { throw new Error(message); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${command} exited ${result.status}`);
  return result.stdout;
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateAuthorization(budget, sourceCommit) {
  assert.equal(budget?.schema, "zero.q28_graded_plasticity_pilot_budget.v1");
  assert.equal(budget.id, "zero4-q28-seed2-pilot-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.profile.path, PROFILE);
  assert.equal(budget.profile.sha256, PROFILE_SHA256);
  assert.equal(budget.proposed.diagnostic_seed, 2);
  assert.equal(budget.proposed.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.deepEqual(budget.proposed.checkpoint_updates, MEASUREMENT_UPDATES);
  assert.equal(
    budget.proposed.maximum_quantity_compute_usd,
    MAXIMUM_QUANTITY_COMPUTE_USD,
  );
  assert.equal(
    budget.proposed.conditional_language_gate_usd,
    CONDITIONAL_LANGUAGE_GATE_USD,
  );
  assert.equal(
    budget.proposed.language_gate_condition,
    "one frozen candidate first passes all quantity and replay criteria",
  );
  assert.equal(budget.proposed.promotion_authorized, false);
  const authorization = budget.authorization;
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.one_execution_only, true);
  assert.match(authorization.approved_by, /^[A-Za-z0-9_.-]+$/);
  assert.match(authorization.approved_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(authorization.source_commit, /^[0-9a-f]{40}$/);
  assert.equal(authorization.source_commit, sourceCommit);
  assert.equal(authorization.profile_sha256, PROFILE_SHA256);
  assert.equal(authorization.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.equal(
    authorization.maximum_quantity_compute_usd,
    MAXIMUM_QUANTITY_COMPUTE_USD,
  );
  assert.equal(
    authorization.conditional_language_gate_usd,
    CONDITIONAL_LANGUAGE_GATE_USD,
  );
  assert.equal(authorization.language_gate_authorized, true);
  assert.equal(authorization.promotion_authorized, false);
  return budget;
}

export function validateInputLocks(activation) {
  assert.equal(activation?.schema,
    "zero.zero4_q28_activation_contract.v1");
  assert.equal(activation.lineage.audited_merge_commit,
    "ea5242d0f65dd1e604c553a4d9aca9856347757e");
  assert.equal(activation.lineage.profile.path, PROFILE);
  assert.equal(activation.lineage.profile.sha256, PROFILE_SHA256);
  assert.deepEqual(activation.inputs.replay.map(({ path: file }) => file), [
    "corpus/bpe/zero-foundation.tok", "corpus/bpe/shakespeare.tok",
    "corpus/bpe/blake.tok", "corpus/bpe/crowley.tok",
    "corpus/bpe/bible-kjv.tok", "corpus/channel/literary-dialogue.tok",
  ]);
  for (const binding of [
    activation.lineage.audit_contract, activation.lineage.profile,
    activation.lineage.initialization, activation.inputs.tokenizer,
    activation.inputs.quantity, ...activation.inputs.replay,
  ]) assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} source lock drifted`);
  return activation;
}

export function selectCandidate(measurements) {
  assert.deepEqual(measurements.map(({ update }) => update),
    MEASUREMENT_UPDATES);
  const baseline = measurements[0];
  assert(Number.isFinite(baseline.quantity_training_loss) &&
    baseline.quantity_training_loss > 0);
  assert(Number.isFinite(baseline.replay_training_loss) &&
    baseline.replay_training_loss > 0);
  const candidates = measurements.slice(1).map((measurement) => {
    const quantityImprovement =
      (baseline.quantity_training_loss - measurement.quantity_training_loss) /
      baseline.quantity_training_loss;
    const replayRegression =
      (measurement.replay_training_loss - baseline.replay_training_loss) /
      baseline.replay_training_loss;
    return {
      ...measurement,
      quantity_improvement: quantityImprovement,
      replay_regression: replayRegression,
      feasible: quantityImprovement >= MINIMUM_QUANTITY_IMPROVEMENT &&
        replayRegression <= MAXIMUM_REPLAY_REGRESSION,
    };
  });
  const feasible = candidates.filter(({ feasible }) => feasible).sort(
    (left, right) =>
      right.quantity_improvement - left.quantity_improvement ||
      left.replay_training_loss - right.replay_training_loss ||
      left.update - right.update,
  );
  return { baseline, candidates, selected: feasible[0] ?? null };
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null,
    mechanics: "./graded_plasticity_pilot" };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!option.startsWith("--") || index + 1 >= argv.length) {
      fail(`unknown or incomplete option ${option}`);
    }
    const key = option.slice(2);
    assert(Object.hasOwn(options, key), `unknown option ${option}`);
    options[key] = argv[++index];
  }
  assert(options.authorization, "pilot requires --authorization");
  assert(options.out, "pilot requires --out");
  return options;
}

function selfTest() {
  const source = "a".repeat(40);
  const budget = {
    schema: "zero.q28_graded_plasticity_pilot_budget.v1",
    id: "zero4-q28-seed2-pilot-v1",
    status: "run_authorized",
    profile: { path: PROFILE, sha256: PROFILE_SHA256 },
    proposed: {
      source_commit: "exact merged activation commit",
      diagnostic_seed: 2,
      maximum_optimizer_updates: 200,
      checkpoint_updates: [0, 100, 200],
      maximum_quantity_compute_usd: 0.5,
      conditional_language_gate_usd: 0.12,
      language_gate_condition:
        "one frozen candidate first passes all quantity and replay criteria",
      promotion_authorized: false,
    },
    authorization: {
      authorized: true,
      one_execution_only: true,
      approved_by: "atimics",
      approved_at: "2026-08-09T00:00:00Z",
      source_commit: source,
      profile_sha256: PROFILE_SHA256,
      maximum_optimizer_updates: 200,
      maximum_quantity_compute_usd: 0.5,
      conditional_language_gate_usd: 0.12,
      language_gate_authorized: true,
      promotion_authorized: false,
    },
  };
  validateAuthorization(budget, source);
  for (const mutate of [
    (copy) => { copy.status = "proposal_not_authorized"; },
    (copy) => { copy.proposed.maximum_optimizer_updates = 201; },
    (copy) => { copy.proposed.checkpoint_updates = [0, 50, 200]; },
    (copy) => { copy.authorization.authorized = false; },
    (copy) => { copy.authorization.source_commit = "b".repeat(40); },
    (copy) => { copy.authorization.maximum_quantity_compute_usd = 0.51; },
    (copy) => { copy.authorization.conditional_language_gate_usd = 0.13; },
    (copy) => { copy.authorization.promotion_authorized = true; },
  ]) {
    const copy = structuredClone(budget);
    mutate(copy);
    assert.throws(() => validateAuthorization(copy, source));
  }
  const selection = selectCandidate([
    { update: 0, quantity_training_loss: 2, replay_training_loss: 1 },
    { update: 100, quantity_training_loss: 1.98, replay_training_loss: 1.01 },
    { update: 200, quantity_training_loss: 1.95, replay_training_loss: 1.03 },
  ]);
  assert.equal(selection.selected.update, 100);
  assert.equal(selection.candidates[1].feasible, false);
  assert.throws(() => selectCandidate([
    { update: 0, quantity_training_loss: 2, replay_training_loss: 1 },
    { update: 50, quantity_training_loss: 1.9, replay_training_loss: 1 },
    { update: 200, quantity_training_loss: 1.8, replay_training_loss: 1 },
  ]));
  console.log("Q2.8 pilot authorization and selection self-test passed");
}

function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  const sourceCommit = run("git", ["rev-parse", "HEAD"], { quiet: true }).trim();
  const budget = validateAuthorization(readJson(options.authorization),
    sourceCommit);
  validateInputLocks(readJson(ACTIVATION));
  assert(!fs.existsSync(options.out), "pilot output already exists");
  const authorizationSha256 = sha256(options.authorization);
  fs.mkdirSync(options.out, { recursive: false });
  const eventsPath = path.join(options.out, "events.jsonl");
  run(options.mechanics, [
    "--out-prefix", path.join(options.out, "checkpoint"),
    "--events", eventsPath,
    "--authorization-sha256", authorizationSha256,
  ]);
  const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n")
    .map(JSON.parse);
  assert(events.every(({ schema }) => schema ===
    "zero.zero4_q28_pilot_event.v1"));
  assert.equal(events.filter(({ type }) => type === "update").length,
    MAXIMUM_UPDATES);
  const complete = events.filter(({ type }) => type === "complete");
  assert.equal(complete.length, 1);
  assert.equal(complete[0].updates_committed, MAXIMUM_UPDATES);
  assert.equal(complete[0].language_gate_run, false);
  assert.equal(complete[0].promotion_run, false);
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, quantity_training_loss, replay_training_loss,
      learned_state_digest }) => ({
      update, quantity_training_loss, replay_training_loss,
      learned_state_digest,
    }));
  const selection = selectCandidate(measurements);
  let candidate = null;
  if (selection.selected) {
    const source = path.join(options.out,
      `checkpoint-u${String(selection.selected.update).padStart(6, "0")}.ckpt`);
    const target = path.join(options.out, "candidate.ckpt");
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    candidate = {
      update: selection.selected.update,
      path: target,
      sha256: sha256(target),
      quantity_improvement: selection.selected.quantity_improvement,
      replay_regression: selection.selected.replay_regression,
    };
  }
  const result = {
    schema: "zero.zero4_q28_pilot_result.v1",
    source_commit: sourceCommit,
    authorization_sha256: authorizationSha256,
    profile_sha256: PROFILE_SHA256,
    seed: 2,
    maximum_optimizer_updates: MAXIMUM_UPDATES,
    measurement_updates: MEASUREMENT_UPDATES,
    measurements,
    selection,
    candidate,
    decision: candidate ? "candidate-frozen" : "no-go",
    language_gate: {
      eligible: candidate !== null && budget.authorization.language_gate_authorized,
      executed: false,
      maximum_compute_usd: CONDITIONAL_LANGUAGE_GATE_USD,
    },
    promotion: { authorized: false, executed: false },
  };
  atomicJson(path.join(options.out, "result.json"), result);
  console.log(`Q2.8 pilot ${result.decision}; language gate not executed`);
}

main();

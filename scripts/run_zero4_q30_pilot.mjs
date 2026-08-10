#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q30-v1/contract.json";
const MAXIMUM_UPDATES = 200;
const MEASUREMENT_UPDATES = Object.freeze([0, 50, 100, 150, 200]);
const MAXIMUM_COMPUTE_USD = 0.5;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(command, args, quiet = false) {
  const result = spawnSync(command, args, { encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
  return result.stdout;
}

export function validateAuthorization(budget, sourceCommit, contractSha256) {
  assert.equal(budget.schema,
    "zero.q30_routed_quantity_adapter_pilot_budget.v1");
  assert.equal(budget.id, "zero4-q30-seed2-pilot-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.diagnostic_seed, 2);
  assert.equal(budget.proposed.adapter_rank, 4);
  assert.equal(budget.proposed.adapter_parameters, 62976);
  assert.equal(budget.proposed.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.deepEqual(budget.proposed.checkpoint_updates, MEASUREMENT_UPDATES);
  assert.equal(budget.proposed.quantity_improvement_minimum, 0.8);
  assert.equal(budget.proposed.maximum_quantity_compute_usd,
    MAXIMUM_COMPUTE_USD);
  assert.equal(budget.proposed.promotion_authorized, false);
  const authorization = budget.authorization;
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.one_execution_only, true);
  assert.match(authorization.approval_id, /^q30-[a-z0-9-]+$/);
  assert.match(authorization.approved_by, /^[A-Za-z0-9_.-]+$/);
  assert.match(authorization.approved_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(authorization.source_commit, sourceCommit);
  assert.equal(authorization.contract_sha256, contractSha256);
  assert.equal(authorization.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.equal(authorization.maximum_quantity_compute_usd,
    MAXIMUM_COMPUTE_USD);
  assert.equal(authorization.language_gate_authorized, false);
  assert.equal(authorization.promotion_authorized, false);
}

export function validateContract(contract) {
  assert.equal(contract.schema,
    "zero.zero4_q30_routed_quantity_adapter_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.architecture.base_trainable_parameters, 0);
  assert.equal(contract.architecture.adapter_rank, 4);
  assert.equal(contract.architecture.adapter_parameters, 62976);
  assert.equal(contract.pilot.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.deepEqual(contract.pilot.measurement_updates, MEASUREMENT_UPDATES);
  assert.equal(contract.pilot.quantity_training_loss_relative_improvement_minimum,
    0.8);
  assert.equal(contract.pilot.base_state_digest_must_remain_exact, true);
  assert.equal(contract.pilot.non_q_replay_loss_must_be_bit_identical, true);
  for (const binding of [
    ...Object.values(contract.lineage), contract.inputs.tokenizer,
    contract.inputs.quantity, ...contract.inputs.replay,
  ]) assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} source lock drifted`);
}

export function selectCandidate(measurements) {
  assert(measurements.length >= 2 &&
    measurements.length <= MEASUREMENT_UPDATES.length);
  assert.deepEqual(measurements.map(({ update }) => update),
    MEASUREMENT_UPDATES.slice(0, measurements.length));
  const baseline = measurements[0];
  let selected = null;
  for (const measurement of measurements.slice(1)) {
    assert.equal(measurement.replay_training_loss,
      baseline.replay_training_loss, "non-Q replay identity drifted");
    const improvement =
      (baseline.quantity_training_loss - measurement.quantity_training_loss) /
      baseline.quantity_training_loss;
    if (improvement >= 0.8) {
      selected = { ...measurement, quantity_improvement: improvement };
      break;
    }
  }
  const terminal = measurements.at(-1).update === MAXIMUM_UPDATES || selected;
  assert(terminal, "pilot stopped without a terminal decision");
  return selected;
}

export function validateCompletion(completion, measurements) {
  assert.equal(completion.updates_committed, measurements.at(-1).update,
    "terminal update count does not match the final measurement");
  assert(completion.updates_committed <= MAXIMUM_UPDATES,
    "terminal update count exceeds the authorized cap");
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null,
    mechanics: "./quantity_adapter_pilot" };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  assert(options.authorization && options.out,
    "pilot requires --authorization and --out");
  return options;
}

function selfTest() {
  const source = "a".repeat(40);
  const contractHash = "b".repeat(64);
  const budget = {
    schema: "zero.q30_routed_quantity_adapter_pilot_budget.v1",
    id: "zero4-q30-seed2-pilot-v1", status: "run_authorized",
    proposed: { diagnostic_seed: 2, adapter_rank: 4,
      adapter_parameters: 62976, maximum_optimizer_updates: 200,
      checkpoint_updates: [...MEASUREMENT_UPDATES],
      quantity_improvement_minimum: 0.8,
      maximum_quantity_compute_usd: 0.5, promotion_authorized: false },
    authorization: { authorized: true, one_execution_only: true,
      approval_id: "q30-test", approved_by: "atimics",
      approved_at: "2026-08-10T00:00:00Z", source_commit: source,
      contract_sha256: contractHash, maximum_optimizer_updates: 200,
      maximum_quantity_compute_usd: 0.5, language_gate_authorized: false,
      promotion_authorized: false },
  };
  validateAuthorization(budget, source, contractHash);
  const selection = selectCandidate([
    { update: 0, quantity_training_loss: 10, replay_training_loss: 2 },
    { update: 50, quantity_training_loss: 1.9, replay_training_loss: 2 },
  ]);
  assert.equal(selection.update, 50);
  assert.throws(() => selectCandidate([
    { update: 0, quantity_training_loss: 10, replay_training_loss: 2 },
    { update: 50, quantity_training_loss: 1.9, replay_training_loss: 2.01 },
  ]));
  const terminalMeasurements = [
    { update: 0 }, { update: 50 }, { update: 100 }, { update: 150 },
    { update: 200 },
  ];
  validateCompletion({ updates_committed: 200 }, terminalMeasurements);
  assert.throws(() => validateCompletion({ updates_committed: 201 },
    terminalMeasurements));
  budget.authorization.authorized = false;
  assert.throws(() => validateAuthorization(budget, source, contractHash));
  console.log("Q3.0 pilot authorization and selection self-test passed");
}

function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  const contract = readJson(CONTRACT);
  validateContract(contract);
  const sourceCommit = run("git", ["rev-parse", "HEAD"], true).trim();
  const contractHash = sha256(CONTRACT);
  const budget = readJson(options.authorization);
  validateAuthorization(budget, sourceCommit, contractHash);
  assert(!fs.existsSync(options.out), "pilot output already exists");
  const authorizationHash = sha256(options.authorization);
  const consumption = `${options.authorization}.consumed`;
  fs.writeFileSync(consumption, `${JSON.stringify({
    schema: "zero.q30_pilot_authorization_consumption.v1",
    authorization_sha256: authorizationHash,
    source_commit: sourceCommit,
    output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  fs.mkdirSync(options.out, { recursive: false });
  const eventsPath = path.join(options.out, "events.jsonl");
  run(options.mechanics, ["--out-prefix", path.join(options.out, "checkpoint"),
    "--events", eventsPath, "--authorization-sha256", authorizationHash]);
  const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n")
    .map(JSON.parse);
  assert(events.every(({ schema }) => schema ===
    "zero.zero4_q30_quantity_adapter_event.v1"));
  const complete = events.filter(({ type }) => type === "complete");
  assert.equal(complete.length, 1);
  assert.equal(complete[0].language_gate_run, false);
  assert.equal(complete[0].promotion_run, false);
  const start = events.filter(({ type }) => type === "start");
  assert.equal(start.length, 1);
  assert.equal(start[0].rank, 4);
  assert.equal(start[0].base_parameters, 4852992);
  assert.equal(start[0].trainable_parameters, 62976);
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, quantity_training_loss, replay_training_loss,
      base_state_digest }) => ({ update, quantity_training_loss,
      replay_training_loss, base_state_digest }));
  validateCompletion(complete[0], measurements);
  const selected = selectCandidate(measurements);
  for (const measurement of measurements.slice(1)) {
    assert.equal(measurement.base_state_digest, start[0].base_state_digest,
      "frozen base-state digest changed");
  }
  assert.equal(Boolean(selected), complete[0].candidate_checkpoint_available);
  if (selected) {
    const checkpoint = path.join(options.out,
      `checkpoint-u${String(selected.update).padStart(6, "0")}.q30`);
    assert(fs.existsSync(checkpoint), "selected adapter checkpoint is missing");
  }
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify({
      schema: "zero.zero4_q30_pilot_result.v1",
      source_commit: sourceCommit,
      authorization_sha256: authorizationHash,
      contract_sha256: contractHash,
      measurements,
      selected,
      selected_checkpoint: selected ? path.join(options.out,
        `checkpoint-u${String(selected.update).padStart(6, "0")}.q30`) : null,
      language_gate_run: false,
      promotion_run: false,
    }, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(consumption,
    path.join(options.out, "authorization-consumption.json"),
    fs.constants.COPYFILE_EXCL);
  console.log(selected ? `Q3.0 candidate frozen at update ${selected.update}` :
    "Q3.0 ended with no candidate");
}

main();

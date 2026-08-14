#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q31-v1/contract.json";
const MAXIMUM_UPDATES = 100;
const MEASUREMENT_UPDATES = Object.freeze([0, 25, 50, 100]);
const MAXIMUM_COMPUTE_USD = 0.1;

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
    "zero.q31_routed_operation_head_pilot_budget.v1");
  assert.equal(budget.id, "zero4-q31-seed2-pilot-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.diagnostic_seed, 2);
  assert.equal(budget.proposed.head_parameters, 7685);
  assert.equal(budget.proposed.training_pool_records, 9000);
  assert.equal(budget.proposed.holdout_records, 500);
  assert.equal(budget.proposed.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.deepEqual(budget.proposed.measurement_updates, MEASUREMENT_UPDATES);
  assert.equal(budget.proposed.overall_accuracy_minimum, 0.99);
  assert.equal(budget.proposed.per_class_accuracy_minimum, 0.98);
  assert.equal(budget.proposed.maximum_compute_usd, MAXIMUM_COMPUTE_USD);
  const authorization = budget.authorization;
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.one_execution_only, true);
  assert.match(authorization.approval_id, /^q31-[a-z0-9-]+$/);
  assert.match(authorization.approved_by, /^[A-Za-z0-9_.-]+$/);
  assert.match(authorization.approved_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(authorization.source_commit, sourceCommit);
  assert.equal(authorization.contract_sha256, contractSha256);
  assert.equal(authorization.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.equal(authorization.maximum_compute_usd, MAXIMUM_COMPUTE_USD);
  assert.equal(authorization.public_quantity_authorized, false);
  assert.equal(authorization.language_gate_authorized, false);
  assert.equal(authorization.promotion_authorized, false);
}

export function validateContract(contract) {
  assert.equal(contract.schema,
    "zero.zero4_q31_routed_operation_head_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.architecture.base_trainable_parameters, 0);
  assert.equal(contract.architecture.feature_dimension, 1536);
  assert.equal(contract.architecture.head_parameters, 7685);
  assert.equal(contract.pilot.training_pool_records, 9000);
  assert.equal(contract.pilot.holdout_records, 500);
  assert.equal(contract.pilot.holdout_records_per_class, 100);
  assert.equal(contract.pilot.maximum_optimizer_updates, MAXIMUM_UPDATES);
  assert.deepEqual(contract.pilot.measurement_updates, MEASUREMENT_UPDATES);
  assert.equal(contract.pilot.overall_accuracy_minimum, 0.99);
  assert.equal(contract.pilot.per_class_accuracy_minimum, 0.98);
  for (const binding of [
    ...Object.values(contract.lineage), ...Object.values(contract.inputs),
  ]) assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} source lock drifted`);
}

export function selectCandidate(measurements) {
  assert(measurements.length >= 2 &&
    measurements.length <= MEASUREMENT_UPDATES.length);
  assert.deepEqual(measurements.map(({ update }) => update),
    MEASUREMENT_UPDATES.slice(0, measurements.length));
  let selected = null;
  for (const measurement of measurements.slice(1)) {
    assert.deepEqual(measurement.per_class_count, [100, 100, 100, 100, 100]);
    if (measurement.holdout_accuracy >= 0.99 &&
        measurement.per_class_accuracy.every((value) => value >= 0.98)) {
      selected = measurement;
      break;
    }
  }
  assert(measurements.at(-1).update === MAXIMUM_UPDATES || selected,
    "pilot stopped without a terminal decision");
  return selected;
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null,
    mechanics: "./operation_head_pilot" };
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
    schema: "zero.q31_routed_operation_head_pilot_budget.v1",
    id: "zero4-q31-seed2-pilot-v1", status: "run_authorized",
    proposed: { diagnostic_seed: 2, head_parameters: 7685,
      training_pool_records: 9000, holdout_records: 500,
      maximum_optimizer_updates: 100,
      measurement_updates: [...MEASUREMENT_UPDATES],
      overall_accuracy_minimum: 0.99, per_class_accuracy_minimum: 0.98,
      maximum_compute_usd: 0.1 },
    authorization: { authorized: true, one_execution_only: true,
      approval_id: "q31-test", approved_by: "atimics",
      approved_at: "2026-08-10T00:00:00Z", source_commit: source,
      contract_sha256: contractHash, maximum_optimizer_updates: 100,
      maximum_compute_usd: 0.1, public_quantity_authorized: false,
      language_gate_authorized: false, promotion_authorized: false },
  };
  validateAuthorization(budget, source, contractHash);
  const counts = [100, 100, 100, 100, 100];
  const selected = selectCandidate([
    { update: 0, holdout_accuracy: 0.2,
      per_class_accuracy: [1, 0, 0, 0, 0], per_class_count: counts },
    { update: 25, holdout_accuracy: 0.992,
      per_class_accuracy: [1, 1, 0.98, 0.98, 1], per_class_count: counts },
  ]);
  assert.equal(selected.update, 25);
  assert.throws(() => selectCandidate([
    { update: 0, holdout_accuracy: 0.2,
      per_class_accuracy: [1, 0, 0, 0, 0], per_class_count: counts },
    { update: 25, holdout_accuracy: 0.992,
      per_class_accuracy: [1, 1, 0.97, 0.99, 1],
      per_class_count: counts },
  ]));
  budget.authorization.authorized = false;
  assert.throws(() => validateAuthorization(budget, source, contractHash));
  console.log("Q3.1 pilot authorization and selection self-test passed");
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
    schema: "zero.q31_pilot_authorization_consumption.v1",
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
    "zero.zero4_q31_operation_head_event.v1"));
  const start = events.filter(({ type }) => type === "start");
  const complete = events.filter(({ type }) => type === "complete");
  assert.equal(start.length, 1); assert.equal(complete.length, 1);
  assert.equal(start[0].base_parameters, 4852992);
  assert.equal(start[0].trainable_parameters, 7685);
  assert.equal(start[0].classes, 5); assert.equal(start[0].feature_dim, 1536);
  assert.equal(complete[0].public_quantity_run, false);
  assert.equal(complete[0].language_gate_run, false);
  assert.equal(complete[0].promotion_run, false);
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, holdout_cross_entropy, holdout_accuracy,
      per_class_accuracy, per_class_count, base_state_digest }) => ({
      update, holdout_cross_entropy, holdout_accuracy, per_class_accuracy,
      per_class_count, base_state_digest,
    }));
  assert.equal(complete[0].updates_committed, measurements.at(-1).update);
  assert(complete[0].updates_committed <= MAXIMUM_UPDATES);
  const selected = selectCandidate(measurements);
  for (const measurement of measurements)
    assert.equal(measurement.base_state_digest, start[0].base_state_digest,
      "frozen base-state digest changed");
  assert.equal(Boolean(selected), complete[0].candidate_checkpoint_available);
  const selectedCheckpoint = selected ? path.join(options.out,
    `checkpoint-u${String(selected.update).padStart(6, "0")}.q31`) : null;
  if (selectedCheckpoint)
    assert(fs.existsSync(selectedCheckpoint), "selected head checkpoint missing");
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify({
      schema: "zero.zero4_q31_pilot_result.v1",
      source_commit: sourceCommit,
      authorization_sha256: authorizationHash,
      contract_sha256: contractHash,
      measurements,
      selected,
      selected_checkpoint: selectedCheckpoint,
      public_quantity_run: false,
      language_gate_run: false,
      promotion_run: false,
    }, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(consumption,
    path.join(options.out, "authorization-consumption.json"),
    fs.constants.COPYFILE_EXCL);
  console.log(selected ? `Q3.1 candidate frozen at update ${selected.update}` :
    "Q3.1 ended with no candidate");
}

main();

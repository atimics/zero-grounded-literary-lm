#!/usr/bin/env node
/*
 * Q3.5 sparse random-feature semantic probe runner.
 *
 * Feature-level diagnostic only. This runner never packages a candidate and
 * never makes a runtime, canonical, language, or promotion claim. It trains
 * three heads over one feature extraction and reports the held-out feature
 * accuracy of each arm against the frozen Q3.5 gate.
 *
 * The sparse arm is the primary claim. The dense arm isolates sparsity from
 * added dimension and nonlinearity. The linear arm reproduces Q3.4 in-run.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q35-sparse-probe-v1";
const CONTRACT_PATH = `${ROOT}/contract.json`;
const ARMS = ["linear", "dense", "sparse"];
const UPDATES = [0, 25, 50, 100];
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
  return result.stdout;
}
function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  assert(options.authorization && options.out,
    "Q3.5 probe requires --authorization and --out");
  return options;
}

export function featureDecision(measurement, gates) {
  const perClass = measurement.per_class_accuracy ?? [];
  const overall = measurement.holdout_accuracy >= gates.overall;
  const everyClass = perClass.length === 5 &&
    perClass.every((value) => value >= gates.per_class);
  return { passed: overall && everyClass, overall, per_class: everyClass };
}

export function selectFeatureCheckpoint(measurements, gates) {
  return measurements.slice(1).find((m) =>
    featureDecision(m, gates).passed) ?? null;
}

function selfTest() {
  const gates = { overall: 0.8, per_class: 0.6 };
  assert.equal(featureDecision({ holdout_accuracy: 0.8,
    per_class_accuracy: [0.6, 0.8, 0.8, 0.8, 1] }, gates).passed, true);
  assert.equal(featureDecision({ holdout_accuracy: 0.8,
    per_class_accuracy: [0.59, 1, 1, 1, 1] }, gates).passed, false);
  assert.equal(featureDecision({ holdout_accuracy: 0.79,
    per_class_accuracy: [1, 1, 1, 1, 1] }, gates).passed, false);
  assert.equal(selectFeatureCheckpoint([
    { update: 0, holdout_accuracy: 0.2, per_class_accuracy: [1, 0, 0, 0, 0] },
    { update: 25, holdout_accuracy: 0.8, per_class_accuracy: [0.6, 1, 1, 1, 1] },
  ], gates).update, 25);
  console.log("Q3.5 probe selectors self-test passed");
}

function validateContract(contract) {
  assert.equal(contract.schema, "zero.zero4_q35_sparse_probe_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.arms.linear.feature_dim, 1536);
  assert.equal(contract.arms.linear.head_parameters, 7685);
  assert.equal(contract.arms.dense.feature_dim, 6144);
  assert.equal(contract.arms.sparse.feature_dim, 6144);
  assert.equal(contract.arms.sparse.top_k, 307);
  assert.equal(contract.pilot.maximum_optimizer_updates, 100);
  assert.deepEqual(contract.pilot.measurement_updates, UPDATES);
  for (const binding of [contract.lineage.projection, contract.lineage.base_runtime,
    contract.data.training_tokens, contract.data.semantic_private,
    contract.data.semantic_confirmation])
    assert.equal(sha256(binding.path), binding.sha256,
      `${binding.path} binding drifted`);
  for (const [file, digest] of Object.entries(contract.mechanics))
    assert.equal(sha256(file), digest, `${file} mechanics drifted`);
  const q34 = readJson(contract.lineage.q34_result.path);
  assert.equal(q34.scientific_decision, contract.lineage.q34_result.required_decision);
}

function validateAuthorization(budget, sourceCommit, contractHash, projectionHash) {
  assert.equal(budget.schema, "zero.q35_sparse_probe_budget.v1");
  assert.equal(budget.id, "zero4-q35-sparse-probe-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.source_commit, sourceCommit);
  assert.equal(budget.proposed.diagnostic_seed, 2);
  assert.equal(budget.proposed.maximum_optimizer_updates, 100);
  assert.equal(budget.proposed.projection_sha256, projectionHash);
  assert.equal(budget.proposed.contract_sha256, contractHash);
  const auth = budget.authorization;
  assert.equal(auth.authorized, true);
  assert.equal(auth.one_execution_only, true);
  assert.match(auth.approval_id, /^q35-[a-z0-9-]+$/);
  assert.equal(auth.source_commit, sourceCommit);
  assert.equal(auth.contract_sha256, contractHash);
  assert.equal(auth.maximum_optimizer_updates, 100);
  assert.equal(auth.maximum_compute_usd, 0.15);
  for (const key of ["training_authorized", "feature_gate_authorized"])
    assert.equal(auth[key], true);
  for (const key of ["package_gate_authorized", "canonical_gate_authorized",
    "language_gate_authorized", "deployment_authorized",
    "additional_seed_authorized", "runtime_claim_authorized"])
    assert.equal(auth[key], false);
}

function readArmMeasurements(directory) {
  const events = fs.readFileSync(path.join(directory, "events.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  const start = events.find(({ type }) => type === "start");
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, holdout_cross_entropy, holdout_accuracy,
      per_class_accuracy, per_class_count, base_runtime_digest, head_state_digest }) =>
      ({ update, holdout_cross_entropy, holdout_accuracy, per_class_accuracy,
        per_class_count, base_runtime_digest, head_state_digest }));
  return { start, measurements };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  const contract = readJson(CONTRACT_PATH);
  validateContract(contract);
  const sourceCommit = run("git", ["rev-parse", "HEAD"], { quiet: true }).trim();
  const contractHash = sha256(CONTRACT_PATH);
  const projectionHash = contract.lineage.projection.sha256;
  const budget = readJson(options.authorization);
  validateAuthorization(budget, sourceCommit, contractHash, projectionHash);
  assert(!fs.existsSync(options.out), "Q3.5 output already exists");
  const authorizationHash = sha256(options.authorization);
  fs.writeFileSync(`${options.authorization}.consumed`, `${JSON.stringify({
    schema: "zero.q35_authorization_consumption.v1",
    authorization_sha256: authorizationHash,
    source_commit: sourceCommit,
    output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  run("./sparse_semantic_probe",
    ["--out", options.out, "--authorization-sha256", authorizationHash]);

  const gates = { overall: contract.gates.feature_semantic_overall_minimum,
    per_class: contract.gates.feature_semantic_per_class_minimum };
  const arms = {};
  for (const arm of ARMS) {
    const { start, measurements } = readArmMeasurements(path.join(options.out, arm));
    assert.deepEqual(measurements.map(({ update }) => update), UPDATES);
    assert.equal(start.arm, arm);
    const selected = selectFeatureCheckpoint(measurements, gates);
    arms[arm] = {
      feature_dim: start.feature_dim,
      trainable_parameters: start.trainable_parameters,
      feature_source: start.feature_source,
      measurements,
      selected_feature_checkpoint: selected ? selected.update : null,
      feature_gate_passed: selected !== null,
      final_accuracy: measurements[measurements.length - 1].holdout_accuracy,
      final_per_class_accuracy:
        measurements[measurements.length - 1].per_class_accuracy,
    };
  }
  const sparse = arms.sparse;
  const q34Reference = contract.lineage.q34_result.observed_semantic_accuracy;
  const result = {
    schema: "zero.zero4_q35_sparse_probe_result.v1",
    source_commit: sourceCommit,
    contract_sha256: contractHash,
    authorization_sha256: authorizationHash,
    projection_sha256: projectionHash,
    scope: "feature-level diagnostic; no package, canonical, runtime, language, or promotion claim",
    arms,
    primary_arm: "sparse",
    sparse_feature_gate_passed: sparse.feature_gate_passed,
    dense_feature_gate_passed: arms.dense.feature_gate_passed,
    linear_feature_gate_passed: arms.linear.feature_gate_passed,
    q34_linear_reference_accuracy: q34Reference,
    sparse_final_minus_q34_linear:
      sparse.final_accuracy - q34Reference,
    scientific_decision: sparse.feature_gate_passed ? "feature_go" : "feature_no_go",
    package_gates_run: false,
    canonical_gates_run: false,
    runtime_claim: false,
    language_gate: { authorized: false, executed: false },
    deployment: { authorized: false, executed: false },
    additional_seeds: { authorized: false, executed: false },
  };
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(`${options.authorization}.consumed`,
    path.join(options.out, "authorization-consumption.json"),
    fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({
    scientific_decision: result.scientific_decision,
    sparse_final_accuracy: sparse.final_accuracy,
    dense_final_accuracy: arms.dense.final_accuracy,
    linear_final_accuracy: arms.linear.final_accuracy,
    q34_linear_reference_accuracy: q34Reference,
  }, null, 2));
}

if (import.meta.url === `file://${path.resolve(process.argv[1])}`) await main();

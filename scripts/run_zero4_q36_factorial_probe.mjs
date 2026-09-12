#!/usr/bin/env node
/*
 * Q3.6 projection-scale and gradient-clip factorial probe runner.
 *
 * Feature-level diagnostic only. Settles H-scale (fan-in scaled projection,
 * global clip) and H-clip (unscaled projection, per-parameter clip) with
 * separate decisions, plus the interaction and dense controls. Never packages
 * a candidate and never makes a runtime or canonical claim.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q36-factor-probe-v1";
const CONTRACT_PATH = `${ROOT}/contract.json`;
const UPDATES = [0, 25, 50, 100];

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
    "Q3.6 probe requires --authorization and --out");
  return options;
}

export function featureDecision(measurement, gates) {
  const perClass = measurement.per_class_accuracy ?? [];
  return measurement.holdout_accuracy >= gates.overall &&
    perClass.length === 5 && perClass.every((value) => value >= gates.per_class);
}

function selfTest() {
  const gates = { overall: 0.8, per_class: 0.6 };
  assert.equal(featureDecision({ holdout_accuracy: 0.8,
    per_class_accuracy: [0.6, 0.8, 0.8, 0.8, 1] }, gates), true);
  assert.equal(featureDecision({ holdout_accuracy: 0.8,
    per_class_accuracy: [0.59, 1, 1, 1, 1] }, gates), false);
  console.log("Q3.6 probe selector self-test passed");
}

function validateContract(contract) {
  assert.equal(contract.schema, "zero.zero4_q36_factor_probe_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.arms.length, 9);
  assert.equal(contract.pilot.maximum_optimizer_updates, 100);
  assert.deepEqual(contract.pilot.measurement_updates, UPDATES);
  for (const binding of [contract.lineage.projection, contract.lineage.base_runtime,
    contract.data.training_tokens, contract.lineage.q35_result])
    assert.equal(sha256(binding.path), binding.sha256,
      `${binding.path} binding drifted`);
  for (const [file, digest] of Object.entries(contract.mechanics))
    assert.equal(sha256(file), digest, `${file} mechanics drifted`);
  const q35 = readJson(contract.lineage.q35_result.path);
  assert.equal(q35.scientific_decision, contract.lineage.q35_result.required_decision);
}

function validateAuthorization(budget, sourceCommit, contractHash, projectionHash) {
  assert.equal(budget.schema, "zero.q36_factor_probe_budget.v1");
  assert.equal(budget.id, "zero4-q36-factor-probe-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.source_commit, sourceCommit);
  assert.equal(budget.proposed.maximum_optimizer_updates, 100);
  assert.equal(budget.proposed.projection_sha256, projectionHash);
  assert.equal(budget.proposed.contract_sha256, contractHash);
  const auth = budget.authorization;
  assert.equal(auth.authorized, true);
  assert.equal(auth.one_execution_only, true);
  assert.match(auth.approval_id, /^q36-[a-z0-9-]+$/);
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

function readArm(directory) {
  const events = fs.readFileSync(path.join(directory, "events.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  const start = events.find(({ type }) => type === "start");
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, holdout_cross_entropy, holdout_accuracy,
      per_class_accuracy, per_class_count, head_state_digest }) =>
      ({ update, holdout_cross_entropy, holdout_accuracy, per_class_accuracy,
        per_class_count, head_state_digest }));
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
  assert(!fs.existsSync(options.out), "Q3.6 output already exists");
  const authorizationHash = sha256(options.authorization);
  fs.writeFileSync(`${options.authorization}.consumed`, `${JSON.stringify({
    schema: "zero.q36_authorization_consumption.v1",
    authorization_sha256: authorizationHash,
    source_commit: sourceCommit,
    output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  run("./sparse_semantic_probe_v2",
    ["--out", options.out, "--authorization-sha256", authorizationHash]);

  const gates = { overall: contract.gates.feature_semantic_overall_minimum,
    per_class: contract.gates.feature_semantic_per_class_minimum };
  const arms = {};
  for (const arm of contract.arms) {
    const { start, measurements } = readArm(path.join(options.out, arm.name));
    assert.deepEqual(measurements.map(({ update }) => update), UPDATES);
    const selected = measurements.slice(1).find((m) => featureDecision(m, gates));
    arms[arm.name] = {
      features: arm.features, scale: start.scale_mode, clip: start.clip_mode,
      feature_dim: start.feature_dim, trainable_parameters: start.trainable_parameters,
      measurements,
      selected_feature_checkpoint: selected ? selected.update : null,
      feature_gate_passed: selected !== undefined && selected !== null,
      final_accuracy: measurements[measurements.length - 1].holdout_accuracy,
      final_per_class_accuracy:
        measurements[measurements.length - 1].per_class_accuracy,
    };
  }
  const anchor = arms.linear.final_accuracy;
  const expected = contract.gates.linear_anchor_expected_accuracy;
  assert(Math.abs(anchor - expected) < 1e-9,
    `linear anchor drifted: ${anchor} vs ${expected}`);
  const hypotheses = {};
  for (const [name, spec] of Object.entries(contract.hypotheses)) {
    hypotheses[name] = {
      intervention: spec.intervention,
      primary_arm: spec.primary_arm,
      supporting_arm: spec.supporting_arm,
      primary_passed: arms[spec.primary_arm].feature_gate_passed,
      supporting_passed: arms[spec.supporting_arm].feature_gate_passed,
    };
  }
  const passed = Object.entries(hypotheses)
    .filter(([, value]) => value.primary_passed).map(([name]) => name);
  const result = {
    schema: "zero.zero4_q36_factor_probe_result.v1",
    source_commit: sourceCommit,
    contract_sha256: contractHash,
    authorization_sha256: authorizationHash,
    projection_sha256: projectionHash,
    scope: "feature-level diagnostic; no package, canonical, runtime, language, or promotion claim",
    arms,
    hypotheses,
    linear_anchor_matches_q35: true,
    hypotheses_supported: passed,
    scientific_decision: passed.length > 0 ? "feature_go" : "feature_no_go",
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
  const summary = { scientific_decision: result.scientific_decision,
    hypotheses_supported: passed, linear_anchor: anchor };
  for (const [name, arm] of Object.entries(arms))
    summary[name] = arm.final_accuracy;
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${path.resolve(process.argv[1])}`) await main();

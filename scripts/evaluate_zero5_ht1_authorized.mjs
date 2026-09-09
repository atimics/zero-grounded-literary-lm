#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evaluateHT1Gates } from "./evaluate_zero5_ht1_mergetree.mjs";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = file => {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
};
const option = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(index + 1 < process.argv.length, `${name} requires a value`);
  return process.argv[index + 1];
};
const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8"));
const requireHash = (file, expected, label) => {
  const observed = artifact(file);
  assert.equal(observed.sha256, expected, `${label} hash`);
  return observed;
};

function selfTest() {
  const authorization = readJSON(
    "benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json");
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.pilot.training_trajectories, 1);
  assert.equal(authorization.scope.independent_retries_authorized, false);
  assert.equal(authorization.scope.sealed_test_access_authorized, false);
  process.stdout.write("ZERO.5 HT1 authorized evaluator self-test passed\n");
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const authorizationPath = path.resolve(option("--authorization",
    "benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json"));
  const authorization = readJSON(authorizationPath);
  assert.equal(authorization.schema, "zero.ht1_training_authorization.v1");
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.scope.training_authorized, true);
  assert.equal(authorization.scope.frozen_validation_authorized, true);
  const bindings = authorization.bindings;
  for (const name of ["contract", "series", "implementation",
    "preflight_evidence", "trainer", "evaluator"]) {
    requireHash(bindings[name], bindings[`${name}_sha256`], name);
  }

  const contract = readJSON(bindings.contract);
  const series = readJSON(bindings.series);
  const evidence = readJSON(bindings.preflight_evidence);
  assert.equal(contract.experiment, authorization.experiment);
  assert.equal(series.execution_order[0], authorization.experiment);
  assert.equal(evidence.status, "complete-pass");
  assert.equal(evidence.eligible_for_pilot_authorization, true);
  assert.equal(evidence.contract_sha256, bindings.contract_sha256);
  assert.equal(evidence.bindings.initial_checkpoint_sha256,
    authorization.pilot.initial_checkpoint_sha256);
  assert.equal(evidence.bindings.training_packs_sha256,
    authorization.pilot.training_packs_sha256);
  assert.equal(evidence.bindings.validation_packs_sha256,
    authorization.pilot.validation_packs_sha256);
  assert.equal(evidence.bindings.tokenizer_sha256,
    authorization.pilot.tokenizer_sha256);
  assert.equal(evidence.experiment_runs_completed, 0);
  assert.equal(evidence.pilot_training_run_executed, false);
  assert.equal(Object.values(evidence.test).every(value => value === false), true);

  const required = Object.fromEntries(["checkpoint", "control-checkpoint",
    "control-result", "tokenizer", "validation", "candidate-tasks",
    "candidate-depth", "control-depth", "training-complete", "trainer"].map(name => {
    const value = option(`--${name}`);
    assert(value, `--${name} is required`);
    return [name, path.resolve(value)];
  }));
  const checkpoint = artifact(required.checkpoint);
  const trainingArtifact = artifact(required["training-complete"]);
  const training = readJSON(required["training-complete"]);
  assert.equal(training.schema, "zero.ht1_training_complete.v1");
  assert.equal(training.experiment, authorization.experiment);
  assert.equal(training.authorization_sha256, artifact(authorizationPath).sha256);
  assert.equal(training.contract_sha256, bindings.contract_sha256);
  assert.match(training.source_commit, /^[0-9a-f]{40}$/u);
  assert.equal(training.seed, authorization.pilot.seed);
  assert.equal(training.updates, authorization.pilot.update_groups);
  assert.equal(training.compute_token_exposures,
    authorization.pilot.compute_token_exposures);
  assert.equal(training.best_checkpoint.sha256, checkpoint.sha256);
  const controlResultArtifact = requireHash(required["control-result"],
    authorization.pilot.control_result_sha256, "C5.1 control result");
  const controlResult = readJSON(required["control-result"]);
  assert.equal(controlResult.schema, "zero.c51_statebridge_result.v1");
  assert.equal(controlResult.contract_sha256, contract.control.contract_sha256);
  const controlCheckpoint = requireHash(required["control-checkpoint"],
    authorization.pilot.control_checkpoint_sha256, "C5.1 control checkpoint");
  assert.equal(controlResult.checkpoints.best.sha256, controlCheckpoint.sha256);
  const tokenizer = requireHash(required.tokenizer,
    authorization.pilot.tokenizer_sha256, "tokenizer");
  const validation = requireHash(required.validation,
    authorization.pilot.validation_packs_sha256, "validation packs");
  const tasksArtifact = artifact(required["candidate-tasks"]);
  const tasks = readJSON(required["candidate-tasks"]);
  assert.equal(tasks.schema, "zero.c51_statebridge_validation.v1");
  assert.equal(tasks.contract_sha256, contract.control.contract_sha256);
  assert.equal(tasks.checkpoint.sha256, checkpoint.sha256);
  assert.equal(tasks.test.metrics_opened, false);
  assert.equal(controlResult.validation.test.metrics_opened, false);
  const candidateDepthArtifact = artifact(required["candidate-depth"]);
  const controlDepthArtifact = artifact(required["control-depth"]);
  const candidateDepth = readJSON(required["candidate-depth"]);
  const controlDepth = readJSON(required["control-depth"]);
  assert.equal(candidateDepth.schema, "zero.ht1_depth_eval.v1");
  assert.equal(controlDepth.schema, "zero.ht1_depth_eval.v1");
  const gates = evaluateHT1Gates(tasks.candidate,
    controlResult.validation.candidate, candidateDepth, controlDepth,
    contract.gates, evidence);
  assert.equal(gates.pending.length, 0);

  const result = {
    schema: "zero.ht1_authorized_result.v1",
    experiment: authorization.experiment,
    status: gates.passed ? "complete-pass" : "complete-no-go",
    authorization: artifact(authorizationPath),
    contract: artifact(bindings.contract),
    implementation: artifact(bindings.implementation),
    source_trainer: artifact(bindings.trainer),
    runtime_trainer: artifact(required.trainer),
    checkpoint,
    control_checkpoint: controlCheckpoint,
    control_result: controlResultArtifact,
    tokenizer,
    validation,
    candidate_tasks: tasksArtifact,
    training: trainingArtifact,
    candidate_depth: candidateDepthArtifact,
    control_depth: controlDepthArtifact,
    candidate: tasks.candidate,
    control: controlResult.validation.candidate,
    gates: gates.checks,
    derived: gates.derived,
    depth: gates.depth,
    scientific_gate_passed: gates.passed,
    replication_authorized: false,
    promotion_authorized: false,
    publication_authorized: false,
    test: { metrics_opened: false },
  };
  const out = option("--out");
  if (out) fs.writeFileSync(path.resolve(out),
    JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}

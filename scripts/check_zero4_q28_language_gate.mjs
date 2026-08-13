#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateTemplate } from "./materialize_q28_language_gate_budget.mjs";

const ROOT = "benchmarks/zero4-q28-v1/language-gate";
const BINDING = `${ROOT}/candidate-binding.json`;
const TEMPLATE = `${ROOT}/budget-template.json`;
const COMPLETION = `${ROOT}/results/COMPLETED`;
const RUNTIME_BUDGET = `${ROOT}/results/runtime-budget.json`;
const CANDIDATE_SHA256 =
  "ffc9a4aa74933547785deacb2ceb790a498833e2aff875a81299cc8955a1b0a1";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

function validateBinding(binding) {
  assert.equal(binding.quantity_result.decision, "candidate-frozen");
  assert.equal(binding.quantity_result.selected_update, 200);
  assert(binding.quantity_result.quantity_improvement >= 0.005);
  assert(binding.quantity_result.replay_regression <= 0.02);
  const result = readJson(binding.quantity_result.path);
  assert.equal(sha256(binding.quantity_result.path),
    binding.quantity_result.sha256);
  assert.equal(result.schema, "zero.zero4_q28_pilot_result.v1");
  assert.equal(result.source_commit, binding.activation_commit);
  assert.equal(result.profile_sha256, binding.profile_sha256);
  assert.equal(result.seed, 2);
  assert.equal(result.maximum_optimizer_updates, 200);
  assert.deepEqual(result.measurement_updates, [0, 100, 200]);
  assert.equal(result.selection.selected.update, 200);
  assert.equal(result.candidate.sha256, binding.checkpoint.sha256);
  assert.equal(result.decision, "candidate-frozen");
  assert.equal(result.language_gate.eligible, true);
  assert.equal(result.language_gate.executed, false);
  assert.equal(result.promotion.authorized, false);
  assert.equal(result.promotion.executed, false);

  assert.equal(sha256(binding.quantized.path), CANDIDATE_SHA256);
  assert.equal(fs.statSync(binding.quantized.path).size, 4920400);
  const header = fs.readFileSync(binding.quantized.path).subarray(0, 48);
  assert.equal(header.subarray(0, 8).toString("ascii"), "LITQ8V1\0");
  assert.equal(header.readUInt32LE(8), 1);
  assert.equal(Number(header.readBigUInt64LE(40)), 200);
  assert.equal(sha256(binding.conversion.tool), binding.conversion.tool_sha256);

  const contract = readJson(binding.gate.contract.path);
  assert.equal(sha256(binding.gate.contract.path), binding.gate.contract.sha256);
  assert.equal(contract.id, binding.gate.contract.id);
  assert.equal(contract.reference.tasks.blimp.cases_sha256,
    binding.gate.datasets.blimp_cases_sha256);
  assert.equal(contract.reference.tasks.tinystories.cases_sha256,
    binding.gate.datasets.tinystories_cases_sha256);
  assert.equal(contract.decision_rule.combination,
    binding.gate.thresholds.combination);
  assert.equal(contract.decision_rule.blimp.minimum_raw_accuracy,
    binding.gate.thresholds.blimp_minimum_raw_accuracy);
  assert.equal(contract.decision_rule.tinystories.maximum_bits_per_byte,
    binding.gate.thresholds.tinystories_maximum_bits_per_byte);
}

function requireText(file, values) {
  const source = fs.readFileSync(file, "utf8");
  for (const value of values) {
    assert(source.includes(value), `${file} lacks ${value}`);
  }
  return source;
}

function validateRouteSources() {
  const launch = requireText(".github/workflows/q28-language-gate-launch.yml", [
    "workflow_dispatch:", "expected_commit:", "candidate_sha256:",
    "approval_id:", "c6i.4xlarge", "ZERO_MAX_INSTANCE_SECONDS: '600'",
    "ZERO_MAX_COMPUTE_USD: '0.12'", "dry-run",
    "experiments/zero4-q28-seed2-language-gate-v1/execution.lock",
    "--if-none-match '*'", "workflow_waited_for_compute: false",
  ]);
  assert(!launch.includes("aws ec2 wait"),
    "launch workflow waits for scientific compute");
  assert(!launch.includes("sleep "),
    "launch workflow contains a compute polling sleep");
  requireText(".github/workflows/q28-language-gate-collect.yml", [
    "source_run_id:", "expected_commit:", "candidate_sha256:",
    "Require terminal instance", "state\" = terminated",
    "collector.lock", "check_q28_language_gate_result.mjs",
    "gh pr create --draft", "promotion_executed: false",
  ]);
  const workload = requireText("scripts/aws/q28-language-gate.sh", [
    "run_zero_language_gate.mjs", "--jobs 16", "training_updates: 0",
    "promotion_executed: false", "test \"$elapsed\" -le 600",
    "cost <= 0.12", "check_zero_language_gate.mjs",
  ]);
  for (const forbidden of [
    "literary_lm", "--resume", "--steps", "export_literary",
  ]) assert(!workload.includes(forbidden),
    `language-gate workload contains forbidden ${forbidden}`);
  requireText("scripts/aws/q28-language-gate-user-data.sh", [
    "HARD_INSTANCE_SECONDS=600", "HARD_WORKLOAD_SECONDS=540",
    "shutdown -h now", "X-aws-ec2-metadata-token", "ZERO_MAX_COMPUTE_USD",
  ]);
  requireText("scripts/aws/q28-language-gate-run-instances.sh", [
    "dry-run)", "launch)", "--instance-type c6i.4xlarge",
    "--instance-initiated-shutdown-behavior terminate",
    "HttpTokens=required", "MaxComputeUsd,Value=0.12",
  ]);
  for (const file of [
    "scripts/aws/q28-language-gate.sh",
    "scripts/aws/q28-language-gate-user-data.sh",
    "scripts/aws/q28-language-gate-run-instances.sh",
  ]) run("bash", ["-n", file]);
}

function validateCompletion(file) {
  const completion = readJson(file);
  assert.equal(completion.schema, "zero.q28_language_gate_completion.v1");
  assert.equal(completion.id, "zero4-q28-seed2-language-gate-v1");
  assert.equal(completion.status, "complete");
  assert.equal(completion.authorization_consumed, true);
  assert.equal(completion.candidate_sha256, CANDIDATE_SHA256);
  assert.equal(completion.training_updates, 0);
  assert.equal(completion.promotion_executed, false);
  const results = path.dirname(file);
  const launch = `${results}/launch-${completion.source_run_id}.json`;
  const status = `${results}/status-${completion.source_run_id}.json`;
  const terminal = `${results}/terminal-${completion.source_run_id}.json`;
  const result = `${results}/result.json`;
  const launchRecord = readJson(launch);
  const terminalRecord = readJson(terminal);
  assert.equal(terminalRecord.schema, "zero.aws_terminal_observation.v1");
  assert.equal(terminalRecord.instance_id, launchRecord.instance_id);
  assert.equal(terminalRecord.state, "terminated");
  assert.equal(sha256(RUNTIME_BUDGET), completion.budget_sha256);
  assert.equal(sha256(result), completion.result_sha256);
  run("node", ["scripts/check_q28_language_gate_result.mjs",
    "--launch", launch, "--status", status, "--result", result,
    "--budget", RUNTIME_BUDGET]);
}

function validateCheckpoint(checkpoint, binding) {
  assert.equal(sha256(checkpoint), binding.checkpoint.sha256);
  assert.equal(fs.statSync(checkpoint).size, binding.checkpoint.bytes);
  run("make", ["export_literary"]);
  const temporary = path.join(os.tmpdir(),
    `q28-language-gate-candidate-${process.pid}.litq8`);
  try {
    run("./export_literary", [checkpoint, temporary]);
    assert.equal(sha256(temporary), binding.quantized.sha256);
    assert.equal(fs.statSync(temporary).size, binding.quantized.bytes);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const binding = readJson(BINDING);
const template = readJson(TEMPLATE);
assert.equal(template.candidate_binding.path, BINDING);
validateTemplate(template, binding);
validateBinding(binding);
validateRouteSources();
run("node", ["scripts/materialize_q28_language_gate_budget.mjs", "--self-test"]);
run("node", ["scripts/check_q28_language_gate_result.mjs", "--self-test"]);

const completionIndex = process.argv.indexOf("--completion");
const completion = completionIndex >= 0 ? process.argv[completionIndex + 1] :
  (fs.existsSync(COMPLETION) ? COMPLETION : null);
if (completion) validateCompletion(completion);
else assert(!fs.existsSync(RUNTIME_BUDGET),
  "authorized runtime budget exists before a consumed completion");

const checkpointIndex = process.argv.indexOf("--candidate-checkpoint");
if (checkpointIndex >= 0) {
  assert(process.argv[checkpointIndex + 1], "candidate checkpoint path missing");
  validateCheckpoint(process.argv[checkpointIndex + 1], binding);
}

console.log("Q2.8 candidate-bound language-gate route passed");

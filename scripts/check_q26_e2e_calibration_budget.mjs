#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function roundedCents(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

export function validateBudget(budget) {
  assert(budget?.schema === "zero.experiment_e2e_calibration_budget.v1", "unsupported end-to-end calibration budget schema");
  assert(budget.id === "openblas-e2e-calibration-v1", "unexpected calibration id");
  assert(budget.status === "preregistered", "calibration budget must be preregistered");
  assert(budget.scientific_inference_allowed === false, "calibration must forbid scientific inference");
  assert(budget.authorization?.scope === "one AWS execution of e2e-calibration-1 only", "authorization scope drifted");
  assert(budget.authorization.one_execution_only === true, "calibration must be single-execution");

  const lock = budget.source_driver_lock;
  assert(lock?.driver_path === "scripts/train_zero4_q26.mjs", "scientific driver path drifted");
  assert(fs.existsSync(lock.driver_path), "scientific driver is unavailable");
  assert(sha256(lock.driver_path) === lock.driver_sha256, "scientific driver hash mismatch");
  assert(lock.scientific_contract_path === "benchmarks/zero4-q26-v1/contract.json", "scientific contract path drifted");
  assert(fs.existsSync(lock.scientific_contract_path), "scientific contract is unavailable");
  assert(sha256(lock.scientific_contract_path) === lock.scientific_contract_sha256, "scientific contract hash mismatch");
  assert(lock.calibration_may_not_invoke_or_modify_scientific_driver === true, "calibration isolation guarantee drifted");

  const evidence = budget.pilot_evidence;
  assert(evidence?.budget_path === "benchmarks/openblas-pilot-v1/budget.json", "pilot budget evidence path drifted");
  assert(evidence.result_path === "benchmarks/openblas-pilot-v1/result-30005889393.json", "pilot result evidence path drifted");
  for (const [file, expected] of [
    [evidence.budget_path, evidence.budget_sha256],
    [evidence.result_path, evidence.result_sha256],
  ]) {
    assert(fs.existsSync(file), `pilot evidence is unavailable: ${file}`);
    assert(sha256(file) === expected, `pilot evidence hash mismatch: ${file}`);
  }
  const pilot = JSON.parse(fs.readFileSync(evidence.result_path, "utf8"));
  assert(pilot.scientific_inference_allowed === false, "pilot evidence became scientific");
  assert(pilot.venue?.backend === evidence.backend_observed, "pilot backend evidence drifted");
  assert(pilot.measurement?.completed_optimizer_attempts === evidence.completed_optimizer_attempts, "pilot attempt evidence drifted");
  assert(pilot.measurement?.training_wall_seconds === evidence.training_wall_seconds, "pilot timing evidence drifted");
  assert(pilot.measurement?.cold_start_seconds === evidence.cold_start_seconds, "pilot cold-start evidence drifted");
  assert(pilot.measurement?.attempts_per_second === evidence.attempts_per_second, "pilot throughput evidence drifted");

  const venue = budget.venue;
  assert(venue?.provider === "aws" && venue.region === "us-east-1", "AWS venue drifted");
  assert(venue.instance_type === "c6i.4xlarge", "instance type drifted");
  assert(venue.backend === "openblas", "backend must be OpenBLAS");
  assert(venue.on_demand_usd_per_hour === 0.68, "hourly rate drifted");

  const workload = budget.workload;
  assert(workload?.driver === "scripts/calibrate_zero4_q26_e2e.mjs", "calibration driver drifted");
  assert(workload.outputs_are_diagnostic_only === true, "outputs must be diagnostic only");
  assert(workload.seed === 89, "diagnostic seed drifted");
  assert(workload.transaction_phase === "acquisition", "transaction phase drifted");
  assert(workload.maximum_optimizer_attempts === 100, "attempt cap drifted");
  assert(workload.batch === 2, "batch drifted");
  assert(workload.recovery_every_committed_updates === 25, "recovery cadence drifted");
  assert(workload.full_every_committed_updates === 100, "full cadence drifted");
  assert(workload.sentinel_replay_batches === 12, "sentinel replay cadence drifted");
  assert(workload.full_replay_batches === 48, "full replay cadence drifted");
  assert(workload.baseline_sentinel_evaluations === 1, "baseline sentinel count drifted");
  assert(workload.baseline_full_evaluations === 1, "baseline full count drifted");
  assert(workload.maximum_sentinel_evaluations === 4, "sentinel evaluation cap drifted");
  assert(workload.maximum_full_evaluations === 1, "full evaluation cap drifted");
  assert(workload.promotion_evaluations === 0, "promotion must remain sealed");
  assert(workload.openblas_threads === 16, "OpenBLAS thread count drifted");

  const execution = budget.execution;
  assert(execution?.id === "e2e-calibration-1", "execution id drifted");
  assert(execution.max_instance_seconds === 1500, "instance cap must be 1,500 seconds");
  assert(execution.workload_timeout_seconds === 1440, "workload cap must be 1,440 seconds");
  assert(execution.max_compute_usd === roundedCents(1500 * venue.on_demand_usd_per_hour / 3600), "compute cap is not the rounded instance upper bound");
  assert(execution.requires_manual_approval === true, "manual approval must be required");
  assert(execution.manual_approval_observed === true, "manual approval is missing");
  assert(execution.authorized_for_execution === true, "calibration is not authorized");

  const projection = budget.budget_projection;
  assert(projection.optimizer_seconds === workload.maximum_optimizer_attempts / evidence.attempts_per_second, "optimizer projection drifted");
  assert(projection.cold_start_seconds === evidence.cold_start_seconds, "cold-start projection drifted");
  assert(
    projection.optimizer_seconds
      + projection.cold_start_seconds
      + projection.evaluation_and_publication_allowance_seconds
      + projection.hard_instance_headroom_seconds
      === execution.max_instance_seconds,
    "budget projection does not reconcile to the instance cap",
  );

  assert(budget.completion_gate?.backend_must_be === "OpenBLAS", "completion backend gate drifted");
  assert(budget.completion_gate.full_evaluation_required_for_complete_status === true, "complete status must require a full evaluation");
  assert(budget.completion_gate.q26r_requires_new_combined_two_seed_budget === true, "Q2.6-R two-seed budget gate drifted");
  assert(budget.completion_gate.q26r_requires_separate_manual_authorization === true, "Q2.6-R authorization gate drifted");
  return true;
}

function selfTest() {
  const budgetPath = new URL("../benchmarks/openblas-e2e-calibration-v1/budget.json", import.meta.url);
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const originalCwd = process.cwd();
  process.chdir(new URL("..", import.meta.url).pathname);
  try {
    validateBudget(budget);
    const mutations = [
      ["scientific inference", (copy) => { copy.scientific_inference_allowed = true; }],
      ["driver hash", (copy) => { copy.source_driver_lock.driver_sha256 = "0".repeat(64); }],
      ["attempt cap", (copy) => { copy.workload.maximum_optimizer_attempts = 101; }],
      ["recovery cadence", (copy) => { copy.workload.recovery_every_committed_updates = 20; }],
      ["promotion evaluation", (copy) => { copy.workload.promotion_evaluations = 1; }],
      ["instance cap", (copy) => { copy.execution.max_instance_seconds = 1501; }],
      ["approval", (copy) => { copy.execution.manual_approval_observed = false; }],
    ];
    for (const [name, mutate] of mutations) {
      const copy = structuredClone(budget);
      mutate(copy);
      let rejected = false;
      try {
        validateBudget(copy);
      } catch {
        rejected = true;
      }
      assert(rejected, `self-test failed to reject ${name} mutation`);
    }
  } finally {
    process.chdir(originalCwd);
  }
  console.log("Q2.6 end-to-end calibration budget self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const budgetPath = args.find((argument) => !argument.startsWith("--"))
    ?? "benchmarks/openblas-e2e-calibration-v1/budget.json";
  validateBudget(JSON.parse(fs.readFileSync(budgetPath, "utf8")));
  console.log(`OK Q2.6 end-to-end calibration budget: ${budgetPath}`);
}

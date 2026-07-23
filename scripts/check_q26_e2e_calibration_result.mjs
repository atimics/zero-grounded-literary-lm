#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { validateBudget } from "./check_q26_e2e_calibration_budget.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateResult(budget, result, status, expected = {}) {
  validateBudget(budget);
  assert(result?.schema === "zero.q26_e2e_calibration_result.v1", "invalid calibration result schema");
  assert(result.id === budget.id, "calibration result id drifted");
  assert(
    ["complete", "budget-exhausted", "insufficient-cadence"].includes(result.status),
    "calibration did not finish within a valid bounded outcome",
  );
  assert(result.scientific_inference_allowed === false, "calibration result cannot support scientific inference");
  assert(status?.schema === "zero.aws_q26_e2e_calibration_status.v1", "invalid remote status schema");
  assert(status.status === result.status, "remote status/result mismatch");
  assert(status.scientific_inference_allowed === false, "remote status cannot support scientific inference");
  assert(status.git_commit === result.git_commit, "remote status commit mismatch");
  assert(status.budget_sha256 === result.budget_sha256, "remote status budget mismatch");
  if (expected.commit) {
    assert(result.git_commit === expected.commit, "result commit mismatch");
  }
  if (expected.budgetSha256) {
    assert(result.budget_sha256 === expected.budgetSha256, "result budget hash mismatch");
  }

  const execution = budget.execution;
  assert(result.budget?.max_instance_seconds === execution.max_instance_seconds, "instance cap drifted");
  assert(result.budget?.workload_timeout_seconds === execution.workload_timeout_seconds, "workload cap drifted");
  assert(result.budget?.max_compute_usd === execution.max_compute_usd, "compute cap drifted");
  assert(result.venue?.provider === "aws", "calibration venue must be AWS");
  assert(result.venue?.region === budget.venue.region, "calibration region drifted");
  assert(result.venue?.instance_type === budget.venue.instance_type, "calibration instance type drifted");
  assert(result.venue?.openblas_threads === budget.workload.openblas_threads, "thread count drifted");
  assert(result.venue?.on_demand_usd_per_hour === budget.venue.on_demand_usd_per_hour, "hourly rate drifted");

  const measurement = result.measurement;
  assert(measurement?.seed === budget.workload.seed, "diagnostic seed drifted");
  assert(measurement.attempt_cap === budget.workload.maximum_optimizer_attempts, "attempt cap drifted");
  for (const field of [
    "completed_optimizer_attempts",
    "completed_committed_updates",
    "sentinel_evaluations",
    "full_evaluations",
    "promotion_evaluations",
    "total_observed_instance_seconds",
    "driver_exit_code",
  ]) {
    assert(Number.isInteger(measurement[field]), `invalid measurement field: ${field}`);
  }
  assert(measurement.completed_optimizer_attempts >= 0, "attempt count is negative");
  assert(measurement.completed_optimizer_attempts <= measurement.attempt_cap, "attempt cap exceeded");
  assert(measurement.completed_committed_updates >= 0, "commit count is negative");
  assert(measurement.completed_committed_updates <= measurement.completed_optimizer_attempts, "commits exceed attempts");
  assert(measurement.sentinel_evaluations >= 0, "sentinel count is negative");
  assert(measurement.sentinel_evaluations <= budget.workload.maximum_sentinel_evaluations, "sentinel evaluation cap exceeded");
  assert(measurement.full_evaluations >= 0, "full evaluation count is negative");
  assert(measurement.full_evaluations <= budget.workload.maximum_full_evaluations, "full evaluation cap exceeded");
  assert(measurement.promotion_evaluations === 0, "promotion split was unsealed");
  assert(measurement.total_observed_instance_seconds >= 0, "instance time is negative");
  assert(measurement.total_observed_instance_seconds <= execution.max_instance_seconds, "result was published after the instance budget");
  assert(measurement.timing_seconds && typeof measurement.timing_seconds === "object", "component timings are missing");

  const backendObserved = result.venue.backend === budget.completion_gate.backend_must_be;
  assert(backendObserved, "OpenBLAS was not observed");
  if (result.status === "complete") {
    assert(status.exit_code === 0 && measurement.driver_exit_code === 0, "complete result has nonzero exit status");
    assert(measurement.completed_optimizer_attempts === 100, "complete calibration must execute 100 attempts");
    assert(measurement.completed_committed_updates >= 100, "complete calibration must reach update 100");
    assert(measurement.sentinel_evaluations === 4, "complete calibration must execute four sentinel evaluations");
    assert(measurement.full_evaluations === 1, "complete calibration must execute the update-100 full evaluation");
  } else if (result.status === "budget-exhausted") {
    assert([124, 137, 143].includes(status.exit_code), "budget exhaustion has unexpected exit status");
    assert([124, 137, 143].includes(measurement.driver_exit_code), "budget exhaustion has unexpected driver status");
  } else {
    assert(status.exit_code === 0 && measurement.driver_exit_code === 0, "insufficient cadence must be a clean driver outcome");
    assert(
      measurement.completed_committed_updates < 100
        || measurement.sentinel_evaluations < 4
        || measurement.full_evaluations < 1,
      "insufficient cadence incorrectly satisfied the completion gate",
    );
  }

  const projection = result.projection;
  assert(projection?.target_optimizer_attempts_per_seed === 1400, "projection target drifted");
  assert(projection.target_seed_count === 2, "projection must budget both Q2.6-R seeds");
  if (result.status === "complete") {
    assert(projection.available === true, "complete calibration must publish a projection");
    assert(projection.projected_sentinel_evaluations_per_seed === 56, "projected sentinel count drifted");
    assert(projection.projected_full_evaluations_per_seed === 14, "projected full count drifted");
    for (const field of [
      "estimated_total_seconds_per_seed",
      "estimated_compute_usd_per_seed",
      "estimated_total_seconds_two_seeds",
      "estimated_compute_usd_two_seeds",
    ]) {
      assert(Number.isFinite(projection[field]) && projection[field] > 0, `invalid projection field: ${field}`);
    }
    assert(
      Math.abs(projection.estimated_total_seconds_two_seeds - 2 * projection.estimated_total_seconds_per_seed) < 1e-9,
      "two-seed wall projection is inconsistent",
    );
    assert(
      Math.abs(projection.estimated_compute_usd_two_seeds - 2 * projection.estimated_compute_usd_per_seed) < 1e-9,
      "two-seed cost projection is inconsistent",
    );
  }
  return true;
}

function selfTest() {
  const budgetPath = new URL("../benchmarks/openblas-e2e-calibration-v1/budget.json", import.meta.url);
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const originalCwd = process.cwd();
  process.chdir(new URL("..", import.meta.url).pathname);
  try {
    const budgetSha256 = sha256("benchmarks/openblas-e2e-calibration-v1/budget.json");
    const result = {
      schema: "zero.q26_e2e_calibration_result.v1",
      id: budget.id,
      status: "complete",
      git_commit: "a".repeat(40),
      budget_sha256: budgetSha256,
      scientific_inference_allowed: false,
      venue: {
        provider: "aws",
        region: budget.venue.region,
        instance_type: budget.venue.instance_type,
        backend: "OpenBLAS",
        openblas_threads: 16,
        on_demand_usd_per_hour: 0.68,
      },
      budget: {
        max_instance_seconds: 1500,
        workload_timeout_seconds: 1440,
        max_compute_usd: 0.29,
      },
      measurement: {
        seed: 89,
        attempt_cap: 100,
        completed_optimizer_attempts: 100,
        completed_committed_updates: 100,
        sentinel_evaluations: 4,
        full_evaluations: 1,
        promotion_evaluations: 0,
        total_observed_instance_seconds: 1300,
        driver_exit_code: 0,
        timing_seconds: {},
      },
      projection: {
        target_optimizer_attempts_per_seed: 1400,
        target_seed_count: 2,
        available: true,
        projected_sentinel_evaluations_per_seed: 56,
        projected_full_evaluations_per_seed: 14,
        estimated_total_seconds_per_seed: 14000,
        estimated_compute_usd_per_seed: 2.65,
        estimated_total_seconds_two_seeds: 28000,
        estimated_compute_usd_two_seeds: 5.3,
      },
    };
    const status = {
      schema: "zero.aws_q26_e2e_calibration_status.v1",
      status: "complete",
      exit_code: 0,
      git_commit: result.git_commit,
      budget_sha256: result.budget_sha256,
      scientific_inference_allowed: false,
    };
    validateResult(budget, result, status, {
      commit: result.git_commit,
      budgetSha256,
    });
    for (const [name, mutate] of [
      ["over budget", (copy) => { copy.measurement.total_observed_instance_seconds = 1501; }],
      ["promotion access", (copy) => { copy.measurement.promotion_evaluations = 1; }],
      ["missing full evaluation", (copy) => { copy.measurement.full_evaluations = 0; }],
      ["one-seed projection", (copy) => { copy.projection.target_seed_count = 1; }],
    ]) {
      const invalid = structuredClone(result);
      mutate(invalid);
      let rejected = false;
      try {
        validateResult(budget, invalid, status);
      } catch {
        rejected = true;
      }
      assert(rejected, `self-test failed to reject ${name}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
  console.log("Q2.6 end-to-end calibration result self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}
if (args.length < 3) {
  fail("usage: check_q26_e2e_calibration_result.mjs BUDGET RESULT STATUS [--commit SHA] [--budget-sha256 SHA]");
}
const [budgetPath, resultPath, statusPath] = args;
const commitIndex = args.indexOf("--commit");
const budgetHashIndex = args.indexOf("--budget-sha256");
validateResult(
  JSON.parse(fs.readFileSync(budgetPath, "utf8")),
  JSON.parse(fs.readFileSync(resultPath, "utf8")),
  JSON.parse(fs.readFileSync(statusPath, "utf8")),
  {
    commit: commitIndex >= 0 ? args[commitIndex + 1] : null,
    budgetSha256: budgetHashIndex >= 0
      ? args[budgetHashIndex + 1]
      : sha256(budgetPath),
  },
);
console.log(`OK Q2.6 end-to-end calibration result: ${resultPath}`);

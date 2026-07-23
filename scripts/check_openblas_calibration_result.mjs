#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

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
  assert(result?.schema === "zero.openblas_calibration_result.v1", "invalid calibration result schema");
  assert(result.id === budget.id, "calibration result id drifted");
  assert(["complete", "budget-exhausted"].includes(result.status), "calibration did not complete within its budget boundary");
  assert(result.scientific_inference_allowed === false, "calibration result cannot support scientific inference");
  assert(status?.schema === "zero.aws_openblas_calibration_status.v1", "invalid remote status schema");
  assert(status.status === result.status, "remote status/result mismatch");
  assert(status.scientific_inference_allowed === false, "remote status cannot support scientific inference");
  assert(status.git_commit === result.git_commit, "remote status commit mismatch");
  assert(status.budget_sha256 === result.budget_sha256, "remote status budget mismatch");

  if (expected.commit) assert(result.git_commit === expected.commit, "result commit mismatch");
  if (expected.budgetSha256) assert(result.budget_sha256 === expected.budgetSha256, "result budget hash mismatch");

  const calibration = budget.stages.find((stage) => stage.id === "calibration");
  assert(result.budget?.max_instance_seconds === calibration.max_instance_seconds, "instance cap drifted");
  assert(result.budget?.workload_timeout_seconds === calibration.workload_timeout_seconds, "workload cap drifted");
  assert(result.budget?.max_compute_usd === calibration.max_compute_usd, "compute cap drifted");
  assert(result.venue?.provider === "aws", "calibration venue must be AWS");
  assert(result.venue?.region === budget.venue.region, "calibration region drifted");
  assert(result.venue?.instance_type === budget.venue.instance_type, "calibration instance type drifted");
  assert(result.venue?.openblas_threads === budget.workload.openblas_threads, "OpenBLAS thread count drifted");
  assert(result.venue?.on_demand_usd_per_hour === budget.venue.on_demand_usd_per_hour, "hourly rate drifted");

  const measurement = result.measurement;
  assert(measurement?.seed === budget.workload.seed, "diagnostic seed drifted");
  assert(measurement?.attempt_cap === budget.workload.maximum_optimizer_attempts, "attempt cap drifted");
  assert(Number.isInteger(measurement?.completed_optimizer_attempts), "completed attempt count is invalid");
  assert(measurement.completed_optimizer_attempts >= 0, "completed attempt count is negative");
  assert(measurement.completed_optimizer_attempts <= measurement.attempt_cap, "attempt cap exceeded");
  const backendObserved = result.venue?.backend === "OpenBLAS";
  const coldStartExhausted = result.status === "budget-exhausted"
    && result.venue?.backend === "not-observed"
    && measurement.completed_optimizer_attempts === 0
    && result.phase === "cold-start";
  assert(backendObserved || coldStartExhausted, "OpenBLAS was not observed and the result is not a cold-start exhaustion");
  assert(Number.isInteger(measurement.total_observed_instance_seconds), "observed instance time is invalid");
  assert(measurement.total_observed_instance_seconds >= 0, "observed instance time is negative");
  assert(measurement.total_observed_instance_seconds <= calibration.max_instance_seconds, "result was published after the instance budget");

  if (result.status === "complete") {
    assert(status.exit_code === 0 && measurement.training_exit_code === 0, "complete result has nonzero exit status");
  } else {
    assert([124, 137, 143].includes(status.exit_code), "budget exhaustion has unexpected exit status");
    assert([124, 137, 143].includes(measurement.training_exit_code), "budget exhaustion has unexpected training status");
  }

  const projection = result.projection;
  assert(projection?.target_optimizer_attempts === 1400, "projection target drifted");
  if (measurement.completed_optimizer_attempts === 0) {
    assert(projection.estimated_wall_seconds === null, "zero-attempt calibration cannot estimate wall time");
    assert(projection.estimated_compute_usd === null, "zero-attempt calibration cannot estimate cost");
  } else {
    assert(Number.isFinite(projection.estimated_wall_seconds) && projection.estimated_wall_seconds > 0, "projected wall time is invalid");
    assert(Number.isFinite(projection.estimated_compute_usd) && projection.estimated_compute_usd > 0, "projected compute cost is invalid");
  }
  return true;
}

function selfTest() {
  const budgetPath = new URL("../benchmarks/openblas-calibration-v1/budget.json", import.meta.url);
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const budgetSha256 = sha256(budgetPath);
  const result = {
    schema: "zero.openblas_calibration_result.v1",
    id: budget.id,
    status: "budget-exhausted",
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
      max_instance_seconds: 300,
      workload_timeout_seconds: 240,
      max_compute_usd: 0.06,
    },
    measurement: {
      seed: 89,
      attempt_cap: 8,
      completed_optimizer_attempts: 2,
      total_observed_instance_seconds: 290,
      training_exit_code: 124,
    },
    projection: {
      target_optimizer_attempts: 1400,
      estimated_wall_seconds: 70000,
      estimated_compute_usd: 13.22,
    },
  };
  const status = {
    schema: "zero.aws_openblas_calibration_status.v1",
    status: result.status,
    exit_code: 124,
    git_commit: result.git_commit,
    budget_sha256: result.budget_sha256,
    scientific_inference_allowed: false,
  };
  validateResult(budget, result, status, {
    commit: result.git_commit,
    budgetSha256,
  });
  const invalid = structuredClone(result);
  invalid.measurement.total_observed_instance_seconds = 301;
  let rejected = false;
  try {
    validateResult(budget, invalid, status);
  } catch {
    rejected = true;
  }
  assert(rejected, "self-test failed to reject an over-budget result");
  console.log("OpenBLAS calibration result self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}
if (args.length < 3) {
  fail("usage: check_openblas_calibration_result.mjs BUDGET RESULT STATUS [--commit SHA] [--budget-sha256 SHA]");
}
const [budgetPath, resultPath, statusPath] = args;
const commitIndex = args.indexOf("--commit");
const budgetHashIndex = args.indexOf("--budget-sha256");
const expected = {
  commit: commitIndex >= 0 ? args[commitIndex + 1] : null,
  budgetSha256: budgetHashIndex >= 0 ? args[budgetHashIndex + 1] : sha256(budgetPath),
};
validateResult(
  JSON.parse(fs.readFileSync(budgetPath, "utf8")),
  JSON.parse(fs.readFileSync(resultPath, "utf8")),
  JSON.parse(fs.readFileSync(statusPath, "utf8")),
  expected,
);
console.log(`OK OpenBLAS calibration result: ${resultPath}`);

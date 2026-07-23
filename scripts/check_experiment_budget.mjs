#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function roundedCents(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validateVenueAndWorkload(budget) {
  const venue = budget.venue;
  assert(venue?.provider === "aws" && venue.region === "us-east-1", "AWS venue drifted");
  assert(venue.instance_type === "c6i.4xlarge", "instance type drifted");
  assert(venue.backend === "openblas", "backend must be OpenBLAS");
  assert(Number.isFinite(venue.on_demand_usd_per_hour) && venue.on_demand_usd_per_hour > 0, "hourly rate must be positive");

  const workload = budget.workload;
  assert(workload?.outputs_are_diagnostic_only === true, "workload outputs must be diagnostic only");
  assert(workload.seed === 89, "diagnostic seed drifted");
  assert(Number.isInteger(workload.maximum_optimizer_attempts) && workload.maximum_optimizer_attempts > 0, "attempt cap must be positive");
  assert(workload.openblas_threads === 16, "OpenBLAS thread declaration drifted");
}

export function validateBudget(budget, requestedStage = null) {
  assert(budget && typeof budget === "object" && !Array.isArray(budget), "budget must be an object");
  assert(budget.schema === "zero.experiment_budget.v1", "unsupported budget schema");
  assert(budget.id === "openblas-calibration-v1", "unexpected budget id");
  assert(budget.status === "preregistered", "budget must be preregistered");
  assert(budget.scientific_inference_allowed === false, "calibration must forbid scientific inference");

  validateVenueAndWorkload(budget);
  const venue = budget.venue;

  assert(Array.isArray(budget.stages), "stages must be an array");
  assert(JSON.stringify(budget.stages.map((stage) => stage.id)) === '["ci","calibration","pilot","full"]', "budget stage order drifted");

  let previousSeconds = -1;
  let previousCost = -1;
  for (const stage of budget.stages) {
    assert(Number.isInteger(stage.max_instance_seconds) && stage.max_instance_seconds >= 0, `${stage.id} has invalid wall cap`);
    assert(Number.isFinite(stage.max_compute_usd) && stage.max_compute_usd >= 0, `${stage.id} has invalid compute cap`);
    assert(stage.max_instance_seconds >= previousSeconds, `${stage.id} wall cap is not monotonic`);
    assert(stage.max_compute_usd >= previousCost, `${stage.id} cost cap is not monotonic`);
    const requiredCost = roundedCents(
      stage.max_instance_seconds * venue.on_demand_usd_per_hour / 3600,
    );
    assert(stage.max_compute_usd === requiredCost, `${stage.id} compute cap must equal the hourly-rate upper bound ${requiredCost.toFixed(2)}`);
    previousSeconds = stage.max_instance_seconds;
    previousCost = stage.max_compute_usd;
  }

  const [ci, calibration, pilot, full] = budget.stages;
  assert(ci.max_instance_seconds === 0 && ci.authorized_for_execution === true, "CI stage drifted");
  assert(calibration.max_instance_seconds === 300, "calibration must have a five-minute instance cap");
  assert(Number.isInteger(calibration.workload_timeout_seconds), "calibration workload timeout is missing");
  assert(calibration.workload_timeout_seconds <= 240, "calibration must reserve at least one minute for publication and cleanup");
  assert(calibration.requires_manual_approval === false && calibration.authorized_for_execution === true, "calibration authorization drifted");
  assert(pilot.requires_manual_approval === true && pilot.authorized_for_execution === false, "pilot must remain approval-gated");
  assert(full.requires_manual_approval === true && full.authorized_for_execution === false, "full run must remain approval-gated");

  if (requestedStage) {
    const stage = budget.stages.find((candidate) => candidate.id === requestedStage);
    assert(stage, `unknown requested stage: ${requestedStage}`);
    assert(stage.authorized_for_execution === true, `${requestedStage} is not authorized for execution`);
  }
  return true;
}

export function validateRetryBudget(
  budget,
  requestedStage = null,
  baseBudgetPath = budget?.base_budget?.path,
) {
  assert(budget && typeof budget === "object" && !Array.isArray(budget), "budget must be an object");
  assert(budget.schema === "zero.experiment_retry_budget.v1", "unsupported retry budget schema");
  assert(budget.id === "openblas-calibration-v1", "unexpected budget id");
  assert(budget.status === "preregistered", "retry budget must be preregistered");
  assert(budget.scientific_inference_allowed === false, "retry must forbid scientific inference");
  validateVenueAndWorkload(budget);
  assert(budget.workload.transaction_phase === "acquisition", "retry must use the supported acquisition transaction phase");

  const base = budget.base_budget;
  assert(base?.path === "benchmarks/openblas-calibration-v1/budget.json", "base budget path drifted");
  assert(base.sha256 === "6036e379a9da0d05081d443e3c71074583ca0f976cfc14aab870d4cfd613fbc3", "base budget hash drifted");
  assert(base.max_instance_seconds === 300 && base.max_compute_usd === 0.06, "base authorization drifted");
  assert(baseBudgetPath && fs.existsSync(baseBudgetPath), "base budget is unavailable");
  assert(sha256(baseBudgetPath) === base.sha256, "base budget file hash mismatch");
  const baseBudget = JSON.parse(fs.readFileSync(baseBudgetPath, "utf8"));
  validateBudget(baseBudget, "calibration");
  assert(JSON.stringify(budget.venue) === JSON.stringify(baseBudget.venue), "retry venue differs from base budget");

  const prior = budget.prior_execution;
  assert(prior?.github_run_id === "30003225539", "prior execution id drifted");
  assert(prior.status === "infrastructure-error", "retry requires the recorded infrastructure failure");
  assert(prior.backend_observed === "OpenBLAS", "prior execution backend record drifted");
  assert(prior.completed_optimizer_attempts === 0, "prior execution completed scientific work");
  assert(prior.request_to_termination_seconds === 107, "prior execution charge window drifted");
  assert(prior.failure_record === "benchmarks/openblas-calibration-v1/execution-failure-30003225539.json", "failure record drifted");
  assert(fs.existsSync(prior.failure_record), "failure record is unavailable");
  const failure = JSON.parse(fs.readFileSync(prior.failure_record, "utf8"));
  assert(failure.github_run_id === prior.github_run_id, "failure record run id mismatch");
  assert(failure.request_to_termination_seconds === prior.request_to_termination_seconds, "failure record charge window mismatch");
  assert(failure.completed_optimizer_attempts === 0, "failure record completed optimizer work");

  const execution = budget.execution;
  assert(execution?.id === "calibration-retry-1", "retry execution id drifted");
  assert(execution.max_instance_seconds === 190, "retry instance cap must be 190 seconds");
  assert(execution.workload_timeout_seconds === 130, "retry workload cap must be 130 seconds");
  assert(execution.max_compute_usd === roundedCents(190 * budget.venue.on_demand_usd_per_hour / 3600), "retry compute cap drifted");
  assert(execution.requires_manual_approval === false && execution.authorized_for_execution === true, "retry authorization drifted");

  const aggregate = budget.aggregate_ceiling;
  const aggregateSeconds = prior.request_to_termination_seconds + execution.max_instance_seconds;
  const aggregateCompute = aggregateSeconds * budget.venue.on_demand_usd_per_hour / 3600;
  assert(aggregate.max_instance_seconds === aggregateSeconds, "aggregate instance ceiling is inconsistent");
  assert(Math.abs(aggregate.request_window_compute_usd - aggregateCompute) < 1e-12, "aggregate compute ceiling is inconsistent");
  assert(aggregate.declared_max_compute_usd === base.max_compute_usd, "aggregate declared cost cap drifted");
  assert(aggregateSeconds <= base.max_instance_seconds, "retry exceeds the original instance authorization");
  assert(aggregateCompute <= base.max_compute_usd, "retry exceeds the original compute authorization");

  if (requestedStage) {
    assert(["calibration", "calibration-retry-1"].includes(requestedStage), `unknown requested stage: ${requestedStage}`);
    assert(execution.authorized_for_execution === true, "retry is not authorized for execution");
  }
  return true;
}

function selfTest() {
  const basePath = new URL("../benchmarks/openblas-calibration-v1/budget.json", import.meta.url);
  const valid = JSON.parse(fs.readFileSync(basePath, "utf8"));
  validateBudget(valid, "calibration");

  const mutations = [
    ["scientific inference", (copy) => { copy.scientific_inference_allowed = true; }],
    ["wall cap", (copy) => { copy.stages[1].max_instance_seconds = 301; }],
    ["cost cap", (copy) => { copy.stages[1].max_compute_usd = 1; }],
    ["pilot authorization", (copy) => { copy.stages[2].authorized_for_execution = true; }],
    ["backend", (copy) => { copy.venue.backend = "portable"; }],
  ];
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(valid);
    mutate(copy);
    let rejected = false;
    try {
      validateBudget(copy, "calibration");
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name} mutation`);
  }

  const retryPath = new URL("../benchmarks/openblas-calibration-v1/retry-1-budget.json", import.meta.url);
  const retry = JSON.parse(fs.readFileSync(retryPath, "utf8"));
  const originalCwd = process.cwd();
  process.chdir(new URL("..", import.meta.url).pathname);
  try {
    validateRetryBudget(retry, "calibration", "benchmarks/openblas-calibration-v1/budget.json");
    const retryMutations = [
      ["retry wall cap", (copy) => { copy.execution.max_instance_seconds = 191; }],
      ["transaction phase", (copy) => { copy.workload.transaction_phase = "calibration"; }],
      ["prior charge window", (copy) => { copy.prior_execution.request_to_termination_seconds = 106; }],
      ["aggregate ceiling", (copy) => { copy.aggregate_ceiling.max_instance_seconds = 296; }],
    ];
    for (const [name, mutate] of retryMutations) {
      const copy = structuredClone(retry);
      mutate(copy);
      let rejected = false;
      try {
        validateRetryBudget(copy, "calibration", "benchmarks/openblas-calibration-v1/budget.json");
      } catch {
        rejected = true;
      }
      assert(rejected, `self-test failed to reject ${name} mutation`);
    }
  } finally {
    process.chdir(originalCwd);
  }
  console.log("experiment budget self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}
const budgetPath = args.find((argument) => !argument.startsWith("--"))
  ?? "benchmarks/openblas-calibration-v1/budget.json";
const stageIndex = args.indexOf("--stage");
const requestedStage = stageIndex >= 0 ? args[stageIndex + 1] : null;
if (stageIndex >= 0 && !requestedStage) fail("--stage requires a value");
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
if (budget.schema === "zero.experiment_retry_budget.v1") {
  validateRetryBudget(budget, requestedStage);
} else {
  validateBudget(budget, requestedStage);
}
console.log(`OK budget: ${budget.id}${requestedStage ? ` stage=${requestedStage}` : ""}`);

#!/usr/bin/env node

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

export function validateBudget(budget, requestedStage = null) {
  assert(budget && typeof budget === "object" && !Array.isArray(budget), "budget must be an object");
  assert(budget.schema === "zero.experiment_budget.v1", "unsupported budget schema");
  assert(budget.id === "openblas-calibration-v1", "unexpected budget id");
  assert(budget.status === "preregistered", "budget must be preregistered");
  assert(budget.scientific_inference_allowed === false, "calibration must forbid scientific inference");

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

function selfTest() {
  const valid = JSON.parse(fs.readFileSync(new URL("../benchmarks/openblas-calibration-v1/budget.json", import.meta.url), "utf8"));
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
validateBudget(budget, requestedStage);
console.log(`OK budget: ${budget.id}${requestedStage ? ` stage=${requestedStage}` : ""}`);

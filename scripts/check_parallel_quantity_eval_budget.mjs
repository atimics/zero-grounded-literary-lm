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
  assert(
    budget?.schema === "zero.quantity_eval_calibration_budget.v1",
    "unsupported quantity-evaluator calibration budget schema",
  );
  assert(
    budget.id === "parallel-quantity-eval-calibration-v1",
    "unexpected calibration id",
  );
  assert(budget.status === "preregistered", "budget must be preregistered");
  assert(
    budget.scientific_inference_allowed === false,
    "calibration must forbid scientific inference",
  );
  assert(
    budget.authorization?.scope
      === "one AWS execution of quantity-eval-calibration-1 only",
    "authorization scope drifted",
  );
  assert(
    budget.authorization.one_execution_only === true,
    "authorization must be single-execution",
  );

  const lock = budget.source_lock;
  for (const [name, file, expected] of [
    ["evaluator", lock?.evaluator_path, lock?.evaluator_sha256],
    ["generator", lock?.generator_path, lock?.generator_sha256],
    ["model", lock?.model_path, lock?.model_sha256],
  ]) {
    assert(typeof file === "string" && fs.existsSync(file), `${name} lock is unavailable`);
    assert(sha256(file) === expected, `${name} lock hash mismatch`);
  }
  assert(
    fs.statSync(lock.model_path).size === lock.model_bytes,
    "model byte count drifted",
  );

  const evidence = budget.prior_evidence;
  assert(
    evidence?.result_path
      === "benchmarks/openblas-e2e-calibration-v1/result-30023119249.json",
    "prior evidence path drifted",
  );
  assert(fs.existsSync(evidence.result_path), "prior evidence is unavailable");
  assert(
    sha256(evidence.result_path) === evidence.result_sha256,
    "prior evidence hash mismatch",
  );
  const prior = JSON.parse(fs.readFileSync(evidence.result_path, "utf8"));
  assert(prior.scientific_inference_allowed === false, "prior evidence became scientific");
  assert(
    prior.measurement?.sentinel_evaluations === evidence.serial_sentinel_evaluations,
    "prior sentinel count drifted",
  );
  assert(
    prior.measurement?.timing_seconds?.sentinel_quantity
      === evidence.serial_sentinel_total_seconds,
    "prior sentinel timing drifted",
  );
  assert(
    evidence.serial_sentinel_mean_seconds
      === evidence.serial_sentinel_total_seconds
        / evidence.serial_sentinel_evaluations,
    "prior sentinel mean is inconsistent",
  );
  assert(evidence.serial_sentinel_cases === 64, "prior sentinel case count drifted");
  assert(evidence.serial_public_cases === 500, "prior public case count drifted");
  assert(
    evidence.serial_public_planning_estimate_seconds === 795.982,
    "prior public planning estimate drifted",
  );

  const venue = budget.venue;
  assert(
    venue?.provider === "aws" && venue.region === "us-east-1",
    "AWS venue drifted",
  );
  assert(venue.instance_type === "c6i.4xlarge", "instance type drifted");
  assert(venue.cpu_architecture === "x86_64", "CPU architecture drifted");
  assert(venue.online_vcpus === 16, "online vCPU count drifted");
  assert(
    venue.quantity_backend === "portable-quantized-inference",
    "quantity backend drifted",
  );
  assert(venue.on_demand_usd_per_hour === 0.68, "hourly rate drifted");

  const workload = budget.workload;
  assert(workload?.corpus_quantity === 10000, "corpus quantity drifted");
  assert(workload.corpus_seed === 5, "corpus seed drifted");
  assert(workload.request_mode === "operation", "request mode drifted");
  assert(workload.sentinel_cases === 64, "sentinel case count drifted");
  assert(workload.public_cases === 500, "public case count drifted");
  assert(workload.serial_jobs === 1, "serial job count drifted");
  assert(workload.parallel_jobs === 16, "parallel job count drifted");
  assert(
    JSON.stringify(workload.measurement_order)
      === JSON.stringify([
        "sentinel_serial",
        "sentinel_parallel",
        "public_serial",
        "public_parallel",
      ]),
    "measurement order drifted",
  );
  assert(workload.repetitions === 1, "repetition count drifted");
  assert(workload.warmup_cases === 1, "warmup count drifted");
  assert(workload.json_output_must_match === true, "JSON parity gate drifted");
  assert(workload.promotion_evaluations === 0, "promotion must remain sealed");
  assert(workload.optimizer_attempts === 0, "optimizer must remain disabled");
  assert(workload.outputs_are_diagnostic_only === true, "outputs must be diagnostic only");

  const execution = budget.execution;
  assert(execution?.id === "quantity-eval-calibration-1", "execution id drifted");
  assert(execution.max_instance_seconds === 1500, "instance cap drifted");
  assert(execution.workload_timeout_seconds === 1440, "workload cap drifted");
  assert(
    execution.max_compute_usd
      === roundedCents(
        execution.max_instance_seconds * venue.on_demand_usd_per_hour / 3600,
      ),
    "compute cap is not the rounded instance upper bound",
  );
  assert(execution.requires_manual_approval === true, "manual approval must be required");
  assert(execution.manual_approval_observed === true, "manual approval is missing");
  assert(execution.authorized_for_execution === true, "execution is not authorized");

  const projection = budget.budget_projection;
  const projectedTotal = [
    "cold_start_build_and_generation_seconds",
    "sentinel_serial_seconds",
    "sentinel_parallel_seconds",
    "public_serial_seconds",
    "public_parallel_seconds",
    "publication_seconds",
    "hard_instance_headroom_seconds",
  ].reduce((sum, field) => sum + projection[field], 0);
  assert(
    projectedTotal === execution.max_instance_seconds,
    "budget projection does not reconcile to the instance cap",
  );
  assert(
    projection.sentinel_serial_seconds >= evidence.serial_sentinel_mean_seconds,
    "serial sentinel allowance is below prior evidence",
  );
  assert(
    projection.public_serial_seconds
      >= evidence.serial_public_planning_estimate_seconds,
    "serial public allowance is below prior estimate",
  );

  const gate = budget.completion_gate;
  assert(gate?.all_four_measurements_required === true, "four-measurement gate drifted");
  assert(gate.sentinel_json_parity_required === true, "sentinel parity gate drifted");
  assert(gate.public_json_parity_required === true, "public parity gate drifted");
  assert(gate.structured_status_required === true, "structured status gate drifted");
  assert(gate.result_is_diagnostic_only === true, "diagnostic-only gate drifted");
  assert(
    gate.q26r_requires_new_combined_two_seed_budget === true,
    "Q2.6-R budget gate drifted",
  );
  assert(
    gate.q26r_requires_separate_manual_authorization === true,
    "Q2.6-R authorization gate drifted",
  );
  return true;
}

function selfTest() {
  const budgetPath = new URL(
    "../benchmarks/parallel-quantity-eval-calibration-v1/budget.json",
    import.meta.url,
  );
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const originalCwd = process.cwd();
  process.chdir(new URL("..", import.meta.url).pathname);
  try {
    validateBudget(budget);
    for (const [name, mutate] of [
      ["scientific inference", (copy) => { copy.scientific_inference_allowed = true; }],
      ["evaluator hash", (copy) => { copy.source_lock.evaluator_sha256 = "0".repeat(64); }],
      ["parallel jobs", (copy) => { copy.workload.parallel_jobs = 15; }],
      ["measurement order", (copy) => { copy.workload.measurement_order.reverse(); }],
      ["promotion access", (copy) => { copy.workload.promotion_evaluations = 1; }],
      ["instance cap", (copy) => { copy.execution.max_instance_seconds = 1501; }],
      ["approval", (copy) => { copy.execution.manual_approval_observed = false; }],
    ]) {
      const invalid = structuredClone(budget);
      mutate(invalid);
      let rejected = false;
      try {
        validateBudget(invalid);
      } catch {
        rejected = true;
      }
      assert(rejected, `self-test failed to reject ${name}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
  console.log("Parallel quantity-evaluator calibration budget self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const budgetPath = args.find((argument) => !argument.startsWith("--"))
    ?? "benchmarks/parallel-quantity-eval-calibration-v1/budget.json";
  validateBudget(JSON.parse(fs.readFileSync(budgetPath, "utf8")));
  console.log(`OK parallel quantity-evaluator calibration budget: ${budgetPath}`);
}

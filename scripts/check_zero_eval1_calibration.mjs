#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_BUDGET = "benchmarks/zero-eval-1/aws-calibration/budget.json";

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

function containsScoreField(value) {
  if (Array.isArray(value)) return value.some(containsScoreField);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) =>
      /accuracy|bits_per_byte|metrics|score|prediction|greedy_exact/iu.test(key) ||
      containsScoreField(item));
  }
  return false;
}

export function validateBudget(budget) {
  assert(budget?.schema === "zero.external_eval_calibration_budget.v1", "budget schema drifted");
  assert(budget.id === "zero-eval-1-aws-calibration", "budget id drifted");
  assert(budget.status === "authorized", "calibration is not authorized");
  assert(budget.scientific_inference_allowed === false, "calibration cannot support inference");
  assert(budget.training_allowed === false, "calibration cannot train");
  assert(
    budget.authorization?.scope === "one AWS execution of ZERO-EVAL-1 timing calibration only",
    "authorization scope drifted",
  );
  assert(budget.authorization.one_execution_only === true, "authorization must be one-time");
  assert(budget.authorization.full_evaluation_authorized === false, "full run is not authorized");

  const lock = budget.source_lock;
  for (const [name, file, expected] of [
    ["contract", lock?.contract_path, lock?.contract_sha256],
    ["evaluator", lock?.evaluator_path, lock?.evaluator_sha256],
    ["inference", lock?.inference_path, lock?.inference_sha256],
    ["inference header", lock?.inference_header_path, lock?.inference_header_sha256],
    ["channel protocol", lock?.channel_protocol_path, lock?.channel_protocol_sha256],
    ["build recipe", lock?.makefile_path, lock?.makefile_sha256],
    ["preparer", lock?.preparer_path, lock?.preparer_sha256],
    ["sampler", lock?.sampler_path, lock?.sampler_sha256],
    ["runner", lock?.runner_path, lock?.runner_sha256],
    ["result compiler", lock?.result_compiler_path, lock?.result_compiler_sha256],
    ["contract checker", lock?.contract_checker_path, lock?.contract_checker_sha256],
    ["calibration checker", lock?.calibration_checker_path, lock?.calibration_checker_sha256],
    ["workload", lock?.workload_path, lock?.workload_sha256],
    ["user data", lock?.user_data_path, lock?.user_data_sha256],
    ["workflow", lock?.workflow_path, lock?.workflow_sha256],
    ["model", lock?.model_path, lock?.model_sha256],
  ]) {
    assert(typeof file === "string" && fs.existsSync(file), `${name} lock is unavailable`);
    assert(sha256(file) === expected, `${name} lock hash mismatch`);
  }
  assert(fs.statSync(lock.model_path).size === lock.model_bytes, "model size drifted");

  assert(
    JSON.stringify(Object.keys(budget.calibration_datasets ?? {})) ===
      JSON.stringify(["blimp", "hellaswag", "lambada", "tinystories"]),
    "calibration dataset grid drifted",
  );
  const contract = JSON.parse(fs.readFileSync(lock.contract_path, "utf8"));
  for (const [id, dataset] of Object.entries(budget.calibration_datasets)) {
    assert(dataset.cases === 64, `${id} calibration count drifted`);
    assert(dataset.sample_bytes > 0, `${id} calibration size missing`);
    assert(/^[0-9a-f]{64}$/u.test(dataset.sample_sha256), `${id} sample hash missing`);
    assert(
      dataset.source_sha256 === contract.prepared_bundle.datasets[id].sha256,
      `${id} source bundle hash drifted`,
    );
  }

  const venue = budget.venue;
  assert(
    venue?.provider === "aws" && venue.region === "us-east-1",
    "AWS venue drifted",
  );
  assert(venue.instance_type === "c6i.4xlarge", "instance type drifted");
  assert(venue.online_vcpus === 16, "vCPU count drifted");
  assert(venue.on_demand_usd_per_hour === 0.68, "hourly rate drifted");

  const workload = budget.workload;
  assert(workload?.model === "zero4" && workload.jobs === 16, "workload model/jobs drifted");
  assert(workload.cases_per_task === 64 && workload.repetitions === 1, "workload multiplicity drifted");
  assert(
    JSON.stringify(workload.task_order) ===
      JSON.stringify(["blimp", "tinystories", "hellaswag", "lambada"]),
    "task order drifted",
  );
  assert(workload.optimizer_attempts === 0 && workload.training_updates === 0, "training leaked");
  assert(workload.controller_or_kernel_calls === 0, "controller/kernel leaked");
  assert(workload.metrics_must_be_absent === true, "score seal drifted");
  assert(workload.outputs_are_timing_only === true, "timing-only gate drifted");

  const execution = budget.execution;
  assert(execution?.max_instance_seconds === 600, "instance cap drifted");
  assert(execution.workload_timeout_seconds === 540, "workload timeout drifted");
  assert(execution.publication_reserve_seconds === 60, "publication reserve drifted");
  assert(
    execution.workload_timeout_seconds + execution.publication_reserve_seconds ===
      execution.max_instance_seconds,
    "instance budget does not reconcile",
  );
  assert(
    execution.max_compute_usd === roundedCents(
      execution.max_instance_seconds * venue.on_demand_usd_per_hour / 3600,
    ),
    "compute ceiling does not match venue price",
  );
  assert(execution.requires_manual_approval === true, "manual approval gate missing");
  assert(execution.manual_approval_observed === true, "manual approval not observed");
  assert(execution.authorized_for_execution === true, "calibration execution is disabled");

  const projected = Object.values(budget.budget_projection)
    .reduce((sum, value) => sum + value, 0);
  assert(projected === execution.max_instance_seconds, "budget projection does not reconcile");
  assert(budget.completion_gate?.score_fields_forbidden === true, "score fields became permitted");
  assert(budget.completion_gate.full_evaluation_requires_new_budget === true, "full budget gate missing");
  assert(
    budget.completion_gate.full_evaluation_requires_separate_manual_authorization === true,
    "full authorization gate missing",
  );
  return true;
}

export function validateResult(budget, result, status, expected) {
  assert(result?.schema === "zero.external_eval_calibration_result.v1", "result schema drifted");
  assert(result.id === budget.id, "result id drifted");
  assert(result.status === "complete", "calibration did not complete");
  assert(result.scientific_inference_allowed === false, "result became scientific");
  assert(result.training_updates === 0 && result.optimizer_attempts === 0, "result trained");
  assert(result.git_commit === expected.commit, "result commit drifted");
  assert(result.budget_sha256 === expected.budgetSha256, "result budget hash drifted");
  assert(result.model_sha256 === budget.source_lock.model_sha256, "result model drifted");
  assert(result.jobs === budget.workload.jobs, "result jobs drifted");
  assert(!containsScoreField(result), "calibration result exposes a score field");
  assert(
    JSON.stringify(Object.keys(result.measurements ?? {})) ===
      JSON.stringify(budget.workload.task_order),
    "calibration measurement order drifted",
  );
  for (const id of budget.workload.task_order) {
    const measurement = result.measurements[id];
    const dataset = budget.calibration_datasets[id];
    assert(measurement.cases === dataset.cases, `${id} result count drifted`);
    assert(measurement.cases_sha256 === dataset.sample_sha256, `${id} result input drifted`);
    assert(/^[0-9a-f]{64}$/u.test(measurement.case_results_sha256), `${id} result hash missing`);
    assert(measurement.elapsed_seconds > 0, `${id} timing missing`);
  }
  assert(result.elapsed_instance_seconds <= budget.execution.max_instance_seconds, "instance cap exceeded");
  assert(result.estimated_compute_usd <= budget.execution.max_compute_usd, "cost cap exceeded");

  assert(status?.schema === "zero.aws_external_eval_calibration_status.v1", "status schema drifted");
  assert(status.status === "complete", "structured status is not complete");
  assert(status.git_commit === expected.commit, "status commit drifted");
  assert(status.budget_sha256 === expected.budgetSha256, "status budget drifted");
  assert(status.scientific_inference_allowed === false, "status became scientific");
  return true;
}

function selfTest() {
  const budget = JSON.parse(fs.readFileSync(DEFAULT_BUDGET, "utf8"));
  validateBudget(budget);
  for (const [name, mutate] of [
    ["science", (copy) => { copy.scientific_inference_allowed = true; }],
    ["training", (copy) => { copy.training_allowed = true; }],
    ["model", (copy) => { copy.source_lock.model_sha256 = "0".repeat(64); }],
    ["cases", (copy) => { copy.calibration_datasets.blimp.cases = 65; }],
    ["jobs", (copy) => { copy.workload.jobs = 15; }],
    ["duration", (copy) => { copy.execution.max_instance_seconds = 601; }],
    ["approval", (copy) => { copy.execution.manual_approval_observed = false; }],
    ["full run", (copy) => { copy.authorization.full_evaluation_authorized = true; }],
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
  const scoreLeak = { metrics: { accuracy: 0.5 } };
  assert(containsScoreField(scoreLeak), "score leak detector failed");
  const commit = "c".repeat(40);
  const budgetSha256 = "b".repeat(64);
  const measurements = {};
  for (const id of budget.workload.task_order) {
    const dataset = budget.calibration_datasets[id];
    measurements[id] = {
      cases: dataset.cases,
      input_bytes: dataset.sample_bytes,
      cases_sha256: dataset.sample_sha256,
      case_results_sha256: "a".repeat(64),
      elapsed_seconds: 1,
      cases_per_second: dataset.cases,
    };
  }
  const result = {
    schema: "zero.external_eval_calibration_result.v1",
    id: budget.id,
    status: "complete",
    scientific_inference_allowed: false,
    training_updates: 0,
    optimizer_attempts: 0,
    controller_or_kernel_calls: 0,
    git_commit: commit,
    budget_sha256: budgetSha256,
    model_sha256: budget.source_lock.model_sha256,
    jobs: budget.workload.jobs,
    started_at: "2026-07-24T00:00:00Z",
    finished_at: "2026-07-24T00:01:00Z",
    elapsed_instance_seconds: 60,
    estimated_compute_usd: 0.011334,
    measurements,
  };
  const status = {
    schema: "zero.aws_external_eval_calibration_status.v1",
    status: "complete",
    phase: "complete",
    exit_code: 0,
    started_at: result.started_at,
    finished_at: result.finished_at,
    git_commit: commit,
    budget_sha256: budgetSha256,
    scientific_inference_allowed: false,
  };
  validateResult(budget, result, status, { commit, budgetSha256 });
  for (const [name, mutate] of [
    ["score leak", (copy) => { copy.metrics = { accuracy: 0.5 }; }],
    ["case count", (copy) => { copy.measurements.blimp.cases += 1; }],
    ["cost", (copy) => { copy.estimated_compute_usd = 0.13; }],
  ]) {
    const invalid = structuredClone(result);
    mutate(invalid);
    let rejected = false;
    try {
      validateResult(budget, invalid, status, { commit, budgetSha256 });
    } catch {
      rejected = true;
    }
    assert(rejected, `result self-test failed to reject ${name}`);
  }
  console.log("ZERO-EVAL-1 calibration validator self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
  } else {
    const budgetPath = args[0] ?? DEFAULT_BUDGET;
    const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
    validateBudget(budget);
    const resultIndex = args.indexOf("--result");
    if (resultIndex >= 0) {
      const statusIndex = args.indexOf("--status");
      const commitIndex = args.indexOf("--commit");
      const hashIndex = args.indexOf("--budget-sha256");
      assert(statusIndex >= 0 && commitIndex >= 0 && hashIndex >= 0, "result validation args missing");
      validateResult(
        budget,
        JSON.parse(fs.readFileSync(args[resultIndex + 1], "utf8")),
        JSON.parse(fs.readFileSync(args[statusIndex + 1], "utf8")),
        { commit: args[commitIndex + 1], budgetSha256: args[hashIndex + 1] },
      );
    }
    console.log(`OK ZERO-EVAL-1 calibration: ${budgetPath}`);
  }
}

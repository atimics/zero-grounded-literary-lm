#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateContract } from "./check_zero_eval1_screen.mjs";

const DEFAULT_BUDGET = "benchmarks/zero-eval-1/screen/aws/budget.json";

function fail(message) {
  throw new Error(message);
}
function assert(value, message) {
  if (!value) fail(message);
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateBudget(budget) {
  assert(budget?.schema === "zero.external_eval_screen_budget.v1", "budget schema drifted");
  assert(budget.id === "zero-eval-1-screen-v1", "budget id drifted");
  assert(budget.status === "authorized", "screen is not authorized");
  assert(budget.training_allowed === false, "training became allowed");
  assert(budget.authorization?.scope ===
    "one AWS execution of the frozen ZERO-EVAL-1 stratified screen only",
  "authorization scope drifted");
  assert(budget.authorization.one_execution_only === true, "authorization became repeatable");
  assert(budget.authorization.full_suite_authorized === false, "full suite became authorized");

  const requiredLocks = [
    "base_contract", "screen_contract", "evaluator", "inference", "inference_header",
    "channel_protocol", "preparer", "sampler", "runner", "result_compiler",
    "result_renderer", "screen_checker", "budget_checker", "workload", "user_data",
    "launch_workflow", "collector_workflow", "zero3_model", "zero4_model",
  ];
  assert(same(Object.keys(budget.source_lock), requiredLocks), "source-lock grid drifted");
  for (const [name, lock] of Object.entries(budget.source_lock)) {
    assert(typeof lock.path === "string" && fs.existsSync(lock.path), `${name} lock unavailable`);
    assert(sha256(lock.path) === lock.sha256, `${name} lock hash mismatch`);
    if (lock.bytes !== undefined) {
      assert(fs.statSync(lock.path).size === lock.bytes, `${name} lock size mismatch`);
    }
  }
  const contract = JSON.parse(fs.readFileSync(
    budget.source_lock.screen_contract.path, "utf8",
  ));
  validateContract(contract);
  const calibration = budget.calibration_basis;
  assert(fs.existsSync(calibration.result_path), "calibration result unavailable");
  assert(sha256(calibration.result_path) === calibration.result_sha256,
    "calibration result hash drifted");
  for (const [task, basis] of Object.entries(calibration.task_seconds)) {
    const dataset = contract.datasets[task];
    const byCases = 2 * basis.elapsed * dataset.cases /
      calibration.calibration_cases_per_task;
    const byBytes = 2 * basis.elapsed * dataset.bytes / basis.calibration_bytes;
    assert(basis.projected === Math.ceil(Math.max(byCases, byBytes)),
      `${task} projection rule drifted`);
  }

  assert(budget.venue?.provider === "aws" && budget.venue.region === "us-east-1",
    "AWS venue drifted");
  assert(budget.venue.instance_type === "c6i.4xlarge" &&
    budget.venue.online_vcpus === 16, "AWS instance drifted");
  assert(budget.venue.on_demand_usd_per_hour === 0.68, "AWS price drifted");
  assert(budget.workload?.jobs === 16 && budget.workload.repetitions === 1,
    "workload multiplicity drifted");
  assert(same(budget.workload.evaluation_order, contract.execution_policy.evaluation_order),
    "workload order drifted");
  assert(budget.workload.optimizer_attempts === 0 &&
    budget.workload.training_updates === 0 &&
    budget.workload.controller_or_kernel_calls === 0, "forbidden work leaked");

  const execution = budget.execution;
  assert(execution?.max_instance_seconds === 3600, "instance cap drifted");
  assert(execution.workload_timeout_seconds === 3480, "workload cap drifted");
  assert(execution.publication_reserve_seconds === 120, "publication reserve drifted");
  assert(execution.workload_timeout_seconds + execution.publication_reserve_seconds ===
    execution.max_instance_seconds, "time budget does not reconcile");
  assert(execution.max_compute_usd === 0.68, "compute cap drifted");
  assert(execution.max_compute_usd ===
    execution.max_instance_seconds * budget.venue.on_demand_usd_per_hour / 3600,
  "compute cap and price do not reconcile");
  assert(execution.manual_approval_observed === true &&
    execution.authorized_for_execution === true, "execution is not authorized");

  const inference = Object.values(budget.projection.frozen_inference_seconds)
    .reduce((sum, value) => sum + value, 0);
  assert(inference === 2421, "inference projection drifted");
  assert(budget.projection.calibration_contingency_seconds ===
    Math.ceil(inference * 0.25), "calibration contingency drifted");
  const workloadProjected = budget.projection.cold_start_and_dependencies_seconds +
    budget.projection.source_and_input_download_seconds +
    budget.projection.build_seconds + inference +
    budget.projection.calibration_contingency_seconds +
    budget.projection.workload_headroom_seconds;
  assert(workloadProjected === execution.workload_timeout_seconds,
    "workload projection does not reconcile");
  assert(budget.projection.publication_reserve_seconds ===
    execution.publication_reserve_seconds, "publication projection drifted");

  assert(budget.completion_gate?.all_eight_results_required === true,
    "eight-result gate missing");
  assert(budget.completion_gate.partial_scores_must_not_be_published === true,
    "partial-score seal missing");
  assert(budget.completion_gate.collector_may_wait_or_launch_compute === false,
    "collector gained compute authority");

  const launch = fs.readFileSync(budget.source_lock.launch_workflow.path, "utf8");
  const collector = fs.readFileSync(budget.source_lock.collector_workflow.path, "utf8");
  assert(launch.includes("run-instances"), "launch workflow cannot launch");
  assert(!/\b(?:sleep|ec2 wait)\b/u.test(launch), "launch workflow waits for compute");
  assert(!/\b(?:run-instances|start-instances|sleep|ec2 wait)\b/u.test(collector),
    "collector waits or starts compute");
  return true;
}

function main(file) {
  const budget = JSON.parse(fs.readFileSync(file, "utf8"));
  validateBudget(budget);
  console.log(`OK ZERO-EVAL-1 screen budget: ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv[2] ?? DEFAULT_BUDGET); } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}

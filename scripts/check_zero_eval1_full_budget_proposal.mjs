#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_PROPOSAL = "benchmarks/zero-eval-1/full-budget-proposal.json";
const CONTRACT_PATH = "benchmarks/zero-eval-1/contract.json";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function approximately(left, right) {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function roundedCents(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

export function validateProposal(proposal) {
  assert(
    proposal?.schema === "zero.external_eval_full_budget_proposal.v1",
    "proposal schema drifted",
  );
  assert(proposal.id === "zero-eval-1-aws-full", "proposal id drifted");
  assert(proposal.status === "proposed_not_authorized", "proposal status drifted");
  assert(proposal.training_allowed === false, "proposal permits training");
  assert(
    proposal.authorization?.full_evaluation_authorized === false &&
      proposal.authorization?.requires_separate_manual_authorization === true &&
      proposal.authorization?.authorized_for_execution === false,
    "full evaluation became authorized",
  );

  const evidence = proposal.evidence;
  assert(fs.existsSync(evidence.calibration_result_path), "calibration evidence missing");
  assert(
    sha256(evidence.calibration_result_path) === evidence.calibration_result_sha256,
    "calibration evidence hash mismatch",
  );
  const result = JSON.parse(fs.readFileSync(evidence.calibration_result_path, "utf8"));
  assert(result.status === "complete", "calibration evidence is incomplete");
  assert(result.scientific_inference_allowed === false, "calibration evidence became scientific");
  assert(result.jobs === evidence.calibration_jobs, "calibration jobs drifted");
  assert(
    result.elapsed_instance_seconds === evidence.calibration_elapsed_instance_seconds,
    "calibration elapsed time drifted",
  );
  assert(
    result.estimated_compute_usd === evidence.calibration_estimated_compute_usd,
    "calibration cost drifted",
  );

  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const workload = proposal.workload;
  assert(
    JSON.stringify(workload.models) === JSON.stringify(contract.models.map(({ id }) => id)),
    "model grid drifted",
  );
  assert(workload.jobs === contract.execution_policy.jobs, "job count drifted");
  assert(workload.repetitions === contract.execution_policy.repetitions, "repetitions drifted");
  assert(
    JSON.stringify(workload.evaluation_order) ===
      JSON.stringify(contract.execution_policy.evaluation_order),
    "evaluation order drifted",
  );
  assert(
    workload.optimizer_attempts === 0 && workload.training_updates === 0 &&
      workload.controller_or_kernel_calls === 0,
    "training or controller work leaked into the proposal",
  );

  const expectedTaskOrder = ["blimp", "tinystories", "hellaswag", "lambada"];
  assert(
    JSON.stringify(Object.keys(workload.task_cases)) === JSON.stringify(expectedTaskOrder),
    "task order drifted",
  );
  const projection = proposal.projection;
  let baseSeconds = 0;
  for (const id of expectedTaskOrder) {
    const task = contract.tasks.find((candidate) => candidate.id === id);
    const dataset = contract.prepared_bundle.datasets[id];
    const measurement = result.measurements[id];
    const stored = projection.tasks[id];
    assert(workload.task_cases[id] === task.cases, `${id} case count drifted`);
    assert(measurement.cases === evidence.calibration_cases_per_task, `${id} sample count drifted`);
    const caseScaled =
      measurement.elapsed_seconds * task.cases / measurement.cases * workload.models.length;
    const byteScaled =
      measurement.elapsed_seconds * dataset.bytes / measurement.input_bytes *
        workload.models.length;
    assert(approximately(stored.case_scaled_seconds, caseScaled), `${id} case projection drifted`);
    assert(approximately(stored.byte_scaled_seconds, byteScaled), `${id} byte projection drifted`);
    assert(
      stored.selected_seconds === Math.ceil(Math.max(caseScaled, byteScaled)),
      `${id} selected projection drifted`,
    );
    baseSeconds += stored.selected_seconds;
  }
  assert(projection.base_evaluation_seconds === baseSeconds, "base projection drifted");
  assert(projection.contingency_fraction === 0.25, "contingency fraction drifted");
  assert(
    projection.contingency_seconds === Math.ceil(baseSeconds * projection.contingency_fraction),
    "contingency seconds drifted",
  );
  const workloadTotal =
    baseSeconds + projection.contingency_seconds +
    projection.cold_start_build_and_download_seconds +
    projection.rounding_headroom_seconds;
  assert(
    projection.workload_timeout_seconds === workloadTotal,
    "workload timeout does not reconcile",
  );
  assert(
    projection.max_instance_seconds ===
      workloadTotal + projection.publication_reserve_seconds,
    "instance cap does not reconcile",
  );

  const venue = proposal.venue;
  assert(
    venue.provider === "aws" && venue.region === "us-east-1" &&
      venue.instance_type === "c6i.4xlarge" && venue.online_vcpus === 16,
    "venue drifted",
  );
  assert(venue.on_demand_usd_per_hour === 0.68, "hourly price drifted");
  assert(
    projection.max_compute_usd === roundedCents(
      projection.max_instance_seconds * venue.on_demand_usd_per_hour / 3600,
    ),
    "compute cap drifted",
  );
  assert(
    projection.max_instance_seconds === 30600 &&
      projection.workload_timeout_seconds === 30300 &&
      projection.max_compute_usd === 5.78,
    "proposed hard ceiling drifted",
  );

  const policy = proposal.execution_policy;
  assert(policy.long_run_must_be_asynchronous_aws === true, "long-run venue gate missing");
  assert(policy.github_actions_must_not_wait_for_compute === true, "GHA wait became allowed");
  assert(policy.collector_must_not_start_or_wait_for_compute === true, "collector gate drifted");
  assert(policy.exactly_once_execution_lock_required === true, "execution lock gate missing");
  assert(policy.structured_status_required === true, "status gate missing");
  assert(policy.instance_termination_required === true, "termination gate missing");
  assert(policy.full_workflow_not_yet_implemented === true, "proposal pretends to be executable");
  return true;
}

function selfTest() {
  const proposal = JSON.parse(fs.readFileSync(DEFAULT_PROPOSAL, "utf8"));
  validateProposal(proposal);
  for (const [name, mutate] of [
    ["authorization", (copy) => { copy.authorization.authorized_for_execution = true; }],
    ["task count", (copy) => { copy.workload.task_cases.blimp -= 1; }],
    ["cap", (copy) => { copy.projection.max_instance_seconds += 1; }],
    ["GHA wait", (copy) => { copy.execution_policy.github_actions_must_not_wait_for_compute = false; }],
  ]) {
    const invalid = structuredClone(proposal);
    mutate(invalid);
    let rejected = false;
    try {
      validateProposal(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("ZERO-EVAL-1 full-budget proposal self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const proposalPath = process.argv[2] ?? DEFAULT_PROPOSAL;
    validateProposal(JSON.parse(fs.readFileSync(proposalPath, "utf8")));
    console.log(`OK ZERO-EVAL-1 full-budget proposal: ${proposalPath}`);
  }
}

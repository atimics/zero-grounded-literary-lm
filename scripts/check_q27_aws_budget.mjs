#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_BUDGET = "benchmarks/zero4-q27-v1/aws-v1/budget.json";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateBudget(
  budget,
  { requireAuthorized = false } = {},
) {
  assert(
    budget?.schema === "zero.q27_diagnostic_execution_budget.v1",
    "unsupported Q2.7 AWS budget schema",
  );
  assert(budget.id === "zero4-q27-aws-v1", "unexpected Q2.7 AWS id");
  assert(
    ["proposed_not_authorized", "authorized"].includes(budget.status),
    "Q2.7 budget status drifted",
  );
  assert(budget.scientific_inference_allowed === true,
    "Q2.7 budget forbids scientific inference");

  const authorization = budget.authorization;
  assert(
    authorization?.scope ===
      "one AWS execution of Q2.7 diagnostic seed 2 through quantity promotion",
    "Q2.7 authorization scope drifted",
  );
  assert(authorization.one_execution_only === true,
    "Q2.7 authorization became repeatable");
  assert(authorization.requires_manual_approval === true,
    "Q2.7 approval gate is absent");
  assert(
    authorization.manual_approval_observed ===
      authorization.authorized_for_execution,
    "Q2.7 approval fields disagree",
  );
  if (authorization.authorized_for_execution) {
    assert(budget.status === "authorized",
      "authorized Q2.7 budget retains a proposal status");
    assert(
      typeof authorization.authorized_at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(authorization.authorized_at),
      "authorized Q2.7 budget lacks an authorization date",
    );
  } else {
    assert(budget.status === "proposed_not_authorized",
      "unapproved Q2.7 budget has an authorized status");
    assert(authorization.authorized_at === null,
      "unapproved Q2.7 budget has an authorization date");
  }
  if (requireAuthorized) {
    assert(authorization.manual_approval_observed === true,
      "Q2.7 manual approval is missing");
    assert(authorization.authorized_for_execution === true,
      "Q2.7 execution is not authorized");
  }

  const requiredScientificLocks = [
    "q27_contract",
    "q26_contract",
    "trainer",
    "result_checker",
    "trainer_source",
    "exporter_source",
    "quantity_evaluator_source",
    "generator",
    "language_gate_contract",
    "language_gate_runner",
  ];
  assert(
    budget.scientific_source_lock?.frozen_science_commit ===
      "765600e218537ac3b7ff320c676cfb7f62dab0ae" &&
      budget.scientific_source_lock?.scientific_design_unchanged === true,
    "Q2.7 frozen scientific authority drifted",
  );
  assert(
    same(
      Object.keys(budget.scientific_source_lock).slice(2),
      requiredScientificLocks,
    ),
    "Q2.7 scientific source-lock grid drifted",
  );
  for (const name of requiredScientificLocks) {
    const lock = budget.scientific_source_lock[name];
    assert(typeof lock.path === "string" && fs.existsSync(lock.path),
      `${name} scientific lock unavailable`);
    assert(sha256(lock.path) === lock.sha256,
      `${name} scientific source-lock hash mismatch`);
  }

  const requiredInfrastructureLocks = [
    "budget_checker",
    "preflight_checker",
    "preflight_failure_checker",
    "preflight_iam_checker",
    "workflow_checker",
    "completion_checker",
    "preflight",
    "request_builder",
    "provisioner",
    "preflight_iam_applier",
    "workload",
    "user_data",
    "launch_workflow",
    "collector_workflow",
    "conditional_authorization",
    "language_gate_materializer",
    "preflight_failure_record",
  ];
  assert(
    budget.infrastructure_source_lock?.executor_version ===
      "q27-aws-v1-preflight-iam-2",
    "Q2.7 infrastructure executor version drifted",
  );
  assert(
    same(
      Object.keys(budget.infrastructure_source_lock).slice(1),
      requiredInfrastructureLocks,
    ),
    "Q2.7 infrastructure source-lock grid drifted",
  );
  for (const name of requiredInfrastructureLocks) {
    const lock = budget.infrastructure_source_lock[name];
    assert(typeof lock.path === "string" && fs.existsSync(lock.path),
      `${name} infrastructure lock unavailable`);
    assert(sha256(lock.path) === lock.sha256,
      `${name} infrastructure source-lock hash mismatch`);
  }
  const q27 = JSON.parse(fs.readFileSync(
    budget.scientific_source_lock.q27_contract.path,
    "utf8",
  ));
  assert(q27.schema === "zero.zero4_q27_contract.v1",
    "Q2.7 contract schema drifted");
  assert(q27.authorization.authorized === false,
    "base Q2.7 contract directly authorizes compute");
  assert(
    q27.lineage.q26_contract_sha256 ===
      budget.scientific_source_lock.q26_contract.sha256,
    "Q2.7 inherited Q2.6 contract differs from the budget lock",
  );
  const conditional = JSON.parse(fs.readFileSync(
    budget.infrastructure_source_lock.conditional_authorization.path,
    "utf8",
  ));
  assert(
    conditional.schema ===
      "zero.q27_conditional_language_gate_authorization.v1" &&
      conditional.status === "authorized_if_candidate_ready" &&
      conditional.quantity_stage.required_decision === "candidate-ready" &&
      conditional.language_gate.caps.max_compute_usd === 0.12 &&
      conditional.all_in_envelope.maximum_compute_usd === 1.29 &&
      conditional.authorization.explicit_manual_authorization === true &&
      conditional.authorization.authorized_for_execution_if_candidate_ready ===
        true &&
      conditional.authorization.one_execution_only === true,
    "Q2.7 conditional language-gate authorization drifted",
  );
  assert(
    conditional.quantity_stage.result_checker_sha256 ===
      budget.scientific_source_lock.result_checker.sha256 &&
      conditional.language_gate.contract_sha256 ===
        budget.scientific_source_lock.language_gate_contract.sha256 &&
      conditional.language_gate.runner_sha256 ===
        budget.scientific_source_lock.language_gate_runner.sha256,
    "Q2.7 conditional stage differs from frozen science",
  );

  const venue = budget.venue;
  assert(
    venue?.provider === "aws" &&
      venue.region === "us-east-1" &&
      venue.instance_type === "c6i.4xlarge" &&
      venue.cpu_architecture === "x86_64" &&
      venue.online_vcpus === 16 &&
      venue.training_backend === "OpenBLAS" &&
      venue.openblas_threads === 16,
    "Q2.7 AWS venue drifted",
  );
  assert(venue.on_demand_usd_per_hour === 0.68,
    "Q2.7 AWS price drifted");
  assert(
    budget.workload.seed === 2 &&
      budget.workload.maximum_optimizer_attempts === 1400 &&
      budget.workload.acquisition_attempts === 1000 &&
      budget.workload.consolidation_attempts === 400 &&
      budget.workload.batch === 2 &&
      budget.workload.trainable_scope === "top-ffn" &&
      budget.workload.trainable_parameters === 541184,
    "Q2.7 workload drifted",
  );
  assert(
    budget.workload.language_gate_included === false &&
      budget.workload.language_gate_requires_candidate_bound_budget === true,
    "Q2.7 budget improperly includes the language gate",
  );
  const execution = budget.execution;
  assert(
    execution.max_instance_seconds === 6190 &&
      execution.workload_timeout_seconds === 6130 &&
      execution.publication_reserve_seconds === 60 &&
      execution.max_compute_usd === 1.17,
    "Q2.7 execution ceiling drifted",
  );
  assert(
    execution.github_actions_must_not_wait_for_compute === true &&
      execution.collector_may_wait_or_launch_compute === false,
    "Q2.7 non-waiting policy drifted",
  );
  const exact = Math.ceil(
    execution.max_instance_seconds *
      venue.on_demand_usd_per_hour / 3600 * 100,
  ) / 100;
  assert(exact === execution.max_compute_usd,
    "Q2.7 dollar ceiling does not cover the time ceiling");
  assert(
    budget.timing_basis.maximum_observed_q26r_seed_seconds === 5000 &&
      budget.timing_basis.top_ffn_speedup_assumed === false &&
      budget.timing_basis.rationale.includes("forward"),
    "Q2.7 conservative timing basis drifted",
  );
  assert(
    budget.completion_gate.terminal_instance_required === true &&
      budget.completion_gate.structured_status_required === true &&
      budget.completion_gate.green_ci_required_before_merge === true,
    "Q2.7 completion gate drifted",
  );
  assert(
    budget.preflight?.required_before_execution_lock === true &&
      budget.preflight.exact_run_instances_dry_run_required === true &&
      budget.preflight.iam_pass_role_proof_required === true &&
      budget.preflight.ami_validation_required === true &&
      budget.preflight.subnet_security_group_validation_required === true &&
      budget.preflight.s3_write_once_proof_required === true &&
      budget.preflight.required_asset_count === 6,
    "Q2.7 infrastructure preflight authority drifted",
  );
  assert(
    budget.prior_zero_compute_preflight?.record_path ===
      "benchmarks/zero4-q27-v1/aws-v1/preflight-failure-30189009274.json" &&
      budget.prior_zero_compute_preflight.ci_run_id === "30189009274" &&
      budget.prior_zero_compute_preflight.execution_lock_acquired === false &&
      budget.prior_zero_compute_preflight.compute_launched === false &&
      budget.prior_zero_compute_preflight.observed_compute_usd === 0 &&
      budget.prior_zero_compute_preflight.scientific_attempt_consumed ===
        false &&
      budget.prior_zero_compute_preflight.authorization_remains_available ===
        true,
    "Q2.7 zero-compute preflight history drifted",
  );
  return true;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const budgetPath = process.argv[2] ?? DEFAULT_BUDGET;
  validateBudget(
    JSON.parse(fs.readFileSync(budgetPath, "utf8")),
    { requireAuthorized: process.argv.includes("--require-authorized") },
  );
  console.log("Q2.7 AWS budget and compute firewall passed");
}

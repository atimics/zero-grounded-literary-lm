#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { validateExecutionFailure } from
  "./check_q27_aws_execution_failure.mjs";

const DEFAULT_RETRY =
  "benchmarks/zero4-q27-v1/aws-v1/infrastructure-retry-1.json";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateRetry(
  retry,
  { requireAuthorized = false } = {},
) {
  assert(
    retry?.schema === "zero.q27_infrastructure_retry_authorization.v1" &&
      retry.id === "zero4-q27-aws-v1-infrastructure-retry-1",
    "unsupported Q2.7 infrastructure retry authority",
  );
  assert(
    ["proposed_not_authorized", "authorized"].includes(retry.status),
    "Q2.7 infrastructure retry status drifted",
  );
  const authorization = retry.authorization;
  assert(
    authorization?.scope ===
      "one infrastructure-only retry of Q2.7 diagnostic seed 2 through quantity promotion" &&
      authorization.failed_workflow_run_id === "30199981920" &&
      authorization.retry_ordinal === 1 &&
      authorization.maximum_retry_count === 1 &&
      authorization.one_retry_execution_only === true &&
      authorization.requires_manual_approval === true,
    "Q2.7 retry scope or cardinality drifted",
  );
  assert(
    authorization.manual_approval_observed ===
      authorization.authorized_for_execution &&
      authorization.expanded_all_in_envelope_approved ===
        authorization.authorized_for_execution,
    "Q2.7 retry approval fields disagree",
  );
  if (authorization.authorized_for_execution) {
    assert(retry.status === "authorized",
      "authorized Q2.7 retry retains proposal status");
    assert(
      typeof authorization.authorized_at === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(authorization.authorized_at),
      "authorized Q2.7 retry lacks an authorization date",
    );
    assert(
      typeof authorization.approval_basis === "string" &&
        authorization.approval_basis.includes("Issue #61") &&
        authorization.approved_additional_compute_usd === 1.17 &&
        authorization.approved_max_new_scientific_compute_usd === 1.29,
      "authorized Q2.7 retry lacks the bounded human approval record",
    );
  } else {
    assert(
      retry.status === "proposed_not_authorized" &&
        authorization.authorized_at === null,
      "unapproved Q2.7 retry has an authorized state",
    );
  }
  if (requireAuthorized) {
    assert(authorization.manual_approval_observed === true,
      "Q2.7 retry manual approval is missing");
    assert(authorization.authorized_for_execution === true,
      "Q2.7 infrastructure retry is not authorized");
  }

  const failureLock = retry.eligibility?.failure_record;
  assert(
    failureLock?.path ===
      "benchmarks/zero4-q27-v1/aws-v1/execution-failure-30199981920.json" &&
      fs.existsSync(failureLock.path) &&
      sha256(failureLock.path) === failureLock.sha256,
    "Q2.7 retry failure record lock drifted",
  );
  validateExecutionFailure(JSON.parse(fs.readFileSync(failureLock.path, "utf8")));
  assert(
    retry.eligibility.required_terminal_status === "infrastructure-error" &&
      retry.eligibility.required_failure_phase === "build" &&
      retry.eligibility.required_scientific_result_available === false &&
      retry.eligibility.required_scientific_decision === null &&
      retry.eligibility.required_prior_instance_state === "terminated" &&
      retry.eligibility.result_object_must_be_absent === true &&
      retry.eligibility.candidate_artifacts_must_be_absent === true &&
      retry.eligibility.budget_exhaustion_is_ineligible === true &&
      retry.eligibility.completed_result_is_ineligible === true,
    "Q2.7 retry eligibility predicates drifted",
  );

  const science = retry.scientific_immutability;
  const requiredScience = [
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
    science?.frozen_science_commit ===
      "765600e218537ac3b7ff320c676cfb7f62dab0ae" &&
      science.scientific_design_unchanged === true &&
      same(Object.keys(science).slice(2), requiredScience),
    "Q2.7 retry scientific lock grid drifted",
  );
  for (const name of requiredScience) {
    const lock = science[name];
    assert(
      typeof lock.path === "string" &&
        fs.existsSync(lock.path) &&
        sha256(lock.path) === lock.sha256,
      `${name} Q2.7 retry scientific hash drifted`,
    );
  }

  const provenance = retry.provenance;
  assert(
    provenance?.original_execution_lock?.s3_key ===
      "experiments/zero4-q27-aws-v1/execution.lock" &&
      provenance.original_execution_lock.sha256 ===
        "7def9b3e6a684cfd48f401dda7a9988aeef636f89ba6a7b4eddcb969f529c59a" &&
      provenance.failed_launch.sha256 ===
        "5798760a21e4766926cb8f25028bfc3b88319c91313672c71e0380cd860b43c1" &&
      provenance.failed_status.sha256 ===
        "2f2dad36934ad2aff3d3294e945cae0866b1dcc4e2a47e0f07745125038ac12e" &&
      provenance.prior_instance_id === "i-095a0fdf736ce98e9" &&
      provenance.prior_instance_must_be_terminated === true &&
      provenance.original_execution_lock_must_remain_unchanged === true,
    "Q2.7 retry provenance drifted",
  );

  const execution = retry.retry_execution;
  assert(
    execution?.provider === "aws" &&
      execution.region === "us-east-1" &&
      execution.instance_type === "c6i.4xlarge" &&
      execution.seed === 2 &&
      execution.max_instance_seconds === 6190 &&
      execution.workload_timeout_seconds === 6130 &&
      execution.publication_reserve_seconds === 60 &&
      execution.on_demand_usd_per_hour === 0.68 &&
      execution.max_compute_usd === 1.17 &&
      execution.exact_run_instances_dry_run_required === true &&
      execution.preflight_before_retry_lock_required === true &&
      execution.separate_write_once_lock_key ===
        "experiments/zero4-q27-aws-v1/infrastructure-retry-1.lock" &&
      execution.collector_may_wait_or_launch_compute === false,
    "Q2.7 retry execution boundary drifted",
  );

  const cost = retry.cost_envelope;
  const priorCost = 113 * 0.68 / 3600;
  const quantityExact = priorCost + 1.17;
  const overallExact = quantityExact + 0.12;
  assert(
    cost?.prior_observed_instance_seconds === 113 &&
      Math.abs(cost.prior_observed_compute_usd - priorCost) < 1e-15 &&
      cost.retry_max_instance_seconds === 6190 &&
      cost.retry_max_compute_usd === 1.17 &&
      cost.quantity_all_in_max_instance_seconds === 6303 &&
      Math.abs(cost.quantity_all_in_exact_max_compute_usd - quantityExact) <
        1e-15 &&
      cost.quantity_all_in_ceiling_usd === 1.2 &&
      cost.conditional_language_gate_max_compute_usd === 0.12 &&
      Math.abs(cost.overall_exact_max_compute_usd - overallExact) < 1e-15 &&
      cost.overall_all_in_ceiling_usd === 1.32 &&
      cost.additional_retry_compute_authorization_required_usd === 1.17,
    "Q2.7 retry all-in cost envelope drifted",
  );
  assert(
    same(retry.forbidden_conditions, [
      "retry authorization absent",
      "retry lock already exists",
      "original execution lock missing or changed",
      "prior instance not terminated",
      "active ZERO compute exists",
      "prior status is budget-exhausted",
      "scientific result or decision exists",
      "candidate artifact exists",
      "retry ordinal greater than one",
      "scientific source hash differs",
    ]),
    "Q2.7 retry forbidden-condition set drifted",
  );
  return true;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const retryPath = process.argv.find(
    (argument, index) => index > 1 && argument !== "--require-authorized",
  ) ?? DEFAULT_RETRY;
  validateRetry(
    JSON.parse(fs.readFileSync(retryPath, "utf8")),
    { requireAuthorized: process.argv.includes("--require-authorized") },
  );
  console.log("Q2.7 one-shot infrastructure retry authority passed");
}

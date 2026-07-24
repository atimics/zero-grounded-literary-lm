#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { validateBudget as validateV1Budget } from "./check_q26r_aws_budget.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function roundedCents(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateV2Budget(
  budget,
  { requireAuthorized = false } = {},
) {
  assert(
    budget?.schema === "zero.q26r_replacement_execution_budget.v2",
    "unsupported Q2.6-R AWS v2 budget schema",
  );
  assert(budget.id === "zero4-q26r-aws-v2", "unexpected Q2.6-R AWS v2 id");
  assert(budget.status === "preregistered", "Q2.6-R AWS v2 is not preregistered");
  assert(budget.scientific_inference_allowed === true, "replacement execution forbids inference");

  const authorization = budget.authorization;
  assert(
    authorization?.scope
      === "one combined replacement AWS execution of Q2.6-R seeds 1 and 3",
    "v2 authorization scope drifted",
  );
  assert(authorization.one_combined_execution_only === true, "v2 is not one-time");
  assert(authorization.requires_manual_approval === true, "v2 approval gate is absent");
  assert(
    typeof authorization.manual_approval_observed === "boolean"
      && typeof authorization.authorized_for_execution === "boolean",
    "v2 approval fields must be boolean",
  );
  assert(
    !authorization.authorized_for_execution
      || authorization.manual_approval_observed === true,
    "v2 execution is authorized without observed approval",
  );
  assert(
    authorization.manual_approval_observed
      === authorization.authorized_for_execution,
    "v2 approval and execution authorization must change together",
  );
  if (authorization.authorized_for_execution) {
    assert(
      typeof authorization.authorized_at === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(authorization.authorized_at),
      "v2 authorization date is missing",
    );
  } else {
    assert(authorization.authorized_at === null, "unapproved v2 budget has an authorization date");
  }
  if (requireAuthorized) {
    assert(authorization.manual_approval_observed === true, "v2 manual approval is missing");
    assert(authorization.authorized_for_execution === true, "v2 execution is not authorized");
  }

  const recoveryAuthorization = budget.recovery_authorization;
  assert(
    recoveryAuthorization?.scope
      === "one recovery launch after infrastructure-only preflight failure 30117320329",
    "v2 recovery authorization scope drifted",
  );
  assert(
    recoveryAuthorization.failed_launch_workflow_run_id === "30117320329",
    "v2 recovery source run drifted",
  );
  assert(recoveryAuthorization.one_recovery_launch_only === true, "v2 recovery is not one-time");
  assert(recoveryAuthorization.requires_manual_approval === true, "v2 recovery approval gate is absent");
  assert(
    recoveryAuthorization.manual_approval_observed
      === recoveryAuthorization.authorized_for_execution,
    "v2 recovery approval and execution authorization must change together",
  );
  if (recoveryAuthorization.authorized_for_execution) {
    assert(
      recoveryAuthorization.manual_approval_observed === true
        && typeof recoveryAuthorization.authorized_at === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(recoveryAuthorization.authorized_at),
      "v2 recovery authorization is incomplete",
    );
  } else {
    assert(
      recoveryAuthorization.authorized_at === null,
      "unapproved v2 recovery has an authorization date",
    );
  }
  if (requireAuthorized) {
    assert(
      recoveryAuthorization.manual_approval_observed === true,
      "v2 recovery manual approval is missing",
    );
    assert(
      recoveryAuthorization.authorized_for_execution === true,
      "v2 recovery execution is not authorized",
    );
  }

  const recovery2Authorization = budget.recovery_2_authorization;
  assert(
    recovery2Authorization?.scope
      === "one final recovery launch after IAM preflight failure 30118477546",
    "v2 recovery-2 authorization scope drifted",
  );
  assert(
    recovery2Authorization.failed_launch_workflow_run_id === "30118477546",
    "v2 recovery-2 source run drifted",
  );
  assert(
    recovery2Authorization.one_recovery_launch_only === true,
    "v2 recovery-2 is not one-time",
  );
  assert(
    recovery2Authorization.requires_manual_approval === true,
    "v2 recovery-2 approval gate is absent",
  );
  assert(
    recovery2Authorization.manual_approval_observed
      === recovery2Authorization.authorized_for_execution,
    "v2 recovery-2 approval and execution authorization must change together",
  );
  if (recovery2Authorization.authorized_for_execution) {
    assert(
      recovery2Authorization.manual_approval_observed === true
        && typeof recovery2Authorization.authorized_at === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(recovery2Authorization.authorized_at),
      "v2 recovery-2 authorization is incomplete",
    );
  } else {
    assert(
      recovery2Authorization.authorized_at === null,
      "unapproved v2 recovery-2 has an authorization date",
    );
  }
  if (requireAuthorized) {
    assert(
      recovery2Authorization.manual_approval_observed === true
        && recovery2Authorization.authorized_for_execution === true,
      "v2 recovery-2 execution is not authorized",
    );
  }

  const recovery3Authorization = budget.recovery_3_authorization;
  assert(
    recovery3Authorization?.scope
      === "one corrective recovery launch after deterministic bootstrap failure 30119938666",
    "v2 recovery-3 authorization scope drifted",
  );
  assert(
    recovery3Authorization.failed_launch_workflow_run_id === "30119938666",
    "v2 recovery-3 source run drifted",
  );
  assert(
    recovery3Authorization.one_recovery_launch_only === true,
    "v2 recovery-3 is not one-time",
  );
  assert(
    recovery3Authorization.requires_manual_approval === true
      && recovery3Authorization.manual_approval_observed
        === recovery3Authorization.authorized_for_execution,
    "v2 recovery-3 approval gate drifted",
  );
  if (recovery3Authorization.authorized_for_execution) {
    assert(
      recovery3Authorization.manual_approval_observed === true
        && recovery3Authorization.expanded_all_in_budget_approved === true
        && typeof recovery3Authorization.authorized_at === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(recovery3Authorization.authorized_at),
      "v2 recovery-3 authorization is incomplete",
    );
  } else {
    assert(
      recovery3Authorization.authorized_at === null
        && recovery3Authorization.expanded_all_in_budget_approved === false,
      "unapproved v2 recovery-3 has expanded authorization",
    );
  }
  if (requireAuthorized) {
    assert(
      recovery3Authorization.manual_approval_observed === true
        && recovery3Authorization.authorized_for_execution === true
        && recovery3Authorization.expanded_all_in_budget_approved === true,
      "v2 recovery-3 execution is not authorized",
    );
  }

  const science = budget.scientific_source_lock;
  assert(
    science?.base_execution_budget_path
      === "benchmarks/zero4-q26r-v1/aws-v1/budget.json",
    "v2 base execution budget path drifted",
  );
  assert(fs.existsSync(science.base_execution_budget_path), "v2 base budget is unavailable");
  assert(
    sha256(science.base_execution_budget_path)
      === science.base_execution_budget_sha256,
    "v2 base budget hash mismatch",
  );
  const base = readJson(science.base_execution_budget_path);
  validateV1Budget(base);
  assert(
    science.replication_contract_path
      === "benchmarks/zero4-q26r-v1/contract.json",
    "v2 replication contract path drifted",
  );
  assert(fs.existsSync(science.replication_contract_path), "v2 contract is unavailable");
  assert(
    sha256(science.replication_contract_path)
      === science.replication_contract_sha256,
    "v2 replication contract hash mismatch",
  );
  assert(
    science.replication_contract_sha256
      === base.scientific_source_lock.replication_contract_sha256,
    "v2 contract differs from v1",
  );
  assert(
    science.scientific_design_unchanged === true
      && science.scientific_checker_unchanged === true
      && science.family_rule_unchanged === true,
    "v2 permits scientific drift",
  );

  const replacement = budget.replacement_basis;
  assert(
    replacement?.prior_failure_path
      === "benchmarks/zero4-q26r-v1/aws-v1/execution-failure-30047634061.json",
    "v2 prior failure path drifted",
  );
  assert(fs.existsSync(replacement.prior_failure_path), "v2 prior failure is unavailable");
  assert(
    sha256(replacement.prior_failure_path) === replacement.prior_failure_sha256,
    "v2 prior failure hash mismatch",
  );
  const failure = readJson(replacement.prior_failure_path);
  assert(failure.status === "execution-failure", "v2 prior execution did not fail");
  assert(
    replacement.prior_launch_workflow_run_id
      === failure.source.launch_workflow_run_id,
    "v2 prior run id drifted",
  );
  assert(
    replacement.prior_status === failure.status
      && replacement.prior_candidate_results_observed
        === failure.candidate_results_observed
      && replacement.prior_scientific_result_observed
        === failure.scientific_result_observed
      && replacement.prior_scientific_result_accepted
        === failure.scientific_result_accepted
      && replacement.prior_family_inference === failure.family_inference,
    "v2 prior failure classification drifted",
  );
  assert(
    same(
      replacement.prior_candidate_decisions_disclosed,
      failure.candidate_results.map(({ seed, decision, accepted }) => ({
        seed,
        decision,
        accepted,
      })),
    ),
    "v2 prior candidate disclosure drifted",
  );
  assert(
    replacement.replacement_is_not_duplicate_accepted_evidence === true
      && replacement.prior_outcomes_may_not_change_science_or_stopping === true
      && replacement.prior_candidate_artifacts_forbidden_as_execution_inputs === true,
    "v2 replacement safeguards drifted",
  );
  assert(
    failure.scientific_result_accepted === false
      && failure.family_inference === null,
    "v2 replacement would duplicate accepted evidence",
  );

  const recovery = budget.recovery_basis;
  assert(
    recovery?.preflight_failure_path
      === "benchmarks/zero4-q26r-v1/aws-v2/preflight-failure-30117320329.json",
    "v2 preflight failure path drifted",
  );
  assert(fs.existsSync(recovery.preflight_failure_path), "v2 preflight failure is unavailable");
  assert(
    sha256(recovery.preflight_failure_path) === recovery.preflight_failure_sha256,
    "v2 preflight failure hash mismatch",
  );
  const preflight = readJson(recovery.preflight_failure_path);
  assert(
    preflight.schema === "zero.q26r_aws_preflight_failure.v2"
      && preflight.experiment === budget.id
      && preflight.status === "execution-preflight-failure",
    "v2 preflight failure classification drifted",
  );
  assert(
    recovery.failed_launch_workflow_run_id === preflight.source.launch_workflow_run_id
      && recovery.failed_launch_git_commit === preflight.source.git_commit
      && recovery.failed_launch_budget_sha256 === preflight.source.budget_sha256,
    "v2 failed launch identity drifted",
  );
  assert(
    recovery.partial_seed_1_instance_id
      === preflight.partial_launch.seed_1.instance_id
      && recovery.seed_1_termination_requested
        === preflight.partial_launch.seed_1.termination_requested
      && recovery.seed_3_instance_created
        === preflight.partial_launch.seed_3.created,
    "v2 partial launch evidence drifted",
  );
  assert(
    recovery.candidate_results_observed
      === preflight.scientific_effect.candidate_results_observed
      && recovery.scientific_result_observed
        === preflight.scientific_effect.scientific_result_observed
      && recovery.scientific_result_accepted
        === preflight.scientific_effect.scientific_result_accepted
      && recovery.family_inference === preflight.scientific_effect.family_inference
      && recovery.recovery_may_not_change_science === true,
    "v2 recovery scientific boundary drifted",
  );
  assert(
    preflight.failure.execution_lock_acquired === true
      && preflight.failure.launch_receipt_published === false
      && preflight.failure.identity_receipts_published === false
      && preflight.failure.seed_statuses_published === false
      && preflight.failure.shutdown_intents_published === false
      && preflight.scientific_effect.training_started === false
      && preflight.recovery.eligible === true,
    "v2 preflight failure does not permit recovery",
  );
  assert(
    preflight.failure.classification
      === "identity-capture-implementation-error"
      && preflight.failure.cause
        === "the launch asserted InstanceInitiatedShutdownBehavior in DescribeInstances output, but AWS exposes that value through DescribeInstanceAttribute"
      && preflight.partial_launch.seed_1.created === true
      && preflight.partial_launch.seed_1.state_at_termination_response
        === "shutting-down"
      && preflight.partial_launch.seed_3.created === false,
    "v2 preflight implementation failure evidence drifted",
  );
  assert(
    preflight.billing_reservation.hourly_rate_usd === 0.68
      && preflight.billing_reservation.reserved_instance_seconds === 60
      && Math.abs(
        preflight.billing_reservation.reserved_compute_usd
          - 60 * 0.68 / 3600,
      ) < 1e-15,
    "v2 preflight billing reservation drifted",
  );
  assert(
    preflight.recovery.requires_new_write_once_lock === true
      && preflight.recovery.prior_lock_must_remain_immutable === true
      && preflight.recovery.prior_job_artifacts_forbidden_as_execution_inputs
        === true
      && preflight.recovery.prior_billing_reservation_must_be_deducted
        === true,
    "v2 preflight recovery safeguards drifted",
  );

  const recovery2 = budget.recovery_2_basis;
  assert(
    recovery2?.preflight_failure_path
      === "benchmarks/zero4-q26r-v1/aws-v2/preflight-failure-30118477546.json",
    "v2 recovery-2 failure path drifted",
  );
  assert(
    fs.existsSync(recovery2.preflight_failure_path),
    "v2 recovery-2 failure is unavailable",
  );
  assert(
    sha256(recovery2.preflight_failure_path)
      === recovery2.preflight_failure_sha256,
    "v2 recovery-2 failure hash mismatch",
  );
  const preflight2 = readJson(recovery2.preflight_failure_path);
  assert(
    preflight2.schema === "zero.q26r_aws_preflight_failure.v2"
      && preflight2.experiment === budget.id
      && preflight2.status === "execution-preflight-failure",
    "v2 recovery-2 failure classification drifted",
  );
  assert(
    recovery2.failed_launch_workflow_run_id
      === preflight2.source.launch_workflow_run_id
      && recovery2.failed_launch_git_commit === preflight2.source.git_commit
      && recovery2.failed_launch_budget_sha256
        === preflight2.source.budget_sha256,
    "v2 recovery-2 launch identity drifted",
  );
  assert(
    recovery2.partial_seed_1_instance_id
      === preflight2.partial_launch.seed_1.instance_id
      && recovery2.seed_1_termination_requested
        === preflight2.partial_launch.seed_1.termination_requested
      && recovery2.seed_3_instance_created
        === preflight2.partial_launch.seed_3.created,
    "v2 recovery-2 partial launch evidence drifted",
  );
  assert(
    recovery2.required_iam_permission === "ec2:DescribeInstanceAttribute"
      && recovery2.zero_compute_permission_preflight_required === true
      && preflight2.failure.classification === "iam-permission-error"
      && preflight2.failure.cause
        === "the GitHub Actions role lacked ec2:DescribeInstanceAttribute"
      && preflight2.failure.aws_error_code === "UnauthorizedOperation"
      && preflight2.failure.original_execution_lock_acquired === true
      && preflight2.failure.recovery_1_lock_acquired === true
      && preflight2.failure.original_execution_lock_sha256
        === "6223613dcc64e5352f5ced21ab294c8875956038f5883bb1885aea57d25d5ab7"
      && preflight2.failure.recovery_1_lock_sha256
        === "2b70ef1f9459aa531e58818523747746b6d35a13c3f0102c22ea8f49039226c9"
      && preflight2.failure.launch_receipt_published === false
      && preflight2.failure.identity_receipts_published === false
      && preflight2.failure.seed_statuses_published === false
      && preflight2.failure.shutdown_intents_published === false,
    "v2 recovery-2 IAM failure evidence drifted",
  );
  assert(
    recovery2.candidate_results_observed
      === preflight2.scientific_effect.candidate_results_observed
      && recovery2.scientific_result_observed
        === preflight2.scientific_effect.scientific_result_observed
      && recovery2.scientific_result_accepted
        === preflight2.scientific_effect.scientific_result_accepted
      && recovery2.family_inference
        === preflight2.scientific_effect.family_inference
      && recovery2.recovery_may_not_change_science === true
      && preflight2.scientific_effect.training_started === false,
    "v2 recovery-2 scientific boundary drifted",
  );
  assert(
    preflight2.billing_reservation.hourly_rate_usd === 0.68
      && preflight2.billing_reservation.reserved_instance_seconds === 60
      && Math.abs(
        preflight2.billing_reservation.reserved_compute_usd
          - 60 * 0.68 / 3600,
      ) < 1e-15
      && preflight2.billing_reservation.cumulative_preflight_instance_seconds
        === 120
      && Math.abs(
        preflight2.billing_reservation.cumulative_preflight_compute_usd
          - 120 * 0.68 / 3600,
      ) < 1e-15,
    "v2 recovery-2 billing reservation drifted",
  );
  assert(
    preflight2.recovery.eligible === true
      && preflight2.recovery.requires_iam_permission
        === "ec2:DescribeInstanceAttribute"
      && preflight2.recovery.requires_zero_compute_permission_preflight
        === true
      && preflight2.recovery.requires_new_write_once_lock === true
      && preflight2.recovery.prior_locks_must_remain_immutable === true
      && preflight2.recovery.prior_job_artifacts_forbidden_as_execution_inputs
        === true
      && preflight2.recovery.cumulative_preflight_billing_must_be_deducted
        === true,
    "v2 recovery-2 safeguards drifted",
  );

  const recovery3 = budget.recovery_3_basis;
  assert(
    recovery3?.bootstrap_failure_path
      === "benchmarks/zero4-q26r-v1/aws-v2/bootstrap-failure-30119938666.json",
    "v2 recovery-3 failure path drifted",
  );
  assert(
    fs.existsSync(recovery3.bootstrap_failure_path),
    "v2 recovery-3 failure is unavailable",
  );
  assert(
    sha256(recovery3.bootstrap_failure_path)
      === recovery3.bootstrap_failure_sha256,
    "v2 recovery-3 failure hash mismatch",
  );
  const bootstrapFailure = readJson(recovery3.bootstrap_failure_path);
  assert(
    bootstrapFailure.schema === "zero.q26r_aws_bootstrap_failure.v2"
      && bootstrapFailure.experiment === budget.id
      && bootstrapFailure.status === "execution-bootstrap-failure",
    "v2 recovery-3 failure classification drifted",
  );
  assert(
    recovery3.failed_launch_workflow_run_id
      === bootstrapFailure.source.launch_workflow_run_id
      && recovery3.failed_launch_git_commit
        === bootstrapFailure.source.git_commit
      && recovery3.failed_launch_budget_sha256
        === bootstrapFailure.source.budget_sha256
      && recovery3.failed_launch_receipt_sha256
        === bootstrapFailure.source.launch_receipt_sha256,
    "v2 recovery-3 launch identity drifted",
  );
  assert(
    recovery3.seed_1_instance_id === bootstrapFailure.seeds[0].instance_id
      && recovery3.seed_3_instance_id === bootstrapFailure.seeds[1].instance_id
      && bootstrapFailure.seeds[0].seed === 1
      && bootstrapFailure.seeds[1].seed === 3,
    "v2 recovery-3 instance evidence drifted",
  );
  assert(
    bootstrapFailure.failure.classification
      === "deterministic-bootstrap-contract-error"
      && bootstrapFailure.failure.failed_guard
        === 'test "$ZERO_MAX_COMPUTE_USD" = "1.18"'
      && bootstrapFailure.failure.expected_guard
        === 'test "$ZERO_MAX_COMPUTE_USD" = "1.17"'
      && bootstrapFailure.failure.training_started === false
      && bootstrapFailure.failure.scientific_results_published === false
      && recovery3.required_bootstrap_contract_regression_test === true,
    "v2 recovery-3 bootstrap failure evidence drifted",
  );
  assert(
    bootstrapFailure.provenance.original_execution_lock_sha256
      === "6223613dcc64e5352f5ced21ab294c8875956038f5883bb1885aea57d25d5ab7"
      && bootstrapFailure.provenance.recovery_1_lock_sha256
        === "2b70ef1f9459aa531e58818523747746b6d35a13c3f0102c22ea8f49039226c9"
      && bootstrapFailure.provenance.recovery_2_lock_sha256
        === "79a7b826f7b669fa2ceb7ef117ca8f0f0ef5a0b494903a736f2b0e3b110c57a6"
      && bootstrapFailure.provenance.launch_receipt_published === true
      && bootstrapFailure.provenance.identity_receipts_published === true
      && bootstrapFailure.provenance.seed_statuses_published === true
      && bootstrapFailure.provenance.shutdown_intents_published === true,
    "v2 recovery-3 provenance evidence drifted",
  );
  const failedSeed1 = bootstrapFailure.seeds[0];
  const failedSeed3 = bootstrapFailure.seeds[1];
  assert(
    failedSeed1.status === "infrastructure-error"
      && failedSeed1.exit_code === 1
      && failedSeed1.observed_instance_seconds === 80
      && failedSeed1.status_sha256
        === "839400de52ce40ba9cb3a77b1588a76ec577de3b50c19bd2cda0d7a9984865c2"
      && failedSeed3.status === "infrastructure-error"
      && failedSeed3.exit_code === 1
      && failedSeed3.observed_instance_seconds === 87
      && failedSeed3.status_sha256
        === "c0370ade643c4c9e258995fa319032909ecbe770b40dca630b307317ba805e94",
    "v2 recovery-3 seed statuses drifted",
  );
  assert(
    bootstrapFailure.billing.hourly_rate_usd === 0.68
      && bootstrapFailure.billing.this_failure_instance_seconds === 167
      && Math.abs(
        bootstrapFailure.billing.this_failure_compute_usd
          - 167 * 0.68 / 3600,
      ) < 1e-15
      && bootstrapFailure.billing.cumulative_failed_instance_seconds === 287
      && Math.abs(
        bootstrapFailure.billing.cumulative_failed_compute_usd
          - 287 * 0.68 / 3600,
      ) < 1e-15,
    "v2 recovery-3 billing evidence drifted",
  );
  assert(
    recovery3.candidate_results_observed
      === bootstrapFailure.scientific_effect.candidate_results_observed
      && recovery3.scientific_result_observed
        === bootstrapFailure.scientific_effect.scientific_result_observed
      && recovery3.scientific_result_accepted
        === bootstrapFailure.scientific_effect.scientific_result_accepted
      && recovery3.family_inference
        === bootstrapFailure.scientific_effect.family_inference
      && recovery3.recovery_may_not_change_science === true
      && bootstrapFailure.recovery.eligible === true
      && bootstrapFailure.recovery.requires_bootstrap_contract_regression_test
        === true
      && bootstrapFailure.recovery.requires_new_write_once_lock === true,
    "v2 recovery-3 safeguards drifted",
  );

  const { price_checked_at: v2PriceDate, ...v2Venue } = budget.venue;
  const { price_checked_at: _basePriceDate, ...baseVenue } = base.venue;
  assert(same(v2Venue, baseVenue), "v2 venue differs from v1");
  assert(v2PriceDate === "2026-07-24", "v2 price check date drifted");
  assert(same(budget.workload, base.workload), "v2 scientific workload differs from v1");

  const evidence = budget.runtime_evidence;
  const seed1 = failure.candidate_results.find((record) => record.seed === 1);
  const seed3 = failure.candidate_results.find((record) => record.seed === 3);
  assert(
    evidence?.seed_1_observed_instance_seconds === seed1.observed_instance_seconds
      && evidence.seed_3_observed_instance_seconds === seed3.observed_instance_seconds
      && evidence.maximum_observed_instance_seconds
        === Math.max(seed1.observed_instance_seconds, seed3.observed_instance_seconds),
    "v2 runtime evidence drifted",
  );
  assert(
    evidence.seed_1_observed_compute_usd === seed1.observed_compute_usd
      && evidence.seed_3_observed_compute_usd === seed3.observed_compute_usd,
    "v2 cost evidence drifted",
  );
  assert(evidence.scientific_decisions_used_for_budgeting === false, "v2 budget uses outcomes");

  const perSeed = budget.per_seed_execution;
  assert(perSeed?.max_instance_seconds === 6190, "v2 per-seed cap drifted");
  assert(perSeed.workload_timeout_seconds === 6130, "v2 workload timeout drifted");
  assert(perSeed.publication_reserve_seconds === 60, "v2 publication reserve drifted");
  assert(
    perSeed.workload_timeout_seconds + perSeed.publication_reserve_seconds
      === perSeed.max_instance_seconds,
    "v2 per-seed time budget does not reconcile",
  );
  assert(
    perSeed.max_compute_usd
      === roundedCents(
        perSeed.max_instance_seconds * budget.venue.on_demand_usd_per_hour / 3600,
      ),
    "v2 per-seed cost cap does not reconcile",
  );
  assert(
    perSeed.budget_is_independent === true
      && perSeed.unused_budget_transfer_forbidden === true,
    "v2 permits budget transfer",
  );

  const combined = budget.combined_execution;
  assert(combined?.max_concurrent_instances === 2, "v2 concurrency cap drifted");
  assert(
    combined.max_instance_seconds_sum === 2 * perSeed.max_instance_seconds,
    "v2 combined time cap does not reconcile",
  );
  assert(
    combined.max_compute_usd === 2 * perSeed.max_compute_usd,
    "v2 combined cost cap does not reconcile",
  );
  assert(
    combined.both_seed_statuses_required === true
      && combined.one_seed_cannot_extend_the_other === true,
    "v2 combined budget safeguards drifted",
  );

  const allIn = budget.all_in_authorization;
  assert(
    allIn?.original_max_instance_seconds_sum === 12600
      && allIn.original_max_compute_usd === 2.38,
    "v2 original authorization drifted",
  );
  assert(
    allIn.preflight_failure_count === 2
      && allIn.bootstrap_failure_count === 1
      && allIn.preflight_reserved_instance_seconds
        === preflight.billing_reservation.reserved_instance_seconds
          + preflight2.billing_reservation.reserved_instance_seconds
      && allIn.preflight_reserved_compute_usd
        === preflight2.billing_reservation.cumulative_preflight_compute_usd
      && allIn.preflight_reserved_instance_seconds
        === preflight2.billing_reservation.cumulative_preflight_instance_seconds,
    "v2 preflight billing reservation drifted",
  );
  assert(
    allIn.bootstrap_failure_observed_instance_seconds
      === bootstrapFailure.billing.this_failure_instance_seconds
      && allIn.bootstrap_failure_observed_compute_usd
        === bootstrapFailure.billing.this_failure_compute_usd
      && allIn.cumulative_failed_instance_seconds
        === bootstrapFailure.billing.cumulative_failed_instance_seconds
      && allIn.cumulative_failed_compute_usd
        === bootstrapFailure.billing.cumulative_failed_compute_usd
      && allIn.cumulative_failed_instance_seconds
        === allIn.preflight_reserved_instance_seconds
          + allIn.bootstrap_failure_observed_instance_seconds
      && Math.abs(
        allIn.cumulative_failed_compute_usd
          - (
            allIn.preflight_reserved_compute_usd
              + allIn.bootstrap_failure_observed_compute_usd
          ),
      ) < 1e-12,
    "v2 cumulative failure billing drifted",
  );
  assert(
    allIn.recovery_max_instance_seconds_sum
      === combined.max_instance_seconds_sum
      && allIn.recovery_max_compute_usd === combined.max_compute_usd,
    "v2 recovery authorization cap drifted",
  );
  assert(
    allIn.all_in_max_instance_seconds_sum
      === allIn.cumulative_failed_instance_seconds
        + allIn.recovery_max_instance_seconds_sum
      && Math.abs(
        allIn.all_in_max_compute_usd
          - (
            allIn.cumulative_failed_compute_usd
              + allIn.recovery_max_compute_usd
          ),
      ) < 1e-12,
    "v2 all-in recovery cap does not reconcile",
  );
  assert(
    allIn.additional_instance_seconds_authorized
      === allIn.all_in_max_instance_seconds_sum
        - allIn.original_max_instance_seconds_sum
      && Math.abs(
        allIn.additional_compute_usd_authorized
          - (
            allIn.all_in_max_compute_usd
              - allIn.original_max_compute_usd
          ),
      ) < 1e-12
      && allIn.all_in_max_instance_seconds_sum
        > allIn.original_max_instance_seconds_sum
      && allIn.all_in_max_compute_usd > allIn.original_max_compute_usd
      && allIn.additional_instance_seconds_authorized === 67
      && allIn.additional_compute_usd_authorized > 0
      && allIn.within_original_authorization === false
      && allIn.expanded_authorization_observed
        === recovery3Authorization.expanded_all_in_budget_approved,
    "v2 expanded recovery authorization drifted",
  );

  const projection = budget.budget_projection;
  assert(
    projection?.basis_seconds_per_seed === evidence.maximum_observed_instance_seconds,
    "v2 projection basis drifted",
  );
  assert(projection.minimum_contingency_fraction === 0.2, "v2 contingency minimum drifted");
  assert(
    Math.abs(
      projection.minimum_seconds_per_seed
        - projection.basis_seconds_per_seed * 1.2,
    ) < 1e-9,
    "v2 minimum contingency does not reconcile",
  );
  assert(
    projection.capped_seconds_per_seed === perSeed.max_instance_seconds
      && projection.capped_seconds_two_seeds === combined.max_instance_seconds_sum,
    "v2 projection caps drifted",
  );
  assert(
    Math.abs(
      projection.actual_contingency_fraction
        - (
          perSeed.max_instance_seconds - projection.basis_seconds_per_seed
        ) / projection.basis_seconds_per_seed,
    ) < 1e-12,
    "v2 actual contingency does not reconcile",
  );
  assert(
    perSeed.max_instance_seconds >= projection.minimum_seconds_per_seed,
    "v2 cap is below its declared contingency",
  );

  const provenance = budget.provenance_gate;
  assert(
    provenance?.original_execution_lock_must_validate === true
      && provenance.failed_launch_receipts_must_be_absent === true
      && provenance.recovery_execution_lock_put_once === true
      && provenance.recovery_2_execution_lock_put_once === true
      && provenance.recovery_3_execution_lock_put_once === true
      && provenance.zero_compute_iam_permission_preflight_required === true
      && provenance.bootstrap_contract_regression_test_required === true
      && provenance.original_execution_lock_sha256_bound_into_launch_receipt
        === true
      && provenance.recovery_execution_lock_sha256_bound_into_launch_receipt
        === true
      && provenance.recovery_2_execution_lock_sha256_bound_into_launch_receipt
        === true
      && provenance.recovery_3_execution_lock_sha256_bound_into_launch_receipt
        === true
      && provenance.launch_receipt_put_once === true
      && provenance.canonical_aws_identity_receipt_required_for_each_seed === true
      && provenance.identity_receipt_put_once === true
      && provenance.identity_receipt_sha256_bound_into_launch_receipt === true
      && provenance.source_archive_sha256_bound_into_instance_identity === true
      && provenance.instance_id_bound_into_seed_status === true
      && provenance.shutdown_intent_required_for_each_seed === true,
    "v2 durable provenance gate drifted",
  );
  assert(
    provenance.collector_waits_for_compute === false
      && provenance.collector_starts_compute === false,
    "v2 collector may consume compute",
  );

  const completion = budget.completion_gate;
  assert(
    completion?.seed_1_result_required === true
      && completion.seed_3_result_required === true
      && completion.frozen_replication_checker_required_for_each_seed === true
      && completion.family_aggregation_only_after_both_valid_results === true
      && completion.structured_status_required_for_each_seed === true
      && completion.duplicate_accepted_result_forbidden === true
      && completion.execution_failure_is_not_scientific_no_go === true,
    "v2 completion gate drifted",
  );
  return true;
}

function selfTest() {
  const budgetPath = new URL(
    "../benchmarks/zero4-q26r-v1/aws-v2/budget.json",
    import.meta.url,
  );
  const budget = readJson(budgetPath);
  const originalCwd = process.cwd();
  process.chdir(new URL("..", import.meta.url).pathname);
  try {
    validateV2Budget(budget);

    const unapproved = structuredClone(budget);
    unapproved.authorization.manual_approval_observed = false;
    unapproved.authorization.authorized_for_execution = false;
    unapproved.authorization.authorized_at = null;
    unapproved.recovery_authorization.manual_approval_observed = false;
    unapproved.recovery_authorization.authorized_for_execution = false;
    unapproved.recovery_authorization.authorized_at = null;
    unapproved.recovery_2_authorization.manual_approval_observed = false;
    unapproved.recovery_2_authorization.authorized_for_execution = false;
    unapproved.recovery_2_authorization.authorized_at = null;
    unapproved.recovery_3_authorization.manual_approval_observed = false;
    unapproved.recovery_3_authorization.authorized_for_execution = false;
    unapproved.recovery_3_authorization.authorized_at = null;
    unapproved.recovery_3_authorization.expanded_all_in_budget_approved = false;
    unapproved.all_in_authorization.expanded_authorization_observed = false;
    validateV2Budget(unapproved);

    let authorizationRejected = false;
    try {
      validateV2Budget(unapproved, { requireAuthorized: true });
    } catch {
      authorizationRejected = true;
    }
    assert(authorizationRejected, "v2 launch accepted an unapproved budget");

    const approved = structuredClone(unapproved);
    approved.authorization.manual_approval_observed = true;
    approved.authorization.authorized_for_execution = true;
    approved.authorization.authorized_at = "2026-07-24";
    approved.recovery_authorization.manual_approval_observed = true;
    approved.recovery_authorization.authorized_for_execution = true;
    approved.recovery_authorization.authorized_at = "2026-07-24";
    approved.recovery_2_authorization.manual_approval_observed = true;
    approved.recovery_2_authorization.authorized_for_execution = true;
    approved.recovery_2_authorization.authorized_at = "2026-07-24";
    approved.recovery_3_authorization.manual_approval_observed = true;
    approved.recovery_3_authorization.authorized_for_execution = true;
    approved.recovery_3_authorization.authorized_at = "2026-07-24";
    approved.recovery_3_authorization.expanded_all_in_budget_approved = true;
    approved.all_in_authorization.expanded_authorization_observed = true;
    validateV2Budget(approved, { requireAuthorized: true });

    for (const [name, mutate] of [
      ["accepted prior evidence", (copy) => {
        copy.replacement_basis.prior_scientific_result_accepted = true;
      }],
      ["science change", (copy) => {
        copy.scientific_source_lock.scientific_design_unchanged = false;
      }],
      ["seed set", (copy) => {
        copy.workload.authorized_seeds = [1];
      }],
      ["wall cap", (copy) => {
        copy.per_seed_execution.max_instance_seconds = 6191;
      }],
      ["cost cap", (copy) => {
        copy.per_seed_execution.max_compute_usd = 1.18;
      }],
      ["recovery approval", (copy) => {
        copy.recovery_authorization.authorized_for_execution = false;
      }],
      ["recovery-2 approval", (copy) => {
        copy.recovery_2_authorization.authorized_for_execution = false;
      }],
      ["recovery-3 approval", (copy) => {
        copy.recovery_3_authorization.authorized_for_execution = false;
      }],
      ["all-in cost", (copy) => {
        copy.all_in_authorization.all_in_max_compute_usd = 2.39;
      }],
      ["identity receipt", (copy) => {
        copy.provenance_gate.identity_receipt_put_once = false;
      }],
    ]) {
      const invalid = structuredClone(budget);
      mutate(invalid);
      let rejected = false;
      try {
        validateV2Budget(invalid);
      } catch {
        rejected = true;
      }
      assert(rejected, `v2 self-test failed to reject ${name}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
  console.log("Q2.6-R AWS v2 budget self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const budgetPath = args.find((argument) => !argument.startsWith("--"))
    ?? "benchmarks/zero4-q26r-v1/aws-v2/budget.json";
  validateV2Budget(readJson(budgetPath), {
    requireAuthorized: args.includes("--require-authorized"),
  });
  console.log(
    `OK Q2.6-R AWS v2 budget: ${budgetPath}`
      + (args.includes("--require-authorized") ? " authorized" : ""),
  );
}

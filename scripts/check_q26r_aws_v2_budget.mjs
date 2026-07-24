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
  assert(perSeed?.max_instance_seconds === 6300, "v2 per-seed cap drifted");
  assert(perSeed.workload_timeout_seconds === 6180, "v2 workload timeout drifted");
  assert(perSeed.publication_reserve_seconds === 120, "v2 publication reserve drifted");
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
    provenance?.launch_receipt_put_once === true
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
        copy.per_seed_execution.max_instance_seconds = 6301;
      }],
      ["cost cap", (copy) => {
        copy.per_seed_execution.max_compute_usd = 1.2;
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

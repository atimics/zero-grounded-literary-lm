#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
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

function requireLock(name, file, expected) {
  assert(typeof file === "string" && fs.existsSync(file), `${name} lock is unavailable`);
  assert(sha256(file) === expected, `${name} lock hash mismatch`);
}

export function validateBudget(budget) {
  assert(
    budget?.schema === "zero.q26r_combined_execution_budget.v1",
    "unsupported Q2.6-R AWS budget schema",
  );
  assert(budget.id === "zero4-q26r-aws-v1", "unexpected Q2.6-R AWS budget id");
  assert(budget.status === "preregistered", "Q2.6-R AWS budget must be preregistered");
  assert(budget.scientific_inference_allowed === true, "scientific execution must permit inference");

  const authorization = budget.authorization;
  assert(
    authorization?.scope === "one combined AWS execution of Q2.6-R seeds 1 and 3",
    "authorization scope drifted",
  );
  assert(authorization.one_combined_execution_only === true, "authorization is not one-time");
  assert(authorization.requires_manual_approval === true, "manual approval gate is absent");
  assert(authorization.manual_approval_observed === true, "manual approval is missing");
  assert(authorization.authorized_for_execution === true, "execution is not authorized");

  const science = budget.scientific_source_lock;
  for (const [name, file, expected] of [
    ["replication contract", science?.replication_contract_path, science?.replication_contract_sha256],
    ["diagnostic contract", science?.diagnostic_contract_path, science?.diagnostic_contract_sha256],
    ["diagnostic result", science?.diagnostic_result_path, science?.diagnostic_result_sha256],
    ["diagnostic model", science?.diagnostic_model_path, science?.diagnostic_model_sha256],
    ["trainer", science?.trainer_path, science?.trainer_sha256],
    ["replication checker", science?.replication_checker_path, science?.replication_checker_sha256],
    ["diagnostic checker", science?.diagnostic_checker_path, science?.diagnostic_checker_sha256],
    ["family aggregator", science?.family_aggregator_path, science?.family_aggregator_sha256],
    ["quantity generator", science?.quantity_generator_path, science?.quantity_generator_sha256],
    ["teacher registry", science?.teacher_registry_path, science?.teacher_registry_sha256],
  ]) requireLock(name, file, expected);
  assert(
    science.frozen_science_commit === "3ee802c29ddf47982477a6b6dd635eaedede7bb7",
    "frozen science commit drifted",
  );
  assert(
    science.trainer_and_checkers_match_frozen_science_commit === true,
    "frozen science byte-identity is not asserted",
  );
  const frozenCommitAvailable = fs.existsSync(".git")
    && spawnSync(
      "git",
      ["cat-file", "-e", `${science.frozen_science_commit}^{commit}`],
      { stdio: "ignore" },
    ).status === 0;
  if (frozenCommitAvailable) {
    for (const path of [
      science.trainer_path,
      science.replication_checker_path,
      science.diagnostic_checker_path,
    ]) {
      const frozen = execFileSync("git", ["show", `${science.frozen_science_commit}:${path}`]);
      const current = fs.readFileSync(path);
      assert(frozen.equals(current), `${path} differs from frozen science commit`);
    }
  }

  const runtime = budget.execution_runtime_lock;
  for (const [name, file, expected] of [
    ["literary trainer runtime", runtime?.literary_lm_path, runtime?.literary_lm_sha256],
    ["literary inference runtime", runtime?.literary_infer_path, runtime?.literary_infer_sha256],
    ["quantity evaluator runtime", runtime?.quantity_evaluator_path, runtime?.quantity_evaluator_sha256],
  ]) requireLock(name, file, expected);
  assert(
    JSON.stringify(runtime.permitted_runtime_changes) === JSON.stringify([
      "OpenBLAS dispatch for the existing literary_lm matrix operations",
      "deterministic process-parallel quantity evaluation with byte-identical JSON output",
    ]),
    "runtime change envelope drifted",
  );
  assert(runtime.scientific_contract_change_allowed === false, "runtime envelope permits science drift");

  const evidence = budget.prior_evidence;
  requireLock(
    "parallel calibration result",
    evidence?.parallel_calibration_result_path,
    evidence?.parallel_calibration_result_sha256,
  );
  requireLock(
    "parallel calibration status",
    evidence?.parallel_calibration_status_path,
    evidence?.parallel_calibration_status_sha256,
  );
  const calibration = JSON.parse(fs.readFileSync(evidence.parallel_calibration_result_path, "utf8"));
  assert(calibration.status === "complete", "parallel calibration is incomplete");
  assert(calibration.scientific_inference_allowed === false, "calibration became scientific");
  assert(calibration.measurement?.parity?.sentinel === true, "sentinel parity evidence is absent");
  assert(calibration.measurement?.parity?.public === true, "public parity evidence is absent");
  assert(
    calibration.measurement.speedup.sentinel === evidence.measured_sentinel_speedup,
    "sentinel speedup drifted",
  );
  assert(
    calibration.measurement.speedup.public === evidence.measured_public_speedup,
    "public speedup drifted",
  );
  assert(
    calibration.projection.estimated_total_seconds_per_seed
      === evidence.projected_seconds_per_seed,
    "per-seed time projection drifted",
  );
  assert(
    calibration.projection.estimated_compute_usd_per_seed
      === evidence.projected_compute_usd_per_seed,
    "per-seed cost projection drifted",
  );
  assert(evidence.contingency_fraction === 0.2, "contingency drifted");

  const venue = budget.venue;
  assert(
    venue?.provider === "aws" && venue.region === "us-east-1",
    "AWS venue drifted",
  );
  assert(venue.instance_type === "c6i.4xlarge", "instance type drifted");
  assert(venue.cpu_architecture === "x86_64", "CPU architecture drifted");
  assert(venue.online_vcpus === 16, "vCPU count drifted");
  assert(venue.training_backend === "OpenBLAS", "training backend drifted");
  assert(venue.openblas_threads === 16 && venue.omp_threads === 16, "training threads drifted");
  assert(venue.quantity_evaluator_jobs === 16, "quantity evaluator jobs drifted");
  assert(venue.on_demand_usd_per_hour === 0.68, "hourly rate drifted");

  const workload = budget.workload;
  assert(JSON.stringify(workload?.authorized_seeds) === "[1,3]", "authorized seeds drifted");
  assert(workload.independent_instances === true, "seed instances are not independent");
  assert(workload.launch_both_seeds === true, "both-seed launch is not required");
  assert(workload.abort_after_first_no_go === false, "optional stopping is enabled");
  assert(workload.optimizer_attempts_per_seed === 1400, "attempt budget drifted");
  assert(
    workload.acquisition_attempts === 1000
      && workload.consolidation_attempts === 400
      && workload.batch === 2,
    "training workload drifted",
  );
  assert(
    workload.recovery_every_committed_updates === 25
      && workload.full_every_committed_updates === 100,
    "evaluation cadence drifted",
  );
  assert(
    workload.sentinel_replay_batches === 12
      && workload.full_replay_batches === 48,
    "replay workload drifted",
  );
  assert(
    workload.quantity_corpus_size === 10000
      && workload.quantity_corpus_seed === 5
      && workload.quantity_request_mode === "operation",
    "quantity corpus workload drifted",
  );

  const perSeed = budget.per_seed_execution;
  assert(perSeed?.max_instance_seconds === 13620, "per-seed instance cap drifted");
  assert(perSeed.workload_timeout_seconds === 13500, "per-seed workload cap drifted");
  assert(perSeed.publication_reserve_seconds === 120, "publication reserve drifted");
  assert(
    perSeed.workload_timeout_seconds + perSeed.publication_reserve_seconds
      === perSeed.max_instance_seconds,
    "per-seed workload and publication caps do not reconcile",
  );
  assert(
    perSeed.max_compute_usd
      === roundedCents(perSeed.max_instance_seconds * venue.on_demand_usd_per_hour / 3600),
    "per-seed compute cap is not the rounded instance upper bound",
  );
  assert(perSeed.budget_is_independent === true, "per-seed budget is not independent");
  assert(perSeed.unused_budget_transfer_forbidden === true, "budget transfer is permitted");

  const combined = budget.combined_execution;
  assert(combined?.max_concurrent_instances === 2, "concurrency cap drifted");
  assert(
    combined.max_instance_seconds_sum === 2 * perSeed.max_instance_seconds,
    "combined time cap does not equal two independent seed caps",
  );
  assert(
    combined.max_compute_usd === 2 * perSeed.max_compute_usd,
    "combined compute cap does not equal two independent seed caps",
  );
  assert(combined.both_seed_statuses_required === true, "both statuses are not required");
  assert(combined.one_seed_cannot_extend_the_other === true, "cross-seed budget transfer is enabled");

  const projection = budget.budget_projection;
  assert(
    projection?.estimated_seconds_per_seed === evidence.projected_seconds_per_seed,
    "budget projection per seed drifted",
  );
  assert(
    projection.estimated_seconds_two_seeds === 2 * projection.estimated_seconds_per_seed,
    "two-seed estimate does not reconcile",
  );
  assert(
    Math.abs(
      projection.estimated_seconds_per_seed
        + projection.contingency_seconds_per_seed
        - projection.capped_seconds_per_seed,
    ) < 1e-9,
    "per-seed contingency does not reconcile",
  );
  assert(
    projection.capped_seconds_per_seed === perSeed.max_instance_seconds,
    "projection and per-seed cap disagree",
  );
  assert(
    projection.capped_seconds_two_seeds === combined.max_instance_seconds_sum,
    "projection and combined cap disagree",
  );

  const gate = budget.completion_gate;
  assert(gate?.seed_1_result_required === true, "seed 1 result gate drifted");
  assert(gate.seed_3_result_required === true, "seed 3 result gate drifted");
  assert(gate.frozen_replication_checker_required_for_each_seed === true, "checker gate drifted");
  assert(gate.family_aggregation_only_after_both_valid_results === true, "aggregation gate drifted");
  assert(gate.structured_status_required_for_each_seed === true, "status gate drifted");
  assert(gate.duplicate_execution_forbidden === true, "duplicate execution gate drifted");
  assert(gate.execution_failure_is_not_scientific_no_go === true, "failure classification drifted");
  return true;
}

function selfTest() {
  const budgetPath = new URL(
    "../benchmarks/zero4-q26r-v1/aws-v1/budget.json",
    import.meta.url,
  );
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const originalCwd = process.cwd();
  process.chdir(new URL("..", import.meta.url).pathname);
  try {
    validateBudget(budget);
    for (const [name, mutate] of [
      ["science permission", (copy) => { copy.scientific_inference_allowed = false; }],
      ["trainer hash", (copy) => { copy.scientific_source_lock.trainer_sha256 = "0".repeat(64); }],
      ["runtime envelope", (copy) => { copy.execution_runtime_lock.scientific_contract_change_allowed = true; }],
      ["seed set", (copy) => { copy.workload.authorized_seeds = [1]; }],
      ["optional stopping", (copy) => { copy.workload.abort_after_first_no_go = true; }],
      ["quantity jobs", (copy) => { copy.venue.quantity_evaluator_jobs = 15; }],
      ["per-seed cap", (copy) => { copy.per_seed_execution.max_instance_seconds = 13621; }],
      ["budget transfer", (copy) => { copy.per_seed_execution.unused_budget_transfer_forbidden = false; }],
      ["combined cost", (copy) => { copy.combined_execution.max_compute_usd = 5.17; }],
      ["approval", (copy) => { copy.authorization.manual_approval_observed = false; }],
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
  console.log("Q2.6-R combined AWS budget self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const budgetPath = args.find((argument) => !argument.startsWith("--"))
    ?? "benchmarks/zero4-q26r-v1/aws-v1/budget.json";
  validateBudget(JSON.parse(fs.readFileSync(budgetPath, "utf8")));
  console.log(`OK Q2.6-R combined AWS budget: ${budgetPath}`);
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const budgetPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-budget.json";
const phaseProfilePath =
  "benchmarks/zero5-cpu-phase-profile-v1/result.json";
const recoveryContractPath =
  "benchmarks/zero5-c61-shared-state-v1/evaluation-recovery-contract-v2.json";

function sha256(file) {
  return crypto.createHash("sha256")
    .update(fs.readFileSync(file)).digest("hex");
}

function roundedCents(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

function close(left, right, tolerance = 1e-6) {
  return Math.abs(left - right) <= tolerance;
}

const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
const phaseProfile = JSON.parse(fs.readFileSync(phaseProfilePath, "utf8"));
const recoveryContract = JSON.parse(
  fs.readFileSync(recoveryContractPath, "utf8"),
);

assert.equal(budget.schema, "zero.c61_evaluation_experiment_budget.v1",
  "unsupported budget schema");
assert.equal(budget.experiment, "zero5-c61-shared-state-v1",
  "budget experiment drifted");
assert.equal(budget.status, "authorized",
  "budget must be authorized");
assert.equal(budget.scientific_inference_allowed, false,
  "budget must forbid scientific inference");

// ── Phase profile source ──
const source = budget.phase_profile_source;
assert.equal(source.experiment, "zero5-cpu-phase-profile-v1",
  "phase profile source experiment drifted");
assert.equal(source.result, phaseProfilePath,
  "phase profile result path drifted");
assert.equal(source.result_sha256, sha256(phaseProfilePath),
  "phase profile result hash drifted");
assert.match(source.platform, /c6i\.4xlarge/u,
  "phase profile platform must be c6i.4xlarge");

// ── Venue ──
const venue = budget.venue;
assert.equal(venue.provider, "aws", "venue provider drifted");
assert.equal(venue.region, "us-east-1", "venue region drifted");
assert.equal(venue.instance_type, "c6i.4xlarge", "venue instance type drifted");
assert.equal(venue.backend, "openblas", "venue backend drifted");
assert.equal(venue.on_demand_usd_per_hour, 0.68,
  "venue hourly price drifted");

// ── Measured phase costs ──
const costs = budget.measured_phase_costs;
const hourly = venue.on_demand_usd_per_hour;

assert(Number.isFinite(costs.training.wall_seconds),
  "training wall seconds must be finite");
assert(costs.training.wall_seconds > 9000,
  "training must exceed the per-instance ceiling");
assert(close(costs.training.compute_usd,
  costs.training.wall_seconds * hourly / 3600),
  "training compute_usd must equal wall_seconds * hourly_rate / 3600");

assert(Number.isFinite(costs.evaluation.wall_seconds),
  "evaluation wall seconds must be finite");
assert(costs.evaluation.wall_seconds > 0,
  "evaluation wall seconds must be positive");
assert(costs.evaluation.wall_seconds <= 9000,
  "evaluation must fit within a single per-instance ceiling");
assert(close(costs.evaluation.compute_usd,
  costs.evaluation.wall_seconds * hourly / 3600),
  "evaluation compute_usd must equal wall_seconds * hourly_rate / 3600");

assert.equal(costs.full_cycle.wall_seconds,
  costs.training.wall_seconds + costs.evaluation.wall_seconds,
  "full cycle must be the sum of training and evaluation");
assert(close(costs.full_cycle.compute_usd,
  costs.training.compute_usd + costs.evaluation.compute_usd),
  "full cycle cost must be the sum of training and evaluation");

// ── Per-instance ceiling ──
const ceiling = budget.per_instance_ceiling;
assert.equal(ceiling.max_instance_seconds, 9000,
  "per-instance ceiling seconds drifted");
assert.equal(ceiling.max_compute_usd, 1.7,
  "per-instance ceiling USD drifted");
assert.equal(roundedCents(
  ceiling.max_instance_seconds * hourly / 3600), ceiling.max_compute_usd,
  "per-instance ceiling USD must equal the hourly-rate upper bound");

// ── Cumulative budget ──
const cumulative = budget.cumulative_budget;
assert.ok(cumulative.max_instance_seconds >= costs.full_cycle.wall_seconds,
  "cumulative budget must cover the full cycle");
assert.ok(cumulative.max_compute_usd >= costs.full_cycle.compute_usd,
  "cumulative budget cost must cover the full cycle");
assert.equal(cumulative.max_instance_seconds, 18300,
  "cumulative budget seconds must be 18300");
assert.equal(cumulative.max_compute_usd, 3.46,
  "cumulative budget USD must be 3.46");
assert.equal(roundedCents(
  cumulative.max_instance_seconds * hourly / 3600), cumulative.max_compute_usd,
  "cumulative budget USD must equal the hourly-rate upper bound");

// ── Cumulative > per-instance (the whole point) ──
assert.ok(cumulative.max_instance_seconds > ceiling.max_instance_seconds,
  "cumulative budget must exceed the per-instance ceiling");
assert.ok(cumulative.max_compute_usd > ceiling.max_compute_usd,
  "cumulative budget cost must exceed the per-instance ceiling cost");

// ── Phase breakdown ──
const phases = cumulative.phases;
assert(Array.isArray(phases), "phases must be an array");
assert.equal(phases.length, 2, "must have exactly two phases");
assert.equal(phases[0].id, "training", "first phase must be training");
assert.equal(phases[1].id, "evaluation", "second phase must be evaluation");

for (const phase of phases) {
  assert(Number.isInteger(phase.max_instance_seconds),
    `${phase.id} max_instance_seconds must be an integer`);
  assert(Number.isFinite(phase.max_compute_usd),
    `${phase.id} max_compute_usd must be finite`);
  assert.equal(roundedCents(
    phase.max_instance_seconds * hourly / 3600), phase.max_compute_usd,
    `${phase.id} compute cap must equal the hourly-rate upper bound`);
  assert(Number.isInteger(phase.instances) && phase.instances > 0,
    `${phase.id} instances must be a positive integer`);
}

assert.ok(phases[0].max_instance_seconds >= costs.training.wall_seconds,
  "training phase budget must cover measured training cost");
assert.ok(phases[1].max_instance_seconds >= costs.evaluation.wall_seconds,
  "evaluation phase budget must cover measured evaluation cost");

// ── Authorized continuation cap ──
const continuation = budget.authorized_continuation_budget;
const authorization = budget.authorization;
assert.equal(continuation.maximum_attempts, 5,
  "continuation attempts drifted");
assert.equal(continuation.max_instance_seconds_each,
  ceiling.max_instance_seconds,
  "continuation instance cap must match the per-instance ceiling");
assert.equal(continuation.max_cumulative_instance_seconds,
  continuation.maximum_attempts * continuation.max_instance_seconds_each,
  "continuation time cap must cover exactly the authorized attempts");
assert.equal(continuation.max_cumulative_compute_usd,
  continuation.maximum_attempts * ceiling.max_compute_usd,
  "continuation cost cap must cover exactly the authorized attempts");
assert.equal(continuation.attempts_after_first_require_prior_recoverable_status,
  true, "continuations must require a recoverable prior status");
assert.equal(continuation.shared_state_across_attempts, true,
  "continuations must share checkpoint state");
assert.equal(authorization.authorized, true,
  "continuation budget needs authorization");
assert.equal(authorization.approved_by, "ratimics",
  "continuation approver drifted");
assert.equal(authorization.maximum_compute_usd, 10,
  "approved outer cost cap drifted");
assert.equal(continuation.max_cumulative_compute_usd <=
  authorization.maximum_compute_usd, true,
"operating cost cap exceeds the approval");
assert.equal(continuation.unused_approval_reserve_usd,
  authorization.maximum_compute_usd -
    continuation.max_cumulative_compute_usd,
"approval reserve does not reconcile");
assert.equal(authorization.one_recovery_series_only, true,
  "authorization must cover one recovery series");
assert.equal(authorization.training_updates_authorized, 0,
  "recovery authorization must keep training closed");
assert.equal(authorization.independent_scientific_retries_authorized, 0,
  "recovery authorization must keep independent retries closed");

// ── Evaluation resume ──
const resume = budget.evaluation_resume;
assert.equal(resume.checkpoint_strategy,
  "hash-bound atomic task cache synced to S3 every 30 seconds",
  "resume checkpoint strategy drifted");
assert.equal(resume.progress_schema, "zero.c61_evaluation_progress.v1",
  "resume progress schema drifted");
assert.equal(resume.cache_schema, "zero.c61_evaluation_cache.v1",
  "resume cache schema drifted");
assert.equal(resume.atomic_tasks,
  recoveryContract.evaluation.atomic_tasks,
  "resume atomic tasks must match the recovery contract");
assert.equal(resume.resume_on_recoverable, true,
  "resume must be enabled on recoverable");
assert.equal(resume.restart_on_recoverable, false,
  "restart must be disabled on recoverable");

// ── Workload ──
const workload = budget.workload;
assert.equal(workload.seed, 0, "workload seed drifted");
assert.equal(workload.update_groups,
  recoveryContract.source_training.completed_accounting.update_groups,
  "workload update_groups must match the recovery contract");
assert.equal(workload.pack_sequences,
  recoveryContract.source_training.completed_accounting.pack_sequences,
  "workload pack_sequences must match the recovery contract");
assert.equal(workload.combined_validation_packs, 128,
  "workload combined_validation_packs drifted");
assert.equal(workload.evidence_validation_packs, 128,
  "workload evidence_validation_packs drifted");
assert.equal(workload.evaluation_jobs,
  recoveryContract.execution.evaluation_jobs,
  "workload evaluation_jobs must match the recovery contract");
assert.equal(workload.openblas_threads,
  recoveryContract.execution.openblas_threads,
  "workload openblas_threads must match the recovery contract");
assert.equal(workload.outputs_are_diagnostic_only, true,
  "workload outputs must be diagnostic only");

// ── Self-test: mutations must be rejected ──
const mutations = [
  ["cumulative below full cycle", copy => {
    copy.cumulative_budget.max_instance_seconds = 18000;
  }],
  ["per-instance exceeds cumulative", copy => {
    copy.per_instance_ceiling.max_instance_seconds = 20000;
  }],
  ["training phase below measured", copy => {
    copy.cumulative_budget.phases[0].max_instance_seconds = 9000;
  }],
  ["evaluation restart on recoverable", copy => {
    copy.evaluation_resume.restart_on_recoverable = true;
  }],
  ["scientific inference allowed", copy => {
    copy.scientific_inference_allowed = true;
  }],
  ["continuation cap above approval", copy => {
    copy.authorized_continuation_budget.max_cumulative_compute_usd = 10.01;
  }],
];

for (const [name, mutate] of mutations) {
  const copy = structuredClone(budget);
  mutate(copy);
  let rejected = false;
  try {
    if (copy.cumulative_budget.max_instance_seconds <
        copy.measured_phase_costs.full_cycle.wall_seconds)
      throw new Error("cumulative below full cycle");
    if (copy.per_instance_ceiling.max_instance_seconds >
        copy.cumulative_budget.max_instance_seconds)
      throw new Error("per-instance exceeds cumulative");
    if (copy.cumulative_budget.phases[0].max_instance_seconds <
        copy.measured_phase_costs.training.wall_seconds)
      throw new Error("training phase below measured");
    if (copy.evaluation_resume.restart_on_recoverable === true)
      throw new Error("restart on recoverable");
    if (copy.scientific_inference_allowed === true)
      throw new Error("scientific inference allowed");
    if (copy.authorized_continuation_budget.max_cumulative_compute_usd >
        copy.authorization.maximum_compute_usd)
      throw new Error("continuation cap above approval");
  } catch {
    rejected = true;
  }
  assert(rejected, `self-test failed to reject ${name} mutation`);
}

process.stdout.write(
  "ZERO.5 C6.1 evaluation experiment budget checks passed\n");

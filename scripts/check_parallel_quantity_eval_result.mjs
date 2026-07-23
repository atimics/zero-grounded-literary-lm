#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateBudget } from "./check_parallel_quantity_eval_budget.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function close(left, right, tolerance = 1e-9) {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

export function validateResult(budget, result, status, expected = {}) {
  validateBudget(budget);
  assert(
    result?.schema === "zero.quantity_eval_calibration_result.v1",
    "invalid calibration result schema",
  );
  assert(result.id === budget.id, "calibration result id drifted");
  assert(
    ["complete", "budget-exhausted"].includes(result.status),
    "calibration did not finish with a valid bounded outcome",
  );
  assert(
    result.scientific_inference_allowed === false,
    "result cannot support scientific inference",
  );
  assert(
    status?.schema === "zero.aws_quantity_eval_calibration_status.v1",
    "invalid remote status schema",
  );
  assert(status.status === result.status, "remote status/result mismatch");
  assert(
    status.scientific_inference_allowed === false,
    "remote status cannot support scientific inference",
  );
  assert(status.git_commit === result.git_commit, "remote status commit mismatch");
  assert(status.budget_sha256 === result.budget_sha256, "remote status budget mismatch");
  if (expected.commit) {
    assert(result.git_commit === expected.commit, "result commit mismatch");
  }
  if (expected.budgetSha256) {
    assert(result.budget_sha256 === expected.budgetSha256, "result budget mismatch");
  }

  assert(result.venue?.provider === "aws", "calibration venue must be AWS");
  assert(result.venue.region === budget.venue.region, "AWS region drifted");
  assert(result.venue.instance_type === budget.venue.instance_type, "instance type drifted");
  assert(result.venue.cpu_architecture === budget.venue.cpu_architecture, "CPU architecture drifted");
  assert(result.venue.online_vcpus === budget.venue.online_vcpus, "online vCPU count drifted");
  assert(
    result.venue.quantity_backend === budget.venue.quantity_backend,
    "quantity backend drifted",
  );
  assert(
    result.venue.on_demand_usd_per_hour === budget.venue.on_demand_usd_per_hour,
    "hourly rate drifted",
  );

  assert(
    result.budget?.max_instance_seconds === budget.execution.max_instance_seconds,
    "instance cap drifted",
  );
  assert(
    result.budget.workload_timeout_seconds === budget.execution.workload_timeout_seconds,
    "workload cap drifted",
  );
  assert(
    result.budget.max_compute_usd === budget.execution.max_compute_usd,
    "compute cap drifted",
  );

  const measurement = result.measurement;
  assert(measurement && typeof measurement === "object", "measurement is missing");
  for (const field of [
    "warmup_cases",
    "promotion_evaluations",
    "optimizer_attempts",
    "cold_start_build_and_generation_seconds",
    "total_observed_instance_seconds",
    "driver_exit_code",
  ]) {
    assert(Number.isInteger(measurement[field]), `invalid measurement field: ${field}`);
  }
  assert(measurement.warmup_cases === budget.workload.warmup_cases, "warmup count drifted");
  assert(measurement.promotion_evaluations === 0, "promotion split was unsealed");
  assert(measurement.optimizer_attempts === 0, "optimizer was unexpectedly invoked");
  assert(
    measurement.total_observed_instance_seconds >= 0
      && measurement.total_observed_instance_seconds <= budget.execution.max_instance_seconds,
    "result was published outside the instance budget",
  );

  if (result.status === "budget-exhausted") {
    assert(
      [124, 137, 143].includes(status.exit_code)
        && [124, 137, 143].includes(measurement.driver_exit_code),
      "budget exhaustion has an unexpected exit status",
    );
    return true;
  }

  assert(status.exit_code === 0, "complete status has nonzero remote exit");
  assert(measurement.driver_exit_code === 0, "complete status has nonzero driver exit");
  const records = measurement.evaluations;
  assert(records && typeof records === "object", "evaluation records are missing");
  const expectedRecords = {
    sentinel_serial: [budget.workload.sentinel_cases, budget.workload.serial_jobs],
    sentinel_parallel: [budget.workload.sentinel_cases, budget.workload.parallel_jobs],
    public_serial: [budget.workload.public_cases, budget.workload.serial_jobs],
    public_parallel: [budget.workload.public_cases, budget.workload.parallel_jobs],
  };
  for (const [name, [cases, jobs]] of Object.entries(expectedRecords)) {
    const record = records[name];
    assert(record && typeof record === "object", `missing evaluation: ${name}`);
    assert(record.cases === cases, `${name} case count drifted`);
    assert(record.jobs === jobs, `${name} job count drifted`);
    assert(Number.isFinite(record.wall_seconds) && record.wall_seconds > 0, `${name} timing is invalid`);
    assert(
      Number.isFinite(record.cases_per_second) && record.cases_per_second > 0,
      `${name} throughput is invalid`,
    );
    assert(
      close(record.cases_per_second, cases / record.wall_seconds),
      `${name} throughput is inconsistent`,
    );
    assert(/^[0-9a-f]{64}$/.test(record.json_sha256), `${name} output hash is invalid`);
  }
  assert(measurement.parity?.sentinel === true, "sentinel output parity failed");
  assert(measurement.parity?.public === true, "public output parity failed");
  assert(
    records.sentinel_serial.json_sha256 === records.sentinel_parallel.json_sha256,
    "sentinel hashes differ",
  );
  assert(
    records.public_serial.json_sha256 === records.public_parallel.json_sha256,
    "public hashes differ",
  );
  assert(
    close(
      measurement.speedup?.sentinel,
      records.sentinel_serial.wall_seconds / records.sentinel_parallel.wall_seconds,
    ),
    "sentinel speedup is inconsistent",
  );
  assert(
    close(
      measurement.speedup?.public,
      records.public_serial.wall_seconds / records.public_parallel.wall_seconds,
    ),
    "public speedup is inconsistent",
  );

  const projection = result.projection;
  assert(projection?.available === true, "complete result must publish a projection");
  assert(projection.target_optimizer_attempts_per_seed === 1400, "optimizer target drifted");
  assert(projection.target_seed_count === 2, "projection must cover both seeds");
  assert(projection.projected_sentinel_evaluations_per_seed === 56, "sentinel projection drifted");
  assert(projection.projected_full_evaluations_per_seed === 14, "full projection drifted");
  for (const field of [
    "estimated_total_seconds_per_seed",
    "estimated_compute_usd_per_seed",
    "estimated_total_seconds_two_seeds",
    "estimated_compute_usd_two_seeds",
    "suggested_budget_seconds_per_seed_with_20_percent_contingency",
    "suggested_budget_usd_per_seed_with_20_percent_contingency",
    "suggested_budget_seconds_two_seeds_with_20_percent_contingency",
    "suggested_budget_usd_two_seeds_with_20_percent_contingency",
  ]) {
    assert(Number.isFinite(projection[field]) && projection[field] > 0, `invalid projection: ${field}`);
  }
  assert(
    close(
      projection.estimated_total_seconds_two_seeds,
      2 * projection.estimated_total_seconds_per_seed,
    ),
    "two-seed time estimate is inconsistent",
  );
  assert(
    close(
      projection.estimated_compute_usd_two_seeds,
      2 * projection.estimated_compute_usd_per_seed,
    ),
    "two-seed cost estimate is inconsistent",
  );
  assert(
    projection.suggested_budget_seconds_per_seed_with_20_percent_contingency
      >= 1.2 * projection.estimated_total_seconds_per_seed,
    "suggested time budget lacks 20 percent contingency",
  );
  assert(
    projection.suggested_budget_usd_per_seed_with_20_percent_contingency
      >= 1.2 * projection.estimated_compute_usd_per_seed,
    "suggested cost budget lacks 20 percent contingency",
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
    const budgetSha256 = sha256(
      "benchmarks/parallel-quantity-eval-calibration-v1/budget.json",
    );
    const record = (cases, jobs, seconds, hash) => ({
      cases,
      jobs,
      wall_seconds: seconds,
      cases_per_second: cases / seconds,
      json_sha256: hash,
    });
    const result = {
      schema: "zero.quantity_eval_calibration_result.v1",
      id: budget.id,
      status: "complete",
      git_commit: "a".repeat(40),
      budget_sha256: budgetSha256,
      scientific_inference_allowed: false,
      venue: {
        provider: "aws",
        region: "us-east-1",
        instance_type: "c6i.4xlarge",
        cpu_architecture: "x86_64",
        online_vcpus: 16,
        quantity_backend: "portable-quantized-inference",
        on_demand_usd_per_hour: 0.68,
      },
      budget: {
        max_instance_seconds: 1500,
        workload_timeout_seconds: 1440,
        max_compute_usd: 0.29,
      },
      measurement: {
        warmup_cases: 1,
        promotion_evaluations: 0,
        optimizer_attempts: 0,
        cold_start_build_and_generation_seconds: 90,
        total_observed_instance_seconds: 1000,
        driver_exit_code: 0,
        evaluations: {
          sentinel_serial: record(64, 1, 100, "1".repeat(64)),
          sentinel_parallel: record(64, 16, 10, "1".repeat(64)),
          public_serial: record(500, 1, 800, "2".repeat(64)),
          public_parallel: record(500, 16, 70, "2".repeat(64)),
        },
        parity: { sentinel: true, public: true },
        speedup: { sentinel: 10, public: 800 / 70 },
      },
      projection: {
        available: true,
        target_optimizer_attempts_per_seed: 1400,
        target_seed_count: 2,
        projected_sentinel_evaluations_per_seed: 56,
        projected_full_evaluations_per_seed: 14,
        estimated_total_seconds_per_seed: 12000,
        estimated_compute_usd_per_seed: 2.2666666666666666,
        estimated_total_seconds_two_seeds: 24000,
        estimated_compute_usd_two_seeds: 4.533333333333333,
        suggested_budget_seconds_per_seed_with_20_percent_contingency: 14400,
        suggested_budget_usd_per_seed_with_20_percent_contingency: 2.72,
        suggested_budget_seconds_two_seeds_with_20_percent_contingency: 28800,
        suggested_budget_usd_two_seeds_with_20_percent_contingency: 5.44,
      },
    };
    const status = {
      schema: "zero.aws_quantity_eval_calibration_status.v1",
      status: "complete",
      exit_code: 0,
      git_commit: result.git_commit,
      budget_sha256: budgetSha256,
      scientific_inference_allowed: false,
    };
    validateResult(budget, result, status, {
      commit: result.git_commit,
      budgetSha256,
    });
    for (const [name, mutate] of [
      ["scientific inference", (copy) => { copy.scientific_inference_allowed = true; }],
      ["promotion access", (copy) => { copy.measurement.promotion_evaluations = 1; }],
      ["missing public", (copy) => { delete copy.measurement.evaluations.public_parallel; }],
      ["sentinel mismatch", (copy) => { copy.measurement.evaluations.sentinel_parallel.json_sha256 = "3".repeat(64); }],
      ["one-seed projection", (copy) => { copy.projection.target_seed_count = 1; }],
    ]) {
      const invalid = structuredClone(result);
      mutate(invalid);
      let rejected = false;
      try {
        validateResult(budget, invalid, status);
      } catch {
        rejected = true;
      }
      assert(rejected, `self-test failed to reject ${name}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
  console.log("Parallel quantity-evaluator calibration result self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  if (args.length < 3) {
    fail(
      "usage: check_parallel_quantity_eval_result.mjs BUDGET RESULT STATUS "
        + "[--commit SHA] [--budget-sha256 SHA]",
    );
  }
  const [budgetPath, resultPath, statusPath] = args;
  const commitIndex = args.indexOf("--commit");
  const budgetHashIndex = args.indexOf("--budget-sha256");
  validateResult(
    JSON.parse(fs.readFileSync(budgetPath, "utf8")),
    JSON.parse(fs.readFileSync(resultPath, "utf8")),
    JSON.parse(fs.readFileSync(statusPath, "utf8")),
    {
      commit: commitIndex >= 0 ? args[commitIndex + 1] : null,
      budgetSha256: budgetHashIndex >= 0
        ? args[budgetHashIndex + 1]
        : sha256(budgetPath),
    },
  );
  console.log(`OK parallel quantity-evaluator calibration result: ${resultPath}`);
}

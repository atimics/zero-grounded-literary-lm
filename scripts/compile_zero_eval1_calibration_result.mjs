#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

export function compile(options) {
  const budget = JSON.parse(fs.readFileSync(options.budget, "utf8"));
  const measurements = {};
  for (const id of budget.workload.task_order) {
    const timing = JSON.parse(
      fs.readFileSync(path.join(options.resultsDirectory, `${id}.json`), "utf8"),
    );
    const expected = budget.calibration_datasets[id];
    assert(timing.schema === "zero.external_eval_timing.v1", `${id} timing schema drifted`);
    assert(timing.timing_only === true, `${id} timing exposed metrics`);
    assert(timing.metrics === undefined && timing.groups === undefined, `${id} score fields leaked`);
    assert(timing.model?.id === budget.workload.model, `${id} model id drifted`);
    assert(timing.model?.sha256 === budget.source_lock.model_sha256, `${id} model hash drifted`);
    assert(timing.evaluator?.jobs === budget.workload.jobs, `${id} jobs drifted`);
    assert(timing.cases === expected.cases, `${id} case count drifted`);
    assert(timing.cases_sha256 === expected.sample_sha256, `${id} cases hash drifted`);
    assert(timing.elapsed_seconds > 0, `${id} timing missing`);
    measurements[id] = {
      cases: timing.cases,
      input_bytes: expected.sample_bytes,
      cases_sha256: timing.cases_sha256,
      case_results_sha256: timing.case_results_sha256,
      elapsed_seconds: timing.elapsed_seconds,
      cases_per_second: timing.cases / timing.elapsed_seconds,
    };
  }
  const elapsed = Math.max(0, options.finishedEpoch - options.launchEpoch);
  const result = {
    schema: "zero.external_eval_calibration_result.v1",
    id: budget.id,
    status: "complete",
    scientific_inference_allowed: false,
    training_updates: 0,
    optimizer_attempts: 0,
    controller_or_kernel_calls: 0,
    git_commit: options.commit,
    budget_sha256: options.budgetSha256,
    model_sha256: budget.source_lock.model_sha256,
    jobs: budget.workload.jobs,
    started_at: options.startedAt,
    finished_at: options.finishedAt,
    elapsed_instance_seconds: elapsed,
    estimated_compute_usd: Number(
      (elapsed * budget.venue.on_demand_usd_per_hour / 3600).toFixed(6),
    ),
    measurements,
  };
  fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function selfTest() {
  const budgetPath = "benchmarks/zero-eval-1/aws-calibration/budget.json";
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-eval1-compile-"));
  try {
    for (const id of budget.workload.task_order) {
      const dataset = budget.calibration_datasets[id];
      fs.writeFileSync(path.join(temporary, `${id}.json`), `${JSON.stringify({
        schema: "zero.external_eval_timing.v1",
        model: {
          id: budget.workload.model,
          sha256: budget.source_lock.model_sha256,
        },
        evaluator: { jobs: budget.workload.jobs },
        timing_only: true,
        cases_sha256: dataset.sample_sha256,
        cases: dataset.cases,
        case_results_sha256: "a".repeat(64),
        elapsed_seconds: 2,
      })}\n`);
    }
    const result = compile({
      budget: budgetPath,
      resultsDirectory: temporary,
      output: path.join(temporary, "result.json"),
      commit: "c".repeat(40),
      budgetSha256: "b".repeat(64),
      launchEpoch: 100,
      finishedEpoch: 160,
      startedAt: "2026-07-24T00:00:00Z",
      finishedAt: "2026-07-24T00:01:00Z",
    });
    assert(result.status === "complete", "compiled result status drifted");
    assert(result.elapsed_instance_seconds === 60, "compiled elapsed time drifted");
    assert(
      Object.keys(result.measurements).length === budget.workload.task_order.length,
      "compiled measurement grid drifted",
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log("ZERO-EVAL-1 calibration compiler self-test passed");
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (value === undefined) fail(`missing value for ${key}`);
    if (key === "--budget") options.budget = value;
    else if (key === "--results") options.resultsDirectory = value;
    else if (key === "--output") options.output = value;
    else if (key === "--commit") options.commit = value;
    else if (key === "--budget-sha256") options.budgetSha256 = value;
    else if (key === "--launch-epoch") options.launchEpoch = Number(value);
    else if (key === "--finished-epoch") options.finishedEpoch = Number(value);
    else if (key === "--started-at") options.startedAt = value;
    else if (key === "--finished-at") options.finishedAt = value;
    else fail(`unknown argument ${key}`);
  }
  for (const key of [
    "budget", "resultsDirectory", "output", "commit", "budgetSha256",
    "launchEpoch", "finishedEpoch", "startedAt", "finishedAt",
  ]) {
    if (options[key] === undefined) fail(`missing ${key}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const result = compile(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  }
}

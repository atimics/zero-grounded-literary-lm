#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateResult } from "./check_zero_eval1_screen.mjs";

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function wilson(successes, total) {
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) /
    denominator;
  return { lower: center - half, upper: center + half };
}

function metric(result, name) {
  const value = result.metrics?.[name];
  if (!Number.isFinite(value)) fail(`${result.model?.id}:${result.benchmark} lacks ${name}`);
  return value;
}

export function compile(options) {
  const contract = JSON.parse(fs.readFileSync(options.contract, "utf8"));
  const models = {};
  let measuredSeconds = 0;
  for (const model of contract.models) {
    const tasks = {};
    for (const [task, dataset] of Object.entries(contract.datasets)) {
      const file = path.join(options.results, `${model.id}-${task}.json`);
      if (!fs.existsSync(file)) fail(`missing ${model.id}:${task}`);
      const result = JSON.parse(fs.readFileSync(file, "utf8"));
      measuredSeconds += result.elapsed_seconds;
      tasks[task] = {
        source_path: path.basename(file),
        source_sha256: sha256(file),
        ...result,
      };
    }
    models[model.id] = {
      model_sha256: model.sha256,
      model_bytes: model.bytes,
      tasks,
    };
  }

  const comparisons = {};
  for (const [task, dataset] of Object.entries(contract.datasets)) {
    const name = dataset.primary_metric;
    const left = models.zero3.tasks[task];
    const right = models.zero4.tasks[task];
    const zero3 = metric(left, name);
    const zero4 = metric(right, name);
    const item = { primary_metric: name, zero3, zero4, zero4_minus_zero3: zero4 - zero3 };
    if (name.endsWith("accuracy")) {
      item.zero3_wilson_95 = wilson(Math.round(zero3 * dataset.cases), dataset.cases);
      item.zero4_wilson_95 = wilson(Math.round(zero4 * dataset.cases), dataset.cases);
    }
    comparisons[task] = item;
  }

  const elapsedInstanceSeconds = options.finishedEpoch - options.launchEpoch;
  if (!Number.isInteger(elapsedInstanceSeconds) || elapsedInstanceSeconds < 0) {
    fail("invalid launch-relative elapsed time");
  }
  const result = {
    schema: "zero.external_eval_screen_result.v1",
    id: contract.id,
    status: "complete",
    git_commit: options.commit,
    contract_sha256: sha256(options.contract),
    budget_sha256: options.budgetSha256,
    started_at: options.startedAt,
    finished_at: options.finishedAt,
    launch_epoch: options.launchEpoch,
    finished_epoch: options.finishedEpoch,
    elapsed_instance_seconds: elapsedInstanceSeconds,
    measured_seconds: measuredSeconds,
    estimated_compute_usd: elapsedInstanceSeconds * options.hourlyRate / 3600,
    training_updates: 0,
    optimizer_attempts: 0,
    controller_or_kernel_calls: 0,
    models,
    comparisons,
  };
  fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function parse(args) {
  const options = {};
  for (let index = 0; index < args.length; ++index) {
    const key = args[index];
    const value = args[++index];
    if (value === undefined) fail(`missing value for ${key}`);
    if (key === "--contract") options.contract = value;
    else if (key === "--results") options.results = value;
    else if (key === "--output") options.output = value;
    else if (key === "--commit") options.commit = value;
    else if (key === "--budget-sha256") options.budgetSha256 = value;
    else if (key === "--launch-epoch") options.launchEpoch = Number(value);
    else if (key === "--finished-epoch") options.finishedEpoch = Number(value);
    else if (key === "--started-at") options.startedAt = value;
    else if (key === "--finished-at") options.finishedAt = value;
    else if (key === "--hourly-rate") options.hourlyRate = Number(value);
    else fail(`unknown argument ${key}`);
  }
  for (const key of [
    "contract", "results", "output", "commit", "budgetSha256", "launchEpoch",
    "finishedEpoch", "startedAt", "finishedAt", "hourlyRate",
  ]) {
    if (options[key] === undefined) fail(`missing ${key}`);
  }
  return options;
}

function selfTest() {
  const contractPath = "benchmarks/zero-eval-1/screen/contract.json";
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-eval1-screen-compile-"));
  try {
    const kinds = {
      blimp: "pair",
      tinystories: "rolling",
      hellaswag: "multiple_choice",
      lambada: "cloze",
    };
    for (const model of contract.models) {
      for (const [task, dataset] of Object.entries(contract.datasets)) {
        let groupCounts;
        if (task === "blimp") {
          groupCounts = Object.fromEntries(Array.from(
            { length: 67 },
            (_, index) => [`g${index}`, index < 62 ? 15 : 14],
          ));
        } else if (task === "hellaswag") {
          groupCounts = { indomain: 498, zeroshot: 502 };
        } else {
          groupCounts = { test: 1000 };
        }
        const metrics = { bits_per_byte: model.id === "zero3" ? 4 : 3.9 };
        if (dataset.primary_metric.endsWith("accuracy")) {
          metrics[dataset.primary_metric] = model.id === "zero3" ? 0.51 : 0.52;
        }
        const result = {
          schema: "zero.external_eval_result.v1",
          model: {
            id: model.id,
            path: model.path,
            sha256: model.sha256,
            bytes: model.bytes,
          },
          evaluator: { path: "./external_eval", sha256: "c".repeat(64), jobs: 16 },
          timing_only: false,
          elapsed_seconds: 1,
          cases_path: `${task}.tsv`,
          cases_sha256: dataset.sha256,
          cases: 1000,
          benchmark: task,
          kind: kinds[task],
          case_results_sha256: "d".repeat(64),
          metrics,
          groups: Object.fromEntries(Object.entries(groupCounts).map(([name, cases]) => [
            name, { cases, bits_per_byte: 4 },
          ])),
        };
        fs.writeFileSync(
          path.join(directory, `${model.id}-${task}.json`),
          `${JSON.stringify(result, null, 2)}\n`,
        );
      }
    }
    const output = path.join(directory, "result.json");
    const result = compile({
      contract: contractPath,
      results: directory,
      output,
      commit: "a".repeat(40),
      budgetSha256: "b".repeat(64),
      launchEpoch: 100,
      finishedEpoch: 200,
      startedAt: "2026-07-24T00:00:00Z",
      finishedAt: "2026-07-24T00:01:40Z",
      hourlyRate: 0.68,
    });
    validateResult(contract, result, {
      commit: "a".repeat(40),
      budgetSha256: "b".repeat(64),
      maxInstanceSeconds: 3600,
      maxComputeUsd: 0.68,
      resultPath: output,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log("ZERO-EVAL-1 screen result compiler self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--self-test")) selfTest();
    else console.log(JSON.stringify(compile(parse(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}

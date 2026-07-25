#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONTRACT = "benchmarks/zero-eval-1/screen/contract.json";

function fail(message) {
  throw new Error(message);
}
function assert(value, message) {
  if (!value) fail(message);
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function hash(value) {
  return /^[0-9a-f]{64}$/u.test(value ?? "");
}

export function validateContract(contract) {
  assert(contract?.schema === "zero.external_eval_screen_contract.v1", "screen schema drifted");
  assert(contract.id === "zero-eval-1-screen-v1", "screen id drifted");
  assert(contract.status === "preregistered_authorized", "screen is not authorized");
  assert(contract.training_allowed === false, "training became allowed");
  assert(contract.controller_or_kernel_allowed === false, "controller/kernel became allowed");
  assert(fs.existsSync(contract.base_contract_path), "base contract unavailable");
  assert(sha256(contract.base_contract_path) === contract.base_contract_sha256, "base contract drifted");
  const base = JSON.parse(fs.readFileSync(contract.base_contract_path, "utf8"));
  assert(same(contract.models.map(({ id, path: modelPath, sha256: digest, bytes }) =>
    ({ id, path: modelPath, sha256: digest, bytes })),
  base.models.map(({ id, path: modelPath, sha256: digest, bytes }) =>
    ({ id, path: modelPath, sha256: digest, bytes }))), "model grid drifted");
  for (const model of contract.models) {
    assert(fs.existsSync(model.path), `${model.id} model unavailable`);
    assert(sha256(model.path) === model.sha256, `${model.id} model hash drifted`);
    assert(fs.statSync(model.path).size === model.bytes, `${model.id} model size drifted`);
  }
  assert(same(Object.keys(contract.datasets), ["blimp", "tinystories", "hellaswag", "lambada"]),
    "screen task order drifted");
  for (const [id, dataset] of Object.entries(contract.datasets)) {
    assert(dataset.cases === 1000 && dataset.bytes > 0, `${id} screen size drifted`);
    assert(hash(dataset.sha256) && hash(dataset.source_sha256) &&
      hash(dataset.selected_ordinals_sha256), `${id} screen hashes missing`);
    assert(dataset.source_sha256 === base.prepared_bundle.datasets[id].sha256,
      `${id} source hash drifted`);
  }
  assert(contract.datasets.blimp.groups === 67, "BLiMP coverage drifted");
  assert(contract.datasets.blimp.group_case_minimum === 14 &&
    contract.datasets.blimp.group_case_maximum === 15, "BLiMP quotas drifted");
  assert(same(contract.datasets.hellaswag.group_quotas, { indomain: 498, zeroshot: 502 }),
    "HellaSwag quotas drifted");
  assert(contract.execution_policy.venue === "AWS EC2 only", "venue drifted");
  assert(contract.execution_policy.instance_type === "c6i.4xlarge", "instance drifted");
  assert(contract.execution_policy.jobs === 16 &&
    contract.execution_policy.repetitions === 1, "execution multiplicity drifted");
  assert(same(contract.execution_policy.evaluation_order, [
    "zero3:blimp", "zero4:blimp", "zero3:tinystories", "zero4:tinystories",
    "zero3:hellaswag", "zero4:hellaswag", "zero3:lambada", "zero4:lambada",
  ]), "evaluation order drifted");
  assert(contract.execution_policy.one_execution_only === true, "screen became repeatable");
  assert(contract.execution_policy.full_suite_authorized === false, "full suite became authorized");
}

export function validateBundle(contract, directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  assert(manifest.schema === "zero.external_eval_screen_bundle.v1", "bundle schema drifted");
  assert(manifest.id === contract.id, "bundle id drifted");
  assert(manifest.base_contract_sha256 === contract.base_contract_sha256, "bundle base drifted");
  for (const [id, expected] of Object.entries(contract.datasets)) {
    const actual = manifest.datasets[id];
    const file = path.join(directory, expected.path);
    for (const key of [
      "path", "sha256", "bytes", "cases", "source_sha256",
      "selection", "selected_ordinals_sha256",
    ]) assert(actual[key] === expected[key], `${id} ${key} drifted`);
    assert(fs.existsSync(file) && sha256(file) === expected.sha256, `${id} file hash drifted`);
    assert(fs.statSync(file).size === expected.bytes, `${id} file size drifted`);
    assert(fs.readFileSync(file, "utf8").trim().split("\n").length - 1 === 1000,
      `${id} file count drifted`);
  }
  const blimpCounts = Object.values(manifest.datasets.blimp.selected_group_counts);
  assert(blimpCounts.length === 67 && blimpCounts.every((count) => count === 14 || count === 15),
    "BLiMP group coverage drifted");
  assert(blimpCounts.reduce((sum, count) => sum + count, 0) === 1000, "BLiMP total drifted");
  assert(same(manifest.datasets.hellaswag.selected_group_counts, { indomain: 498, zeroshot: 502 }),
    "HellaSwag screen groups drifted");
}

function validateTask(contract, model, task, result) {
  const expected = contract.datasets[task];
  const expectedKinds = {
    blimp: "pair",
    tinystories: "rolling",
    hellaswag: "multiple_choice",
    lambada: "cloze",
  };
  assert(result.schema === "zero.external_eval_result.v1", `${model}:${task} schema drifted`);
  assert(result.timing_only === false, `${model}:${task} is timing-only`);
  assert(result.model?.id === model, `${model}:${task} model id drifted`);
  const expectedModel = contract.models.find(({ id }) => id === model);
  assert(result.model.sha256 === expectedModel.sha256 &&
    result.model.bytes === expectedModel.bytes, `${model}:${task} model drifted`);
  assert(result.benchmark === task, `${model}:${task} benchmark drifted`);
  assert(result.kind === expectedKinds[task], `${model}:${task} scoring kind drifted`);
  assert(result.cases_sha256 === expected.sha256 && result.cases === expected.cases,
    `${model}:${task} cases drifted`);
  assert(result.evaluator?.jobs === 16 && hash(result.evaluator.sha256),
    `${model}:${task} evaluator drifted`);
  assert(hash(result.case_results_sha256), `${model}:${task} result hash missing`);
  assert(Number.isFinite(result.elapsed_seconds) && result.elapsed_seconds > 0,
    `${model}:${task} elapsed time invalid`);
  assert(Number.isFinite(result.metrics?.bits_per_byte) && result.metrics.bits_per_byte > 0,
    `${model}:${task} bits-per-byte invalid`);
  const primary = result.metrics[expected.primary_metric];
  assert(Number.isFinite(primary), `${model}:${task} primary metric missing`);
  if (expected.primary_metric.endsWith("accuracy")) {
    assert(primary >= 0 && primary <= 1, `${model}:${task} accuracy invalid`);
  }
  assert(Object.keys(result.groups ?? {}).length === expected.groups,
    `${model}:${task} result group coverage drifted`);
  const groupCounts = Object.fromEntries(
    Object.entries(result.groups).map(([name, item]) => [name, item.cases]),
  );
  assert(Object.values(groupCounts).reduce((sum, count) => sum + count, 0) === 1000,
    `${model}:${task} group total drifted`);
  if (task === "blimp") {
    assert(Object.values(groupCounts).every((count) => count === 14 || count === 15),
      `${model}:${task} paradigm quota drifted`);
  } else if (task === "hellaswag") {
    assert(same(groupCounts, { indomain: 498, zeroshot: 502 }),
      `${model}:${task} split quota drifted`);
  }
}

export function validateResult(contract, result, expected) {
  assert(result?.schema === "zero.external_eval_screen_result.v1", "result schema drifted");
  assert(result.id === contract.id && result.status === "complete", "result is incomplete");
  assert(result.git_commit === expected.commit, "result commit drifted");
  assert(result.contract_sha256 === sha256(DEFAULT_CONTRACT), "result contract drifted");
  assert(result.budget_sha256 === expected.budgetSha256, "result budget drifted");
  assert(result.training_updates === 0 && result.optimizer_attempts === 0 &&
    result.controller_or_kernel_calls === 0, "result executed forbidden updates");
  assert(result.finished_epoch - result.launch_epoch === result.elapsed_instance_seconds,
    "launch-relative timing drifted");
  assert(Number.isInteger(result.elapsed_instance_seconds) &&
    result.elapsed_instance_seconds >= 0 &&
    result.elapsed_instance_seconds <= expected.maxInstanceSeconds, "instance cap exceeded");
  assert(result.estimated_compute_usd >= 0 &&
    result.estimated_compute_usd <= expected.maxComputeUsd, "compute cap exceeded");
  assert(result.estimated_compute_usd === result.elapsed_instance_seconds * 0.68 / 3600,
    "compute estimate drifted");
  assert(same(Object.keys(result.models ?? {}), contract.models.map(({ id }) => id)),
    "aggregate model grid drifted");
  for (const model of contract.models) {
    assert(result.models?.[model.id]?.model_sha256 === model.sha256 &&
      result.models[model.id].model_bytes === model.bytes, `${model.id} aggregate drifted`);
    assert(same(Object.keys(result.models[model.id].tasks ?? {}), Object.keys(contract.datasets)),
      `${model.id} aggregate task grid drifted`);
    for (const task of Object.keys(contract.datasets)) {
      const item = result.models[model.id].tasks[task];
      assert(item.source_path === `${model.id}-${task}.json` &&
        hash(item.source_sha256), `${model.id}:${task} source record drifted`);
      validateTask(contract, model.id, task, item);
    }
  }
  assert(same(Object.keys(result.comparisons ?? {}), Object.keys(contract.datasets)),
    "comparison grid drifted");
  for (const [task, dataset] of Object.entries(contract.datasets)) {
    const comparison = result.comparisons?.[task];
    assert(comparison?.primary_metric === dataset.primary_metric, `${task} comparison drifted`);
    const left = result.models.zero3.tasks[task].metrics[dataset.primary_metric];
    const right = result.models.zero4.tasks[task].metrics[dataset.primary_metric];
    assert(comparison.zero3 === left && comparison.zero4 === right &&
      comparison.zero4_minus_zero3 === right - left, `${task} delta drifted`);
    if (dataset.primary_metric.endsWith("accuracy")) {
      for (const interval of [comparison.zero3_wilson_95, comparison.zero4_wilson_95]) {
        assert(interval?.lower >= 0 && interval.upper <= 1 && interval.lower <= interval.upper,
          `${task} Wilson interval invalid`);
      }
    }
  }
}

export function validatePublished(contract, launch, status, result, expected) {
  assert(launch?.schema === "zero.external_eval_screen_launch.v1", "launch schema drifted");
  assert(launch.experiment === contract.id && launch.git_commit === expected.commit,
    "launch provenance drifted");
  assert(launch.budget_sha256 === expected.budgetSha256, "launch budget drifted");
  assert(launch.max_instance_seconds === expected.maxInstanceSeconds &&
    launch.max_compute_usd === expected.maxComputeUsd, "launch cap drifted");
  assert(/^i-[0-9a-f]+$/u.test(launch.instance_id), "launch instance id invalid");
  assert(status?.schema === "zero.aws_external_eval_screen_status.v1" &&
    status.status === "complete" && status.phase === "complete" && status.exit_code === 0,
  "structured status is not successful");
  assert(status.git_commit === expected.commit &&
    status.budget_sha256 === expected.budgetSha256, "status provenance drifted");
  assert(status.result_sha256 === sha256(expected.resultPath), "status result hash drifted");
  validateResult(contract, result, expected);
}

export function validateCompletion(contract, completion) {
  assert(completion?.schema === "zero.external_eval_screen_completion.v1",
    "completion schema drifted");
  assert(completion.id === contract.id && completion.status === "complete",
    "screen completion is incomplete");
  assert(completion.authorization_consumed === true, "authorization is not consumed");
  assert(completion.training_updates === 0, "completion trained");
  assert(completion.instance_state === "terminated", "instance is not terminal");
  assert(/^[0-9]+$/u.test(completion.source_run_id), "source run id invalid");
  for (const [name, file, digest] of [
    ["contract", completion.contract_path, completion.contract_sha256],
    ["budget", completion.budget_path, completion.budget_sha256],
    ["launch", completion.launch_path, completion.launch_sha256],
    ["status", completion.status_path, completion.status_sha256],
    ["terminal observation", completion.terminal_path, completion.terminal_sha256],
    ["result", completion.result_path, completion.result_sha256],
    ["report", completion.report_path, completion.report_sha256],
  ]) {
    assert(typeof file === "string" && fs.existsSync(file), `${name} record unavailable`);
    assert(hash(digest) && sha256(file) === digest, `${name} record hash drifted`);
  }
  const launch = JSON.parse(fs.readFileSync(completion.launch_path, "utf8"));
  const status = JSON.parse(fs.readFileSync(completion.status_path, "utf8"));
  const terminal = JSON.parse(fs.readFileSync(completion.terminal_path, "utf8"));
  const result = JSON.parse(fs.readFileSync(completion.result_path, "utf8"));
  validatePublished(contract, launch, status, result, {
    commit: completion.git_commit,
    budgetSha256: completion.budget_sha256,
    maxInstanceSeconds: 3600,
    maxComputeUsd: 0.68,
    resultPath: completion.result_path,
  });
  assert(launch.ci_run_id === completion.source_run_id, "completion run id drifted");
  assert(launch.instance_id === completion.instance_id, "completion instance drifted");
  assert(terminal?.schema === "zero.aws_terminal_observation.v1" &&
    terminal.experiment === contract.id &&
    terminal.instance_id === completion.instance_id &&
    terminal.state === "terminated", "terminal observation drifted");
}

function selfTest(contract) {
  validateContract(contract);
  for (const mutate of [
    (copy) => { copy.training_allowed = true; },
    (copy) => { copy.datasets.blimp.cases = 999; },
    (copy) => { copy.execution_policy.full_suite_authorized = true; },
  ]) {
    const copy = structuredClone(contract);
    mutate(copy);
    let rejected = false;
    try { validateContract(copy); } catch { rejected = true; }
    assert(rejected, "screen checker self-test failed");
  }
  console.log("ZERO-EVAL-1 screen contract self-test passed");
}

function main(args) {
  const contract = JSON.parse(fs.readFileSync(DEFAULT_CONTRACT, "utf8"));
  if (args.includes("--self-test")) return selfTest(contract);
  validateContract(contract);
  const bundleIndex = args.indexOf("--bundle");
  if (bundleIndex >= 0) validateBundle(contract, args[bundleIndex + 1]);
  const publishedIndex = args.indexOf("--published");
  if (publishedIndex >= 0) {
    const launchPath = args[publishedIndex + 1];
    const statusPath = args[publishedIndex + 2];
    const resultPath = args[publishedIndex + 3];
    const value = (name) => {
      const index = args.indexOf(name);
      assert(index >= 0 && args[index + 1] !== undefined, `${name} missing`);
      return args[index + 1];
    };
    validatePublished(
      contract,
      JSON.parse(fs.readFileSync(launchPath, "utf8")),
      JSON.parse(fs.readFileSync(statusPath, "utf8")),
      JSON.parse(fs.readFileSync(resultPath, "utf8")),
      {
        commit: value("--commit"),
        budgetSha256: value("--budget-sha256"),
        maxInstanceSeconds: Number(value("--max-instance-seconds")),
        maxComputeUsd: Number(value("--max-compute-usd")),
        resultPath,
      },
    );
  }
  const completionIndex = args.indexOf("--completion");
  if (completionIndex >= 0) {
    validateCompletion(
      contract,
      JSON.parse(fs.readFileSync(args[completionIndex + 1], "utf8")),
    );
  }
  console.log("OK ZERO-EVAL-1 screen contract");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}

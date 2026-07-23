#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { validateBudget } from "./check_q26r_aws_budget.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hexadecimal(value, length) {
  return typeof value === "string"
    && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

export function validateSeedStatus(status, budget, seed, sourceCommit) {
  assert(status?.schema === "zero.aws_q26r_seed_status.v1", `seed ${seed} status schema drifted`);
  assert(status.experiment === "zero4-q26r-aws-v1", `seed ${seed} experiment drifted`);
  assert(status.seed === seed, `seed ${seed} identity drifted`);
  assert(status.status === "complete" && status.exit_code === 0, `seed ${seed} execution is incomplete`);
  assert(status.phase === "publication", `seed ${seed} did not reach publication`);
  assert(status.git_commit === sourceCommit, `seed ${seed} source commit drifted`);
  assert(hexadecimal(status.budget_sha256, 64), `seed ${seed} budget hash is invalid`);
  assert(status.scientific_result_available === true, `seed ${seed} has no scientific result`);
  assert(["go", "no-go"].includes(status.decision), `seed ${seed} decision is invalid`);
  assert(hexadecimal(status.result_sha256, 64), `seed ${seed} result hash is invalid`);
  assert(
    Number.isInteger(status.observed_instance_seconds)
      && status.observed_instance_seconds >= 0
      && status.observed_instance_seconds <= budget.per_seed_execution.max_instance_seconds,
    `seed ${seed} exceeded its instance cap`,
  );
  assert(
    typeof status.observed_compute_usd === "number"
      && status.observed_compute_usd >= 0
      && status.observed_compute_usd <= budget.per_seed_execution.max_compute_usd,
    `seed ${seed} exceeded its compute cap`,
  );
  assert(
    status.max_instance_seconds === budget.per_seed_execution.max_instance_seconds,
    `seed ${seed} recorded the wrong instance cap`,
  );
  assert(
    status.max_compute_usd === budget.per_seed_execution.max_compute_usd,
    `seed ${seed} recorded the wrong compute cap`,
  );
  assert(status.training_backend === "OpenBLAS", `seed ${seed} backend drifted`);
  assert(
    status.openblas_threads === budget.venue.openblas_threads,
    `seed ${seed} OpenBLAS threads drifted`,
  );
  assert(
    status.quantity_evaluator_jobs === budget.venue.quantity_evaluator_jobs,
    `seed ${seed} quantity jobs drifted`,
  );
  return true;
}

export function validateCompletion(completionPath, budgetPath) {
  const budget = readJson(budgetPath);
  validateBudget(budget);
  const completion = readJson(completionPath);
  assert(
    completion?.schema === "zero.q26r_aws_completion.v1",
    "Q2.6-R completion schema drifted",
  );
  assert(completion.experiment === budget.id, "completion experiment drifted");
  assert(/^[0-9]+$/.test(completion.source_run_id), "source run id is invalid");
  assert(hexadecimal(completion.source_commit, 40), "source commit is invalid");
  assert(/^[0-9]+$/.test(completion.collector_run_id), "collector run id is invalid");
  assert(hexadecimal(completion.collector_commit, 40), "collector commit is invalid");
  assert(completion.budget_file === budgetPath, "completion budget path drifted");
  assert(completion.budget_sha256 === sha256(budgetPath), "completion budget hash drifted");
  assert(JSON.stringify(completion.seeds) === "[1,3]", "completion seed set drifted");
  assert(completion.new_training_started_by_collector === false, "collector started training");

  const root = "benchmarks/zero4-q26r-v1";
  const executionRoot = `${root}/aws-v1`;
  const launchPath = `${executionRoot}/launch-${completion.source_run_id}.json`;
  assert(fs.existsSync(launchPath), "launch receipt is missing");
  const launch = readJson(launchPath);
  assert(launch.schema === "zero.q26r_aws_launch.v1", "launch schema drifted");
  assert(launch.experiment === budget.id, "launch experiment drifted");
  assert(launch.git_commit === completion.source_commit, "launch source commit drifted");
  assert(launch.ci_run_id === completion.source_run_id, "launch run id drifted");
  assert(launch.budget_file === budgetPath, "launch budget path drifted");
  assert(launch.budget_sha256 === completion.budget_sha256, "launch budget hash drifted");
  assert(launch.region === budget.venue.region, "launch region drifted");
  assert(launch.instance_type === budget.venue.instance_type, "launch instance type drifted");
  assert(
    launch.max_instance_seconds_sum === budget.combined_execution.max_instance_seconds_sum,
    "launch combined time cap drifted",
  );
  assert(
    launch.max_compute_usd === budget.combined_execution.max_compute_usd,
    "launch combined cost cap drifted",
  );
  assert(
    JSON.stringify(launch.instances?.map((record) => record.seed)) === "[1,3]",
    "launch instances drifted",
  );
  assert(
    new Set(launch.instances.map((record) => record.instance_id)).size === 2,
    "launch reused an instance",
  );
  for (const record of launch.instances) {
    assert(/^i-[0-9a-f]+$/.test(record.instance_id), `seed ${record.seed} instance id is invalid`);
    assert(Number.isInteger(record.launch_epoch), `seed ${record.seed} launch epoch is invalid`);
    assert(
      record.max_instance_seconds === budget.per_seed_execution.max_instance_seconds,
      `seed ${record.seed} launch time cap drifted`,
    );
    assert(
      record.max_compute_usd === budget.per_seed_execution.max_compute_usd,
      `seed ${record.seed} launch cost cap drifted`,
    );
  }

  for (const seed of budget.workload.authorized_seeds) {
    const statusRecord = completion.statuses?.[String(seed)];
    assert(statusRecord, `seed ${seed} completion status reference is missing`);
    const expectedStatusPath = `${executionRoot}/seed${seed}-status-${completion.source_run_id}.json`;
    assert(statusRecord.path === expectedStatusPath, `seed ${seed} status path drifted`);
    assert(fs.existsSync(statusRecord.path), `seed ${seed} status is missing`);
    assert(statusRecord.sha256 === sha256(statusRecord.path), `seed ${seed} status hash drifted`);
    const status = readJson(statusRecord.path);
    validateSeedStatus(status, budget, seed, completion.source_commit);
    assert(status.budget_sha256 === completion.budget_sha256, `seed ${seed} budget hash drifted`);

    const seedRoot = `${root}/seed${seed}`;
    const resultPath = `${seedRoot}/result.json`;
    const attemptsPath = `${seedRoot}/optimizer-attempts.jsonl`;
    assert(fs.existsSync(resultPath), `seed ${seed} result is missing`);
    assert(fs.existsSync(attemptsPath), `seed ${seed} attempt log is missing`);
    assert(sha256(resultPath) === status.result_sha256, `seed ${seed} result hash drifted`);
    const result = readJson(resultPath);
    assert(result.seed === seed && result.decision === status.decision, `seed ${seed} result/status mismatch`);
    execFileSync(
      "node",
      [
        "scripts/check_zero4_q26r.mjs",
        "benchmarks/zero4-q26r-v1/contract.json",
        attemptsPath,
        resultPath,
      ],
      { stdio: "inherit" },
    );
  }

  const aggregatePath = `${root}/aggregate.json`;
  assert(fs.existsSync(aggregatePath), "Q2.6-R family aggregate is missing");
  const aggregate = readJson(aggregatePath);
  assert(
    aggregate.schema === "zero.zero4_q26_multiseed.v1",
    "Q2.6-R aggregate schema drifted",
  );
  assert(JSON.stringify(aggregate.completed_seeds) === "[1,2,3]", "aggregate is incomplete");
  for (const seed of [1, 3]) {
    const result = readJson(`${root}/seed${seed}/result.json`);
    assert(
      aggregate.results?.[String(seed)]?.decision === result.decision,
      `seed ${seed} aggregate decision drifted`,
    );
  }
  return true;
}

function selfTest() {
  const budgetPath = new URL(
    "../benchmarks/zero4-q26r-v1/aws-v1/budget.json",
    import.meta.url,
  );
  const budget = readJson(budgetPath);
  const status = {
    schema: "zero.aws_q26r_seed_status.v1",
    experiment: "zero4-q26r-aws-v1",
    seed: 1,
    status: "complete",
    phase: "publication",
    exit_code: 0,
    git_commit: "a".repeat(40),
    budget_sha256: "b".repeat(64),
    scientific_result_available: true,
    decision: "go",
    result_sha256: "c".repeat(64),
    observed_instance_seconds: 12000,
    observed_compute_usd: 2.27,
    max_instance_seconds: 13620,
    max_compute_usd: 2.58,
    training_backend: "OpenBLAS",
    openblas_threads: 16,
    quantity_evaluator_jobs: 16,
  };
  validateSeedStatus(status, budget, 1, "a".repeat(40));
  for (const [name, mutate] of [
    ["seed", (copy) => { copy.seed = 3; }],
    ["execution failure", (copy) => { copy.status = "infrastructure-error"; }],
    ["missing result", (copy) => { copy.scientific_result_available = false; }],
    ["instance overrun", (copy) => { copy.observed_instance_seconds = 13621; }],
    ["cost overrun", (copy) => { copy.observed_compute_usd = 2.59; }],
    ["backend", (copy) => { copy.training_backend = "portable"; }],
    ["quantity jobs", (copy) => { copy.quantity_evaluator_jobs = 1; }],
  ]) {
    const invalid = structuredClone(status);
    mutate(invalid);
    let rejected = false;
    try {
      validateSeedStatus(invalid, budget, 1, "a".repeat(40));
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("Q2.6-R AWS completion self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const completionPath = args[0]
    ?? "benchmarks/zero4-q26r-v1/aws-v1/COMPLETED";
  const budgetPath = args[1]
    ?? "benchmarks/zero4-q26r-v1/aws-v1/budget.json";
  validateCompletion(completionPath, budgetPath);
  console.log(`OK Q2.6-R AWS completion: ${completionPath}`);
}

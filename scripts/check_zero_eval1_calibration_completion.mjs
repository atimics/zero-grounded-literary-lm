#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateResult } from "./check_zero_eval1_calibration.mjs";

const DEFAULT_COMPLETION =
  "benchmarks/zero-eval-1/aws-calibration/COMPLETED";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateCompletion(completion) {
  assert(
    completion?.schema === "zero.external_eval_calibration_completion.v1",
    "completion schema drifted",
  );
  assert(completion.id === "zero-eval-1-aws-calibration", "completion id drifted");
  assert(completion.status === "complete", "calibration is not complete");
  assert(completion.authorization_consumed === true, "authorization is not consumed");
  assert(completion.scientific_inference_allowed === false, "completion became scientific");
  assert(completion.training_updates === 0, "completion trained");
  assert(completion.instance_state_after_workflow === "terminated", "instance was not terminated");
  assert(/^[0-9]+$/u.test(completion.github_run_id), "run id is invalid");
  assert(
    completion.github_run_url.endsWith(`/actions/runs/${completion.github_run_id}`),
    "run URL drifted",
  );
  assert(/^[0-9a-f]{64}$/u.test(completion.artifact_sha256), "artifact digest is invalid");

  for (const [name, file, expected] of [
    ["budget", completion.budget_path, completion.budget_sha256],
    ["launch", completion.launch_path, completion.launch_sha256],
    ["status", completion.status_path, completion.status_sha256],
    ["result", completion.result_path, completion.result_sha256],
  ]) {
    assert(typeof file === "string" && fs.existsSync(file), `${name} record is unavailable`);
    assert(/^[0-9a-f]{64}$/u.test(expected), `${name} digest is invalid`);
    assert(sha256(file) === expected, `${name} record hash mismatch`);
  }

  const budget = JSON.parse(fs.readFileSync(completion.budget_path, "utf8"));
  const launch = JSON.parse(fs.readFileSync(completion.launch_path, "utf8"));
  const status = JSON.parse(fs.readFileSync(completion.status_path, "utf8"));
  const result = JSON.parse(fs.readFileSync(completion.result_path, "utf8"));

  assert(budget.id === completion.id, "budget id drifted");
  assert(budget.authorization?.one_execution_only === true, "budget became repeatable");
  assert(
    budget.authorization?.full_evaluation_authorized === false,
    "calibration authorized the full evaluation",
  );
  validateResult(budget, result, status, {
    commit: completion.git_commit,
    budgetSha256: completion.budget_sha256,
  });

  assert(
    launch?.schema === "zero.external_eval_calibration_launch.v1",
    "launch schema drifted",
  );
  assert(launch.experiment === completion.id, "launch experiment drifted");
  assert(launch.ci_run_id === completion.github_run_id, "launch run id drifted");
  assert(launch.git_commit === completion.git_commit, "launch commit drifted");
  assert(launch.budget_sha256 === completion.budget_sha256, "launch budget drifted");
  assert(
    launch.source_archive_sha256 === completion.source_archive_sha256,
    "source archive drifted",
  );
  assert(
    launch.calibration_archive_sha256 === completion.calibration_archive_sha256,
    "calibration archive drifted",
  );
  assert(launch.instance_id === completion.instance_id, "instance id drifted");
  assert(
    launch.max_instance_seconds === budget.execution.max_instance_seconds,
    "instance cap drifted",
  );
  assert(
    launch.max_compute_usd === budget.execution.max_compute_usd,
    "compute cap drifted",
  );
  assert(launch.scientific_inference_allowed === false, "launch became scientific");
  assert(launch.training_updates === 0, "launch trained");
  return true;
}

function selfTest() {
  const completion = JSON.parse(fs.readFileSync(DEFAULT_COMPLETION, "utf8"));
  validateCompletion(completion);
  for (const [name, mutate] of [
    ["status", (copy) => { copy.status = "running"; }],
    ["authorization", (copy) => { copy.authorization_consumed = false; }],
    ["termination", (copy) => { copy.instance_state_after_workflow = "running"; }],
    ["result hash", (copy) => { copy.result_sha256 = "0".repeat(64); }],
  ]) {
    const invalid = structuredClone(completion);
    mutate(invalid);
    let rejected = false;
    try {
      validateCompletion(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("ZERO-EVAL-1 calibration completion self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const completionPath = process.argv[2] ?? DEFAULT_COMPLETION;
    validateCompletion(JSON.parse(fs.readFileSync(completionPath, "utf8")));
    console.log(`OK ZERO-EVAL-1 calibration completion: ${completionPath}`);
  }
}

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { validateBudget } from "./check_q27_aws_budget.mjs";
import { validateResult } from "./check_zero4_q27_result.mjs";

const DEFAULT_COMPLETION = "benchmarks/zero4-q27-v1/aws-v1/COMPLETED";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateCompletion(completionPath = DEFAULT_COMPLETION) {
  const root = "benchmarks/zero4-q27-v1";
  const budgetPath = `${root}/aws-v1/budget.json`;
  const resultPath = `${root}/seed2/result.json`;
  const artifactRoot = `${root}/seed2`;
  const completion = readJson(completionPath);
  assert(completion.schema === "zero.q27_aws_completion.v1",
    "wrong Q2.7 completion schema");
  assert(
    completion.id === "zero4-q27-aws-v1" &&
      completion.status === "complete" &&
      completion.authorization_consumed === true,
    "Q2.7 completion identity drifted",
  );
  assert(/^[0-9]+$/.test(completion.source_run_id),
    "Q2.7 source run id is invalid");
  assert(/^[0-9a-f]{40}$/.test(completion.git_commit),
    "Q2.7 source commit is invalid");
  assert(
    completion.seed === 2 &&
      completion.instance_state === "terminated",
    "Q2.7 completion seed or terminality drifted",
  );
  assert(
    ["candidate-ready", "no-go"].includes(
      completion.quantity_stage_decision,
    ),
    "Q2.7 completion decision is invalid",
  );
  assert(
    completion.language_gate_evaluated === false &&
      completion.q27_final_decision === null,
    "Q2.7 quantity completion claims a final language decision",
  );
  assert(fs.existsSync(budgetPath) && fs.existsSync(resultPath),
    "Q2.7 completion artifacts are unavailable");
  assert(sha256(budgetPath) === completion.budget_sha256,
    "Q2.7 completed budget hash drifted");
  validateBudget(readJson(budgetPath), { requireAuthorized: true });

  const launchPath =
    `${root}/aws-v1/results/launch-${completion.source_run_id}.json`;
  const statusPath =
    `${root}/aws-v1/results/status-${completion.source_run_id}.json`;
  const terminalPath =
    `${root}/aws-v1/results/terminal-${completion.source_run_id}.json`;
  for (const [file, expected, label] of [
    [launchPath, completion.launch_sha256, "launch"],
    [statusPath, completion.status_sha256, "status"],
    [terminalPath, completion.terminal_sha256, "terminal"],
    [resultPath, completion.result_sha256, "result"],
  ]) {
    assert(fs.existsSync(file), `Q2.7 ${label} record is unavailable`);
    assert(sha256(file) === expected, `Q2.7 ${label} hash drifted`);
  }
  const launch = readJson(launchPath);
  const status = readJson(statusPath);
  const terminal = readJson(terminalPath);
  const result = readJson(resultPath);
  assert(
    launch.schema === "zero.q27_aws_launch.v1" &&
      launch.ci_run_id === completion.source_run_id &&
      launch.git_commit === completion.git_commit &&
      launch.budget_sha256 === completion.budget_sha256 &&
      launch.seed === 2 &&
      launch.language_gate_authorized === false,
    "Q2.7 launch chain drifted",
  );
  assert(
    status.schema === "zero.aws_q27_seed2_status.v1" &&
      status.status === "complete" &&
      status.instance_id === launch.instance_id &&
      status.git_commit === completion.git_commit &&
      status.budget_sha256 === completion.budget_sha256 &&
      status.scientific_decision === completion.quantity_stage_decision &&
      status.language_gate_evaluated === false &&
      status.observed_instance_seconds >= 0 &&
      status.observed_instance_seconds <= 6190 &&
      status.observed_compute_usd >= 0 &&
      status.observed_compute_usd <= 1.17,
    "Q2.7 status chain drifted",
  );
  assert(
    terminal.schema === "zero.aws_terminal_observation.v1" &&
      terminal.experiment === "zero4-q27-aws-v1" &&
      terminal.instance_id === launch.instance_id &&
      terminal.state === "terminated",
    "Q2.7 terminal observation drifted",
  );
  assert(result.decision === completion.quantity_stage_decision,
    "Q2.7 result/completion decision drifted");
  validateResult(result, { budgetPath, artifactRoot });
  const attemptCheck = spawnSync(
    "node",
    [
      "scripts/check_zero4_q26.mjs",
      "benchmarks/zero4-q26-v1/contract.json",
      `${artifactRoot}/optimizer-attempts.jsonl`,
    ],
    { encoding: "utf8" },
  );
  assert(attemptCheck.status === 0,
    `Q2.7 optimizer attempt validation failed: ${attemptCheck.stderr}`);
  return true;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const path = process.argv.find(
    (argument, index) => index > 1 && argument !== "--if-present",
  ) ?? DEFAULT_COMPLETION;
  if (!fs.existsSync(path) && process.argv.includes("--if-present")) {
    console.log("Q2.7 AWS completion is not present; staged state passed");
    process.exit(0);
  }
  validateCompletion(path);
  console.log("Q2.7 AWS completion chain passed");
}

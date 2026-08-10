#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  validateContract,
  validateResult,
} from "./check_zero_language_gate.mjs";
import { validateBudget } from "./run_zero_language_gate.mjs";

const CONTRACT = "benchmarks/zero-language-gate-v1/contract.json";
const CANDIDATE_SHA256 =
  "018efb1151731f35d10137ee76679d50d62f9bfb344234b54dc418e065abce28";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function approximately(left, right) {
  return Math.abs(left - right) <=
    1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}

export function validateEnvelope(launch, status, result, budget) {
  assert.equal(launch?.schema, "zero.q29_language_gate_launch.v1");
  assert.equal(launch.experiment, "zero4-q29-seed2-language-gate-v1");
  assert.match(launch.git_commit, /^[0-9a-f]{40}$/);
  assert.match(launch.ci_run_id, /^[0-9]+$/);
  assert.match(launch.instance_id, /^i-[0-9a-f]+$/);
  assert.equal(launch.instance_type, "c6i.4xlarge");
  assert.equal(launch.region, "us-east-1");
  assert.equal(launch.candidate_sha256, CANDIDATE_SHA256);
  assert.equal(launch.max_instance_seconds, 600);
  assert.equal(launch.workload_timeout_seconds, 540);
  assert.equal(launch.max_compute_usd, 0.12);
  assert.equal(launch.execution_lock_acquired, true);
  assert.equal(launch.workflow_waited_for_compute, false);

  assert.equal(budget?.schema, "zero.language_preservation_gate_budget.v1");
  assert.equal(budget.id, launch.experiment);
  assert.equal(budget.status, "authorized");
  assert.equal(budget.candidate.id, "zero4-q29-seed2-u50");
  assert.equal(budget.candidate.sha256, CANDIDATE_SHA256);
  assert.equal(budget.candidate.bytes, 4920400);
  assert.equal(budget.provenance.source_commit, launch.git_commit);
  assert.equal(budget.provenance.promotion_authorized, false);
  assert.equal(budget.authorization.one_execution_only, true);

  assert.equal(status?.schema, "zero.q29_language_gate_status.v1");
  assert.equal(status.status, "complete");
  assert.equal(status.phase, "complete");
  assert.equal(status.instance_id, launch.instance_id);
  assert.equal(status.git_commit, launch.git_commit);
  assert.equal(status.budget_sha256, launch.budget_sha256);
  assert.equal(status.candidate_sha256, CANDIDATE_SHA256);
  assert(Number.isInteger(status.elapsed_instance_seconds));
  assert(status.elapsed_instance_seconds >= 0 &&
    status.elapsed_instance_seconds <= 600);
  assert(Number.isFinite(status.estimated_compute_usd));
  assert(status.estimated_compute_usd >= 0 &&
    status.estimated_compute_usd <= 0.12);
  assert(approximately(status.estimated_compute_usd,
    status.elapsed_instance_seconds * 0.68 / 3600));
  assert.equal(status.training_updates, 0);
  assert.equal(status.promotion_executed, false);

  assert.equal(result?.schema, "zero.language_preservation_gate_result.v1");
  assert.equal(result.model.id, budget.candidate.id);
  assert.equal(result.model.sha256, budget.candidate.sha256);
  assert.equal(result.model.bytes, budget.candidate.bytes);
  assert.equal(result.training_updates, 0);
  assert.equal(result.execution.mode, "authorized_aws");
  assert.equal(result.decision.pass,
    status.scientific_decision === "pass");
  return true;
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(value !== undefined, `missing value for ${key}`);
    if (key === "--launch") options.launch = value;
    else if (key === "--status") options.status = value;
    else if (key === "--result") options.result = value;
    else if (key === "--budget") options.budget = value;
    else assert.fail(`unknown argument ${key}`);
  }
  for (const field of ["launch", "status", "result", "budget"]) {
    assert(options[field], `missing ${field}`);
  }
  return options;
}

function selfTest() {
  const commit = "a".repeat(40);
  const instance = "i-1234abcd";
  const budget = {
    schema: "zero.language_preservation_gate_budget.v1",
    id: "zero4-q29-seed2-language-gate-v1",
    status: "authorized",
    candidate: {
      id: "zero4-q29-seed2-u50",
      sha256: CANDIDATE_SHA256,
      bytes: 4920400,
    },
    authorization: { one_execution_only: true },
    provenance: { source_commit: commit, promotion_authorized: false },
  };
  const launch = {
    schema: "zero.q29_language_gate_launch.v1",
    experiment: budget.id,
    git_commit: commit,
    ci_run_id: "123",
    instance_id: instance,
    instance_type: "c6i.4xlarge",
    region: "us-east-1",
    candidate_sha256: CANDIDATE_SHA256,
    budget_sha256: "b".repeat(64),
    max_instance_seconds: 600,
    workload_timeout_seconds: 540,
    max_compute_usd: 0.12,
    execution_lock_acquired: true,
    workflow_waited_for_compute: false,
  };
  const elapsed = 500;
  const status = {
    schema: "zero.q29_language_gate_status.v1",
    status: "complete",
    phase: "complete",
    instance_id: instance,
    git_commit: commit,
    budget_sha256: launch.budget_sha256,
    candidate_sha256: CANDIDATE_SHA256,
    elapsed_instance_seconds: elapsed,
    estimated_compute_usd: elapsed * 0.68 / 3600,
    training_updates: 0,
    promotion_executed: false,
    scientific_decision: "pass",
  };
  const result = {
    schema: "zero.language_preservation_gate_result.v1",
    model: budget.candidate,
    training_updates: 0,
    execution: { mode: "authorized_aws" },
    decision: { pass: true },
  };
  validateEnvelope(launch, status, result, budget);
  for (const mutate of [
    (copy) => { copy.launch.instance_type = "c6i.2xlarge"; },
    (copy) => { copy.launch.max_instance_seconds = 601; },
    (copy) => { copy.status.estimated_compute_usd = 0.121; },
    (copy) => { copy.status.training_updates = 1; },
    (copy) => { copy.result.model.sha256 = "c".repeat(64); },
  ]) {
    const copy = structuredClone({ launch, status, result, budget });
    mutate(copy);
    assert.throws(() => validateEnvelope(
      copy.launch, copy.status, copy.result, copy.budget));
  }
  console.log("Q2.9 language-gate result envelope self-test passed");
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const options = parseArguments(process.argv.slice(2));
    const launch = readJson(options.launch);
    const status = readJson(options.status);
    const result = readJson(options.result);
    const budget = readJson(options.budget);
    assert.equal(sha256(options.budget), launch.budget_sha256);
    assert.equal(sha256(options.result), status.result_sha256);
    const contract = readJson(CONTRACT);
    assert.equal(launch.workload_sha256,
      sha256("scripts/aws/q29-language-gate.sh"));
    assert.equal(launch.user_data_sha256,
      sha256("scripts/aws/q29-language-gate-user-data.sh"));
    validateContract(contract);
    validateBudget(budget, sha256(CONTRACT), result.model);
    validateResult(result, contract);
    validateEnvelope(launch, status, result, budget);
    console.log("OK Q2.9 candidate-bound language-gate result");
  }
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TEMPLATE =
  "benchmarks/zero4-q28-v1/language-gate/budget-template.json";
const BINDING =
  "benchmarks/zero4-q28-v1/language-gate/candidate-binding.json";
const CANDIDATE_SHA256 =
  "ffc9a4aa74933547785deacb2ceb790a498833e2aff875a81299cc8955a1b0a1";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(result.status, 0, "could not resolve source commit");
  return result.stdout.trim();
}

export function validateTemplate(template, binding, { checkFiles = true } = {}) {
  assert.equal(template?.schema, "zero.q28_language_gate_budget_template.v1");
  assert.equal(template.id, "zero4-q28-seed2-language-gate-v1");
  assert.equal(template.status,
    "implementation_authorized_dispatch_not_authorized");
  assert.equal(template.source_commit,
    "exact merged implementation commit required at dispatch");
  assert.equal(binding?.schema,
    "zero.q28_language_gate_candidate_binding.v1");
  assert.equal(binding.id, "zero4-q28-seed2-u200");
  assert.equal(binding.activation_commit,
    "606e1ab6c9b449bdfe647d283a35127e29f5e309");
  assert.equal(binding.checkpoint.sha256,
    "a5bad72e0421a600f686928fd9da88e9c3b6e182b1a117b24224fb82af5463b1");
  assert.equal(binding.checkpoint.bytes, 58236384);
  assert.equal(binding.quantized.sha256, CANDIDATE_SHA256);
  assert.equal(binding.quantized.bytes, 4920400);
  assert.equal(binding.quantized.update, 200);
  assert.equal(template.candidate_binding.id, binding.id);
  assert.equal(template.candidate_binding.checkpoint_sha256,
    binding.checkpoint.sha256);
  assert.equal(template.candidate_binding.quantized_sha256,
    binding.quantized.sha256);
  assert.equal(template.candidate_binding.quantized_bytes,
    binding.quantized.bytes);
  assert.deepEqual(template.contract, {
    id: "zero-language-gate-v1",
    path: "benchmarks/zero-language-gate-v1/contract.json",
    sha256: "1dcd3f0f577190ec2f879e2a7d713260b241f6335bc850de71f60efd6ef25a7a",
  });
  assert.deepEqual(template.venue, {
    provider: "aws",
    region: "us-east-1",
    instance_type: "c6i.4xlarge",
    hourly_rate_usd: 0.68,
  });
  assert.deepEqual(template.caps, {
    max_instance_seconds: 600,
    workload_timeout_seconds: 540,
    max_compute_usd: 0.12,
    jobs: 16,
    models_per_execution: 1,
  });
  assert.equal(template.workload.training_updates, 0);
  assert.deepEqual(template.workload.evaluation_order,
    ["candidate:blimp", "candidate:tinystories"]);
  assert.equal(template.workload.threshold_changes_allowed, false);
  assert.equal(template.workload.candidate_substitution_allowed, false);
  assert.equal(template.workload.promotion_authorized, false);
  assert.equal(template.authorization.implementation_issue, 76);
  assert.equal(template.authorization.implementation_authorized, true);
  for (const field of [
    "dispatch_authorized", "aws_compute_authorized", "evaluation_authorized",
  ]) assert.equal(template.authorization[field], false,
    `tracked template unexpectedly authorizes ${field}`);
  assert.equal(template.authorization.one_execution_only, true);
  if (checkFiles) {
    assert.equal(sha256(template.candidate_binding.path), sha256(BINDING));
    assert.equal(sha256(binding.quantity_result.path),
      binding.quantity_result.sha256);
    assert.equal(sha256(binding.quantized.path), binding.quantized.sha256);
    assert.equal(fs.statSync(binding.quantized.path).size,
      binding.quantized.bytes);
    assert.equal(sha256(template.contract.path), template.contract.sha256);
    assert.equal(sha256(binding.gate.runner.path), binding.gate.runner.sha256);
    assert.equal(sha256(binding.gate.checker.path), binding.gate.checker.sha256);
    for (const source of binding.gate.evaluator_sources) {
      assert.equal(sha256(source.path), source.sha256,
        `${source.path} source lock drifted`);
    }
  }
  return true;
}

export function materialize(template, binding, approval, sourceCommit) {
  validateTemplate(template, binding, { checkFiles: false });
  assert.match(sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(approval.candidate_sha256, CANDIDATE_SHA256);
  assert.match(approval.id, /^[A-Za-z0-9_.:-]{8,128}$/);
  assert.match(approval.approved_by, /^[A-Za-z0-9_.-]+$/);
  assert.match(approval.approved_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  return {
    schema: "zero.language_preservation_gate_budget.v1",
    id: template.id,
    status: "authorized",
    contract: {
      id: template.contract.id,
      sha256: template.contract.sha256,
    },
    candidate: {
      id: binding.id,
      sha256: binding.quantized.sha256,
      bytes: binding.quantized.bytes,
    },
    venue: {
      provider: template.venue.provider,
      region: template.venue.region,
      instance_type: template.venue.instance_type,
    },
    caps: {
      max_instance_seconds: template.caps.max_instance_seconds,
      workload_timeout_seconds: template.caps.workload_timeout_seconds,
      max_compute_usd: template.caps.max_compute_usd,
    },
    authorization: {
      explicit_manual_authorization: true,
      authorized_for_execution: true,
      one_execution_only: true,
      approved_by: approval.approved_by,
      approved_at: approval.approved_at,
      approval_id: approval.id,
    },
    provenance: {
      source_commit: sourceCommit,
      activation_commit: binding.activation_commit,
      profile_sha256: binding.profile_sha256,
      checkpoint_sha256: binding.checkpoint.sha256,
      quantity_result_sha256: binding.quantity_result.sha256,
      candidate_binding_sha256: sha256(BINDING),
      budget_template_sha256: sha256(TEMPLATE),
      promotion_authorized: false,
    },
  };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(value !== undefined, `missing value for ${key}`);
    if (key === "--source-commit") options.sourceCommit = value;
    else if (key === "--candidate-sha256") options.candidateSha256 = value;
    else if (key === "--approval-id") options.approvalId = value;
    else if (key === "--approved-by") options.approvedBy = value;
    else if (key === "--approved-at") options.approvedAt = value;
    else if (key === "--out") options.out = value;
    else assert.fail(`unknown argument ${key}`);
  }
  for (const field of [
    "sourceCommit", "candidateSha256", "approvalId", "approvedBy",
    "approvedAt", "out",
  ]) assert(options[field], `missing ${field}`);
  return options;
}

function selfTest() {
  const template = readJson(TEMPLATE);
  const binding = readJson(BINDING);
  validateTemplate(template, binding);
  const approval = {
    id: "q28-gate-test-a",
    approved_by: "atimics",
    approved_at: "2026-08-09T00:00:00Z",
    candidate_sha256: CANDIDATE_SHA256,
  };
  const budget = materialize(template, binding, approval, "a".repeat(40));
  assert.equal(budget.status, "authorized");
  assert.equal(budget.candidate.sha256, CANDIDATE_SHA256);
  assert.equal(budget.caps.max_compute_usd, 0.12);
  assert.equal(budget.provenance.promotion_authorized, false);
  for (const mutate of [
    (copy) => { copy.candidate_binding.quantized_sha256 = "b".repeat(64); },
    (copy) => { copy.venue.region = "us-west-2"; },
    (copy) => { copy.caps.max_instance_seconds = 601; },
    (copy) => { copy.caps.max_compute_usd = 0.13; },
    (copy) => { copy.authorization.dispatch_authorized = true; },
  ]) {
    const copy = structuredClone(template);
    mutate(copy);
    assert.throws(() => validateTemplate(copy, binding, { checkFiles: false }));
  }
  assert.throws(() => materialize(template, binding,
    { ...approval, candidate_sha256: "b".repeat(64) }, "a".repeat(40)));
  console.log("Q2.8 language-gate budget materializer self-test passed");
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const options = parseArguments(process.argv.slice(2));
    assert.equal(gitHead(), options.sourceCommit,
      "dispatch source commit does not match checkout HEAD");
    const template = readJson(TEMPLATE);
    const binding = readJson(BINDING);
    validateTemplate(template, binding);
    const budget = materialize(template, binding, {
      id: options.approvalId,
      approved_by: options.approvedBy,
      approved_at: options.approvedAt,
      candidate_sha256: options.candidateSha256,
    }, options.sourceCommit);
    fs.writeFileSync(options.out, `${JSON.stringify(budget, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(`Materialized Q2.8 language-gate budget at ${options.out}`);
  }
}

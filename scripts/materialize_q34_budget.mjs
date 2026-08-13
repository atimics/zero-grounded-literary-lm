#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const ROOT = "benchmarks/zero4-q34-semantic-head-v1";
const TEMPLATE = `${ROOT}/budget-template.json`;
const CONTRACT = `${ROOT}/contract.json`;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { out: null, "source-commit": null, "approval-id": null,
    "approved-by": null, "approved-at": null };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  for (const [key, value] of Object.entries(options))
    assert(value, `missing --${key}`);
  return options;
}

export function materialize(template, options, contractHash) {
  assert.equal(template.schema, "zero.q34_semantic_head_budget.v1");
  assert.equal(template.status, "implementation_staged_run_not_authorized");
  assert.equal(template.authorization.authorized, false);
  assert.equal(template.authorization.maximum_optimizer_updates, 0);
  assert.match(options["source-commit"], /^[0-9a-f]{40}$/);
  assert.match(options["approval-id"], /^q34-[a-z0-9-]+$/);
  assert.match(options["approved-by"], /^[A-Za-z0-9_.-]+$/);
  assert.match(options["approved-at"], /^\d{4}-\d{2}-\d{2}T/);
  const runtime = structuredClone(template);
  runtime.status = "run_authorized";
  runtime.proposed.source_commit = options["source-commit"];
  runtime.authorization = {
    authorized: true, one_execution_only: true,
    approval_id: options["approval-id"],
    approved_by: options["approved-by"], approved_at: options["approved-at"],
    source_commit: options["source-commit"], contract_sha256: contractHash,
    maximum_optimizer_updates: template.proposed.maximum_optimizer_updates,
    maximum_semantic_evaluation_records:
      template.proposed.maximum_semantic_evaluation_records,
    maximum_canonical_evaluation_records:
      template.proposed.maximum_canonical_evaluation_records,
    maximum_compute_usd: template.proposed.maximum_compute_usd,
    training_authorized: true, private_gate_authorized: true,
    confirmation_gate_authorized: true,
    canonical_regression_authorized: true,
    language_gate_authorized: false, deployment_authorized: false,
    additional_seed_authorized: false,
  };
  return runtime;
}

function selfTest() {
  const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  const runtime = materialize(template, {
    "source-commit": "a".repeat(40), "approval-id": "q34-test-one-shot",
    "approved-by": "ratimics", "approved-at": "2026-08-12T00:00:00Z",
  }, "b".repeat(64));
  assert.equal(runtime.authorization.maximum_optimizer_updates, 100);
  assert.equal(runtime.authorization.maximum_compute_usd, 0.15);
  assert.equal(runtime.authorization.training_authorized, true);
  assert.equal(runtime.authorization.deployment_authorized, false);
  console.log("Q3.4 budget materializer self-test passed");
}

function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  assert(!fs.existsSync(options.out), "refuse to overwrite runtime budget");
  const runtime = materialize(JSON.parse(fs.readFileSync(TEMPLATE, "utf8")),
    options, sha256(CONTRACT));
  fs.writeFileSync(options.out, `${JSON.stringify(runtime, null, 2)}\n`,
    { flag: "wx" });
  console.log(`wrote one-shot Q3.4 runtime budget to ${options.out}`);
}

main();

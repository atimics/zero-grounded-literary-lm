#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const contractPath = "benchmarks/zero5-c51-statebridge-v1/contract.json";
const specPath = "benchmarks/zero5-c51-statebridge-v1/SPEC.md";
const contract = JSON.parse(fs.readFileSync(contractPath));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(program, args, expectedStatus = 0) {
  const result = spawnSync(program, args, {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, expectedStatus,
    `${program} ${args.join(" ")} returned ${result.status}: ` +
      (result.stderr || result.stdout));
  return result;
}

assert.equal(contract.schema, "zero.c51_statebridge_contract.v1");
assert.equal(contract.experiment, "zero5-c51-statebridge-v1");
assert.equal(contract.status, "authorized-unrun");
assert.equal(contract.authorized, true);
assert.equal(contract.authorization.training_authorized, true);
assert.equal(contract.authorization.authorization_id,
  "zero5-c51-statebridge-local-2026-08-28-v1");
assert.equal(sha256(contract.authorization.record),
  contract.authorization.record_sha256);
const authorization = JSON.parse(fs.readFileSync(contract.authorization.record));
assert.equal(authorization.authorized, true);
assert.equal(authorization.scope.runs, 1);
assert.equal(authorization.scope.seed, 0);
assert.equal(authorization.scope.maximum_execution_seconds, 3600);
assert.equal(authorization.scope.paid_compute, false);
assert(authorization.not_authorized.includes("sealed-test access"));
assert(authorization.not_authorized.includes("an independent retry"));

for (const file of [contractPath, specPath, contract.authorization.record]) {
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("/Users/"), false, `${file} exposes a user path`);
  assert.equal(text.includes("/private/"), false,
    `${file} exposes a private path`);
}
for (const name of ["trainer", "importer", "evaluator", "runner",
  "c43_evaluator"]) {
  assert.equal(sha256(contract.implementation[name]),
    contract.implementation[`${name}_sha256`],
  `${name} implementation changed`);
}
assert.equal(sha256(contract.control.contract_path),
  contract.control.contract_sha256);
assert.equal(sha256(contract.control.public_result.path),
  contract.control.public_result.sha256);
const publicResult = JSON.parse(fs.readFileSync(
  contract.control.public_result.path));
assert.equal(publicResult.validation.candidate.choice.retrieval.choice_accuracy,
  contract.control.retrieval_choice_accuracy);
assert.equal(publicResult.validation.candidate.choice.retrieval
  .pair_exact_accuracy, contract.control.retrieval_pair_exact_accuracy);

const primary = contract.verified_import.primary;
assert.equal(primary.packs, 37768);
assert.equal(primary.update_groups, 28707);
assert.equal(primary.active_targets, 14850534);
assert.equal(primary.compute_token_exposures, 19337216);
assert.equal(primary.maximum_packs_per_update, 2);
assert.equal(contract.verified_import.mixture.c5_pack_fraction, .25);
assert.equal(contract.verified_import.mixture.c5_packs, 9442);
assert.equal(contract.verified_import.mixture.c5_choice_a_packs,
  contract.verified_import.mixture.c5_choice_b_packs);
assert.equal(contract.verified_import.mixture.symbolic_serialization_present,
  false);
assert.equal(contract.verified_import.mixture.auxiliary_state_head_present,
  false);
assert.equal(contract.training.seed, 0);
assert.equal(contract.training.paid_compute_authorized, false);
assert.equal(contract.training.cost_ceiling_usd, null);
assert.equal(contract.execution.venue, "local");
assert.equal(contract.execution.maximum_execution_seconds, 3600);
assert.equal(contract.execution.independent_retry_authorized, false);
assert.equal(contract.evaluation.cloze_exact_metric,
  "reported-retired-not-a-decision-gate");
assert.equal(contract.claim_boundary.structured_content_only, true);
assert.equal(contract.claim_boundary.symbolic_serialization, false);
assert.equal(contract.claim_boundary.verified_state_target_loss, false);
assert.equal(contract.claim_boundary.promotion_authorized, false);
for (const name of ["content_present", "parsed", "tokenized", "packed",
  "scored", "metrics_opened"]) assert.equal(contract.test[name], false);

const importer = fs.readFileSync(contract.implementation.importer, "utf8");
assert.equal(importer.includes("data/text/test.jsonl"), false);
assert.equal(importer.includes("canonical/test.jsonl"), false);
assert.equal(importer.includes("alignment/test.jsonl"), false);
assert.match(run("node", [contract.implementation.importer, "--self-test"])
  .stdout, /importer self-test passed/u);
assert.match(run("node", [contract.implementation.evaluator, "--self-test"])
  .stdout, /evaluator self-test passed/u);
assert.match(run("node", [contract.implementation.runner, "--self-test"])
  .stdout, /runner self-test passed/u);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c51-check-"));
try {
  const blocked = structuredClone(contract);
  blocked.status = "frozen-awaiting-authorization";
  blocked.authorized = false;
  blocked.authorization.training_authorized = false;
  const blockedPath = path.join(directory, "blocked.json");
  fs.writeFileSync(blockedPath, JSON.stringify(blocked, null, 2) + "\n");
  const result = run("node", [contract.implementation.runner,
    "--contract", blockedPath], 1);
  assert.match(result.stderr, /not explicitly authorized/u);
} finally { fs.rmSync(directory, { recursive: true }); }

process.stdout.write("ZERO.5 C5.1 StateBridge contract checks passed\n");

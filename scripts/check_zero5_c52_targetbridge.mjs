#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const contractPath = "benchmarks/zero5-c52-targetbridge-v1/contract.json";
const specPath = "benchmarks/zero5-c52-targetbridge-v1/SPEC.md";
const contract = JSON.parse(fs.readFileSync(contractPath));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(program, args, expected = 0) {
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, expected,
    `${program} ${args.join(" ")} returned ${result.status}: ` +
      (result.stderr || result.stdout));
  return result;
}

assert.equal(contract.schema, "zero.c52_targetbridge_contract.v1");
assert.equal(contract.experiment, "zero5-c52-targetbridge-v1");
assert.equal(contract.status, "authorized-unrun");
assert.equal(contract.authorized, true);
assert.equal(contract.authorization.training_authorized, true);
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
  assert.equal(text.includes("/private/"), false, `${file} exposes a private path`);
}
for (const name of ["trainer", "importer", "evaluator", "runner",
  "c51_evaluator"]) {
  assert.equal(sha256(contract.implementation[name]),
    contract.implementation[`${name}_sha256`], `${name} changed`);
}
assert.equal(sha256(contract.control.c51_contract),
  contract.control.c51_contract_sha256);
assert.equal(contract.control.new_runner_loss_off_equivalence.byte_identical,
  true);
assert.equal(contract.control.new_runner_loss_off_equivalence.updates, 10);

assert.equal(contract.model.base_parameters, 4852992);
assert.equal(contract.model.auxiliary_parameters, 193264);
assert.equal(contract.model.total_parameters, 5046256);
assert(contract.model.total_parameters < 5100000);
assert.equal(contract.training.seed, 0);
assert.equal(contract.training.update_groups, 28707);
assert.equal(contract.training.pack_sequences, 37768);
assert.equal(contract.training.compute_token_exposures, 19337216);
assert.equal(contract.training.auxiliary_events, 293606);
assert.equal(contract.training.auxiliary_loss_weight, .1);
assert.equal(contract.verified_target_import.primary.choice_a_records,
  contract.verified_target_import.primary.choice_b_records);
assert.equal(contract.verified_target_import.factorized_family_softmax, true);
assert.equal(contract.verified_target_import.singleton_families_excluded, true);
assert.equal(contract.verified_target_import.prompt_boundary_hidden_state, true);
assert.equal(contract.execution.venue, "local Apple Silicon");
assert.equal(contract.execution.paid_compute_authorized, false);
assert.equal(contract.execution.cost_ceiling_usd, null);
assert.equal(contract.execution.independent_retry_authorized, false);
assert.equal(contract.claim_boundary.verified_state_target_loss, true);
assert.equal(contract.claim_boundary.symbolic_serialization, false);
assert.equal(contract.claim_boundary.promotion_authorized, false);
assert.equal(contract.evaluation.cloze_exact_metric,
  "reported-retired-not-a-decision-gate");
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
assert.match(run("./zero5_c51_target_lm", ["--self-test"]).stdout,
  /TargetBridge self-test passed/u);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c52-check-"));
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

process.stdout.write("ZERO.5 C5.2 TargetBridge contract checks passed\n");

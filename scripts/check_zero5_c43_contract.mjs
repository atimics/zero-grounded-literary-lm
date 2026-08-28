#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";

const contractPath = "benchmarks/zero5-c43-v1/contract.json";
const proposalPath = "benchmarks/zero5-c43-v1/contract-proposal.json";
const contract = JSON.parse(fs.readFileSync(contractPath));
const proposal = JSON.parse(fs.readFileSync(proposalPath));

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
  return { stdout: result.stdout, stderr: result.stderr };
}

assert.equal(contract.schema, "zero.c43_experiment_contract.v1");
assert.equal(contract.experiment, proposal.experiment);
assert.equal(contract.status,
  "frozen-awaiting-primary-training-authorization");
assert.equal(contract.authorized, false);
assert.equal(contract.source_proposal_sha256, sha256(proposalPath));
assert.equal(contract.braid.release_id, proposal.braid_request.release_id);
assert.equal(contract.braid.source_commit, proposal.braid_request.source_commit);
assert.equal(contract.braid.manifest_sha256,
  proposal.braid_request.manifest_sha256);
assert.equal(contract.braid.membership_digest,
  proposal.braid_request.membership_digest);
assert.equal(contract.braid.pack_plan_sha256,
  proposal.braid_request.pack_plan_sha256);

for (const evidence of [contract.braid.report,
  contract.verified_import.intake,
  contract.verified_import.evidence.first,
  contract.verified_import.evidence.second,
  contract.pilot.selection,
  ...Object.values(contract.pilot.variants)]) {
  assert.equal(sha256(evidence.path), evidence.sha256,
    `${evidence.path} hash changed`);
  assert.equal(fs.statSync(evidence.path).size, evidence.bytes,
    `${evidence.path} size changed`);
  const text = fs.readFileSync(evidence.path, "utf8");
  assert.equal(text.includes("/Users/"), false,
    `${evidence.path} exposes a user path`);
  assert.equal(text.includes("/private/"), false,
    `${evidence.path} exposes a private path`);
}

for (const name of ["trainer", "importer", "intake_library",
  "pilot_runner", "evaluator", "runner"]) {
  assert.equal(sha256(contract.implementation[name]),
    contract.implementation[`${name}_sha256`],
  `${name} implementation changed`);
}
assert.equal(contract.implementation.pack_format, "Z5PKV3 grouped packs");

const firstImport = JSON.parse(fs.readFileSync(
  contract.verified_import.evidence.first.path));
const secondImport = JSON.parse(fs.readFileSync(
  contract.verified_import.evidence.second.path));
assert.equal(firstImport.schema, "zero.c43_import_receipt.v1");
assert.equal(secondImport.schema, "zero.c43_import_receipt.v1");
assert.notEqual(firstImport.import_id, secondImport.import_id);
assert(isDeepStrictEqual(firstImport.outputs, secondImport.outputs));
assert.equal(contract.verified_import.deterministic, true);
assert.equal(contract.verified_import.primary.sha256,
  "34d38b1b0ed67f0eb86d04cd9482e507b41d4418ea7e4f86e361452310dca329");
assert.equal(contract.verified_import.primary.packs, 37768);
assert.equal(contract.verified_import.primary.records, 78039);
assert.equal(contract.verified_import.primary.update_groups, 28707);
assert.equal(contract.verified_import.primary.compute_token_exposures,
  19337216);
assert.equal(contract.verified_import.primary.wraps, 0);
assert.equal(contract.verified_import.development.sha256,
  "4426d9a51480f658bf5405524fb819a33f979eabe6cc31f446b906c4e9d38749");
assert.equal(contract.verified_import.development.update_groups, 1061);

const selection = JSON.parse(fs.readFileSync(contract.pilot.selection.path));
assert.equal(selection.schema, "zero.c43_pilot_selection.v1");
assert.equal(selection.selected.variant, "cloze-plus-five-v1");
assert.equal(selection.variants.length, 2);
assert(isDeepStrictEqual(contract.training.answer_weights,
  selection.selected.answer_weights));
assert.equal(contract.pilot.primary_starts_from_pilot, false);
assert.equal(contract.pilot.frozen_validation_scored, false);
assert.equal(contract.pilot.test_metrics_opened, false);
assert.equal(contract.pilot.promotion_eligible, false);

assert.equal(contract.training.status, "frozen-unauthorized");
assert.equal(contract.training.update_groups, 28707);
assert.equal(contract.training.compute_token_exposures, 19337216);
assert.equal(contract.training.pair_atomic_updates, true);
assert.equal(contract.training.zero_wraps_required, true);
assert.equal(contract.training.primary_initialization, "C2-not-C4.2-or-pilot");
assert.equal(contract.training.paid_compute_authorized, false);
assert.equal(contract.training.cost_ceiling_usd, null);
assert.equal(contract.execution.status, "blocked-not-selected");
assert.equal(contract.execution.venue, null);
assert.equal(contract.execution.maximum_execution_seconds, null);

assert.equal(contract.evaluation.evaluator_status, "implemented-frozen");
assert.equal(contract.evaluation.reuse_c42_validation_artifacts, true);
assert.equal("swap_improvement_minimum" in contract.gates, false);
for (const task of ["claim", "retrieval"]) {
  assert(contract.gates.swap_consistency_minimum[task] >= 0 &&
    contract.gates.swap_consistency_minimum[task] <= 1);
  assert(contract.gates.swap_regression_maximum[task] >= 0 &&
    contract.gates.swap_regression_maximum[task] <= 1);
}
assert.equal(contract.test.content_present, false);
assert.equal(contract.test.parsed, false);
assert.equal(contract.test.tokenized, false);
assert.equal(contract.test.packed, false);
assert.equal(contract.test.scored, false);
assert.equal(contract.test.metrics_opened, false);
for (const value of Object.values(contract.authorization)) {
  assert(value === false || value === null);
}

assert.match(run("node", ["scripts/evaluate_zero5_c43.mjs", "--self-test"])
  .stdout, /evaluator self-test passed/u);
assert.match(run("node", ["scripts/run_zero5_c43.mjs", "--self-test"])
  .stdout, /runner self-test passed/u);
const blocked = run("node", ["scripts/run_zero5_c43.mjs",
  "--contract", contractPath], 1);
assert.match(blocked.stderr, /frozen but not authorized/u);

process.stdout.write("ZERO.5 C4.3 frozen contract checks passed\n");

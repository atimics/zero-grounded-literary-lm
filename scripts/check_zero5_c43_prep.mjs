#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildContractCandidate,
  readJson,
  selectPilotVariants,
  sha256File,
  validateImportPair,
  validatePilotVariant,
  validateReleaseReport,
} from "./lib/zero5_c43_intake.mjs";

const fixtureDirectory = "tests/fixtures/zero5-c43-release";
const proposalPath = "benchmarks/zero5-c43-v1/contract-proposal.json";
const releaseSchemaPath = "schemas/zero5-c43-release-report.schema.json";
const reportPath = `${fixtureDirectory}/report.json`;
const firstImportPath = `${fixtureDirectory}/import-a.json`;
const secondImportPath = `${fixtureDirectory}/import-b.json`;
const focusedPath = `${fixtureDirectory}/pilot-focused.json`;
const balancedPath = `${fixtureDirectory}/pilot-balanced.json`;

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${program} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function expectFailure(pattern, action) {
  assert.throws(action, pattern);
}

const proposal = readJson(proposalPath);
const c42Contract = readJson(proposal.c42_decision.contract);
const report = readJson(reportPath);
const firstImport = readJson(firstImportPath);
const secondImport = readJson(secondImportPath);
const focused = readJson(focusedPath);
const balanced = readJson(balancedPath);
const releaseSchema = readJson(releaseSchemaPath);

assert.equal(releaseSchema.$schema,
  "https://json-schema.org/draft/2020-12/schema");
assert.equal(releaseSchema.properties.schema.const,
  "braid.zero5_c43_release_report.v1");
assert.equal(releaseSchema.properties.primary.properties
  .compute_token_exposures.const,
proposal.training_proposal.primary_compute_token_exposures);
assert.equal(releaseSchema.$defs.sealedTest.properties.sha256.const,
  proposal.test.sha256);

validateReleaseReport(report, proposal, c42Contract,
  path.resolve(fixtureDirectory));
const imports = validateImportPair(firstImport, secondImport, report,
  proposal, c42Contract);

const lowCloze = structuredClone(report);
lowCloze.primary.answer_targets.cloze = 400000;
lowCloze.primary.answer_targets.total = 2900000;
expectFailure(/cloze answer-target coverage/u, () => validateReleaseReport(
  lowCloze, proposal, c42Contract, path.resolve(fixtureDirectory),
  { verifyArtifacts: false }));

const weakRetrieval = structuredClone(report);
weakRetrieval.primary.retrieval.negative_type_counts["lexical-confounder"] =
  200;
expectFailure(/lexical-confounder retrieval share/u, () =>
  validateReleaseReport(weakRetrieval, proposal, c42Contract,
    path.resolve(fixtureDirectory), { verifyArtifacts: false }));

const openTest = structuredClone(report);
openTest.test.content_present = true;
expectFailure(/content_present must be false/u, () => validateReleaseReport(
  openTest, proposal, c42Contract, path.resolve(fixtureDirectory),
  { verifyArtifacts: false }));

const brokenPairing = structuredClone(report);
brokenPairing.primary.mirroring.claim.group_violations = 1;
expectFailure(/cross optimizer groups/u, () => validateReleaseReport(
  brokenPairing, proposal, c42Contract, path.resolve(fixtureDirectory),
  { verifyArtifacts: false }));

const differentImport = structuredClone(secondImport);
differentImport.outputs.primary.sha256 =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
expectFailure(/produced different outputs/u, () => validateImportPair(
  firstImport, differentImport, report, proposal, c42Contract));

const invalidPilot = structuredClone(focused);
invalidPilot.frozen_validation_scored = true;
expectFailure(/opened frozen validation/u, () => validatePilotVariant(
  invalidPilot, report, imports, proposal));

const overweightPilot = structuredClone(focused);
overweightPilot.answer_weights.cloze = 9;
expectFailure(/cloze answer weight/u, () => validatePilotVariant(
  overweightPilot, report, imports, proposal));

const entries = [focusedPath, balancedPath].map(file => ({
  value: readJson(file),
  sha256: sha256File(file),
}));
const selection = selectPilotVariants(entries, report, imports, proposal);
assert.equal(selection.selected.variant, "balanced-cloze");
assert.equal(selection.frozen_validation_scored, false);
assert.equal(selection.test_metrics_opened, false);
assert.equal(selection.promotion_eligible, false);

const tamperedSelection = structuredClone(selection);
tamperedSelection.selected.answer_weights = {
  ...tamperedSelection.selected.answer_weights,
  cloze: 3.7,
};
expectFailure(/differs from its result-set entry/u, () =>
  buildContractCandidate({
    proposal,
    proposalSha256: sha256File(proposalPath),
    report,
    reportSha256: sha256File(reportPath),
    imports,
    firstImportSha256: sha256File(firstImportPath),
    secondImportSha256: sha256File(secondImportPath),
    pilotSelection: tamperedSelection,
    pilotSelectionSha256:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  }));

const candidate = buildContractCandidate({
  proposal,
  proposalSha256: sha256File(proposalPath),
  report,
  reportSha256: sha256File(reportPath),
  imports,
  firstImportSha256: sha256File(firstImportPath),
  secondImportSha256: sha256File(secondImportPath),
  pilotSelection: selection,
  pilotSelectionSha256:
    "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
});
assert.equal(candidate.authorized, false);
assert.equal(candidate.training.paid_compute_authorized, false);
assert.equal(candidate.training.cost_ceiling_usd, null);
assert.equal(candidate.test.sha256, proposal.test.sha256);
assert.equal(candidate.gates.test_metrics_opened, false);
assert.equal(candidate.pilot.selected_variant, "balanced-cloze");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(),
  "zero5-c43-prep-"));
try {
  const intake = JSON.parse(run("node", [
    "scripts/check_zero5_c43_release.mjs",
    "--report", reportPath,
    "--import-a", firstImportPath,
    "--import-b", secondImportPath,
  ]));
  assert.equal(intake.status, "pass");
  assert.equal(intake.paid_compute_authorized, false);
  assert.equal(intake.test_metrics_opened, false);

  const selectionPath = path.join(temporaryDirectory, "selection.json");
  assert.match(run("node", [
    "scripts/select_zero5_c43_pilot.mjs",
    "--report", reportPath,
    "--import-a", firstImportPath,
    "--import-b", secondImportPath,
    "--variant", focusedPath,
    "--variant", balancedPath,
    "--out", selectionPath,
  ]), /balanced-cloze/u);
  const selected = readJson(selectionPath);
  assert.equal(selected.promotion_eligible, false);

  const candidatePath = path.join(temporaryDirectory, "candidate.json");
  assert.match(run("node", [
    "scripts/build_zero5_c43_contract_candidate.mjs",
    "--report", reportPath,
    "--import-a", firstImportPath,
    "--import-b", secondImportPath,
    "--pilot-selection", selectionPath,
    "--out", candidatePath,
  ]), /blocked-pending-final-review-and-compute-approval/u);
  const generated = readJson(candidatePath);
  assert.equal(generated.authorized, false);
  assert.equal(generated.training.paid_compute_authorized, false);
  assert.equal(generated.pilot.test_metrics_opened, false);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write("ZERO.5 C4.3 preparation checks passed\n");

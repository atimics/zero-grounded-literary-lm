#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { assert, sha256File } from "./zero_data_lib.mjs";

const contractPath =
  "benchmarks/reasoner5-generated-family-harness-v1/contract.json";
const contract = JSON.parse(readFileSync(contractPath, "utf8"));

assert(contract.schema ===
  "zero.reasoner5_generated_family_harness_contract.v1",
"unexpected Reasoner 5 generated-family harness contract schema");
assert(contract.experiment === "reasoner5-generated-family-harness-v1",
  "unexpected Reasoner 5 generated-family harness ID");
assert(contract.status === "development-only",
  "Reasoner 5 harness must remain development-only");
assert(contract.execution?.authorized === false,
  "Reasoner 5 harness execution must remain unauthorized");
assert(contract.execution?.sealed_seeds_present === false,
  "Reasoner 5 harness must not contain sealed seeds");
assert(contract.execution?.scientific_executions === 0,
  "Reasoner 5 harness must not record a scientific execution");

const design = JSON.parse(readFileSync(contract.base_design.path, "utf8"));
assert(sha256File(contract.base_design.path) === contract.base_design.sha256,
  "Reasoner 5 next-set design hash changed");
assert(design.schema === "zero.reasoner5_next_set_design.v1",
  "unexpected Reasoner 5 next-set design schema");
assert(design.status === "design-only",
  "Reasoner 5 next-set plan must remain design-only");
assert(design.execution?.authorized === false,
  "Reasoner 5 next-set execution must remain unauthorized");

assert(contract.implementation?.library ===
  "scripts/lib/reasoner5_harness.mjs", "harness library path changed");
assert(contract.implementation?.check ===
  "scripts/check_reasoner5_harness.mjs", "harness check path changed");
readFileSync(contract.implementation.library);
readFileSync(contract.implementation.check);

assert(Array.isArray(contract.lanes) && contract.lanes.join("\n") === [
  "source-training", "calibration", "development", "sealed",
].join("\n"), "harness lane order changed");
assert(contract.digest?.algorithm === "sha256",
  "harness digest algorithm changed");
assert(contract.digest?.canonical_encoding === "stable-json-utf8",
  "harness canonical encoding changed");
assert(contract.statistics?.confidence_interval ===
  "ordinary percentile cluster bootstrap",
"harness confidence interval method changed");
assert(contract.statistics?.one_sided_p_value ===
  "recentered null cluster bootstrap",
"harness p-value method changed");
assert(contract.statistics?.fixed_environment_weighting === "equal",
  "harness fixed-environment weighting changed");
assert(contract.statistics?.ordinary_and_null_sample_receipts ===
  "separate SHA-256 digests", "harness bootstrap receipt design changed");
assert(contract.statistics?.holm_ordering === "calibrated null p-values",
  "harness Holm ordering changed");

const requiredChecks = contract.required_checks;
assert(Array.isArray(requiredChecks) && requiredChecks.length > 0,
  "harness required checks are missing");
assert(new Set(requiredChecks).size === requiredChecks.length,
  "harness required checks contain duplicates");
for (const required of [
  "strict canonical JSON domain",
  "transactional registration rollback",
  "hash-bound replay registry",
  "intrinsic function-source hashing",
  "manifest structural replay",
  "registered crossed-family references",
  "recursive public ranker-view isolation",
  "typed public leaf provenance",
  "complete recursive ranker schema",
  "case-insensitive evaluator-field rejection",
  "semantic and syntax candidate-multiset parity",
  "registered candidate-universe enforcement",
  "proposal record binding and work-charge floor",
  "immutable verifier input",
  "canonical digest-bound fallback order",
  "expansion-to-verifier trace linkage",
  "complete charged fallback and cap-plus-one censoring",
  "exhausted-search cap-plus-one censoring reason",
  "full operational source-ablation equality",
  "family-level independent-unit restriction",
  "portable numerical receipts",
  "ordinary percentile confidence interval",
  "recentered null one-way bootstrap",
  "recentered null stratified one-way bootstrap",
  "recentered null two-way bootstrap",
  "null-bootstrap digest binding",
  "Holm ordering on calibrated null p-values",
  "complete-crossing two-way bootstrap",
  "strict raw-trace schema and provenance derivation",
  "scientific mechanism miss produces no-go",
  "registered analysis derived from raw traces",
  "exactness validated before measurement floor",
  "raw-trace result digest replay",
  "common pass-gate reconstruction",
]) {
  assert(requiredChecks.includes(required),
    `harness contract omits required check: ${required}`);
}

const makefile = readFileSync("Makefile", "utf8");
assert(makefile.includes("reasoner5-harness-check:"),
  "harness focused check is not wired into Makefile");
assert(makefile.includes("reasoner5-harness-contract-check:"),
  "harness contract check is not wired into Makefile");

console.log("Reasoner 5 generated-family harness contract passed");

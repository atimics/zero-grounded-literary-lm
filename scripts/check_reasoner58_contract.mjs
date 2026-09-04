#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { assert, sha256File } from "./zero_data_lib.mjs";

const contractPath =
  "benchmarks/reasoner58-compositional-behavior-transfer-v1/contract.json";
const contract = JSON.parse(readFileSync(contractPath, "utf8"));

assert(contract.schema === "zero.reasoner58_development_contract.v1",
  "unexpected Reasoner 5.8 contract schema");
assert(contract.experiment ===
  "reasoner58-compositional-behavior-transfer-v1",
"unexpected Reasoner 5.8 experiment ID");
assert(contract.status === "development-only",
  "Reasoner 5.8 contract must stay development-only");
assert(contract.execution?.authorized === false,
  "Reasoner 5.8 scientific execution must stay locked");
assert(contract.execution?.sealed_seeds_present === false,
  "Reasoner 5.8 contract must stay seed-free");
assert(contract.execution?.scientific_executions === 0,
  "Reasoner 5.8 contract must record zero scientific runs");

for (const item of [contract.base_design.plan, contract.base_design.document])
  assert(sha256File(item.path) === item.sha256,
    `Reasoner 5.8 base design changed at ${item.path}`);

for (const [name, item] of Object.entries(contract.implementation.files))
  assert(sha256File(item.path) === item.sha256,
    `Reasoner 5.8 implementation changed at ${name}`);
for (const [name, item] of Object.entries(
  contract.implementation.protected_predecessors))
  assert(sha256File(item.path) === item.sha256,
    `Reasoner 5.8 predecessor changed at ${name}`);

const artifactHex = readFileSync(contract.artifacts.source.path, "utf8").trim();
assert(/^[0-9a-f]+$/u.test(artifactHex) && artifactHex.length % 2 === 0,
  "Reasoner 5.8 source artifact must be canonical hex");
assert(Buffer.from(artifactHex, "hex").length ===
  contract.artifacts.source.canonical_bytes,
"Reasoner 5.8 source artifact byte count changed");
assert(contract.artifacts.source.content_sha256 ===
  contract.measurements.source_artifact_sha256,
"Reasoner 5.8 source artifact receipt changed");

for (const [name, item] of Object.entries(contract.artifacts.files))
  assert(sha256File(item.path) === item.file_sha256,
    `Reasoner 5.8 fixture file changed at ${name}`);

const manifest = JSON.parse(readFileSync(contract.artifacts.files.manifest.path,
  "utf8"));
const result = JSON.parse(readFileSync(contract.artifacts.files.result.path,
  "utf8"));
assert(manifest.manifest_sha256 === contract.measurements.manifest_sha256,
  "Reasoner 5.8 manifest receipt changed");
assert(manifest.source_artifact.source_count_receipt_sha256 ===
  contract.measurements.source_count_receipt_sha256,
"Reasoner 5.8 source count receipt changed");
assert(result.raw_trace_sha256 === contract.measurements.raw_trace_sha256,
  "Reasoner 5.8 raw trace receipt changed");
assert(result.result_sha256 === contract.measurements.result_sha256,
  "Reasoner 5.8 result receipt changed");
assert(result.decision === contract.measurements.decision,
  "Reasoner 5.8 development decision changed");
assert(result.development_measurements.episodes === 12 &&
  result.development_measurements.rows === 504,
"Reasoner 5.8 development coverage changed");
assert(manifest.episode_counts["source-training"] === 64,
  "Reasoner 5.8 source provenance is incomplete");
assert(manifest.episode_counts.sealed === 0,
  "Reasoner 5.8 sealed lane must stay closed");

for (const control of ["target_only", "source_free_jit", "source_ablation",
  "transition_only", "raw_token", "behavior_off", "shuffled_behavior",
  "token_permuted", "source_only", "oracle_truth_rank"])
  assert(contract.controls.includes(control),
    `Reasoner 5.8 contract omits ${control}`);
assert(contract.derangements === 31,
  "Reasoner 5.8 contract needs 31 derangements");
assert(contract.shift_strata.length === 4,
  "Reasoner 5.8 contract needs four shifts");
assert(contract.search?.enumerator ===
  "parent-gated bottom-up priority queue",
"Reasoner 5.8 search must stay parent-gated and bottom-up");
assert(contract.search?.development_proposals ===
  "complete 428-class semantic order",
"Reasoner 5.8 development rows need the complete proposal queue");
assert(contract.search?.censoring_charge ===
  "cap plus one for every unsolved search",
"Reasoner 5.8 unsolved searches need conservative charging");

const makefile = readFileSync("Makefile", "utf8");
for (const target of ["reasoner58-check:", "reasoner58-sanitize-check:",
  "reasoner58-development:", "reasoner58-development-check:",
  "reasoner58-contract-check:"])
  assert(makefile.includes(target), `Makefile omits ${target}`);

console.log(`Reasoner 5.8 development contract passed: ` +
  `${contract.measurements.result_sha256}`);

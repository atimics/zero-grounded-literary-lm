#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q32-public-v1";
const RESULTS = `${ROOT}/results`;
const EXPECTED = Object.freeze({
  source_commit: "6b5e75189502c265e544d439f4f7204cf1b8d3fc",
  contract_sha256: "35f0a1333553535f261641a47147665ab638f7f2edf3814e4bcd280f05c13184",
  authorization_sha256: "3851bddb61ecd9da5ab507fab036f7c8682e15ca3d4631a82dbed07aafacc4ec",
  result_sha256: "2c87a3227ecd559b1840d7cfb0e415dc581d41521dc7d4af6e690e97407f7a00",
  candidate_sha256: "cd3a1d5ea3833dda88c352b5bdb1add0eb9dca7d36d9133461f251b6ca27852c",
  class_sha256: {
    add: "d2af71dededc5eefb52b286f7e89111d8ca6023e641e2173e17b708cddf691bc",
    multiply: "8efcc82813c4187a0453a029b6d91c7b241556c03147b503ebed76ab9d6e7367",
    "add-rational": "641a6884f70eeda4180f7dc13f56e407dd5d95c1cfab78d7f41bcca87841a35b",
    convert: "8ae7368651cc02b186e00756be59b79cc62286bc17e9ef662cea7a41e212043a",
    "solve-linear": "c026d5909a3dea0d55244af81ffcc4f29139776bae37af3cbe7e8e393c236bd3",
  },
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

assert.equal(sha256(`${ROOT}/contract.json`), EXPECTED.contract_sha256);
assert.equal(sha256(`${ROOT}/runtime-budget.json`),
  EXPECTED.authorization_sha256);
assert.equal(sha256(`${RESULTS}/result.json`), EXPECTED.result_sha256);
assert.equal(sha256("benchmarks/zero4-q32-v1/results/candidate.litqhead"),
  EXPECTED.candidate_sha256);
for (const [name, digest] of Object.entries(EXPECTED.class_sha256))
  assert.equal(sha256(`${RESULTS}/public-${name}.json`), digest);

const budget = readJson(`${ROOT}/runtime-budget.json`);
const consumption = readJson(`${ROOT}/runtime-budget.json.consumed`);
const copied = readJson(`${RESULTS}/authorization-consumption.json`);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.source_commit, EXPECTED.source_commit);
assert.equal(budget.authorization.training_updates, 0);
assert.equal(consumption.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(consumption.public_records, 500);
assert.deepEqual(copied, consumption);
assert.equal(spawnSync("git", ["cat-file", "-e",
  `${EXPECTED.source_commit}^{commit}`]).status, 0);

const result = readJson(`${RESULTS}/result.json`);
assert.equal(result.schema, "zero.zero4_q32_public_quantity_result.v1");
assert.equal(result.source_commit, EXPECTED.source_commit);
assert.equal(result.contract_sha256, EXPECTED.contract_sha256);
assert.equal(result.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(result.candidate.sha256, EXPECTED.candidate_sha256);
assert.equal(result.public_split.records, 500);
assert.equal(result.public_split.records_per_class, 100);
assert.equal(result.training_updates, 0);
assert.equal(result.scientific_decision, "go");
assert.equal(result.decision.passed, true);
assert.equal(result.totals.cases, 500);
assert.equal(result.totals.closed, 500);
assert.equal(result.totals.syntax, 500);
assert.equal(result.totals.operation, 499);
assert.equal(result.totals.arguments, 500);
assert.equal(result.totals.exact_request, 499);
assert.equal(result.totals.oracle_arithmetic, 500);
assert.equal(result.totals.committed, 499);
assert.equal(result.totals.exact_artifact, 499);
assert.equal(result.totals.rejected, 1);
assert.equal(result.totals.rejected_state_mutations, 0);
assert.equal(result.non_q_probability_identity, true);
assert(Object.values(result.decision.gates).every(Boolean));
for (const name of ["add", "multiply", "add-rational", "convert"])
  assert.equal(result.classes[name].operation, 100);
assert.equal(result.classes["solve-linear"].operation, 99);
for (const section of ["promotion", "language_gate", "deployment",
  "additional_seeds"]) {
  assert.equal(result[section].authorized, false);
  assert.equal(result[section].executed, false);
}

const report = fs.readFileSync(`${RESULTS}/PUBLIC-RESULT.md`, "utf8");
for (const phrase of ["Decision: **go**", "499/500", "99.8%",
  "solve-linear", "zero training updates", "not evaluated"])
  assert(report.includes(phrase), `public report lacks ${phrase}`);

console.log("Q3.2 public quantity go result passed");

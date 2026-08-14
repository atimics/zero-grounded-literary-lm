#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q33-semantic-v1";
const RESULTS = `${ROOT}/results`;
const EXPECTED = Object.freeze({
  source_commit: "2f43a4e6d40a6da4cd63db66fcccf77e89ff7809",
  contract_sha256: "a487d1ca4897f69e93340e742269728766e283d0d7b2378dd8cee30750b906eb",
  authorization_sha256: "b03c5ab97acc394137e807322190d0149442194a7539334ddb3e61f7635529b5",
  result_sha256: "1e6d1a5033aa704c52ea3c02bd000875b8f30ebc3ef599ca690655cd4d6df150",
  candidate_sha256: "cd3a1d5ea3833dda88c352b5bdb1add0eb9dca7d36d9133461f251b6ca27852c",
  dataset_sha256: "2c49fa5c5a431b204ed79d06f20f17126a3180735230fcd73eb7c0511bfd2888",
  cell_sha256: {
    "add-lexical": "68d52781847afc0d7f0b430d3c6f5130005fedc9e98a4cc91b7b8391af903074",
    "add-implicit": "98e7e8f1de07a38fa99741bbdfd0f67bb29dd3f3485e6a768fe331b2a0d99458",
    "multiply-lexical": "6e0b7a75723c817aaeebe3dd7973c391c1444b7e9ab60f1d0aa6cee403914152",
    "multiply-implicit": "fc4e7e5dcfb078136624d9bb11e02bebceee93aa9333260cfdb784a7882bc9c1",
    "add-rational-lexical": "5eb22b53710d0bb0a7977c02db54a49c4efdc2c66f822918124209c95f8095ff",
    "add-rational-implicit": "71653deeacaa1c718354341d49261ee70296b01bc911658106537f5e9cbdd3c9",
    "convert-lexical": "78f1a2b9dcccbcae7b02ed01fa5efbc24c2fb8082ce43cbb370dfb7ebc4dee73",
    "convert-implicit": "66f1221144375244614794870c243797874ba4cfa0c0ee1a8ec5a3801325334a",
    "solve-linear-lexical": "5075bc7e137892b6d34add648a816363ba37859b5972f397f1c4fb58c33a8e47",
    "solve-linear-implicit": "088649957fad3ecf9df1f96701cf9bfd7e9c40f505d4862c87d30d94b6fad026"
  }
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

assert.equal(sha256(`${ROOT}/contract.json`), EXPECTED.contract_sha256);
assert.equal(sha256(`${ROOT}/runtime-budget.json`),
  EXPECTED.authorization_sha256);
assert.equal(sha256(`${RESULTS}/result.json`), EXPECTED.result_sha256);
assert.equal(sha256(`${ROOT}/semantic-eval.tsv`), EXPECTED.dataset_sha256);
assert.equal(sha256("benchmarks/zero4-q32-v1/results/candidate.litqhead"),
  EXPECTED.candidate_sha256);
for (const [cell, digest] of Object.entries(EXPECTED.cell_sha256))
  assert.equal(sha256(`${RESULTS}/semantic-${cell}.json`), digest);

const budget = readJson(`${ROOT}/runtime-budget.json`);
const consumption = readJson(`${ROOT}/runtime-budget.json.consumed`);
const copied = readJson(`${RESULTS}/authorization-consumption.json`);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.source_commit, EXPECTED.source_commit);
assert.equal(budget.authorization.training_updates, 0);
assert.equal(consumption.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(consumption.semantic_records, 500);
assert.deepEqual(copied, consumption);
assert.equal(spawnSync("git", ["cat-file", "-e",
  `${EXPECTED.source_commit}^{commit}`]).status, 0);

const result = readJson(`${RESULTS}/result.json`);
assert.equal(result.schema, "zero.zero4_q33_semantic_routing_result.v1");
assert.equal(result.source_commit, EXPECTED.source_commit);
assert.equal(result.contract_sha256, EXPECTED.contract_sha256);
assert.equal(result.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(result.candidate.sha256, EXPECTED.candidate_sha256);
assert.equal(result.dataset.sha256, EXPECTED.dataset_sha256);
assert.equal(result.training_updates, 0);
assert.equal(result.scientific_decision, "no-go");
assert.equal(result.decision.passed, false);
assert.equal(result.totals.cases, 500);
assert.equal(result.totals.closed, 500);
assert.equal(result.totals.syntax, 500);
assert.equal(result.totals.operation, 130);
assert.equal(result.totals.canonical_binding, 500);
assert.equal(result.totals.oracle_arithmetic, 500);
assert.equal(result.totals.committed, 130);
assert.equal(result.totals.exact_artifact, 130);
assert.equal(result.totals.rejected, 370);
assert.equal(result.totals.rejected_state_mutations, 0);
assert.equal(result.non_q_probability_identity, true);
assert.deepEqual(Object.fromEntries(Object.entries(result.classes).map(
  ([name, value]) => [name, value.operation])), {
    add: 0, multiply: 89, "add-rational": 24, convert: 7,
    "solve-linear": 10,
  });
assert.equal(result.strata.lexical.operation, 73);
assert.equal(result.strata.implicit.operation, 57);
assert.deepEqual(result.confusion_matrix.add, [0, 58, 11, 31, 0]);
assert.deepEqual(result.confusion_matrix.multiply, [0, 89, 9, 2, 0]);
assert.deepEqual(result.confusion_matrix["add-rational"], [0, 71, 24, 2, 3]);
assert.deepEqual(result.confusion_matrix.convert, [0, 93, 0, 7, 0]);
assert.deepEqual(result.confusion_matrix["solve-linear"], [2, 51, 37, 0, 10]);
for (const section of ["retraining", "language_gate", "deployment",
  "additional_seeds"]) {
  assert.equal(result[section].authorized, false);
  assert.equal(result[section].executed, false);
}

const report = fs.readFileSync(`${RESULTS}/SEMANTIC-RESULT.md`, "utf8");
for (const phrase of ["Decision: **no-go**", "130/500", "26.0%",
  "362/500", "0.000683", "brittle surface/template", "zero training"])
  assert(report.includes(phrase), `semantic report lacks ${phrase}`);

console.log("Q3.3 semantic-routing no-go result passed");

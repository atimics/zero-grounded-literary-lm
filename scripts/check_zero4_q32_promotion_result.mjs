#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q32-promotion-v1";
const RESULTS = `${ROOT}/results`;
const EXPECTED = Object.freeze({
  source_commit: "d609b770b6a65a8ca7f04e56be8687020bc224c4",
  contract_sha256: "9bb209418f30440be24129e18c5cecae4b41da6bda614b297717c6d75c0cca5f",
  authorization_sha256: "7f96e4c3346ff98b58f8cfff99be1061d14beca40bc9b9597ef924b3e3cbe4ea",
  result_sha256: "23086929f38eb84d28e8defc2995afd54a4134eff09aa1cc90a77058b2ad18fc",
  candidate_sha256: "cd3a1d5ea3833dda88c352b5bdb1add0eb9dca7d36d9133461f251b6ca27852c",
  public_result_sha256: "2c87a3227ecd559b1840d7cfb0e415dc581d41521dc7d4af6e690e97407f7a00",
  class_sha256: {
    add: "a4d478956b0e815f2dcf56bca1018ee3cbaca57347a670d6defa6161d9b7cf23",
    multiply: "e049d06c5177bc800b9f1c3058a0a84489f6680ad6c310f6fc682209a12c9545",
    "add-rational": "ae72f8e792e63e17474e9fd1a890b3a2e4f2b86c84b7f22a29a987c2ffc848ee",
    convert: "3aaaa86df03d682147b91ff392e6432867a77088624ece2d913e48c73a93db43",
    "solve-linear": "9dfdbbbf2e7b07e089030846a812da8c4d83ca651862373671727854d8fa74ae"
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
assert.equal(sha256("benchmarks/zero4-q32-v1/results/candidate.litqhead"),
  EXPECTED.candidate_sha256);
assert.equal(sha256("benchmarks/zero4-q32-public-v1/results/result.json"),
  EXPECTED.public_result_sha256);
for (const [name, digest] of Object.entries(EXPECTED.class_sha256))
  assert.equal(sha256(`${RESULTS}/promotion-${name}.json`), digest);

const budget = readJson(`${ROOT}/runtime-budget.json`);
const consumption = readJson(`${ROOT}/runtime-budget.json.consumed`);
const copied = readJson(`${RESULTS}/authorization-consumption.json`);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.source_commit, EXPECTED.source_commit);
assert.equal(budget.authorization.training_updates, 0);
assert.equal(consumption.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(consumption.promotion_records, 500);
assert.deepEqual(copied, consumption);
assert.equal(spawnSync("git", ["cat-file", "-e",
  `${EXPECTED.source_commit}^{commit}`]).status, 0);

const result = readJson(`${RESULTS}/result.json`);
assert.equal(result.schema,
  "zero.zero4_q32_quantity_promotion_result.v1");
assert.equal(result.source_commit, EXPECTED.source_commit);
assert.equal(result.contract_sha256, EXPECTED.contract_sha256);
assert.equal(result.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(result.eligibility.public_result_sha256,
  EXPECTED.public_result_sha256);
assert.equal(result.eligibility.public_decision, "go");
assert.equal(result.candidate.sha256, EXPECTED.candidate_sha256);
assert.equal(result.promotion_split.records, 500);
assert.equal(result.promotion_split.records_per_class, 100);
assert.equal(result.training_updates, 0);
assert.equal(result.scientific_decision, "go");
assert.equal(result.decision.passed, true);
for (const key of ["cases", "closed", "syntax", "operation", "arguments",
  "exact_request", "oracle_arithmetic", "committed", "exact_artifact"])
  assert.equal(result.totals[key], 500, `${key} is not exact`);
assert.equal(result.totals.rejected, 0);
assert.equal(result.totals.rejected_state_mutations, 0);
assert.equal(result.non_q_probability_identity, true);
assert(Object.values(result.decision.gates).every(Boolean));
for (const name of ["add", "multiply", "add-rational", "convert",
  "solve-linear"]) assert.equal(result.classes[name].operation, 100);
for (const section of ["language_gate", "deployment", "additional_seeds"]) {
  assert.equal(result[section].authorized, false);
  assert.equal(result[section].executed, false);
}

const report = fs.readFileSync(`${RESULTS}/PROMOTION-RESULT.md`, "utf8");
for (const phrase of ["Decision: **go**", "500/500", "1,499/1,500",
  "99.93%", "zero training", "does not establish paraphrase"])
  assert(report.includes(phrase), `promotion report lacks ${phrase}`);

console.log("Q3.2 perfect quantity promotion result passed");

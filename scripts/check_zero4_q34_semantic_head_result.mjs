#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q34-semantic-head-v1";
const RESULTS = `${ROOT}/results`;
const EXPECTED = Object.freeze({
  source_commit: "1456dfb09c7d2e5bfc4293ac903c0515cc1494c7",
  contract_sha256: "74fee27396800a6bba3e62c3d15c11d4cbe1e2e46c7315e8818faf9353d3a94e",
  authorization_sha256: "8e3f6d0585a810a2eb9d9485dbd419fa9309dbcab2130dee4d6ce8bd6e709b13",
  result_sha256: "759f9ee26a758dcb3debabbc5256fa4a6764911fc23925b46179f7099a12958f",
  events_sha256: "c1e117c423c144d58cb5c7531a4dda466103933c90ecf0dd0f0b849db50946e9",
  consumption_sha256: "662353e531b25cfda35407867cd3802900a8dd0c992e825886fca1c470fa3d04",
  checkpoint_sha256: [
    "0e4994344aa33696bd9663cd086ee76be51ff1fa5fd91b305fdb0bfa7067b6df",
    "1ba72996fdaa9d3a2b2d82e0bd1d282394f43ef6b2db110ba90543a01d22baa5",
    "d00d33986ef432465ade6a2ff1872937e5e3f7c2d1fe5d78f0fe7f116f1e7271",
    "1e61c05d0c569d6f025560b85fc45917855d2f3ee0c4f165193f2961efb54a99"
  ]
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

assert.equal(sha256(`${ROOT}/contract.json`), EXPECTED.contract_sha256);
assert.equal(sha256(`${ROOT}/runtime-budget.json`), EXPECTED.authorization_sha256);
assert.equal(sha256(`${ROOT}/runtime-budget.json.consumed`),
  EXPECTED.consumption_sha256);
assert.equal(sha256(`${RESULTS}/authorization-consumption.json`),
  EXPECTED.consumption_sha256);
assert.equal(sha256(`${RESULTS}/result.json`), EXPECTED.result_sha256);
assert.equal(sha256(`${RESULTS}/events.jsonl`), EXPECTED.events_sha256);
for (const [index, update] of [0, 25, 50, 100].entries())
  assert.equal(sha256(`${RESULTS}/checkpoint-u${String(update).padStart(6,"0")}.q32`),
    EXPECTED.checkpoint_sha256[index]);

const budget = readJson(`${ROOT}/runtime-budget.json`);
const consumption = readJson(`${ROOT}/runtime-budget.json.consumed`);
const copied = readJson(`${RESULTS}/authorization-consumption.json`);
assert.equal(budget.status, "run_authorized");
assert.equal(budget.authorization.authorized, true);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.source_commit, EXPECTED.source_commit);
assert.equal(budget.authorization.maximum_optimizer_updates, 100);
assert.equal(budget.authorization.deployment_authorized, false);
assert.equal(consumption.authorization_sha256, EXPECTED.authorization_sha256);
assert.deepEqual(copied, consumption);
assert.equal(spawnSync("git", ["cat-file", "-e",
  `${EXPECTED.source_commit}^{commit}`]).status, 0);

const result = readJson(`${RESULTS}/result.json`);
assert.equal(result.schema, "zero.zero4_q34_semantic_head_result.v1");
assert.equal(result.source_commit, EXPECTED.source_commit);
assert.equal(result.contract_sha256, EXPECTED.contract_sha256);
assert.equal(result.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(result.scientific_decision, "no-go");
assert.equal(result.selected_feature_checkpoint, null);
assert.equal(result.candidate, null);
for (const key of ["private_semantic", "private_canonical",
  "confirmation_semantic", "public_canonical", "promotion_canonical",
  "combined_public_promotion_canonical"]) assert.equal(result[key], null);
assert.equal(result.base_trainable_parameters, 0);
assert.equal(result.head_trainable_parameters, 7685);
assert.deepEqual(result.measurements.map(({ update }) => update), [0,25,50,100]);
assert.deepEqual(result.measurements.map(({ holdout_accuracy }) =>
  Math.round(holdout_accuracy * 1000)), [200,298,294,416]);
assert.deepEqual(result.measurements.at(-1).per_class_accuracy,
  [0.01, 0.08, 0.49, 0.92, 0.58]);
assert.equal(result.measurements.at(-1).holdout_cross_entropy,
  1.328922460588492);
for (const section of ["language_gate", "deployment", "additional_seeds"]) {
  assert.equal(result[section].authorized, false);
  assert.equal(result[section].executed, false);
}
assert.equal(fs.existsSync(`${RESULTS}/candidate.litqhead`), false);
assert.equal(fs.existsSync(`${RESULTS}/gate-candidate.litqhead`), false);
assert.equal(fs.existsSync(`${RESULTS}/rejected-candidate.litqhead`), false);

const events = fs.readFileSync(`${RESULTS}/events.jsonl`, "utf8")
  .trim().split("\n").map(JSON.parse);
const complete = events.at(-1);
assert.equal(complete.type, "complete");
assert.equal(complete.updates_committed, 100);
assert.equal(complete.stop_reason, "update-cap");
assert.equal(complete.runtime_feature_checkpoint_available, false);
assert.equal(complete.packaged_runtime_gate_run, false);

const report = fs.readFileSync(`${RESULTS}/SEMANTIC-HEAD-RESULT.md`, "utf8");
for (const phrase of ["Decision: **no-go**", "41.6% (208/500)", "17.4%",
  "0.711", "20,485 parameters", "does not validate semantic scaling",
  "does not establish natural-language argument extraction"])
  assert(report.includes(phrase), `Q3.4 result report lacks ${phrase}`);

console.log("Q3.4 semantic-head no-go result passed");

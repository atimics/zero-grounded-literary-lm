#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q32-v1";
const RESULTS = `${ROOT}/results`;
const EXPECTED = Object.freeze({
  source_commit: "d875625081053a65a770fc21642e71a1731b70cd",
  contract_sha256: "be8832501eb48e1ca0ecf631e662fdb655594f0dfd585b076bf2311f1d97bc70",
  authorization_sha256: "e0fabb79c520adbd05555bbf4444751b969f339320a75e733992d2e3992f4a66",
  result_sha256: "382c2e9cb420de5e7234df70c55f3dbdf000930f33b6b66b5f337a2cebd6a910",
  audit_sha256: "a3b798f07f56c60f725e66a34a95a47ad765648babb8c4ace9adbee7f06ff960",
  events_sha256: "aee4948700f5fce6bbeb0c794cc57cdc8ea5205880a48ea1b98a759ae6f2de5b",
  checkpoint_sha256: "bb934157130da1e7baaa63bbefb7e5abbfc5a601323f773210e054c946689a4d",
  candidate_sha256: "cd3a1d5ea3833dda88c352b5bdb1add0eb9dca7d36d9133461f251b6ca27852c",
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

assert.equal(sha256(`${ROOT}/contract.json`), EXPECTED.contract_sha256);
assert.equal(sha256(`${ROOT}/runtime-budget.json`),
  EXPECTED.authorization_sha256);
assert.equal(sha256(`${RESULTS}/result.json`), EXPECTED.result_sha256);
assert.equal(sha256(`${RESULTS}/packaged-runtime-audit.json`),
  EXPECTED.audit_sha256);
assert.equal(sha256(`${RESULTS}/events.jsonl`), EXPECTED.events_sha256);
assert.equal(sha256(`${RESULTS}/checkpoint-u000100.q32`),
  EXPECTED.checkpoint_sha256);
assert.equal(sha256(`${RESULTS}/candidate.litqhead`),
  EXPECTED.candidate_sha256);

const budget = readJson(`${ROOT}/runtime-budget.json`);
const consumption = readJson(`${ROOT}/runtime-budget.json.consumed`);
const copiedConsumption = readJson(`${RESULTS}/authorization-consumption.json`);
assert.equal(budget.status, "run_authorized");
assert.equal(budget.authorization.authorized, true);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.source_commit, EXPECTED.source_commit);
assert.equal(consumption.authorization_sha256, EXPECTED.authorization_sha256);
assert.deepEqual(copiedConsumption, consumption);
const commit = spawnSync("git", ["cat-file", "-e",
  `${EXPECTED.source_commit}^{commit}`]);
assert.equal(commit.status, 0, "bound source commit is unavailable");

const result = readJson(`${RESULTS}/result.json`);
assert.equal(result.schema, "zero.zero4_q32_pilot_result.v1");
assert.equal(result.source_commit, EXPECTED.source_commit);
assert.equal(result.authorization_sha256, EXPECTED.authorization_sha256);
assert.equal(result.contract_sha256, EXPECTED.contract_sha256);
assert.deepEqual(result.measurements.map(({ update }) => update),
  [0, 25, 50, 100]);
assert.deepEqual(result.measurements.map(({ per_class_count }) =>
  per_class_count), Array(4).fill([100, 100, 100, 100, 100]));
assert.equal(result.selected.update, 100);
assert.equal(result.selected.holdout_accuracy, 1.0000000000000007);
assert.deepEqual(result.selected.per_class_accuracy, [1, 1, 1, 1, 1]);
assert.equal(result.selected_checkpoint,
  `${RESULTS}/checkpoint-u000100.q32`);
assert.equal(result.selected_package, `${RESULTS}/candidate.litqhead`);
for (const key of ["public_quantity_run", "language_gate_run",
  "promotion_run", "deployment_run"]) assert.equal(result[key], false);

const gate = result.packaged_runtime;
assert.equal(gate.passed, true); assert.equal(gate.overall_accuracy, 1);
assert.deepEqual(gate.per_class_accuracy, [1, 1, 1, 1, 1]);
for (const key of ["cases", "closed", "syntax", "operation", "arguments",
  "exact_request", "oracle_arithmetic", "committed", "exact_artifact"])
  assert.equal(gate.totals[key], 500, `${key} is not exact`);
assert.equal(gate.totals.rejected, 0);
assert.equal(gate.totals.rejected_state_mutations, 0);
assert.equal(gate.exact_structural, true);
assert.equal(gate.non_q_probability_identity, true);

const audit = readJson(`${RESULTS}/packaged-runtime-audit.json`);
for (const name of ["add", "multiply", "add-rational", "convert",
  "solve-linear"]) {
  const quantity = audit.classes[name].quantity;
  assert.equal(quantity.cases, 100); assert.equal(quantity.operation, 100);
  assert.equal(quantity.exact_request, 100);
  assert.equal(quantity.committed, 100);
  assert.equal(quantity.rejected_state_mutations, 0);
}
assert.deepEqual(audit.gate, gate);

const report = fs.readFileSync(`${RESULTS}/PILOT-RESULT.md`, "utf8");
for (const phrase of ["500/500", "100/100", "73.4%", "7,685-parameter",
  "not promoted or deployed", "Public quantity evaluation"])
  assert(report.includes(phrase), `result report lacks ${phrase}`);

console.log("Q3.2 runtime-qualified result and frozen candidate passed");

#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { validateContract } from "./run_zero4_q33_semantic.mjs";

const ROOT = "benchmarks/zero4-q33-semantic-v1";
validateContract(JSON.parse(fs.readFileSync(`${ROOT}/contract.json`, "utf8")));
const budget = JSON.parse(fs.readFileSync(`${ROOT}/budget-template.json`, "utf8"));
assert.equal(budget.schema, "zero.q33_semantic_routing_budget.v1");
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_semantic_records, 0);
const prereg = fs.readFileSync(`${ROOT}/PREREGISTRATION.md`, "utf8");
for (const phrase of ["1,499/1,500", "500-row", "Five-way chance",
  "80% overall", "does not test natural-language argument parsing",
  "zero training"])
  assert(prereg.includes(phrase), `semantic preregistration lacks ${phrase}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q33-semantic-(?:run|eval):/m.test(makefile));
for (const script of ["scripts/materialize_q33_semantic_budget.mjs",
  "scripts/run_zero4_q33_semantic.mjs"]) {
  const result = spawnSync("node", [script, "--self-test"],
    { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

const prefix = `/tmp/zero-q33-mechanics-${process.pid}`;
for (const command of [
  ["./runtime_operation_head_pilot", ["--self-test-artifact", prefix]],
  ["./package_runtime_operation_head",
    ["docs/model.litq8", `${prefix}.q32`, `${prefix}.litqhead`]],
]) {
  const result = spawnSync(command[0], command[1], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
const tsv = `${prefix}.tsv`, json = `${prefix}.json`;
fs.writeFileSync(tsv,
  "id\tdomain\tprevious_summary\tmodel_input\tcanonical_input\tmodel_request\tbound_request\tartifact\tsummary\tstratum\ttemplate_id\n" +
  "mock\tquantity\tquantity channel has no prior committed result\tWhat fraction is one half with one third?\tadd-rational 1/2 1/3\tquantity.add-rational\tquantity.add-rational 1/2 1/3\tresult 5/6\tkernel committed result 5/6\tlexical\t0\n");
const mechanics = spawnSync("./semantic_operation_eval",
  [`${prefix}.litqhead`, tsv, "--json", json], { encoding: "utf8" });
assert.equal(mechanics.status, 0, mechanics.stderr);
const outcome = JSON.parse(fs.readFileSync(json, "utf8"));
for (const key of ["cases", "closed", "syntax", "operation",
  "canonical_binding", "oracle_arithmetic", "committed", "exact_artifact"])
  assert.equal(outcome[key], 1, `semantic mechanics failed ${key}`);
assert.equal(outcome.rejected_state_mutations, 0);
for (const file of [`${prefix}.q32`, `${prefix}.litqhead`, tsv, json])
  fs.rmSync(file);

const out = `/tmp/zero-q33-unauthorized-${process.pid}`;
const rejected = spawnSync("node", ["scripts/run_zero4_q33_semantic.mjs",
  "--authorization", `${ROOT}/budget-template.json`, "--out", out],
  { encoding: "utf8" });
assert.notEqual(rejected.status, 0);
assert.equal(fs.existsSync(out), false);
console.log("Q3.3 semantic-routing implementation contract passed");

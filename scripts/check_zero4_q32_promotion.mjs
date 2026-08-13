#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { validateContract } from "./run_zero4_q32_promotion.mjs";

const ROOT = "benchmarks/zero4-q32-promotion-v1";
validateContract(JSON.parse(fs.readFileSync(`${ROOT}/contract.json`, "utf8")));
const budget = JSON.parse(fs.readFileSync(`${ROOT}/budget-template.json`, "utf8"));
assert.equal(budget.schema, "zero.q32_quantity_promotion_budget.v1");
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_promotion_records, 0);
const prereg = fs.readFileSync(`${ROOT}/PREREGISTRATION.md`, "utf8");
for (const phrase of ["499/500", "exactly once", "100 examples",
  "zero training updates", "Language evaluation"])
  assert(prereg.includes(phrase), `promotion preregistration lacks ${phrase}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q32-promotion-(?:run|eval):/m.test(makefile));
for (const script of ["scripts/materialize_q32_promotion_budget.mjs",
  "scripts/run_zero4_q32_promotion.mjs"]) {
  const result = spawnSync("node", [script, "--self-test"],
    { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
const out = `/tmp/zero-q32-promotion-unauthorized-${process.pid}`;
const rejected = spawnSync("node", ["scripts/run_zero4_q32_promotion.mjs",
  "--authorization", `${ROOT}/budget-template.json`, "--out", out],
  { encoding: "utf8" });
assert.notEqual(rejected.status, 0);
assert.equal(fs.existsSync(out), false);
console.log("Q3.2 quantity promotion implementation contract passed");

#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { validateContract } from "./run_zero4_q32_public.mjs";

const ROOT = "benchmarks/zero4-q32-public-v1";
const contract = JSON.parse(fs.readFileSync(`${ROOT}/contract.json`, "utf8"));
validateContract(contract);
const budget = JSON.parse(fs.readFileSync(`${ROOT}/budget-template.json`, "utf8"));
assert.equal(budget.schema, "zero.q32_public_quantity_budget.v1");
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_public_records, 0);
assert.equal(budget.authorization.maximum_compute_usd, 0);
const prereg = fs.readFileSync(`${ROOT}/PREREGISTRATION.md`, "utf8");
for (const phrase of ["500-record", "exactly balanced", "exactly once",
  "zero training updates", "promotion sidecar remains sealed"])
  assert(prereg.includes(phrase), `preregistration lacks ${phrase}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q32-public-(?:run|eval):/m.test(makefile),
  "Makefile exposes unauthorized public execution");
for (const [script, message] of [
  ["scripts/materialize_q32_public_budget.mjs",
    "Q3.2 public-gate budget materializer self-test passed"],
  ["scripts/run_zero4_q32_public.mjs",
    "Q3.2 public quantity decision self-test passed"],
]) {
  const result = spawnSync("node", [script, "--self-test"],
    { encoding: "utf8" });
  assert.equal(result.status, 0); assert(result.stdout.includes(message));
}
const out = `/tmp/zero-q32-public-unauthorized-${process.pid}`;
const rejected = spawnSync("node", ["scripts/run_zero4_q32_public.mjs",
  "--authorization", `${ROOT}/budget-template.json`, "--out", out],
  { encoding: "utf8" });
assert.notEqual(rejected.status, 0);
assert.equal(fs.existsSync(out), false,
  "unauthorized public runner created output");
console.log("Q3.2 public quantity implementation contract passed");

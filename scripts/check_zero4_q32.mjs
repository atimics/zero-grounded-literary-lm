#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q32-v1/contract.json";
const BUDGET = "benchmarks/zero4-q32-v1/pilot-budget.json";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
}
function rejected(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
}

const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
assert.equal(contract.schema,
  "zero.zero4_q32_deployment_exact_head_contract.v1");
assert.equal(contract.status, "implementation_staged_run_not_authorized");
assert.equal(contract.training_allowed, false);
assert.equal(contract.architecture.base_parameters, 4852992);
assert.equal(contract.architecture.base_trainable_parameters, 0);
assert.equal(contract.architecture.feature_dimension, 1536);
assert.equal(contract.architecture.head_parameters, 7685);
assert.equal(contract.pilot.feature_records, 9500);
assert.equal(contract.pilot.training_pool_records, 9000);
assert.equal(contract.pilot.private_holdout_records, 500);
assert.equal(contract.pilot.maximum_optimizer_updates, 100);
assert.equal(contract.selection.packaged_runtime_overall_minimum, 0.99);
assert.equal(contract.selection.packaged_runtime_per_class_minimum, 0.98);
for (const binding of [
  ...Object.values(contract.lineage), ...Object.values(contract.inputs),
]) assert.equal(sha256(binding.path), binding.sha256,
  `${binding.path} binding drifted`);

const budget = JSON.parse(fs.readFileSync(BUDGET, "utf8"));
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_compute_usd, 0);

const pilot = fs.readFileSync("runtime_operation_head_pilot.c", "utf8");
for (const phrase of ["Q32_TRAIN_RECORDS 9000", "Q32_HOLDOUT_RECORDS 500",
  "Q32_FEATURE_RECORDS", "Q32_MAXIMUM_UPDATES 100",
  "Q32_LEARNING_RATE 0.001f", "Q32_WORKERS 8",
  "deployment-exact-quantized-streaming", "record < Q32_FEATURE_RECORDS"])
  assert(pilot.includes(phrase), `runtime pilot lacks ${phrase}`);
for (const forbidden of ["--seed", "--resume", "--runtime-source",
  "--quantity", "--public", "--language", "--promotion", "--deploy"])
  assert(!pilot.includes(`strcmp(argv[index], \"${forbidden}\")`),
    `runtime pilot exposes forbidden override ${forbidden}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q32-(?:train|run):/m.test(makefile),
  "Makefile exposes unauthorized Q3.2 execution target");

run("node", ["scripts/materialize_q32_pilot_budget.mjs", "--self-test"]);
run("node", ["scripts/run_zero4_q32_pilot.mjs", "--self-test"]);
run("./runtime_operation_head_pilot", ["--self-test"]);
const prefix = `/tmp/zero-q32-artifact-${process.pid}`;
run("./runtime_operation_head_pilot", ["--self-test-artifact", prefix]);
run("./package_runtime_operation_head",
  ["docs/model.litq8", `${prefix}.q32`, `${prefix}.litqhead`]);
const base = spawnSync("./base_probability_infer",
  ["docs/model.litq8", "--chat", "D", "hello"], { encoding: "utf8" });
const routed = spawnSync("./operation_head_infer",
  [`${prefix}.litqhead`, "--chat", "D", "hello"], { encoding: "utf8" });
assert.equal(base.status, 0); assert.equal(routed.status, 0);
assert.equal(base.stdout, routed.stdout,
  "Q3.2 package changed non-Q probabilities");
fs.rmSync(`${prefix}.q32`); fs.rmSync(`${prefix}.litqhead`);
const out = `/tmp/zero-q32-unauthorized-${process.pid}`;
rejected("node", ["scripts/run_zero4_q32_pilot.mjs", "--authorization",
  BUDGET, "--out", out, "--mechanics", "./runtime_operation_head_pilot"]);
assert.equal(fs.existsSync(out), false,
  "unauthorized Q3.2 runner created output");
console.log("Q3.2 deployment-exact head implementation contract passed");

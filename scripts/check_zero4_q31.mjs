#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q31-v1/contract.json";
const BUDGET = "benchmarks/zero4-q31-v1/pilot-budget.json";
const PREREG = "benchmarks/zero4-q31-v1/PREREGISTRATION.md";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
  return result.stdout;
}
function rejected(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
}

const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
assert.equal(contract.schema,
  "zero.zero4_q31_routed_operation_head_contract.v1");
assert.equal(contract.status, "implementation_staged_run_not_authorized");
assert.equal(contract.training_allowed, false);
assert.equal(contract.architecture.base_parameters, 4852992);
assert.equal(contract.architecture.base_trainable_parameters, 0);
assert.equal(contract.architecture.feature_dimension, 1536);
assert.equal(contract.architecture.head_parameters, 7685);
assert.equal(contract.architecture.classes.length, 5);
assert(Math.abs(contract.architecture.head_fraction_of_base -
  7685 / 4852992) < 1e-15);
assert.equal(contract.pilot.training_pool_records, 9000);
assert.equal(contract.pilot.holdout_records, 500);
assert.equal(contract.pilot.holdout_records_per_class, 100);
assert.equal(contract.pilot.maximum_optimizer_updates, 100);
assert.deepEqual(contract.pilot.measurement_updates, [0, 25, 50, 100]);
assert.equal(contract.pilot.overall_accuracy_minimum, 0.99);
assert.equal(contract.pilot.per_class_accuracy_minimum, 0.98);
assert.equal(contract.pilot.public_quantity_authorized, false);
assert.equal(contract.pilot.language_gate_authorized, false);
assert.equal(contract.pilot.promotion_authorized, false);
for (const binding of [
  ...Object.values(contract.lineage), ...Object.values(contract.inputs),
]) assert.equal(sha256(binding.path), binding.sha256,
  `${binding.path} binding drifted`);

const budget = JSON.parse(fs.readFileSync(BUDGET, "utf8"));
assert.equal(budget.schema,
  "zero.q31_routed_operation_head_pilot_budget.v1");
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_compute_usd, 0);

const tasks = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const records = fs.readFileSync(contract.inputs.quantity_records.path, "utf8")
  .trim().split("\n").map(JSON.parse);
assert.equal(records.length, 10500);
for (let index = 0; index < 9500; ++index) {
  assert.equal(records[index].split, "train");
  assert.equal(records[index].task, tasks[index % tasks.length]);
  assert.equal(records[index].model_request,
    `quantity.${tasks[index % tasks.length]}`);
}
const holdout = records.slice(9000, 9500);
assert.deepEqual(tasks.map((task) =>
  holdout.filter((record) => record.task === task).length),
  [100, 100, 100, 100, 100]);

const q27 = JSON.parse(fs.readFileSync("benchmarks/zero4-q27-v1/contract.json",
  "utf8"));
assert.equal(sha256("literary_lm.c"),
  q27.mechanics_gate.trainer_source_sha256,
  "Q3.1 changed the frozen legacy trainer");
const pilot = fs.readFileSync("operation_head_pilot.c", "utf8");
for (const phrase of ["Q31_CLASSES 5", "Q31_TRAIN_RECORDS 9000",
  "Q31_HOLDOUT_RECORDS 500", "Q31_MAXIMUM_UPDATES 100",
  "Q31_LEARNING_RATE 0.001f", "Q31_OVERALL_MINIMUM 0.99",
  "Q31_CLASS_MINIMUM 0.98", "Q3.1 changed frozen ZERO.3 state"])
  assert(pilot.includes(phrase), `pilot lacks ${phrase}`);
for (const forbidden of ["--seed", "--resume", "--init", "--classes",
  "--public", "--language", "--promotion"])
  assert(!pilot.includes(`strcmp(argv[index], \"${forbidden}\")`),
    `pilot exposes forbidden override ${forbidden}`);
const inference = fs.readFileSync("operation_head_infer.c", "utf8");
for (const phrase of ["if (!q31_active) return q31_base_lm_feed(token)",
  "q31_template_token", "q31_posterior", "q31_active_classes",
  "numerator / denominator"])
  assert(inference.includes(phrase), `runtime lacks ${phrase}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q31-(?:train|run):/m.test(makefile),
  "Makefile exposes an unauthorized Q3.1 execution target");
const prereg = fs.readFileSync(PREREG, "utf8");
for (const phrase of ["7,685", "0.158356%", "exactly 100 per class",
  "pilot run not authorized", "Seeds 1 and 3 remain sealed"])
  assert(prereg.includes(phrase), `preregistration lacks ${phrase}`);

run("node", ["scripts/materialize_q31_pilot_budget.mjs", "--self-test"]);
run("node", ["scripts/run_zero4_q31_pilot.mjs", "--self-test"]);
run("./operation_head_pilot", ["--self-test"]);
const prefix = `/tmp/zero-q31-artifact-${process.pid}`;
const head0 = `${prefix}-head0.q31`;
const head1 = `${prefix}-head1.q31`;
const model0 = `${prefix}-head0.litqhead`;
const model1 = `${prefix}-head1.litqhead`;
run("./operation_head_pilot", ["--self-test-artifacts", prefix]);
run("./package_operation_head", ["docs/model.litq8", head0, model0]);
run("./package_operation_head", ["docs/model.litq8", head1, model1]);
const baseReply = spawnSync("./base_probability_infer",
  ["docs/model.litq8", "--chat", "D", "hello"], { encoding: "utf8" });
const headReply = spawnSync("./operation_head_infer",
  [model1, "--chat", "D", "hello"], { encoding: "utf8" });
assert.equal(baseReply.status, 0); assert.equal(headReply.status, 0);
assert.equal(headReply.stdout, baseReply.stdout,
  "serialized head changed the non-Q inference path");
const qBefore = spawnSync("./operation_head_infer",
  [model0, "--chat", "Q", "add 1 2"], { encoding: "utf8" });
const qAfter = spawnSync("./operation_head_infer",
  [model1, "--chat", "Q", "add 1 2"], { encoding: "utf8" });
assert.equal(qBefore.status, 0); assert.equal(qAfter.status, 0);
assert.notEqual(qAfter.stdout, qBefore.stdout,
  "trained head did not affect the Q route");
const privateTsv = `${prefix}-private.tsv`;
const privateJson = `${prefix}-private.json`;
const privateRecord = records[3];
fs.writeFileSync(privateTsv,
  "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary\n" +
  [privateRecord.id, privateRecord.domain, privateRecord.previous_summary,
    privateRecord.input, privateRecord.model_request, privateRecord.request,
    privateRecord.artifact, privateRecord.summary].join("\t") + "\n");
run("./operation_head_request_eval", [model1, privateTsv, "--json",
  privateJson, "--limit", "1", "--jobs", "1"]);
const privateResult = JSON.parse(fs.readFileSync(privateJson, "utf8"));
for (const key of ["cases", "closed", "syntax", "operation", "arguments",
  "exact_request", "oracle_arithmetic", "committed", "exact_artifact"])
  assert.equal(privateResult.quantity[key], 1,
    `private renderer mechanics failed ${key}`);
assert.equal(privateResult.quantity.rejected_state_mutations, 0);
for (const file of [head0, head1, model0, model1, privateTsv, privateJson])
  fs.rmSync(file);
const out = `/tmp/zero-q31-unauthorized-${process.pid}`;
rejected("node", ["scripts/run_zero4_q31_pilot.mjs", "--authorization",
  BUDGET, "--out", out, "--mechanics", "./operation_head_pilot"]);
assert.equal(fs.existsSync(out), false,
  "unauthorized Q3.1 runner created output");
console.log("Q3.1 routed operation-head implementation contract passed");

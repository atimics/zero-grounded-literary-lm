#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q30-v1/contract.json";
const BUDGET = "benchmarks/zero4-q30-v1/pilot-budget.json";
const PREREG = "benchmarks/zero4-q30-v1/PREREGISTRATION.md";

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
  "zero.zero4_q30_routed_quantity_adapter_contract.v1");
assert.equal(contract.status, "implementation_staged_run_not_authorized");
assert.equal(contract.training_allowed, false);
assert.equal(contract.architecture.base_parameters, 4852992);
assert.equal(contract.architecture.base_trainable_parameters, 0);
assert.equal(contract.architecture.adapter_rank, 4);
assert.deepEqual(contract.architecture.adapted_matrices_per_layer,
  ["w1", "w2"]);
assert.equal(contract.architecture.adapter_parameters, 62976);
assert(Math.abs(contract.architecture.adapter_fraction_of_base -
  62976 / 4852992) < 1e-15);
assert.equal(contract.architecture.non_q_execution,
  "skip all adapter matrix operations");
assert.equal(contract.pilot.authorized, false);
assert.equal(contract.pilot.maximum_optimizer_updates, 200);
assert.deepEqual(contract.pilot.measurement_updates, [0, 50, 100, 150, 200]);
assert.equal(contract.pilot.quantity_training_loss_relative_improvement_minimum,
  0.8);
assert.equal(contract.pilot.base_state_digest_must_remain_exact, true);
assert.equal(contract.pilot.non_q_replay_loss_must_be_bit_identical, true);
for (const binding of [
  ...Object.values(contract.lineage), contract.inputs.tokenizer,
  contract.inputs.quantity, ...contract.inputs.replay,
]) assert.equal(sha256(binding.path), binding.sha256,
  `${binding.path} binding drifted`);

const budget = JSON.parse(fs.readFileSync(BUDGET, "utf8"));
assert.equal(budget.schema,
  "zero.q30_routed_quantity_adapter_pilot_budget.v1");
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_quantity_compute_usd, 0);
assert.equal(budget.authorization.language_gate_authorized, false);
assert.equal(budget.authorization.promotion_authorized, false);

const q27 = JSON.parse(fs.readFileSync("benchmarks/zero4-q27-v1/contract.json",
  "utf8"));
assert.equal(sha256("literary_lm.c"),
  q27.mechanics_gate.trainer_source_sha256,
  "Q3.0 changed the frozen legacy trainer");
const inference = fs.readFileSync("quantity_adapter_infer.c", "utf8");
for (const phrase of ["q30_style_pending", "token == 'Q'",
  "if (!q30_active) return q30_base_lm_feed(token)", "q30_add_low_rank"])
  assert(inference.includes(phrase), `adapter inference lacks ${phrase}`);
const pilot = fs.readFileSync("quantity_adapter_pilot.c", "utf8");
for (const phrase of ["Q30_RANK 4", "Q30_MAXIMUM_UPDATES 200",
  "Q30_QUANTITY_IMPROVEMENT_MINIMUM 0.8",
  "Q3.0 changed frozen ZERO.3 state",
  "Q3.0 non-Q replay path is not bit-identical",
  "B is exactly zero, so enabling the adapter is initially a no-op"])
  assert(pilot.includes(phrase), `pilot lacks ${phrase}`);
for (const forbidden of ["--seed", "--resume", "--init", "--adapter-rank",
  "--quantity", "--language", "--promotion"])
  assert(!pilot.includes(`strcmp(argv[index], \"${forbidden}\")`),
    `pilot exposes forbidden override ${forbidden}`);
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q30-(?:train|run):/m.test(makefile),
  "Makefile exposes an unauthorized Q3.0 execution target");
const prereg = fs.readFileSync(PREREG, "utf8");
for (const phrase of ["62,976", "1.297674%", "bit-identical",
  "pilot run not authorized", "Seeds 1 and 3 remain sealed"])
  assert(prereg.includes(phrase), `preregistration lacks ${phrase}`);

run("node", ["scripts/materialize_q30_pilot_budget.mjs", "--self-test"]);
run("node", ["scripts/run_zero4_q30_pilot.mjs", "--self-test"]);
run("./quantity_adapter_pilot", ["--self-test"]);
const artifactPrefix = `/tmp/zero-q30-artifact-${process.pid}`;
const baseCheckpoint = `${artifactPrefix}-base.ckpt`;
const adapter0Checkpoint = `${artifactPrefix}-adapter0.q30`;
const adapterCheckpoint = `${artifactPrefix}-adapter.q30`;
const baseModel = `${artifactPrefix}-base.litq8`;
const adapter0Model = `${artifactPrefix}-adapter0.litqlr`;
const adapterModel = `${artifactPrefix}-adapter.litqlr`;
run("./quantity_adapter_pilot", ["--self-test-artifacts", artifactPrefix]);
run("./export_literary", [baseCheckpoint, baseModel]);
run("./package_quantity_adapter", [baseModel, adapter0Checkpoint,
  adapter0Model]);
run("./package_quantity_adapter", [baseModel, adapterCheckpoint,
  adapterModel]);
const baseReply = spawnSync("./base_probability_infer",
  [baseModel, "--chat", "D", "hello"], { encoding: "utf8" });
const adapterReply = spawnSync("./quantity_adapter_infer",
  [adapterModel, "--chat", "D", "hello"], { encoding: "utf8" });
assert.equal(baseReply.status, 0);
assert.equal(adapterReply.status, 0);
assert.equal(adapterReply.stdout, baseReply.stdout,
  "serialized adapter changed the non-Q inference path");
const qBefore = spawnSync("./quantity_adapter_infer",
  [adapter0Model, "--chat", "Q", "hello"], { encoding: "utf8" });
const qAfter = spawnSync("./quantity_adapter_infer",
  [adapterModel, "--chat", "Q", "hello"], { encoding: "utf8" });
assert.equal(qBefore.status, 0);
assert.equal(qAfter.status, 0);
assert.notEqual(qAfter.stdout, qBefore.stdout,
  "trained serialized adapter did not affect the Q path");
for (const file of [baseCheckpoint, adapter0Checkpoint, adapterCheckpoint,
  baseModel, adapter0Model, adapterModel]) fs.rmSync(file);
const out = `/tmp/zero-q30-unauthorized-${process.pid}`;
rejected("node", ["scripts/run_zero4_q30_pilot.mjs", "--authorization",
  BUDGET, "--out", out, "--mechanics", "./quantity_adapter_pilot"]);
assert.equal(fs.existsSync(out), false,
  "unauthorized Q3.0 runner created output");
console.log("Q3.0 routed quantity-adapter implementation contract passed");

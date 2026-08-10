#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const ROOT = "benchmarks/zero4-q29-v1/results";
const MANIFEST = `${ROOT}/manifest.json`;

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function close(actual, expected, tolerance = 1e-12) {
  assert(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`);
}

const manifest = readJson(MANIFEST);
assert.equal(manifest.schema, "zero.zero4_q29_pilot_manifest.v1");
assert.equal(manifest.status,
  "completed_candidate_frozen_language_gate_not_authorized");
assert.equal(manifest.decision, "candidate-frozen");
assert.equal(manifest.source_commit,
  "c4f682c020e17d6231b6cab5542172f8ef6c1b76");
assert.equal(manifest.publication.issue, 85);
assert.equal(manifest.publication.language_gate_authorized, false);
assert.equal(manifest.publication.promotion_authorized, false);
for (const binding of Object.values(manifest.bindings)) {
  assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} result binding drifted`);
}
for (const output of [manifest.outputs.runtime_result,
  manifest.outputs.events, manifest.outputs.quantized_candidate]) {
  assert.equal(sha256(output.path), output.sha256,
    `${output.path} result output drifted`);
}

const budget = readJson(manifest.bindings.runtime_budget.path);
assert.equal(budget.status, "run_authorized");
assert.equal(budget.authorization.authorized, true);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.approval_id,
  "q29-user-do-it-c4f682c-one-shot");
assert.equal(budget.authorization.source_commit, manifest.source_commit);
assert.equal(budget.authorization.maximum_optimizer_updates, 100);
assert.equal(budget.authorization.maximum_quantity_compute_usd, 0.25);
assert.equal(budget.authorization.language_gate_authorized, false);
assert.equal(budget.authorization.promotion_authorized, false);

const consumption = readJson(
  manifest.bindings.authorization_consumption.path);
assert.equal(consumption.schema,
  "zero.q29_pilot_authorization_consumption.v1");
assert.equal(consumption.authorization_sha256,
  manifest.bindings.runtime_budget.sha256);
assert.equal(consumption.source_commit, manifest.source_commit);

const result = readJson(manifest.outputs.runtime_result.path);
assert.equal(result.schema, "zero.zero4_q29_pilot_result.v1");
assert.equal(result.source_commit, manifest.source_commit);
assert.equal(result.authorization_sha256,
  manifest.bindings.runtime_budget.sha256);
assert.equal(result.profile_sha256, manifest.bindings.profile.sha256);
assert.equal(result.seed, 2);
assert.equal(result.maximum_optimizer_updates, 100);
assert.deepEqual(result.measurement_updates, [0, 25, 50, 75, 100]);
assert.equal(result.updates_committed, 50);
assert.equal(result.stop_reason, "first-hit");
assert.equal(result.decision, "candidate-frozen");
assert.deepEqual(result.measurements.map(({ update }) => update), [0, 25, 50]);
assert.deepEqual(result.selection.candidates.map(({ reason }) => reason),
  ["continue", "first-hit"]);
assert.equal(result.selection.selected.update, 50);
close(result.selection.selected.quantity_improvement,
  manifest.measurements[2].quantity_improvement);
close(result.selection.selected.replay_regression,
  manifest.measurements[2].replay_regression);
assert(result.selection.selected.quantity_improvement >= 0.8);
assert(result.selection.selected.replay_regression <= 0.0075);
assert.equal(result.candidate.sha256,
  manifest.outputs.raw_checkpoint.sha256);
assert.equal(result.candidate.update, 50);
assert.equal(result.language_gate.eligible_for_separate_authorization, true);
assert.equal(result.language_gate.authorized, false);
assert.equal(result.language_gate.executed, false);
assert.equal(result.promotion.authorized, false);
assert.equal(result.promotion.executed, false);

const events = fs.readFileSync(manifest.outputs.events.path, "utf8").trim()
  .split("\n").map(JSON.parse);
assert(events.every(({ schema }) => schema ===
  "zero.zero4_q29_pilot_event.v1"));
assert.equal(events.filter(({ type }) => type === "start").length, 1);
const updates = events.filter(({ type }) => type === "update");
assert.equal(updates.length, 50);
assert.deepEqual(updates.map(({ update }) => update),
  Array.from({ length: 50 }, (_, index) => index + 1));
const eventMeasurements = events.filter(({ type }) => type === "measurement");
assert.deepEqual(eventMeasurements.map(({ update }) => update), [0, 25, 50]);
const stopChecks = events.filter(({ type }) => type === "stop-check");
assert.deepEqual(stopChecks.map(({ reason }) => reason),
  ["continue", "first-hit"]);
const complete = events.filter(({ type }) => type === "complete");
assert.equal(complete.length, 1);
assert.equal(complete[0].updates_committed, 50);
assert.equal(complete[0].stop_reason, "first-hit");
assert.equal(complete[0].candidate_checkpoint_available, true);
assert.equal(complete[0].language_gate_run, false);
assert.equal(complete[0].promotion_run, false);

const quantized = manifest.outputs.quantized_candidate;
assert.equal(fs.statSync(quantized.path).size, quantized.bytes);
assert.equal(quantized.update, 50);
assert.equal(fs.readFileSync(quantized.path).subarray(0, 8).toString("ascii"),
  "LITQ8V1\0");
assert.equal(sha256("export_literary.c"), manifest.conversion.tool_sha256);
assert.equal(manifest.conversion.deterministic_repeat_cmp, true);
assert.equal(manifest.language_gate.eligible, true);
assert.equal(manifest.language_gate.authorized, false);
assert.equal(manifest.language_gate.executed, false);
assert.equal(manifest.language_gate.maximum_candidates, 1);
assert.equal(sha256(manifest.language_gate.contract.path),
  manifest.language_gate.contract.sha256);
assert.equal(manifest.promotion.authorized, false);
assert.equal(manifest.promotion.executed, false);

const report = fs.readFileSync(`${ROOT}/PILOT-RESULT.md`, "utf8");
for (const phrase of ["candidate frozen", "81.0518%", "0.12325%",
  "no updates 51–100", "language gate eligible but not authorized",
  "Seeds 1 and 3 remain sealed"]) {
  assert(report.includes(phrase), `pilot result report lacks ${phrase}`);
}
console.log("Q2.9 seed-2 pilot result and frozen candidate passed");

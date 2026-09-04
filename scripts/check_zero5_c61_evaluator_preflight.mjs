#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0,
    `${program} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

// ── Self-test ──
assert.match(
  run("node", ["scripts/preflight_zero5_c61_evaluator.mjs", "--self-test"]),
  /evaluator preflight self-test passed/u);

// ── Trace mode: all fixture formats must scan without error ──
const trace = JSON.parse(
  run("node", ["scripts/preflight_zero5_c61_evaluator.mjs", "--trace"]));
assert.equal(trace.schema, "zero.c61_evaluator_preflight_trace.v1");
assert.equal(trace.fixtures_scanned, 4);
for (const result of trace.results) {
  assert(result.trace?.label, "trace result is missing a label");
}

// ── Contract-bound: the preflight must bind the C6.1 contract ──
const contractPath = "benchmarks/zero5-c61-shared-state-v1/contract.json";
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const preflightSource = fs.readFileSync(
  "scripts/preflight_zero5_c61_evaluator.mjs", "utf8");
assert(preflightSource.includes(
  contract.schema),
  "preflight does not bind the C6.1 contract schema");
assert(preflightSource.includes(
  "zero.c61_evaluator_preflight.v1"),
  "preflight does not emit its own schema");
assert(preflightSource.includes(
  "zero.c61_evaluator_preflight_trace.v1"),
  "preflight does not emit a trace schema");

// ── Parse rules: the preflight must implement the corrected
//    target_start == 0 condition (not the old unconditional reject) ──
assert(preflightSource.includes(
  "target_start == 0 with full context"),
  "preflight does not encode the corrected zero-start condition");
assert(!preflightSource.includes("target_start === 0\")"),
  "preflight uses an unconditional zero-start reject (old bug)");

// ── Coverage: the preflight must scan every evaluation binary format
//    that the evaluator reads ──
for (const format of ["scanCompletion", "scanSpanChoice", "scanPacked",
  "scanAuxEval", "scanAuxTrain"]) {
  assert(preflightSource.includes(format),
    `preflight does not implement ${format}`);
}

// ── Read-set coverage: every file the evaluator reads must appear ──
const evaluatorSource = fs.readFileSync(
  "scripts/evaluate_zero5_c61_shared_state_recovery.mjs", "utf8");
for (const filename of [
  "import.json",
  "validation.targets.z5aueval",
  "train.targets.z5aux",
  "c52.next-state.validation.completion-eval.bin",
  "c52.choice-a.validation.completion-eval.bin",
  "c52.choice-b.validation.completion-eval.bin",
  "validation.z5pack",
  "evidence-bundle.validation.z5pack",
  "cloze.validation.completion-eval.bin",
  "claim.validation.span-choice-eval.bin",
  "retrieval.validation.span-choice-eval.bin",
]) {
  assert(preflightSource.includes(filename),
    `preflight does not cover evaluator read-set file: ${filename}`);
}

// ── The preflight must not open sealed-test metrics ──
assert(preflightSource.includes("test_metrics_opened: false"),
  "preflight does not seal test metrics");

process.stdout.write(
  "ZERO.5 C6.1 evaluator preflight checks passed\n");

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_DECISION = "benchmarks/zero-eval-1/full-run-decision.json";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateDecision(record) {
  assert(record?.schema === "zero.external_eval_full_run_decision.v1",
    "decision schema drifted");
  assert(record.id === "zero-eval-1-full-run-decision", "decision id drifted");
  assert(record.status === "closed_do_not_run", "full-run decision reopened");
  assert(record.training_allowed === false, "decision permits training");
  for (const evidence of [record.screen_evidence, record.retired_proposal]) {
    assert(fs.existsSync(evidence.path), `missing evidence ${evidence.path}`);
    assert(sha256(evidence.path) === evidence.sha256,
      `evidence hash mismatch: ${evidence.path}`);
  }
  const screen = JSON.parse(fs.readFileSync(record.screen_evidence.path, "utf8"));
  const proposal = JSON.parse(fs.readFileSync(record.retired_proposal.path, "utf8"));
  assert(screen.status === "complete", "screen is incomplete");
  assert(screen.elapsed_instance_seconds === record.screen_evidence.elapsed_instance_seconds,
    "screen elapsed time drifted");
  assert(screen.estimated_compute_usd === record.screen_evidence.estimated_compute_usd,
    "screen cost drifted");
  assert(
    proposal.projection.max_instance_seconds ===
      record.retired_proposal.max_instance_seconds &&
      proposal.projection.max_compute_usd === record.retired_proposal.max_compute_usd,
    "retired proposal cap drifted",
  );
  const pairs = {
    blimp_raw_accuracy: [
      screen.models.zero3.tasks.blimp.metrics.raw_accuracy,
      screen.models.zero4.tasks.blimp.metrics.raw_accuracy,
    ],
    tinystories_bits_per_byte: [
      screen.models.zero3.tasks.tinystories.metrics.bits_per_byte,
      screen.models.zero4.tasks.tinystories.metrics.bits_per_byte,
    ],
    hellaswag_normalized_accuracy: [
      screen.models.zero3.tasks.hellaswag.metrics.normalized_accuracy,
      screen.models.zero4.tasks.hellaswag.metrics.normalized_accuracy,
    ],
    adapted_lambada_greedy_exact_accuracy: [
      screen.models.zero3.tasks.lambada.metrics.greedy_exact_accuracy,
      screen.models.zero4.tasks.lambada.metrics.greedy_exact_accuracy,
    ],
  };
  for (const [id, [zero3, zero4]] of Object.entries(pairs)) {
    const summary = record.screen_summary[id];
    assert(summary.zero3 === zero3 && summary.zero4 === zero4,
      `${id} evidence drifted`);
    assert(Math.abs(summary.delta - (zero4 - zero3)) < 1e-12,
      `${id} delta drifted`);
  }
  assert(
    record.decision.full_evaluation_authorized === false &&
      record.decision.full_evaluation_should_run === false &&
      record.decision.dispatch_or_implementation_allowed === false,
    "full run became executable",
  );
  assert(
    record.replacement.candidate_only === true &&
      record.replacement.authorized_for_execution === false,
    "replacement gate became authorized",
  );
  return true;
}

function selfTest() {
  const record = JSON.parse(fs.readFileSync(DEFAULT_DECISION, "utf8"));
  validateDecision(record);
  for (const [name, mutate] of [
    ["authorization", (copy) => {
      copy.decision.full_evaluation_authorized = true;
    }],
    ["screen metric", (copy) => {
      copy.screen_summary.blimp_raw_accuracy.zero4 += 0.01;
    }],
    ["replacement", (copy) => {
      copy.replacement.authorized_for_execution = true;
    }],
  ]) {
    const invalid = structuredClone(record);
    mutate(invalid);
    let rejected = false;
    try {
      validateDecision(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("ZERO-EVAL-1 full-run decision self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const decisionPath = process.argv[2] ?? DEFAULT_DECISION;
    validateDecision(JSON.parse(fs.readFileSync(decisionPath, "utf8")));
    console.log(`OK ZERO-EVAL-1 full-run decision: ${decisionPath}`);
  }
}

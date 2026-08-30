#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const proposalPath = "benchmarks/zero5-c43-v1/contract-proposal.json";
const reportPath = "benchmarks/zero5-c43-v1/BRAID-REPORT.md";
const specPath = "benchmarks/zero5-c43-v1/SPEC.md";
const proposal = JSON.parse(fs.readFileSync(proposalPath));
const c42Contract = JSON.parse(fs.readFileSync(proposal.c42_decision.contract));
const c42Result = JSON.parse(fs.readFileSync(proposal.c42_decision.result));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function inUnitInterval(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

assert.equal(proposal.schema, "zero.c43_experiment_proposal.v1");
assert.equal(proposal.experiment, "zero5-c43-v1");
assert.equal(proposal.status, "release-received-integration-ready");
assert.equal(proposal.authorized, false);
assert.equal(proposal.c42_decision.decision, "no-go");
assert.equal(proposal.c42_decision.decision_is_immutable, true);
assert.equal(sha256(proposal.c42_decision.result),
  proposal.c42_decision.result_sha256);
assert.equal(sha256(proposal.c42_decision.contract),
  proposal.c42_decision.contract_sha256);
assert.equal(c42Result.decision.eligible_for_promotion, false);
assert.equal(c42Result.decision.test_metrics_opened, false);

const c42Baseline = c42Result.validation.baseline;
const proposedBaseline = proposal.evaluation.baseline_metrics;
assert.deepEqual(proposedBaseline.choice_accuracy, {
  claim: c42Baseline.choice.claim.choice_accuracy,
  retrieval: c42Baseline.choice.retrieval.choice_accuracy,
});
assert.deepEqual(proposedBaseline.swap_consistency_accuracy, {
  claim: c42Baseline.choice.claim.swap_consistency_accuracy,
  retrieval: c42Baseline.choice.retrieval.swap_consistency_accuracy,
});
assert.deepEqual(proposedBaseline.pair_exact_accuracy, {
  claim: c42Baseline.choice.claim.pair_exact_accuracy,
  retrieval: c42Baseline.choice.retrieval.pair_exact_accuracy,
});
assert.equal(proposedBaseline.cloze_exact_accuracy,
  c42Baseline.cloze.teacher_forced_exact_accuracy);

const oldSwapMinimum = c42Contract.gates.swap_improvement_minimum;
assert(c42Baseline.choice.claim.swap_consistency_accuracy + oldSwapMinimum > 1,
  "the report must remain bound to the demonstrated C4.2 gate defect");
assert.equal("swap_improvement_minimum" in proposal.gates, false,
  "C4.3 must not restore the impossible shared swap-improvement gate");

for (const check of proposal.gate_sanity.bounded_improvement_checks) {
  assert(inUnitInterval(check.baseline), `${check.metric} baseline is invalid`);
  assert(check.minimum_improvement >= 0,
    `${check.metric} improvement is negative`);
  assert(inUnitInterval(check.upper_bound),
    `${check.metric} upper bound is invalid`);
  assert(check.baseline + check.minimum_improvement <= check.upper_bound,
    `${check.metric} improvement exceeds available headroom`);
}

for (const task of ["claim", "retrieval"]) {
  const floor = proposal.gates.swap_consistency_minimum[task];
  const maxRegression = proposal.gates.swap_regression_maximum[task];
  const baseline = proposedBaseline.swap_consistency_accuracy[task];
  assert(inUnitInterval(floor), `${task} swap floor is invalid`);
  assert(inUnitInterval(maxRegression),
    `${task} swap regression limit is invalid`);
  const effectiveThreshold = Math.max(floor, baseline - maxRegression);
  assert(inUnitInterval(effectiveThreshold),
    `${task} swap threshold is impossible`);
}

assert.equal(proposal.training_proposal.primary_compute_token_exposures,
  c42Contract.verified_import.primary_packs.compute_token_exposures);
assert.equal(proposal.training_proposal.compute_token_exposures_maximum,
  proposal.training_proposal.primary_compute_token_exposures);
assert.equal(proposal.training_proposal.paid_compute_authorized, false);
assert.equal(proposal.training_proposal.cost_ceiling_usd, null);
assert.equal(proposal.braid_request.status, "received-and-verified");
assert.equal(proposal.braid_request.pull_request, 15);
assert.match(proposal.braid_request.source_commit, /^[0-9a-f]{40}$/u);
for (const field of ["manifest_sha256", "membership_digest",
  "pack_plan_sha256"]) {
  assert.match(proposal.braid_request[field], /^[0-9a-f]{64}$/u);
}
assert.equal(proposal.braid_request.cloze.answer_target_tokens_minimum,
  3 * c42Contract.verified_import.primary_packs.answer_targets_by_task.cloze);
assert(proposal.braid_request.cloze.answer_target_share_minimum >
  c42Contract.verified_import.primary_packs.answer_targets_by_task.cloze /
  Object.values(c42Contract.verified_import.primary_packs.answer_targets_by_task)
    .reduce((sum, value) => sum + value, 0));
assert.equal(proposal.evaluation.reuse_c42_validation_artifacts, true);
assert.equal(proposal.test.sha256, c42Contract.test.sha256);
assert.equal(proposal.gates.test_metrics_opened, false);
assert.match(proposal.test.policy,
  /content absent, not parsed, not tokenized, not packed, and not scored/u);

for (const file of [reportPath, specPath]) {
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /C4\.2/u);
  assert.match(text, /C4\.3/u);
  assert.match(text, /sealed test/u);
}

process.stdout.write("ZERO.5 C4.3 report and proposal checks passed\n");

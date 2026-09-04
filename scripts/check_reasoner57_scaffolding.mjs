#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const contractPath =
  "benchmarks/reasoner57-active-evidence-development-v1/contract.json";
const contract = JSON.parse(readFileSync(contractPath, "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

assert.equal(contract.schema,
  "zero.reasoner57_active_evidence_development_contract.v4");
assert.equal(contract.status, "gated-development-scaffolding");
assert.equal(contract.prerequisite.base_commit,
  "c9e635bebd82e89aeb468201098baa3b2e9e3f2d");
assert.equal(contract.prerequisite.state,
  "blocked-reasoner56-channel-readiness-gate");

for (const receipt of [
  contract.prerequisite.r56_contract,
  contract.prerequisite.r56_artifact,
  contract.prerequisite.r56_family_manifest,
  contract.prerequisite.r56_assessment,
]) {
  assert.equal(sha256(receipt.path), receipt.sha256,
    `Reasoner 5.6 receipt changed: ${receipt.path}`);
}

const r56Contract = JSON.parse(readFileSync(
  contract.prerequisite.r56_contract.path, "utf8"));
assert.equal(r56Contract.schema,
  contract.prerequisite.r56_contract.schema);
assert.equal(r56Contract.shared_harness.commit,
  contract.shared_harness.commit);
assert.equal(r56Contract.shared_harness.library_sha256,
  contract.shared_harness.library_sha256);
assert.equal(r56Contract.shared_harness.proposal_record_binding, true);
assert.equal(r56Contract.shared_harness.proposal_work_charge_floor, true);

const assessment = JSON.parse(readFileSync(
  contract.prerequisite.r56_assessment.path, "utf8"));
const readiness = assessment.channel_readiness;
assert.equal(assessment.schema,
  contract.prerequisite.r56_assessment.schema);
assert.equal(readiness.schema,
  contract.prerequisite.r56_assessment.channel_readiness_schema);
assert.equal(readiness.assessment_sha256,
  contract.prerequisite.r56_assessment.channel_readiness_assessment_sha256);
assert.equal(readiness.status, "development-no-go");
assert.equal(readiness.metrics.full_mean_log_loss,
  contract.prerequisite.r56_assessment.full_mean_log_loss);
assert.ok(readiness.metrics.full_mean_log_loss > 0);
assert.equal(readiness.metrics.full_log_loss_replay.method,
  "stable-q20-score-logsumexp-minus-truth-score");
assert.equal(readiness.metrics.full_log_loss_replay.replay_sha256,
  contract.prerequisite.r56_assessment.full_log_loss_replay_sha256);
assert.deepEqual(readiness.failures,
  ["candidate_set_size_ratio_at_matched_coverage",
    "development_and_sealed_interface_and_proxy_audits_clean"]);
assert.equal(readiness.metrics.candidate_set.coverage_families, 99);
assert.equal(readiness.metrics.candidate_set.covered_families, 99);
assert.equal(readiness.metrics.candidate_set.one_sided_95_wilson_lower,
  contract.prerequisite.family_coverage.one_sided_95_wilson_lower);
assert.ok(readiness.metrics.candidate_set.one_sided_95_wilson_lower >=
  contract.prerequisite.family_coverage.required_lower);
assert.equal(readiness.metrics.candidate_set.conservative_threshold,
  contract.prerequisite.candidate_set_utility.threshold);
assert.equal(readiness.metrics.candidate_set.full_mean_size,
  contract.prerequisite.candidate_set_utility.full_mean_size);
assert.equal(readiness.metrics.candidate_set.program_prior_only_mean_size,
  contract.prerequisite.candidate_set_utility.program_prior_only_mean_size);
assert.equal(readiness.metrics.candidate_set.size_ratio,
  contract.prerequisite.candidate_set_utility.size_ratio);
assert.ok(readiness.metrics.candidate_set.size_ratio >
  contract.prerequisite.candidate_set_utility.required_maximum_ratio);
assert.equal(contract.prerequisite.candidate_set_utility.passed, false);
const r56Manifest = JSON.parse(readFileSync(
  contract.prerequisite.r56_family_manifest.path, "utf8"));
assert.equal(r56Manifest.calibration_coverage_receipt.schema,
  "zero.reasoner56_calibration_coverage_receipt.v2");
assert.equal(r56Manifest.calibration_coverage_receipt.artifact_sha256,
  contract.prerequisite.r56_artifact.sha256);
assert.equal(r56Manifest.calibration_coverage_receipt.candidate_set_rule,
  "exact-full-universe-at-threshold-one");
assert.ok(r56Manifest.calibration_coverage_receipt.families.every(family =>
  family.all_draws_covered && family.draws.every(draw =>
    draw.candidate_set_size === 427 && draw.candidate_set_contains_truth)));
assert.equal(readiness.metrics.interface_and_proxy_audits.development.passed,
  true);
assert.equal(readiness.metrics.interface_and_proxy_audits.sealed.passed,
  false);
assert.equal(readiness.metrics.interface_and_proxy_audits.sealed.status,
  "pending-preregistration");

assert.equal(contract.analytic_controls.multiclass_noisy_gbs,
  "1-max_y q(y|a)");
assert.equal(contract.analytic_controls.posterior_l2_ec2_edge_cut,
  "sum_y q(y|a) sum_h (p(h)L(h,y|a)/q(y|a))^2-sum_h p(h)^2");
assert.equal(contract.primary.outcomes, 18);
assert.equal(contract.primary.missing_outcome, 17);
assert.equal(contract.shared_harness.commit,
  "db3e85b5808252bbd174e95e8b17ee804594ae2f");
assert.equal(contract.shared_harness.library,
  "scripts/lib/reasoner5_harness.mjs");
assert.equal(sha256(contract.shared_harness.library),
  contract.shared_harness.library_sha256);
assert.equal(contract.shared_harness.proposal_record_binding, true);
assert.equal(contract.shared_harness.proposal_work_charge_floor, true);
assert.equal(contract.shared_harness.bootstrap_receipt_schema, "v2");
assert.equal(contract.shared_harness.confidence_interval_method,
  "ordinary-percentile-bootstrap");
assert.equal(contract.shared_harness.p_value_method,
  "recentered-null-bootstrap");
assert.equal(contract.development_outputs, null);
assert.equal(contract.scientific_decision, null);
assert.equal(contract.execution.authorized, false);
assert.equal(contract.execution.sealed_seeds_present, false);
assert.equal(contract.execution.development_fixture_generation_open, false);
assert.equal(contract.execution.scientific_executions, 0);
assert.equal(contract.prerequisite.required_passing_assessment_sha256, null);
assert.equal(existsSync(
  "benchmarks/reasoner57-active-evidence-development-v1/development"),
false);

for (const [path, expected] of Object.entries(contract.protected_sources))
  assert.equal(sha256(path), expected,
    `${path} changed while Reasoner 5.7 was built`);

for (const path of contract.implementation.files) readFileSync(path);

console.log("Reasoner 5.7 gated scaffolding contract passed");

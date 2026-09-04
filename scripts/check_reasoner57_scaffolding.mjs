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
  "zero.reasoner57_active_evidence_development_contract.v1");
assert.equal(contract.status, "gated-development-scaffolding");
assert.equal(contract.prerequisite.base_commit,
  "1606515ba363a74d62d9659dbf5189434abd84fa");
assert.equal(contract.prerequisite.state,
  "pending-reasoner56-sealed-interface-proxy-audit");

for (const receipt of [
  contract.prerequisite.r56_artifact,
  contract.prerequisite.r56_family_manifest,
  contract.prerequisite.r56_assessment,
]) {
  assert.equal(sha256(receipt.path), receipt.sha256,
    `Reasoner 5.6 receipt changed: ${receipt.path}`);
}

const assessment = JSON.parse(readFileSync(
  contract.prerequisite.r56_assessment.path, "utf8"));
const readiness = assessment.channel_readiness;
assert.equal(readiness.assessment_sha256,
  contract.prerequisite.r56_assessment.channel_readiness_assessment_sha256);
assert.equal(readiness.status, "development-no-go");
assert.deepEqual(readiness.failures,
  ["development_and_sealed_interface_and_proxy_audits_clean"]);
assert.equal(readiness.metrics.candidate_set.coverage_families, 99);
assert.equal(readiness.metrics.candidate_set.covered_families, 99);
assert.equal(readiness.metrics.candidate_set.one_sided_95_wilson_lower,
  contract.prerequisite.family_coverage.one_sided_95_wilson_lower);
assert.ok(readiness.metrics.candidate_set.one_sided_95_wilson_lower >=
  contract.prerequisite.family_coverage.required_lower);
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

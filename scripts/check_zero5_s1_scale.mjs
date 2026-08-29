// Verify the frozen S1 scale-control contract and authorization. Fails closed.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const contractPath = "benchmarks/zero5-s1-scale-v1/contract.json";
const specPath = "benchmarks/zero5-s1-scale-v1/SPEC.md";
const authorizationPath = "benchmarks/zero5-s1-scale-v1/authorization.json";
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const authorization = JSON.parse(fs.readFileSync(authorizationPath, "utf8"));
const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

assert.equal(contract.schema, "zero.s1_scale_contract.v1");
assert.equal(contract.experiment, "zero5-s1-scale-v1");
assert.equal(contract.status, "authorized-unrun-aws");
assert.equal(contract.authorized, true);
assert.equal(contract.model.parameters, 24323264);
assert.ok(Math.abs(contract.model.scale_factor - 5.0123) < 0.001);
assert.equal(contract.model.dim, 448);
assert.equal(contract.model.layers, 10);
assert.equal(contract.model.ff, 1792);
assert.equal(contract.stage_a.updates, 10425);
assert.equal(contract.stage_b.updates, 28707);
assert.equal(contract.stage_b.answer_weights.claim, 2.937013754);
assert.equal(contract.gates.retrieval_choice_accuracy_minimum, 0.55);
assert.equal(contract.gates.claim_choice_accuracy_minimum, 0.65);
assert.equal(contract.gates.swap_consistency_minimum, 0.90);
assert.equal(contract.gates.combined_nats_maximum, 2.26);
assert.equal(contract.gates.test_metrics_opened, false);
assert.equal(contract.execution.venue, "aws us-east-1 c6i.4xlarge on-demand");
assert.equal(contract.execution.maximum_instance_seconds, 43411);
assert.equal(contract.execution.maximum_ec2_usd, 8.2);
assert.equal(contract.execution.spot_instances, false);
assert.equal(contract.execution.automatic_termination, true);
assert.equal(contract.claim_boundary.capacity_control, true);
assert.equal(contract.claim_boundary.promotion_authorized, false);

for (const file of [contractPath, specPath, authorizationPath]) {
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("/Users/"), false, `${file} exposes a user path`);
  assert.equal(text.includes("/private/"), false, `${file} exposes a private path`);
}

assert.equal(sha256("zero5_c32_lm.c"), contract.implementation.trainer_sha256);
assert.equal(sha256("scripts/evaluate_zero5_c43.mjs"),
  contract.evaluation.evaluator_sha256);
assert.equal(sha256("scripts/run_zero5_s1_scale.mjs"),
  contract.implementation.runner_sha256);
assert.equal(sha256("benchmarks/zero5-c43-v1/contract.json"),
  contract.stage_b.contract_sha256);
assert.equal(sha256(contractPath), authorization.contract_sha256);
assert.equal(authorization.authorized, true);
assert.equal(authorization.authorization_id,
  contract.authorization.approval_id);
assert.equal(authorization.scope.venue, contract.execution.venue);
assert.equal(authorization.scope.maximum_execution_seconds,
  contract.execution.maximum_execution_seconds);
assert.equal(authorization.scope.paid_compute, true);
assert.match(authorization.approved_statement,
  /I authorize one ZERO\.5 S1 scale-control run on AWS/u);
assert.match(authorization.authorization_source, /scale control/u);

// The runner must accept the authorization and reach preflight.
const result = (() => {
  const { spawnSync } = require("node:child_process");
  return spawnSync("node", ["scripts/run_zero5_s1_scale.mjs",
    "--preflight-only"], { encoding: "utf8" });
})();
assert.equal(result.status, 0, result.stderr);
const preflight = JSON.parse(result.stdout);
assert.equal(preflight.parameters, 24323264);
assert.equal(preflight.test_metrics_opened, false);

process.stdout.write("ZERO.5 S1 scale-control checks passed\n");

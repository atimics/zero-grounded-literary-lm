#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const contractPath = process.argv[2] ??
  "benchmarks/zero4-q27-v1/contract.json";
const contract = readJson(contractPath);

assert(contract.schema === "zero.zero4_q27_contract.v1",
  "wrong Q2.7 contract schema");
assert(contract.id === "zero4-q27-v1", "wrong Q2.7 contract id");
assert(contract.status === "preregistered_not_authorized",
  "Q2.7 status is not closed");
assert(contract.training_allowed === false, "Q2.7 training is allowed");
assert(contract.independent_variable.includes("top-ffn"),
  "Q2.7 independent variable drifted");

const lineage = contract.lineage;
for (const [pathKey, hashKey] of [
  ["q26_contract_path", "q26_contract_sha256"],
  ["q26_family_result_path", "q26_family_result_sha256"],
  ["q26_attempt_log_path", "q26_attempt_log_sha256"],
  ["language_gate_path", "language_gate_sha256"],
]) {
  assert(sha256(lineage[pathKey]) === lineage[hashKey],
    `Q2.7 lineage drifted: ${lineage[pathKey]}`);
}
assert(lineage.current_model_sha256 ===
  "44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50",
  "current ZERO.4 artifact drifted");
assert(lineage.diagnosis.tinystories_relative_regression >
  lineage.diagnosis.language_gate_maximum_relative_regression,
  "Q2.7 no longer has the declared language-gate failure");

const scope = contract.trainable_scope;
assert(scope.cli === "--trainable-scope top-ffn",
  "top-FFN CLI changed");
assert(JSON.stringify(scope.trainable_parameter_groups) ===
  '["layer.5.norm2","layer.5.w1","layer.5.w2","final_norm"]',
  "top-FFN group boundary changed");
assert(scope.trainable_parameters === 2 * 256 * 1056 + 2 * 256,
  "top-FFN parameter count is wrong");
assert(scope.frozen_parameters + scope.trainable_parameters ===
  contract.student.parameters, "scope does not partition the model");
assert(Math.abs(scope.trainable_fraction -
  scope.trainable_parameters / contract.student.parameters) < 1e-15,
  "top-FFN fraction is wrong");
assert(scope.checkpoint_bound === true, "scope is not checkpoint-bound");

const inherited = contract.inherited_q26_design;
assert(inherited.cumulative_guard.mode === "cumulative-tangent",
  "Q2.6 guard mode changed");
assert(inherited.cumulative_guard.hard_relative_increase === 0.015 &&
  inherited.cumulative_guard.public_replay_ceiling === 0.02,
  "replay authority changed");
assert(JSON.stringify(inherited.cumulative_guard.trial_scales) ===
  "[1,0.5,0.25,0.125,0.0625,0.03125,0.015625,0.0078125]",
  "trial scales changed");
assert(Object.values(inherited.quantity_gates)
  .every((value) => typeof value === "number"),
  "quantity gate is not numeric");

assert(contract.language_gate.combination === "conjunctive",
  "language gate is not conjunctive");
assert(contract.language_gate.blimp_minimum_raw_accuracy === 0.522,
  "BLiMP gate changed");
assert(contract.language_gate.tinystories_maximum_bits_per_byte ===
  2.553139779957201, "TinyStories gate changed");
assert(contract.diagnostic_policy.seed === 2 &&
  JSON.stringify(contract.diagnostic_policy.replication_seeds_sealed) ===
    "[1,3]", "diagnostic/replication seed policy changed");

const authorization = contract.authorization;
assert(authorization.aws_only === true &&
  authorization.training_workflow_exists === true &&
  authorization.budget_exists === true &&
  authorization.proposed_max_optimizer_attempts === 1400 &&
  authorization.proposed_max_instance_seconds === 6190 &&
  authorization.proposed_max_compute_usd === 1.17 &&
  authorization.language_gate_included === false &&
  authorization.language_gate_requires_separate_candidate_bound_budget ===
    true &&
  authorization.maximum_optimizer_attempts === 0 &&
  authorization.maximum_instance_seconds === 0 &&
  authorization.maximum_compute_usd === 0 &&
  authorization.authorized === false,
  "Q2.7 compute firewall is open");
assert(sha256(contract.mechanics_gate.trainer_source) ===
  contract.mechanics_gate.trainer_source_sha256,
  "Q2.7 trainer implementation drifted");

console.log("Q2.7 isolation contract, lineage, and compute firewall passed");

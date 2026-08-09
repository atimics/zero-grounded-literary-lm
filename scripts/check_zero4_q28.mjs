#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q28-v1/contract.json";
const PREREG = "benchmarks/zero4-q28-v1/PREREGISTRATION.md";
const DECISION = "benchmarks/zero4-q28-v1/AUDIT-DECISION.json";
const BUDGET = "benchmarks/zero4-q28-v1/pilot-budget.json";
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} failed`);
}
function parseArgs(argv) {
  const options = { mechanics: null, auditDir: null };
  for (let index = 2; index < argv.length; ++index) {
    if (argv[index] === "--mechanics" && index + 1 < argv.length) {
      options.mechanics = argv[++index];
    } else if (argv[index] === "--audit-dir" && index + 1 < argv.length) {
      options.auditDir = argv[++index];
    } else {
      throw new Error(`unknown or incomplete option ${argv[index]}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv);
const contract = readJson(CONTRACT);
assert.equal(contract.schema, "zero.zero4_q28_graded_plasticity_contract.v1");
assert.equal(contract.id, "zero4-q28-v1");
assert.equal(contract.status, "implementation_only_not_authorized");
assert.equal(contract.training_allowed, false);
assert.equal(contract.lineage.research_commit,
  "b7c676f7d18e6367c67f61a6d41d861c25bf57da");
assert.equal(contract.lineage.research_merge_commit,
  "ffba21b960fff0cafe79b39cbf44f37c0f734687");
for (const binding of [
  contract.lineage.q26_contract,
  contract.lineage.post_q27_hypotheses,
  contract.lineage.post_q27_literature,
  contract.lineage.post_q27_trace,
]) assert.equal(sha256(binding.path), binding.sha256,
  `${binding.path} hash drifted`);

const literature = readJson(contract.lineage.post_q27_literature.path);
assert(literature.works.length >= 5);
assert(literature.works.every((work) =>
  work.primary_source === true && work.review_status === "full_text_reviewed"));
assert.equal(contract.shadow_audit.training_only, true);
assert.equal(contract.shadow_audit.committed_updates, 0);
assert.equal(contract.shadow_audit.deterministic_samples_per_range, 4);
assert.match(contract.shadow_audit.state_invariant, /byte-identical/);
assert.equal(contract.fixed_profile.minimum, 0.05);
assert.equal(contract.fixed_profile.maximum, 1);
assert.equal(contract.fixed_profile.epsilon, 1e-12);
assert.equal(contract.fixed_profile.formula,
  "p_g = 0.05 + 0.95 * N_g / (N_g + O_g + epsilon)");
assert.match(contract.fixed_profile.delta_policy, /including weight decay/);
assert.match(contract.fixed_profile.weighted_projection,
  /sum_g\(p_g \* dot\(r_g,r_g\)\)/);
assert.match(contract.fixed_profile.moment_policy, /fresh AdamW moments/);
assert.equal(contract.fixed_profile.dynamic_profiles_forbidden, true);

const firewall = contract.leakage_firewall;
for (const required of [
  "BLiMP examples or scores", "TinyStories examples or scores",
  "quantity public evaluation rows", "quantity promotion rows",
  "language-gate results", "model promotion inputs",
]) assert(firewall.forbidden_before_candidate_freeze.includes(required));
const pilot = contract.proposed_paid_pilot;
assert.equal(pilot.authorized, false);
assert.equal(pilot.requires_separate_exact_approval, true);
assert.equal(pilot.diagnostic_seed, 2);
assert.equal(pilot.maximum_optimizer_updates, 200);
assert.deepEqual(pilot.measurement_updates, [0, 100, 200]);
assert.equal(pilot.maximum_quantity_compute_usd, 0.5);
assert.equal(pilot.conditional_language_gate_usd, 0.12);
assert.equal(pilot.promotion_authorized, false);
const decision = readJson(DECISION);
assert.equal(decision.schema, "zero.graded_plasticity_audit_decision.v1");
assert.equal(decision.status, "shadow_audit_passed_pilot_not_authorized");
for (const binding of Object.values(decision.bindings)) {
  assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} decision binding drifted`);
}
assert.equal(decision.observations.training_only, true);
assert.equal(decision.observations.committed_updates, 0);
assert.equal(decision.observations.forbidden_evaluation_inputs_used, false);
assert.equal(decision.observations.weights_and_optimizer_byte_identical, true);
assert.equal(decision.observations.parameter_groups, 50);
assert(decision.observations.plasticity_minimum >= 0.05 &&
  decision.observations.plasticity_maximum <= 1);
assert.equal(decision.decision.shadow_audit, "pass");
assert.equal(decision.decision.paid_compute_authorized, false);
assert.equal(decision.decision.language_gate_authorized, false);
assert.equal(decision.decision.promotion_authorized, false);
const budget = readJson(BUDGET);
assert.equal(budget.schema, "zero.q28_graded_plasticity_pilot_budget.v1");
assert.equal(budget.status,
  "activation_implementation_authorized_run_not_authorized");
assert.equal(budget.profile.sha256, decision.bindings.profile.sha256);
assert.equal(budget.proposed.maximum_optimizer_updates, 200);
assert.deepEqual(budget.proposed.checkpoint_updates, [0, 100, 200]);
assert.equal(budget.proposed.maximum_quantity_compute_usd, 0.5);
assert.equal(budget.proposed.conditional_language_gate_usd, 0.12);
assert.equal(budget.implementation_authorization.issue, 74);
assert.equal(budget.implementation_authorization.authorized, true);
assert.equal(budget.implementation_authorization.base_commit,
  "ea5242d0f65dd1e604c553a4d9aca9856347757e");
assert.equal(budget.implementation_authorization.profile_sha256,
  decision.bindings.profile.sha256);
for (const field of [
  "workflow_dispatch", "aws_compute", "parameter_training",
  "language_gate_execution", "promotion",
]) assert.equal(budget.implementation_authorization[field], false);
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.one_execution_only, true);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_quantity_compute_usd, 0);
assert.equal(budget.authorization.conditional_language_gate_usd, 0);
assert.equal(budget.authorization.language_gate_authorized, false);
assert.equal(budget.authorization.promotion_authorized, false);

const source = fs.readFileSync("graded_plasticity_audit.c", "utf8");
for (const required of [
  "q28_run_audit", "q28_apply_candidate", "q28_project_candidate",
  "Q28_MIN_PLASTICITY", "weights_and_optimizer_byte_identical",
]) assert(source.includes(required), `trainer lacks ${required}`);
assert(!source.includes("--train"),
  "audit-only mechanics exposed an unauthorized training route");
const prereg = fs.readFileSync(PREREG, "utf8");
for (const phrase of [
  "no-update shadow audit", "byte-identical", "updates 0, 100, and 200",
  "$0.50", "$0.12", "not authorized",
]) assert(prereg.includes(phrase), `preregistration lacks ${phrase}`);

run("node", ["scripts/run_zero4_q28_shadow_audit.mjs", "--self-test"]);
if (options.mechanics) run(options.mechanics, ["--self-test"]);
if (options.auditDir) {
  const manifest = readJson(`${options.auditDir}/manifest.json`);
  const audit = readJson(`${options.auditDir}/shadow-audit.json`);
  assert.equal(manifest.schema, "zero.graded_plasticity_audit_manifest.v1");
  assert.equal(manifest.training_only, true);
  assert.equal(manifest.updates_committed, 0);
  assert.equal(manifest.forbidden_evaluation_inputs_used, false);
  assert.equal(manifest.weights_and_optimizer_byte_identical, true);
  assert.equal(audit.weights_and_optimizer_byte_identical, true);
  assert.equal(manifest.outputs.audit.sha256,
    sha256(`${options.auditDir}/shadow-audit.json`));
  assert.equal(manifest.outputs.profile.sha256,
    sha256(`${options.auditDir}/profile.tsv`));
}
console.log("Q2.8 graded-plasticity implementation contract passed");

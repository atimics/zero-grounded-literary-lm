#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function boundJson(root, binding, name) {
  assert(binding && !path.isAbsolute(binding.path) &&
    /^[a-f0-9]{64}$/.test(binding.sha256), `${name} binding is invalid`);
  const file = path.resolve(root, binding.path);
  assert(fs.existsSync(file) && sha256(file) === binding.sha256,
    `${name} binding drifted`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function validateQ27DesignRevision(revision, { root = "." } = {}) {
  assert(revision?.schema === "zero.q27_design_revision.v1",
    "Q2.7 design revision schema drifted");
  assert(revision.id === "zero4-q27-v1-scope-ablation" &&
    revision.status === "preregistered_not_authorized",
  "Q2.7 design revision identity or status drifted");

  const q27 = boundJson(root, revision.bindings.q27_contract, "Q2.7 contract");
  const review = boundJson(
    root,
    revision.bindings.literature_review,
    "literature review",
  );
  const q26 = boundJson(root, revision.historical_control.contract,
    "Q2.6 control contract");
  const result = boundJson(root, revision.historical_control.result,
    "Q2.6 control result");
  const screen = boundJson(root, revision.historical_control.language_screen,
    "Q2.6 language screen");

  assert(q27.id === "zero4-q27-v1" && q27.training_allowed === false &&
    q27.diagnostic_policy.seed === 2,
  "bound Q2.7 arm is not closed seed 2");
  assert(q27.lineage.q26_contract_sha256 ===
    revision.historical_control.contract.sha256 &&
    q27.student.initialization_sha256 === q26.immutable_teachers.zero3 &&
    q27.inherited_q26_design.teachers === "exactly Q2.6" &&
    q27.inherited_q26_design.quantity_corpus_and_splits === "exactly Q2.6" &&
    q27.inherited_q26_design.replay_corpus_and_source_order ===
      "exactly Q2.6" &&
    q27.inherited_q26_design.optimizer_schedule_batch_and_attempt_budgets ===
      "exactly Q2.6" &&
    q27.trainable_scope.cli === "--trainable-scope top-ffn",
  "Q2.6/Q2.7 matched-design lineage drifted");
  assert(review.status === "complete" &&
    review.synthesis.recommendation === "revise" &&
    revision.bindings.literature_review.recommendation === "revise",
  "design revision does not resolve the literature recommendation");
  assert(q26.id === "zero4-q26-v1" && q26.diagnostic_seed === 2,
    "historical control is not Q2.6 seed 2");
  assert(result.seed === 2 && result.selected.committed === 500 &&
    result.selected.rates.exact_request === 0.998 &&
    result.selected.replayRegression === 0.011833231146535925 &&
    result.artifacts.quantizedSha256 ===
      revision.historical_control.result.model_sha256,
  "historical Q2.6 control metrics drifted");
  assert(revision.historical_control.result.seed === result.seed &&
    revision.historical_control.result.selected_update ===
      result.selected.committed &&
    revision.historical_control.result.exact_request_rate ===
      result.selected.rates.exact_request &&
    revision.historical_control.result.replay_regression ===
      result.selected.replayRegression,
  "recorded control summary disagrees with Q2.6");

  const zero4 = screen.models?.zero4;
  assert(zero4?.model_sha256 === result.artifacts.quantizedSha256 &&
    zero4.tasks.blimp.metrics.raw_accuracy === 0.537 &&
    Object.keys(zero4.tasks.blimp.groups).length === 67 &&
    zero4.tasks.tinystories.metrics.bits_per_byte === 2.5703534147275877,
  "historical Q2.6 language screen drifted");
  assert(revision.historical_control.language_screen.blimp_raw_accuracy ===
    zero4.tasks.blimp.metrics.raw_accuracy &&
    revision.historical_control.language_screen.blimp_descriptive_paradigms ===
      Object.keys(zero4.tasks.blimp.groups).length &&
    revision.historical_control.language_screen.tinystories_bits_per_byte ===
      zero4.tasks.tinystories.metrics.bits_per_byte,
  "recorded language summary disagrees with the screen");
  assert(revision.historical_control.new_execution_required === false,
    "historical control unexpectedly requires rerun");
  assert(revision.comparability.matched.length >= 6 &&
    revision.comparability.only_prospective_training_difference.includes(
      "--trainable-scope top-ffn",
    ) &&
    revision.comparability.invalidators.length >= 4,
  "scope-ablation comparability is incomplete");
  assert(
    revision.prospective_arm.new_execution_count === 1 &&
    revision.prospective_arm.language_reporting
      .blimp_all_67_paradigms_reported_descriptively === true &&
    revision.prospective_arm.language_reporting
      .per_paradigm_inference_forbidden === true,
    "prospective arm or bounded reporting drifted",
  );
  for (const outcome of ["go", "no_go_before_language_gate",
    "no_go_at_language_gate", "inconclusive"]) {
    assert(typeof revision.decision[outcome] === "string" &&
      revision.decision[outcome].length > 0,
    `Q2.7 ${outcome} decision is missing`);
  }

  const roi = revision.roi;
  assert(roi.new_broad_scope_control_cost_usd === 0 &&
    roi.avoided_broad_scope_rerun_compute_usd === 1.17 &&
    roi.avoided_broad_scope_language_gate_usd === 0.12 &&
    roi.prospective_top_ffn_training_max_usd === 1.17 &&
    roi.conditional_top_ffn_language_gate_max_usd === 0.12,
  "Q2.7 ROI ledger drifted");
  assert(roi.maximum_new_scientific_compute_usd ===
    roi.prospective_top_ffn_training_max_usd +
      roi.conditional_top_ffn_language_gate_max_usd,
  "Q2.7 maximum new scientific compute is mis-summed");
  assert(roi.additional_broad_literature_review_required === false &&
    roi.additional_literature_agent_credit_cap === 0 &&
    roi.targeted_review_trigger.includes("new intervention family"),
  "Q2.7 literature trigger is not bounded");

  const authorization = revision.authorization;
  assert(authorization.training_allowed === false &&
    authorization.evaluation_allowed === false &&
    authorization.authorized_compute_usd === 0 &&
    authorization.explicit_human_experiment_approval_observed === false &&
    authorization.aws_workflow_dispatch_allowed === false,
  "Q2.7 design revision opened execution");
  return true;
}

function selfTest(revisionPath) {
  const root = path.resolve(path.dirname(revisionPath), "../..");
  const revision = JSON.parse(fs.readFileSync(revisionPath, "utf8"));
  validateQ27DesignRevision(revision, { root });
  const copy = structuredClone(revision);
  copy.authorization.training_allowed = true;
  let rejected = false;
  try {
    validateQ27DesignRevision(copy, { root });
  } catch {
    rejected = true;
  }
  assert(rejected, "design revision self-test opened training");
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const revisionPath = process.argv.slice(2)
    .find((argument) => argument !== "--self-test") ??
    "benchmarks/zero4-q27-v1/DESIGN-REVISION.json";
  if (process.argv.includes("--self-test")) selfTest(revisionPath);
  else validateQ27DesignRevision(
    JSON.parse(fs.readFileSync(revisionPath, "utf8")),
  );
  console.log("Q2.7 high-ROI design revision passed");
}

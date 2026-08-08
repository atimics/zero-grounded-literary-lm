#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS = {
  literature: path.join(ROOT, "benchmarks/zero4-post-q27-v1/LITERATURE-REVIEW.json"),
  hypotheses: path.join(ROOT, "benchmarks/zero4-post-q27-v1/HYPOTHESES.json"),
  trace: path.join(ROOT, "benchmarks/zero4-post-q27-v1/trace-analysis.json"),
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value, name) {
  assert(Array.isArray(value) && value.length > 0 && value.every(nonEmpty),
    `${name} must be a non-empty string list`);
}

function close(actual, expected, tolerance = 1e-12) {
  assert(Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, observed ${actual}`);
}

function validateLiterature(review) {
  assert.equal(review.schema, "zero.post_q27_literature_review.v1");
  assert.equal(review.status, "complete");
  assert.equal(review.method.primary_sources_only, true);
  assert.equal(review.method.full_text_required, true);
  assert(Array.isArray(review.works) && review.works.length >= 8,
    "at least eight primary papers are required");
  assert.equal(review.method.source_count, review.works.length);

  const requiredCoverage = new Set([
    "stability_plasticity",
    "constrained_optimization",
    "parameter_efficient_adaptation",
    "layerwise_transfer_localization",
    "causal_parameter_attribution",
    "importance_weighted_consolidation",
    "per_parameter_or_group_schedules",
    "soft_masks",
    "distributed_sparse_plasticity",
  ]);
  const covered = new Set();
  const ids = new Set();
  for (const work of review.works) {
    assert(nonEmpty(work.id) && !ids.has(work.id), "paper IDs must be unique");
    ids.add(work.id);
    assert.equal(work.primary_source, true, `${work.id} is not a primary source`);
    assert.equal(work.review_status, "full_text_reviewed",
      `${work.id} lacks full-text review`);
    assert(/^https:\/\//.test(work.url), `${work.id} lacks a stable HTTPS URL`);
    assert(nonEmpty(work.citation) && Number.isInteger(work.year));
    assert(nonEmpty(work.locator) && nonEmpty(work.experimental_setting));
    stringList(work.categories, `${work.id} categories`);
    stringList(work.supports, `${work.id} supports`);
    stringList(work.limitations, `${work.id} limitations`);
    assert(nonEmpty(work.direct_design_consequence));
    assert(nonEmpty(work.project_evidence_status));
    work.categories.forEach((category) => covered.add(category));
  }
  for (const category of requiredCoverage) {
    assert(covered.has(category), `literature gap: ${category}`);
  }

  const synthesis = review.synthesis;
  stringList(synthesis.established_evidence, "established evidence");
  stringList(synthesis.analogy_to_zero, "analogy to Zero");
  stringList(synthesis.project_specific_hypotheses, "project hypotheses");
  assert.equal(synthesis.further_broad_review_required_before_pilot, false);
  assert(nonEmpty(synthesis.targeted_review_trigger));
}

function validateTrace(trace) {
  assert.equal(trace.schema, "zero.post_q27_plasticity_trace_analysis.v1");
  assert.equal(trace.matched_committed_update_limit, 300);
  assert.equal(trace.inputs.q26_attempts.sha256,
    "c7f7c3a9a20f02c59d0354c7f947195cd5da7b7aa256662064aaa2b4edd931ba");
  assert.equal(trace.inputs.q26_events.sha256,
    "b45268d32ba97db47cca074276a27d55738f8c70319dd373647052ca40f24e75");
  assert.equal(trace.inputs.q27_attempts.sha256,
    "1cd6f546a2aeb0eb8af023dcc7e41845a66b813fb0781b4bbf08e1b008da95e3");
  assert.equal(trace.inputs.q27_events.sha256,
    "9cd34379af110a13bf75f33be339d89d9849cfba7c492ca36afab7c809c11ace");
  assert.equal(trace.inputs.q27_result.sha256,
    "e460286d746518c44f908a178cab839eb484d8f85e4afb69beba73873c58aef2");

  const terminal = trace.frozen_q27_terminal_evidence;
  assert.equal(terminal.workflow_run, 31270819935);
  assert.equal(terminal.source_commit,
    "59a97ff57e964db4e576bbf1a75e44dc7a983e9d");
  assert.equal(terminal.decision, "no-go");
  assert.equal(terminal.attempts, 300);
  assert.equal(terminal.committed_updates, 300);
  assert.equal(terminal.trainable_scope, "top-ffn");
  assert.equal(terminal.selected_checkpoint, null);
  assert.equal(terminal.language_gate_evaluated, false);

  const q26 = trace.q26.matched_attempts;
  const q27 = trace.q27.matched_attempts;
  assert.equal(q26.accepted, 300);
  assert.equal(q27.accepted, 300);
  assert.equal(q27.full_scale_accepted, 300);
  assert.equal(q27.backtracked, 0);
  assert(q27.max_projection_removed_fraction < 0.062);
  assert(q27.mean_gradient_norm < q26.mean_gradient_norm);
  assert(q27.mean_step_displacement_norm < q26.mean_step_displacement_norm);
  assert.equal(trace.q26.first_quantity_pass.committed, 200);
  assert.equal(trace.q27.first_quantity_pass, null);

  const group = (run, id) => run.matched_group_sums.find((item) => item.id === id);
  assert(group(trace.q27, "layer.5.w1").sum_step_displacement_norm >
    group(trace.q26, "layer.5.w1").sum_step_displacement_norm);
  assert(group(trace.q27, "layer.5.w2").sum_step_displacement_norm >
    group(trace.q26, "layer.5.w2").sum_step_displacement_norm);
  const at200 = trace.matched_evaluations.find((item) => item.committed === 200);
  close(at200.q26.rates.operation, 0.954);
  close(at200.q27.rates.operation, 0);
}

function validateHypotheses(document) {
  assert.equal(document.schema, "zero.post_q27_hypotheses.v1");
  const frozen = document.frozen_evidence;
  assert.equal(frozen.q27_result_sha256,
    "e460286d746518c44f908a178cab839eb484d8f85e4afb69beba73873c58aef2");
  assert.equal(frozen.q27_decision, "no-go");
  assert.equal(frozen.q27_selected_checkpoint, null);
  assert.equal(frozen.q27_language_gate_evaluated, false);

  assert(Array.isArray(document.matched_trace_findings) &&
    document.matched_trace_findings.length >= 5);
  for (const finding of document.matched_trace_findings) {
    assert(["observed", "observed_with_causal_uncertainty"].includes(
      finding.classification));
    assert(nonEmpty(finding.finding) && nonEmpty(finding.implication) &&
      nonEmpty(finding.limit));
  }

  const required = new Set([
    "full_top_transformer_block",
    "top_attention_plus_ffn",
    "distributed_graded_plasticity",
    "distributed_sparse_mask",
    "residual_adapters_or_lora",
    "embedding_or_output_adaptation",
    "optimizer_projection_or_stop_rule",
  ]);
  const hypotheses = new Map();
  for (const hypothesis of document.hypotheses) {
    assert(required.has(hypothesis.id) && !hypotheses.has(hypothesis.id),
      `unexpected or duplicate hypothesis: ${hypothesis.id}`);
    hypotheses.set(hypothesis.id, hypothesis);
    assert(nonEmpty(hypothesis.family) && nonEmpty(hypothesis.causal_mechanism));
    assert(nonEmpty(hypothesis.expected_existing_trace_signature));
    assert(nonEmpty(hypothesis.existing_evidence_assessment));
    assert(nonEmpty(hypothesis.falsifier));
    stringList(hypothesis.risks, `${hypothesis.id} risks`);
    assert(nonEmpty(hypothesis.projected_cost.implementation_person_hours));
    assert(Number.isFinite(hypothesis.projected_cost.pilot_quantity_compute_cap_usd));
    assert(Number.isFinite(hypothesis.projected_cost.conditional_language_gate_cap_usd));
  }
  assert.equal(hypotheses.size, required.size);

  const decision = document.decision;
  assert.equal(decision.diagnostic_precondition.estimated_aws_compute_usd, 0);
  const ranking = decision.ranked_interventions;
  assert.equal(ranking.length, required.size);
  assert.deepEqual(ranking.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(ranking.map((item) => item.hypothesis_id)).size,
    required.size);
  assert.equal(ranking[0].hypothesis_id, "distributed_graded_plasticity");

  const profile = decision.graded_profile_preregistration_candidate;
  for (const key of [
    "old_behavior_importance",
    "new_task_relevance",
    "plasticity_formula",
    "profile_freeze",
    "evaluation_firewall",
    "weights_and_optimizer_moments",
    "projection_geometry",
    "damage_migration_check",
  ]) assert(nonEmpty(profile[key]), `graded profile lacks ${key}`);
  assert(/BLiMP/.test(profile.evaluation_firewall));
  assert(/TinyStories/.test(profile.evaluation_firewall));
  assert(/moments/.test(profile.weights_and_optimizer_moments));

  const pilot = decision.cheapest_discriminating_pilot;
  assert.equal(pilot.status, "proposed_not_authorized");
  assert.equal(pilot.maximum_committed_updates, 200);
  assert.deepEqual(pilot.frozen_evaluation_checkpoints, [0, 100, 200]);
  close(pilot.quantity_compute_projected_usd, 0.323125925926);
  assert(pilot.quantity_compute_cap_with_contingency_usd <= 0.5);
  assert(pilot.maximum_new_compute_envelope_usd <= 0.62);
  assert(/valid frozen quantity\/replay candidate/.test(
    pilot.stop_conditions.join(" ")));
  stringList(pilot.stop_conditions, "pilot stop conditions");

  assert(nonEmpty(decision.value_of_information.research_and_design_cost));
  assert(nonEmpty(decision.value_of_information.experiment_cost));
  assert(nonEmpty(decision.value_of_information.decision_value));
  assert(nonEmpty(decision.value_of_information.recommendation));
  assert(nonEmpty(decision.value_of_information.further_literature_review));

  const authorization = decision.authorization;
  for (const key of [
    "workflow_dispatch",
    "aws_compute",
    "training",
    "language_gate",
    "evaluation",
    "promotion",
  ]) assert.equal(authorization[key], false, `${key} was accidentally authorized`);
  assert.equal(authorization.next_experiment_requires_separate_issue_and_exact_approval,
    true);
}

function validateAll(literature, hypotheses, trace) {
  validateLiterature(literature);
  validateHypotheses(hypotheses);
  validateTrace(trace);
}

const literature = readJson(DEFAULTS.literature);
const hypotheses = readJson(DEFAULTS.hypotheses);
const trace = readJson(DEFAULTS.trace);
validateAll(literature, hypotheses, trace);

if (process.argv.includes("--self-test")) {
  const mutations = [
    ["too few sources", () => {
      const copy = structuredClone(literature);
      copy.works = copy.works.slice(0, 7);
      copy.method.source_count = copy.works.length;
      validateLiterature(copy);
    }],
    ["compute authorization", () => {
      const copy = structuredClone(hypotheses);
      copy.decision.authorization.aws_compute = true;
      validateHypotheses(copy);
    }],
    ["terminal hash drift", () => {
      const copy = structuredClone(trace);
      copy.inputs.q27_result.sha256 = "0".repeat(64);
      validateTrace(copy);
    }],
  ];
  for (const [name, mutation] of mutations) {
    let rejected = false;
    try {
      mutation();
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("post-Q2.7 research self-test passed");
} else {
  console.log("post-Q2.7 research artifacts are valid");
}

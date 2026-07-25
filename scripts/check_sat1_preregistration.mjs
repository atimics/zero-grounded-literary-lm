#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_CONTRACT = "benchmarks/sat1-v1/contract.json";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateContract(contract) {
  assert(contract?.schema === "zero.sat1_staged_preregistration.v1",
    "SAT-1 schema drifted");
  assert(contract.id === "sat1-v1", "SAT-1 id drifted");
  assert(contract.status === "preregistered_blocked_not_authorized",
    "SAT-1 status drifted");
  assert(
    contract.scientific_compute_authorized === false &&
      contract.training_allowed_without_stage_budget === false,
    "SAT-1 became authorized",
  );
  const lineage = contract.lineage;
  assert(fs.existsSync(lineage.q26r_aggregate_path), "Q2.6-R aggregate missing");
  assert(sha256(lineage.q26r_aggregate_path) === lineage.q26r_aggregate_sha256,
    "Q2.6-R aggregate hash mismatch");
  const aggregate = JSON.parse(fs.readFileSync(lineage.q26r_aggregate_path, "utf8"));
  assert(aggregate.decision === lineage.q26r_decision && aggregate.decision === "go",
    "Q2.6-R lineage is not go");
  assert(fs.existsSync(lineage.language_gate_path), "language gate missing");
  const languageGate = JSON.parse(
    fs.readFileSync(lineage.language_gate_path, "utf8"),
  );
  const screen = JSON.parse(
    fs.readFileSync(languageGate.reference.result_path, "utf8"),
  );
  const readiness = contract.readiness;
  assert(readiness.stage_a_blocked === true, "SAT-1 anchor unexpectedly unblocked");
  assert(
    readiness.five_operation_anchor.quantity_family_decision === "go" &&
      readiness.five_operation_anchor.language_screen.blimp_gate === "pass" &&
      readiness.five_operation_anchor.language_screen.tinystories_gate === "fail" &&
      readiness.five_operation_anchor.language_screen.conjunctive_gate === "fail",
    "five-operation anchor decision drifted",
  );
  assert(
    readiness.five_operation_anchor.model_sha256 ===
      aggregate.promoted_model.sha256,
    "five-operation anchor model drifted",
  );
  const zero4 = screen.models.zero4.tasks;
  assert(
    readiness.five_operation_anchor.language_screen.blimp_raw_accuracy ===
      zero4.blimp.metrics.raw_accuracy &&
      readiness.five_operation_anchor.language_screen.tinystories_bits_per_byte ===
      zero4.tinystories.metrics.bits_per_byte,
    "five-operation language evidence drifted",
  );
  assert(
    zero4.blimp.metrics.raw_accuracy >=
      languageGate.decision_rule.blimp.minimum_raw_accuracy &&
      zero4.tinystories.metrics.bits_per_byte >
      languageGate.decision_rule.tinystories.maximum_bits_per_byte,
    "five-operation gate outcome drifted",
  );

  const design = contract.fixed_design;
  assert(
    JSON.stringify(design.operation_counts) ===
      JSON.stringify([5, 10, 20, 40, 80, 160]),
    "operation counts drifted",
  );
  assert(JSON.stringify(design.declared_seeds) === JSON.stringify([1, 2, 3]),
    "declared seeds drifted");
  assert(design.diagnostic_seed === 2, "diagnostic seed drifted");
  assert(design.student_parameters === 4852992, "parameter budget drifted");
  assert(design.public_quantity_gates.operation_minimum === 0.95,
    "operation gate drifted");
  assert(design.public_quantity_gates.exact_artifact_minimum === 0.95,
    "exact-artifact gate drifted");
  assert(design.public_quantity_gates.replay_relative_regression_maximum === 0.02,
    "replay gate drifted");
  assert(design.language_gate.contract === "zero-language-gate-v1",
    "language gate drifted");
  assert(design.language_gate.not_training_feedback === true,
    "language evaluation leaked into training");

  assert(contract.stages.length === 4, "stage count drifted");
  const [stage0, stageA, stageB, stageC] = contract.stages;
  assert(
    [stage0.id, stageA.id, stageB.id, stageC.id].join(",") ===
      "stage-0,stage-a,stage-b,stage-c",
    "stage order drifted",
  );
  assert(contract.stages.every((stage) =>
    stage.compute_authorized === false && stage.automatic_advance === false),
  "a stage became authorized or automatic");
  assert(
    stage0.advance_rule.includes("five-operation anchor is unblocked") &&
      stage0.advance_rule.includes("score-sealed timing is complete"),
    "Stage 0 advance rule drifted",
  );
  assert(JSON.stringify(stageA.arms) === JSON.stringify([
    {
      operation_count: 5,
      seed: 2,
      source: "reuse frozen Q2.6 seed-2 anchor; no retraining",
    },
    { operation_count: 40, seed: 2 },
    { operation_count: 160, seed: 2 },
  ]), "Stage A arms drifted");
  assert(JSON.stringify(stageB.arms) === JSON.stringify([
    { operation_count: 10, seed: 2 },
    { operation_count: 20, seed: 2 },
    { operation_count: 80, seed: 2 },
  ]), "Stage B arms drifted");
  assert(stageC.conditional_design.no_transition_through_160.includes("5 and 160"),
    "endpoint replication drifted");
  assert(stageC.family_rule.includes("all three declared seeds"),
    "three-seed family rule drifted");

  const budget = contract.budget_policy;
  assert(
    budget.each_stage_requires_its_own_immutable_aws_budget === true &&
      budget.github_actions_must_not_wait_for_compute === true &&
      budget.collectors_must_not_start_or_wait_for_compute === true &&
      budget.no_stage_authorizes_a_later_stage === true,
    "budget isolation drifted",
  );
  assert(
    budget.current_total_authorized_instance_seconds === 0 &&
      budget.current_total_authorized_compute_usd === 0,
    "SAT-1 compute became authorized",
  );
  assert(
    contract.reporting.report_every_declared_arm === true &&
      contract.reporting.separate_execution_failure_from_scientific_no_go === true &&
      contract.reporting.no_optional_stopping === true,
    "reporting authority drifted",
  );
  return true;
}

function selfTest() {
  const contract = JSON.parse(fs.readFileSync(DEFAULT_CONTRACT, "utf8"));
  validateContract(contract);
  for (const [name, mutate] of [
    ["authorization", (copy) => {
      copy.stages[1].compute_authorized = true;
    }],
    ["anchor unblock", (copy) => {
      copy.readiness.stage_a_blocked = false;
    }],
    ["optional stopping", (copy) => {
      copy.reporting.no_optional_stopping = false;
    }],
    ["diagnostic arms", (copy) => {
      copy.stages[1].arms[1].operation_count = 20;
    }],
    ["language feedback", (copy) => {
      copy.fixed_design.language_gate.not_training_feedback = false;
    }],
  ]) {
    const invalid = structuredClone(contract);
    mutate(invalid);
    let rejected = false;
    try {
      validateContract(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("SAT-1 staged preregistration self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const contractPath = process.argv[2] ?? DEFAULT_CONTRACT;
    validateContract(JSON.parse(fs.readFileSync(contractPath, "utf8")));
    console.log(`OK SAT-1 preregistration: ${contractPath}`);
  }
}

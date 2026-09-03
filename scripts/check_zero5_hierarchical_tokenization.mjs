#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const seriesPath = "benchmarks/zero5-hierarchical-tokenization-v1/series.json";
const seriesDocPath = "benchmarks/zero5-hierarchical-tokenization-v1/SERIES.md";
const launcherPath = "scripts/run_zero5_hierarchical_tokenization.mjs";
const ht1ImplementationPath =
  "benchmarks/zero5-ht1-mergetree-v1/implementation.json";
const experiments = [
  {
    name: "zero5-ht1-mergetree-v1",
    schema: "zero.ht1_mergetree_contract.v1",
    contract: "benchmarks/zero5-ht1-mergetree-v1/contract.json",
    spec: "benchmarks/zero5-ht1-mergetree-v1/SPEC.md",
  },
  {
    name: "zero5-ht2-blockstate-v1",
    schema: "zero.ht2_blockstate_contract.v1",
    contract: "benchmarks/zero5-ht2-blockstate-v1/contract.json",
    spec: "benchmarks/zero5-ht2-blockstate-v1/SPEC.md",
  },
  {
    name: "zero5-ht3-answerroot-v1",
    schema: "zero.ht3_answerroot_contract.v1",
    contract: "benchmarks/zero5-ht3-answerroot-v1/contract.json",
    spec: "benchmarks/zero5-ht3-answerroot-v1/SPEC.md",
  },
];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(program, args, expected = 0) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, expected,
    `${program} ${args.join(" ")} returned ${result.status}: ` +
      (result.stderr || result.stdout));
  return result;
}

function assertNoTestAccess(test) {
  for (const name of ["content_present", "parsed", "tokenized", "packed",
    "scored", "metrics_opened"]) assert.equal(test[name], false);
}

const series = JSON.parse(fs.readFileSync(seriesPath, "utf8"));
assert.equal(series.schema, "zero.hierarchical_tokenization_series.v1");
assert.equal(series.status, "preregistered-ready-for-implementation-review");
assert.equal(series.authorized, false);
assert.deepEqual(series.execution_order, experiments.map(item => item.name));
assert.equal(series.active_dependency.experiment, "zero5-c61-shared-state-v1");
assert.equal(sha256(series.active_dependency.contract),
  series.active_dependency.contract_sha256);
assert.equal(sha256(series.active_dependency.terminal_record),
  series.active_dependency.terminal_record_sha256);
const c61Terminal = JSON.parse(fs.readFileSync(
  series.active_dependency.terminal_record, "utf8"));
assert.equal(series.active_dependency.terminal_status, c61Terminal.status);
assert.equal(series.active_dependency.terminal_result_sha256,
  c61Terminal.evaluation.result.sha256);
assert.equal(series.active_dependency.checkpoint_sha256,
  c61Terminal.selected_checkpoint.sha256);
assert.equal(series.active_dependency.dependency_satisfied, true);
assert.equal(series.shared_control.experiment, "zero5-c51-statebridge-v1");
assert.equal(sha256(series.shared_control.contract),
  series.shared_control.contract_sha256);
assert.equal(series.shared_model.base_parameters, 4852992);
assert.equal(series.shared_model.language_vocabulary, 512);
assert.equal(series.shared_model.tokenizer, "lossless byte-BPE512");
assert.equal(series.shared_training.update_groups_per_arm, 28707);
assert.equal(series.resource_boundary.training_runs_authorized, 0);
assert.equal(series.resource_boundary.independent_retries_authorized, 0);
for (const value of Object.values(series.governance)) {
  if (typeof value === "boolean") assert.equal(value, false);
}
assertNoTestAccess(series.test);

const checkedFiles = [seriesPath, seriesDocPath, launcherPath];
const contracts = new Map();
for (const experiment of experiments) {
  const contract = JSON.parse(fs.readFileSync(experiment.contract, "utf8"));
  contracts.set(experiment.name, contract);
  checkedFiles.push(experiment.contract, experiment.spec);
  assert.equal(contract.schema, experiment.schema);
  assert.equal(contract.experiment, experiment.name);
  assert.match(contract.status, /^preregistered-/u);
  assert.equal(contract.authorized, false);
  assert.equal(contract.ilxyr.run_authorized, false);
  assert.equal(contract.series.path, seriesPath);
  assert.equal(contract.series.sha256, sha256(seriesPath));
  assert.equal(contract.specification.path, experiment.spec);
  assert.equal(contract.specification.sha256, sha256(experiment.spec));
  assert.equal(contract.implementation.status, "planned-not-implemented");
  assert.equal(contract.implementation.implementation_authorized, false);
  assert.equal(contract.implementation.launcher, launcherPath);
  assert.equal(contract.implementation.launcher_sha256, sha256(launcherPath));
  assert.equal(contract.training.paid_compute_authorized, false);
  assert.equal(contract.training.cost_ceiling_usd, null);
  assert.equal(contract.training.runs_authorized, 0);
  assert.equal(contract.claim_boundary.replication_authorized, false);
  assert.equal(contract.claim_boundary.promotion_authorized, false);
  assert.equal(contract.claim_boundary.publication_authorized, false);
  assertNoTestAccess(contract.test);
}

for (const file of checkedFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.equal(source.includes("/Users/"), false, `${file} exposes a user path`);
  assert.equal(source.includes("/private/"), false,
    `${file} exposes a private path`);
}

const ht1 = contracts.get("zero5-ht1-mergetree-v1");
const ht1Implementation = JSON.parse(fs.readFileSync(ht1ImplementationPath));
assert.equal(ht1Implementation.schema, "zero.ht1_mergetree_implementation.v1");
assert.equal(ht1Implementation.status, "implemented-awaiting-artifact-preflight");
assert.equal(ht1Implementation.implementation_complete, true);
assert.equal(ht1Implementation.experiment_runs_completed, 0);
assert.equal(sha256(ht1Implementation.preregistration.contract),
  ht1Implementation.preregistration.contract_sha256);
assert.equal(sha256(ht1Implementation.preregistration.series),
  ht1Implementation.preregistration.series_sha256);
for (const name of ["trainer", "base_trainer", "evaluator", "checker",
  "test_header", "review_notes", "launcher"]) {
  assert.equal(sha256(ht1Implementation.implementation[name]),
    ht1Implementation.implementation[`${name}_sha256`]);
}
assert.equal(ht1Implementation.model.total_parameters,
  ht1Implementation.model.base_parameters +
    ht1Implementation.model.gate_parameters);
assert.equal(ht1Implementation.synthetic_mechanics.ten_update_gate_off_identity,
  true);
assert.equal(ht1Implementation.artifact_preflight.status, "pending");
assert.equal(ht1Implementation.authorization.training_authorized, false);
assert.equal(ht1Implementation.authorization.runs_authorized, 0);
assertNoTestAccess(ht1Implementation.test);
assert.equal(fs.readFileSync(ht1Implementation.implementation.base_trainer)
  .equals(fs.readFileSync(ht1Implementation.implementation.trainer)), false);
checkedFiles.push(ht1ImplementationPath,
  ht1Implementation.implementation.review_notes);
assert.equal(ht1.tokenizer.base_tokens + ht1.tokenizer.merge_tokens,
  ht1.tokenizer.vocabulary);
assert.equal(ht1.tokenizer.segmentation_changed, false);
assert.equal(ht1.tokenizer.decoder_changed, false);
assert.equal(ht1.model.gate_parameters, ht1.tokenizer.merge_tokens + 1);
assert.equal(ht1.model.total_parameters,
  ht1.model.base_parameters + ht1.model.gate_parameters);
assert.equal(ht1.treatment.gate_initialization, "exact zero");
assert.equal(ht1.control.gate_off_shared_tensors_byte_identical_required, true);
assert.equal(ht1.control.full_checkpoint_byte_identical_required, false);
assert(ht1.gates.overall_bits_per_byte_relative_reduction_minimum > 0);
assert(ht1.gates.maximum_compute_ratio <= 1.03);

const ht2 = contracts.get("zero5-ht2-blockstate-v1");
const blockParameters = Object.entries(ht2.parameter_accounting)
  .filter(([, value]) => typeof value === "number")
  .reduce((total, [, value]) => total + value, 0);
assert.equal(blockParameters, ht2.model.block_parameters);
assert.equal(ht2.model.total_parameters_per_arm,
  ht2.model.base_parameters + ht2.model.block_parameters);
assert.equal(ht2.model.block_tokens, 8);
assert.equal(ht2.model.block_state_width, 128);
assert.equal(ht2.parameter_accounting.control_and_treatment_equal, true);
assert.equal(ht2.training.arms, 2);
assert.equal(ht2.boundary_policy.padding_updates_state, false);
assert.equal(ht2.boundary_policy.state_crosses_reset, false);
assert(ht2.gates.retrieval_choice_gain_minimum > 0);
assert(ht2.gates.maximum_compute_ratio_each_arm <= 1.15);

const ht3 = contracts.get("zero5-ht3-answerroot-v1");
const rootParameters = Object.entries(ht3.parameter_accounting)
  .filter(([, value]) => typeof value === "number")
  .reduce((total, [, value]) => total + value, 0);
assert.equal(rootParameters, ht3.model.bottleneck_parameters);
assert.equal(ht3.model.total_parameters,
  ht3.model.base_parameters + ht3.model.bottleneck_parameters);
assert.equal(ht3.control.result_sha256,
  c61Terminal.evaluation.result.sha256);
assert.equal(ht3.control.checkpoint_sha256,
  c61Terminal.selected_checkpoint.sha256);
assert.equal(ht3.control.required_result_state, "terminal-hash-bound");
assert.equal(sha256(ht3.control.contract), ht3.control.contract_sha256);
assert.equal(sha256(ht3.control.terminal_record),
  ht3.control.terminal_record_sha256);
assert.equal(ht3.verified_factors.gold_factors_used_as_language_input, false);
assert.equal(ht3.treatment.root_source, "last prompt token only");
assert.equal(ht3.treatment.root_computations_per_answer, 1);
assert.equal(ht3.treatment.root_held_fixed_during_answer, true);
assert.equal(ht3.treatment.gold_or_future_information_used, false);
assert.equal(ht3.evaluation.checkpoint_selection_uses_interventions, false);
assert.deepEqual(ht3.evaluation.interventions,
  ["normal-root", "zero-root", "paired-wrong-root", "bridge-off"]);

assert.match(run("node", [launcherPath, "--self-test"]).stdout,
  /launcher self-test passed/u);
for (const experiment of experiments) {
  const result = run("node", [launcherPath, "--contract", experiment.contract], 1);
  assert.match(`${result.stderr}${result.stdout}`, /training is not authorized/u);
}

process.stdout.write("ZERO.5 hierarchical tokenization series checks passed\n");

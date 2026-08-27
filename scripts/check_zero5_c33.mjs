#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { verifyFrozenGitFile } from "./frozen_source.mjs";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function close(left, right, tolerance = 1e-9) {
  return Math.abs(left - right) <= tolerance;
}

const contractPath = "benchmarks/zero5-c33-v1/contract.json";
const importPath = "benchmarks/zero5-c33-v1/import.json";
const controlPath = "benchmarks/zero5-c32-v1/result.json";
const awsExecutionPath = "benchmarks/zero5-c33-v1/aws-execution.json";
const sourceLockPath = "benchmarks/zero5-c33-v1/source-lock.json";
const resultPath = "benchmarks/zero5-c33-v1/result.json";
const statusPath = "benchmarks/zero5-c33-v1/status.json";
const contract = JSON.parse(fs.readFileSync(contractPath));
const importedBytes = fs.readFileSync(importPath);
const imported = JSON.parse(importedBytes);
const controlBytes = fs.readFileSync(controlPath);
const control = JSON.parse(controlBytes);
const sourceLock = JSON.parse(fs.readFileSync(sourceLockPath));

assert.equal(contract.schema, "zero.c33_pair_atomic_experiment.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.equal(contract.execution.backend, "openblas");
assert.equal(contract.execution.openblas_threads, 8);
assert.equal(contract.execution.omp_threads, 8);
assert.equal(contract.execution.dynamic_threading, false);
assert.equal(contract.execution.maximum_total_ec2_usd, 3.4);
assert.equal(sha256(fs.readFileSync(contract.execution.stage_script)),
  contract.execution.stage_script_sha256);
assert.equal(sha256(fs.readFileSync(contract.execution.launcher)),
  contract.execution.launcher_sha256);
assert.equal(sha256(fs.readFileSync(contract.execution.user_data)),
  contract.execution.user_data_sha256);
assert.equal(sourceLock.schema, "zero.c33_source_lock.v1");
assert.equal(sourceLock.experiment, contract.experiment);
assert.equal(sourceLock.trainer.path, contract.implementation.trainer);
assert.equal(sourceLock.trainer.sha256,
  contract.implementation.trainer_sha256);
verifyFrozenGitFile(sourceLock.git_commit, sourceLock.trainer.path,
  sourceLock.trainer.sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.importer)),
  contract.implementation.importer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.runner)),
  contract.implementation.runner_sha256);
assert.equal(sha256(importedBytes), contract.input.import_manifest_sha256);
assert.equal(sha256(controlBytes), contract.control_source.result_sha256);

assert.equal(imported.schema, "zero.c33_import.v1");
assert.equal(imported.release.id, contract.input.release_id);
assert.equal(imported.release.braid_head, contract.input.braid_head);
assert.equal(imported.release.manifest.sha256,
  contract.input.release_manifest_sha256);
assert.equal(imported.tokenizer.sha256, contract.input.tokenizer_sha256);
assert.equal(imported.outputs.train_interleaved.sha256,
  contract.input.train_packs.sha256);
assert.equal(imported.outputs.train_interleaved.packs,
  contract.training.pack_sequences);
assert.equal(imported.outputs.train_interleaved.records,
  contract.input.records.train);
assert.equal(imported.outputs.train_interleaved.compute_token_exposures,
  contract.training.compute_token_exposures);
assert.equal(imported.outputs.train_interleaved.active_targets,
  contract.training.active_targets);
assert.equal(imported.outputs.train_interleaved.answer_targets,
  contract.training.answer_targets);
assert.deepEqual(imported.outputs.train_interleaved.answer_targets_by_task,
  contract.training.answer_targets_by_task);
assert.equal(imported.outputs.train_interleaved.padding_targets,
  contract.training.padding_targets);
assert.equal(imported.outputs.train_interleaved.maximum_same_task_pack_run, 4);
assert.equal(imported.paired_training.optimizer_batches,
  contract.training.updates);
assert.equal(imported.paired_training.paired_examples,
  contract.input.paired_training.mirrored_pairs);
assert.equal(imported.paired_training.pair_cross_batch_leakage, 0);
assert.equal(imported.paired_training.direct_consistency_penalty, false);
assert.equal(Object.entries(
  imported.paired_training.batch_profiles_claim_cloze_retrieval)
  .reduce((sum, [, count]) => sum + count, 0), contract.training.updates);
assert.equal(Object.entries(
  imported.paired_training.batch_profiles_claim_cloze_retrieval)
  .reduce((sum, [profile, count]) => sum +
    profile.split(":").reduce((value, part) => value + Number(part), 0) *
      count, 0), contract.training.pack_sequences);
assert.equal(imported.outputs.validation_interleaved.sha256,
  contract.input.validation_packs_sha256);
assert.equal(imported.test.records, contract.input.records.test);
assert.equal(imported.test.parsed, false);
assert.equal(imported.test.tokenized, false);
assert.equal(imported.test.packed, false);
assert.equal(imported.test.metrics_opened, false);

assert.equal(control.schema, "zero.c32_braid_result.v1");
assert.equal(control.status, "complete");
assert.equal(control.test.metrics_opened, false);
const observed = control.arms.D.validation;
assert.ok(close(observed.combined_final_nats_per_token,
  contract.control_c32_D.combined_final_nats_per_token));
assert.ok(close(observed.mean_paired_choice_accuracy,
  contract.control_c32_D.mean_paired_choice_accuracy));
assert.ok(close(observed.mean_pair_exact_accuracy,
  contract.control_c32_D.mean_pair_exact_accuracy));
assert.ok(close((observed.paired.claim.swap_consistency_accuracy +
  observed.paired.retrieval.swap_consistency_accuracy) / 2,
contract.control_c32_D.mean_swap_consistency_accuracy));
assert.ok(close(contract.gates.mean_swap_consistency_accuracy_minimum,
  contract.control_c32_D.mean_swap_consistency_accuracy + 0.1));
assert.ok(close(contract.gates.mean_pair_exact_accuracy_minimum,
  contract.control_c32_D.mean_pair_exact_accuracy + 0.05));
for (const task of ["claim", "retrieval"]) {
  assert.ok(close(contract.gates.paired_choice_accuracy_minimum[task],
    contract.control_c32_D.paired_choice_accuracy[task] - 0.01));
  assert.ok(close(contract.gates.swap_consistency_accuracy_minimum[task],
    contract.control_c32_D.swap_consistency_accuracy[task] - 0.01));
  assert.ok(close(contract.gates.pair_exact_accuracy_minimum[task],
    contract.control_c32_D.pair_exact_accuracy[task] - 0.01));
}

const localImport = "build/zero5-c33-v1/import-final";
if (fs.existsSync(localImport)) {
  for (const [file, expected] of [
    ["train.interleaved.z5pack", imported.outputs.train_interleaved.sha256],
    ["validation.interleaved.z5pack",
      imported.outputs.validation_interleaved.sha256],
    ["claim.validation.paired-eval.bin",
      imported.outputs.paired_validation.claim.sha256],
    ["retrieval.validation.paired-eval.bin",
      imported.outputs.paired_validation.retrieval.sha256],
  ]) {
    assert.equal(sha256(fs.readFileSync(localImport + "/" + file)), expected);
  }
}

assert.match(run("node", [contract.implementation.importer,
  "--self-test-scheduler"]), /pair-atomic scheduler self-test passed/);
run("node", ["--check", contract.implementation.importer]);
run("node", ["--check", contract.implementation.runner]);
assert.match(fs.readFileSync(contract.implementation.runner, "utf8"),
  /\{ id: "E", weights: contract\.arms\.E\.answer_weights \}/);
assert.doesNotMatch(fs.readFileSync(contract.implementation.runner, "utf8"),
  /\{ id: "[CD]", weights: contract\.arms\.[CD]\.answer_weights \}/);

const awsExecution = JSON.parse(fs.readFileSync(awsExecutionPath));
assert.equal(awsExecution.schema, "zero.c33_aws_execution.v1");
assert.equal(awsExecution.status, "authorized-retry");
assert.equal(awsExecution.scientific_contract_sha256,
  sha256(fs.readFileSync(contractPath)));
assert.equal(awsExecution.approval_id, "zero5-c33-aws-2026-08-26-v1");
assert.deepEqual(awsExecution.scope.arms, ["E"]);
assert.deepEqual(awsExecution.scope.seeds, [0]);
assert.equal(awsExecution.scope.test_metrics_opened, false);
assert.equal(awsExecution.prior_attempt.completed_training_updates, 0);
assert.equal(awsExecution.prior_attempt.ec2_usd,
  contract.execution_amendment.failed_attempt_ec2_usd);
assert.ok(awsExecution.maximum_segment_seconds *
  awsExecution.on_demand_usd_per_hour / 3600 <=
    awsExecution.maximum_segment_ec2_usd);
assert.ok(awsExecution.maximum_total_instance_seconds *
  awsExecution.on_demand_usd_per_hour / 3600 <=
    awsExecution.maximum_total_ec2_usd);
for (const script of [contract.execution.stage_script,
  contract.execution.launcher, contract.execution.user_data]) {
  run("bash", ["-n", script]);
  assert.ok((fs.statSync(script).mode & 0o111) !== 0,
    script + " must be executable");
}

if (fs.existsSync(resultPath) || fs.existsSync(statusPath)) {
  assert.ok(fs.existsSync(resultPath) && fs.existsSync(statusPath));
  const resultBytes = fs.readFileSync(resultPath);
  const result = JSON.parse(resultBytes);
  const status = JSON.parse(fs.readFileSync(statusPath));
  const arm = result.arms.E;
  const validation = arm.validation;
  const expectedGates = {
    full_pack_pass:
      arm.training.pack_sequences === contract.training.pack_sequences &&
      arm.training.compute_token_exposures ===
        contract.training.compute_token_exposures &&
      arm.training.active_targets === contract.training.active_targets &&
      arm.training.answer_targets === contract.training.answer_targets &&
      JSON.stringify(arm.training.answer_targets_by_task) ===
        JSON.stringify(contract.training.answer_targets_by_task) &&
      arm.training.padding_targets === contract.training.padding_targets &&
      arm.training.wraps === 0,
    combined_nll_retention: validation.combined_final_nats_per_token <=
      contract.gates.combined_validation_nats_per_token_maximum,
    claim_completion_retention:
      validation.completion.claim.nats_per_target_token <=
        contract.gates.completion_nats_per_target_token_maximum.claim,
    cloze_completion_retention:
      validation.completion.cloze.nats_per_target_token <=
        contract.gates.completion_nats_per_target_token_maximum.cloze,
    retrieval_completion_retention:
      validation.completion.retrieval.nats_per_target_token <=
        contract.gates.completion_nats_per_target_token_maximum.retrieval,
    claim_choice_retention: validation.paired.claim.choice_accuracy >=
      contract.gates.paired_choice_accuracy_minimum.claim,
    retrieval_choice_retention: validation.paired.retrieval.choice_accuracy >=
      contract.gates.paired_choice_accuracy_minimum.retrieval,
    claim_position_gap: Math.abs(validation.paired.claim.position_a_accuracy -
      validation.paired.claim.position_b_accuracy) <=
        contract.gates.paired_position_gap_maximum.claim,
    retrieval_position_gap:
      Math.abs(validation.paired.retrieval.position_a_accuracy -
        validation.paired.retrieval.position_b_accuracy) <=
          contract.gates.paired_position_gap_maximum.retrieval,
    mean_swap_step: validation.mean_swap_consistency_accuracy >=
      contract.gates.mean_swap_consistency_accuracy_minimum,
    claim_swap_retention:
      validation.paired.claim.swap_consistency_accuracy >=
        contract.gates.swap_consistency_accuracy_minimum.claim,
    retrieval_swap_retention:
      validation.paired.retrieval.swap_consistency_accuracy >=
        contract.gates.swap_consistency_accuracy_minimum.retrieval,
    mean_pair_exact_step: validation.mean_pair_exact_accuracy >=
      contract.gates.mean_pair_exact_accuracy_minimum,
    claim_pair_exact_retention:
      validation.paired.claim.pair_exact_accuracy >=
        contract.gates.pair_exact_accuracy_minimum.claim,
    retrieval_pair_exact_retention:
      validation.paired.retrieval.pair_exact_accuracy >=
        contract.gates.pair_exact_accuracy_minimum.retrieval,
    atlas_retention_nats_per_token: validation.atlas_nats_per_token <=
      contract.gates.atlas_nats_per_token_maximum,
    atlas_relative_regression: validation.atlas_relative_regression <=
      contract.gates.atlas_relative_regression_maximum,
    anchor_retention_nats_per_token: validation.anchor_nats_per_token <=
      contract.gates.anchor_nats_per_token_maximum,
    anchor_relative_regression: validation.anchor_relative_regression <=
      contract.gates.anchor_relative_regression_maximum,
    finite_metrics: [validation.combined_final_nats_per_token,
      validation.atlas_nats_per_token, validation.anchor_nats_per_token,
      ...Object.values(validation.members),
      ...Object.values(validation.completion).flatMap(value =>
        [value.nats_per_target_token, value.top1_token_accuracy,
          value.last_target_token_accuracy]),
      ...Object.values(validation.paired).flatMap(value =>
        [value.forced_choice_nats, value.choice_accuracy,
          value.position_a_accuracy, value.position_b_accuracy,
          value.swap_consistency_accuracy, value.pair_exact_accuracy])]
      .every(Number.isFinite),
    test_metrics_opened: false,
  };
  assert.equal(result.schema, "zero.c33_pair_atomic_result.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.contract_sha256, sha256(fs.readFileSync(contractPath)));
  assert.equal(result.implementation.trainer_sha256,
    contract.implementation.trainer_sha256);
  assert.equal(result.test.metrics_opened, false);
  assert.deepEqual(arm.gates, expectedGates);
  assert.equal(arm.all_gates_pass, false);
  assert.equal(result.decision.outcome, "no-go");
  assert.equal(result.decision.replication_authorized, false);
  assert.equal(result.decision.broad_model_promotion_authorized, false);
  assert.ok(close(result.comparisons
    .pair_atomic_E_minus_D_mean_swap_consistency_accuracy,
  validation.mean_swap_consistency_accuracy -
    contract.control_c32_D.mean_swap_consistency_accuracy));
  assert.equal(status.schema, "zero.c33_aws_status.v1");
  assert.equal(status.status, "complete");
  assert.equal(status.contract_sha256, result.contract_sha256);
  assert.equal(status.git_commit, sourceLock.git_commit);
  assert.equal(status.result_sha256, sha256(resultBytes));
  assert.ok(status.estimated_ec2_usd <=
    contract.execution.maximum_total_ec2_usd);
}

console.log("ZERO.5-C3.3 frozen pair-atomic screen passed");

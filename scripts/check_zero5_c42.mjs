#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contract = JSON.parse(fs.readFileSync(
  "benchmarks/zero5-c42-v1/contract.json"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(program + " failed: " +
      (result.stderr || result.stdout).trim());
  }
  return result.stdout;
}

assert.equal(contract.schema, "zero.c42_experiment_contract.v1");
assert.equal(contract.experiment, "zero5-c42-v1");
assert.equal(contract.status, "authorized-unrun");
assert.equal(contract.authorized, true);
assert.equal(contract.upstream.pull_request, 11);
assert.equal(contract.upstream.merge_required_before_training, false);
assert.equal(contract.upstream.merge_commit,
  "f951cc2910a76277baaf1548b2bb4184987ee1a5");
assert.equal(contract.upstream.source_commit,
  "5dbfec78c53676c6aaa32137f7d30e6f81a53593");
assert.equal(contract.upstream.release_manifest_sha256,
  "931544a5e4988b994562dc07831ff39be9da9de734639e6891a3f17b3368be69");
assert.equal(contract.upstream.tokenizer_sha256,
  "90b9ddf7b239b6e48c21b87ca9735cb149c34dcf6f03f49a85410df6efe2cadc");
assert.equal(sha256(contract.implementation.trainer),
  contract.implementation.trainer_sha256);
assert.equal(sha256(contract.implementation.importer),
  contract.implementation.importer_sha256);
assert.equal(sha256(contract.implementation.evaluator),
  contract.implementation.evaluator_sha256);
assert.equal(sha256(contract.implementation.runner),
  contract.implementation.runner_sha256);
assert.equal(sha256(contract.initialization.result),
  contract.initialization.result_sha256);
assert.equal(sha256(contract.proposed_primary_training.math_backend_evidence.result),
  contract.proposed_primary_training.math_backend_evidence.result_sha256);
const vectorResult = JSON.parse(fs.readFileSync(
  contract.proposed_primary_training.math_backend_evidence.result));
assert.equal(vectorResult.decision.eligible_to_promote_vector_math_default,
  true);
assert.equal(contract.proposed_primary_training.math_backend,
  "gnu-libmvec-tanh-exp");
assert.equal(contract.verified_import.primary_packs.packs, 37768);
assert.equal(contract.verified_import.primary_packs.compute_token_exposures,
  37768 * 512);
assert.equal(contract.verified_import.primary_packs.update_groups,
  contract.verified_import.primary_packs.group_sizes.one_pack +
  contract.verified_import.primary_packs.group_sizes.two_packs);
assert.equal(contract.verified_import.primary_packs.packs,
  contract.verified_import.primary_packs.group_sizes.one_pack +
  2 * contract.verified_import.primary_packs.group_sizes.two_packs);
assert.equal(contract.proposed_primary_training.updates,
  contract.verified_import.primary_packs.update_groups);
assert.equal(contract.proposed_primary_training.pack_sequences,
  contract.verified_import.primary_packs.packs);
assert.equal(contract.proposed_primary_training.compute_token_exposures,
  contract.verified_import.primary_packs.compute_token_exposures);
assert.equal(contract.evaluation.evaluator_status, "implemented-frozen");
assert.match(contract.evaluation.training_gate, /\$1\.50 EC2 ceiling/u);
assert.equal(contract.gates.test_metrics_opened, false);
assert.equal(contract.prerequisites_for_training_authorization.length, 0);
assert.equal(contract.prelaunch_requirements.length, 3);
assert.equal(contract.authorization.status, "authorized");
assert.equal(contract.authorization.approval_id,
  "zero5-c42-aws-2026-08-28-v1");
assert.equal(contract.authorization.approved_statement,
  "Approve the $1.50 ceiling.");
assert.equal(contract.execution.instance_count, 1);
assert.equal(contract.execution.instance_type, "c6i.4xlarge");
assert.equal(contract.execution.maximum_instance_seconds, 7941);
assert.equal(contract.execution.maximum_total_ec2_usd, 1.5);
assert(contract.execution.maximum_instance_seconds *
  contract.execution.on_demand_usd_per_hour / 3600 <=
  contract.execution.maximum_total_ec2_usd);
assert((contract.execution.maximum_instance_seconds + 1) *
  contract.execution.on_demand_usd_per_hour / 3600 >
  contract.execution.maximum_total_ec2_usd);
for (const name of ["stage_script", "launcher", "user_data"]) {
  assert.equal(sha256(contract.execution[name]),
    contract.execution[name + "_sha256"]);
}
for (const source of [contract.evaluation.retention_inputs.c2_import_manifest,
  contract.evaluation.retention_inputs.c0_result]) {
  assert.equal(sha256(source.path), source.sha256);
}
assert.match(contract.test.policy,
  /content absent, not parsed, not tokenized, not packed, and not scored/u);

const selfTest = run("node", [
  contract.implementation.importer,
  "--self-test",
  "--trainer", "./zero5_c32_lm_fast",
]);
assert.match(selfTest, /grouped importer self-test passed/u);
const tensorSelfTest = run("node", [
  contract.implementation.importer,
  "--self-test",
  "--trainer", "./zero5_c32_lm_tensor",
  "--trainer-mode", "tensor",
]);
assert.match(tensorSelfTest, /grouped importer self-test passed/u);
const evaluatorSelfTest = run("node", [
  contract.implementation.evaluator,
  "--self-test",
]);
assert.match(evaluatorSelfTest, /evaluator self-test passed/u);
const runnerSelfTest = run("node", [
  contract.implementation.runner,
  "--self-test",
]);
assert.match(runnerSelfTest, /runner self-test passed/u);
assert.doesNotMatch(fs.readFileSync(contract.implementation.evaluator, "utf8"),
  /data\/test\.jsonl/u);

const localImportPath = "build/zero5-c42-v1/import-final/import.json";
if (fs.existsSync(localImportPath)) {
  const imported = JSON.parse(fs.readFileSync(localImportPath));
  assert.equal(sha256(localImportPath),
    contract.verified_import.manifest_sha256);
  assert.equal(imported.schema, "zero.c42_import.v1");
  assert.equal(imported.release.id, contract.upstream.release_id);
  assert.equal(imported.release.braid_head, contract.upstream.source_commit);
  assert.equal(imported.release.manifest.sha256,
    contract.upstream.release_manifest_sha256);
  assert.equal(imported.release.pack_plan.sha256,
    contract.upstream.pack_plan_sha256);
  assert.equal(imported.outputs.train_primary.sha256,
    contract.verified_import.primary_packs.sha256);
  assert.equal(imported.outputs.train_full.sha256,
    contract.verified_import.full_packs.sha256);
  assert.equal(imported.outputs.validation.sha256,
    contract.verified_import.validation_packs.sha256);
  assert.equal(imported.outputs.span_choices.claim.sha256,
    contract.verified_import.evaluation_artifacts.claim_span_choices.sha256);
  assert.equal(imported.outputs.span_choices.retrieval.sha256,
    contract.verified_import.evaluation_artifacts.retrieval_span_choices.sha256);
  assert.equal(imported.outputs.cloze_completion.sha256,
    contract.verified_import.evaluation_artifacts.cloze_completion.sha256);
  assert.equal(imported.outputs.validation_tasks["evidence-bundle"].sha256,
    contract.verified_import.evaluation_artifacts.evidence_validation.sha256);
  assert.equal(imported.test.content_present, false);
  assert.equal(imported.test.parsed, false);
  assert.equal(imported.test.tokenized, false);
  assert.equal(imported.test.packed, false);
  assert.equal(imported.test.metrics_opened, false);
  const preflight = run("node", [
    contract.implementation.evaluator,
    "--import-dir", "build/zero5-c42-v1/import-final",
    "--preflight-only",
  ]);
  const preflightResult = JSON.parse(preflight.trim());
  assert.equal(preflightResult.schema, "zero.c42_evaluator_preflight.v1");
  assert.equal(preflightResult.evaluator_artifacts_verified, true);
  assert.equal(preflightResult.test_metrics_opened, false);
}

process.stdout.write("ZERO.5 C4.2 evaluator and setup checks passed\n");

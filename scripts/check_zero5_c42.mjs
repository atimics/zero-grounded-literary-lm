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

assert.equal(contract.schema, "zero.c42_experiment_setup.v1");
assert.equal(contract.experiment, "zero5-c42-v1");
assert.equal(contract.status, "import-verified-training-unrun");
assert.equal(contract.authorized, false);
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
assert.equal(sha256(contract.initialization.result),
  contract.initialization.result_sha256);
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
assert.equal(contract.evaluation.evaluator_status, "not-yet-implemented");
assert.match(contract.evaluation.training_gate, /Do not authorize training/u);
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
  assert.equal(imported.test.content_present, false);
  assert.equal(imported.test.parsed, false);
  assert.equal(imported.test.tokenized, false);
  assert.equal(imported.test.packed, false);
  assert.equal(imported.test.metrics_opened, false);
}

process.stdout.write("ZERO.5 C4.2 setup checks passed\n");

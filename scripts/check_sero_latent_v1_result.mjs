#!/usr/bin/env node

import fs from "node:fs";

function read(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contract = read("benchmarks/sero-latent-v1/contract.json");
const ablation = read("benchmarks/sero-latent-v1/result.json");
const conventional = read("benchmarks/sero-latent-v1/conventional-result.json");

assert(contract.schema === "sero.latent_v1_contract.v1", "wrong contract schema");
assert(ablation.schema === "sero.latent_v1_result.v1", "wrong ablation schema");
assert(conventional.schema === "sero.latent_v1_conventional_result.v1",
  "wrong conventional-control schema");
assert(ablation.configuration.seed === contract.downstream_model.seed,
  "ablation seed drifted");
assert(ablation.inputs.train_bytes === contract.dataset.train_byte_limit,
  "training byte limit drifted");
assert(ablation.inputs.train_sha256 === conventional.inputs.train_sha256 &&
  ablation.inputs.validation_sha256 === conventional.inputs.validation_sha256,
  "the two comparisons used different input bytes");
assert(ablation.configuration.static_vocabulary_target ===
  contract.static_control.vocabulary_size, "static vocabulary target drifted");
assert(ablation.static_tokenizer.vocabulary_size ===
  contract.static_control.vocabulary_size, "static tokenizer did not reach its target");
assert(ablation.static_tokenizer.artifact_sha256 === conventional.tokenizer.sha256,
  "conventional control used a different tokenizer");

const staticArm = ablation.arms.static;
const latentArm = ablation.arms.latent;
assert(staticArm.parameters === latentArm.parameters,
  "segmentation arms have different downstream parameter counts");
assert(staticArm.patch_positions_seen === latentArm.patch_positions_seen &&
  staticArm.decoder_slots_computed === latentArm.decoder_slots_computed,
  "segmentation arms have different scheduled downstream work");
const exposureRatio = latentArm.raw_bytes_seen / staticArm.raw_bytes_seen;
assert(exposureRatio >= contract.promotion_gates.training_raw_byte_ratio_minimum &&
  exposureRatio <= contract.promotion_gates.training_raw_byte_ratio_maximum,
  "segmentation-arm training exposure missed its gate");
const coverageRatio = latentArm.validation.raw_bytes / staticArm.validation.raw_bytes;
assert(coverageRatio >= contract.promotion_gates.validation_raw_byte_ratio_minimum &&
  coverageRatio <= contract.promotion_gates.validation_raw_byte_ratio_maximum,
  "segmentation-arm validation coverage missed its gate");
assert(latentArm.validation.total_bits_per_raw_byte <=
  contract.promotion_gates.latent_relative_bits_per_byte_maximum *
  staticArm.validation.total_bits_per_raw_byte,
  "latent segmentation did not reproduce the preregistered local/global win");
assert(Object.values(ablation.gates).every(Boolean) &&
  ablation.decision === "advance-latent", "ablation decision is inconsistent");

assert(conventional.tokenizer.exact_roundtrip, "conventional tokenizer is not exact");
assert(conventional.model.patch_positions_seen === latentArm.patch_positions_seen,
  "conventional control saw a different number of patch positions");
assert(conventional.comparison.conventional_to_latent_training_raw_bytes >= 0.95 &&
  conventional.comparison.conventional_to_latent_training_raw_bytes <= 1.05,
  "conventional training exposure is not matched");
assert(conventional.comparison.conventional_to_latent_estimated_madds >= 0.90 &&
  conventional.comparison.conventional_to_latent_estimated_madds <= 1.10,
  "conventional analytic compute is not matched");
assert(conventional.model.validation.total_bits_per_raw_byte <=
  latentArm.validation.total_bits_per_raw_byte,
  "conventional control no longer matches or beats latent");
assert(Object.values(conventional.gates).every(Boolean) &&
  conventional.decision === "retain-static-control",
  "conventional-control decision is inconsistent");

console.log("Sero Latent v1 results passed frozen gates");

#!/usr/bin/env node

import fs from "node:fs";

function read(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function close(actual, expected, tolerance = 1e-12) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

const contract = read("benchmarks/sero-latent-v2/contract.json");
const aggregate = read("benchmarks/sero-latent-v2/aggregate.json");
const results = contract.seeds.map((seed) =>
  read(`benchmarks/sero-latent-v2/seed${seed}.json`));

assert(contract.schema === "sero.latent_v2_contract.v1", "wrong V2 contract schema");
assert(aggregate.schema === "sero.latent_v2_aggregate.v1", "wrong V2 aggregate schema");
assert(results.length === 3, "V2 requires exactly three frozen seeds");

for (const [index, result] of results.entries()) {
  const seed = contract.seeds[index];
  const baseline = contract.frozen_conventional_controls.seeds[index];
  assert(result.schema === "sero.latent_v2_seed_result.v1", `seed ${seed} schema drifted`);
  assert(result.seed === seed && baseline.seed === seed, `seed ${seed} ordering drifted`);
  assert(result.inputs.dataset_digest === contract.dataset.digest,
    `seed ${seed} dataset digest drifted`);
  assert(result.inputs.train_sha256 === contract.dataset.train_sha256 &&
    result.inputs.validation_sha256 === contract.dataset.validation_sha256,
    `seed ${seed} input bytes drifted`);
  assert(result.inputs.training_only_boundary_fit &&
    result.inputs.training_only_threshold_calibration &&
    result.inputs.training_only_codebook_fit, `seed ${seed} leaked validation`);
  assert(result.configuration.codebook_size === contract.codebook.vocabulary_size,
    `seed ${seed} codebook size drifted`);
  assert(result.codebook.escape_id === contract.codebook.vocabulary_size - 1,
    `seed ${seed} escape id drifted`);
  assert(result.model.patch_positions_seen ===
    contract.model.updates * contract.model.batch_size * contract.model.patch_context,
    `seed ${seed} patch budget drifted`);
  assert(close(result.comparison.conventional_bits_per_raw_byte,
    baseline.bits_per_raw_byte), `seed ${seed} conventional result drifted`);
  assert(close(result.comparison.estimated_conventional_madds_per_patch_position,
    contract.frozen_conventional_controls.estimated_madds_per_patch_position),
    `seed ${seed} conventional compute drifted`);
  assert(result.gates.exact_roundtrip && result.gates.vocabulary_size_is_4096 &&
    result.gates.training_exposure_within_five_percent &&
    result.gates.estimated_compute_within_ten_percent,
    `seed ${seed} failed an integrity or fairness gate`);
  assert(!result.gates.at_least_one_percent_better_than_conventional,
    `seed ${seed} unexpectedly passed the quality gate`);
  assert(result.model.validation.total_bits_per_raw_byte > baseline.bits_per_raw_byte,
    `seed ${seed} no-go is inconsistent with measured loss`);
  assert(result.decision === "seed-no-go", `seed ${seed} decision drifted`);
  const row = aggregate.seeds[index];
  assert(row.seed === seed && close(row.v2_bits_per_raw_byte,
    result.model.validation.total_bits_per_raw_byte),
    `seed ${seed} aggregate drifted`);
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const v2Mean = mean(results.map((result) => result.model.validation.total_bits_per_raw_byte));
const conventionalMean = mean(results.map((result) =>
  result.comparison.conventional_bits_per_raw_byte));
assert(close(aggregate.means.v2_bits_per_raw_byte, v2Mean), "V2 mean drifted");
assert(close(aggregate.means.conventional_bits_per_raw_byte, conventionalMean),
  "conventional mean drifted");
assert(aggregate.decision === "lock-static-byte-bpe" && aggregate.hard_stop_triggered,
  "V2 hard-stop decision drifted");

console.log("Sero Latent v2 hard-stop result passed frozen gates");

#!/usr/bin/env node

import crypto from "node:crypto";
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

const contractPath = "benchmarks/sero-latent-v3/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contractDigest = crypto.createHash("sha256").update(contractBytes).digest("hex");
const contract = JSON.parse(contractBytes);
const aggregate = read("benchmarks/sero-latent-v3/aggregate.json");
const results = contract.seeds.map((seed) => read(`benchmarks/sero-latent-v3/seed${seed}.json`));

assert(aggregate.schema === "sero.latent_v3_aggregate.v1", "wrong V3 aggregate schema");
assert(!aggregate.aggregate_override_used, "aggregate override is forbidden");
const datasetDigests = new Set();
const tokenizerDigests = new Set();

for (const [index, result] of results.entries()) {
  const seed = contract.seeds[index];
  assert(result.schema === "sero.latent_v3_seed_result.v1", `seed ${seed} schema drifted`);
  assert(result.seed === seed, `seed ${seed} ordering drifted`);
  assert(result.contract.sha256 === contractDigest, `seed ${seed} contract drifted`);
  assert(result.data.unique_training_bytes >= contract.data.minimum_unique_training_bytes,
    `seed ${seed} corpus is below the promotion floor`);
  assert(result.data.document_boundaries_crossed === false,
    `seed ${seed} crossed a document boundary`);
  assert(result.training.raw_byte_context === contract.data.raw_byte_context &&
    result.training.batch_size === contract.data.batch_size,
    `seed ${seed} training shape drifted`);
  assert(JSON.stringify(result.training.requested_byte_budgets) ===
    JSON.stringify(contract.data.training_byte_budgets), `seed ${seed} budgets drifted`);
  assert(result.training.raw_byte_exposure_ratio === 1 &&
    result.training.actual_raw_bytes_per_arm.latent ===
      result.training.actual_raw_bytes_per_arm.bpe_control,
    `seed ${seed} training exposure differs between arms`);
  assert(result.validation.complete_split && result.validation.raw_byte_exposure_ratio === 1 &&
    result.validation.raw_bytes_per_arm.latent === result.validation.raw_bytes_per_arm.bpe_control,
    `seed ${seed} validation exposure differs between arms`);
  assert(result.tokenizer.training_bytes === contract.bpe_control.tokenizer_training_bytes &&
    result.tokenizer.maximum_token_bytes === contract.bpe_control.maximum_token_bytes &&
    result.tokenizer.actual_vocabulary_size <= contract.bpe_control.vocabulary_size &&
    result.tokenizer.actual_vocabulary_size >= 256,
    `seed ${seed} tokenizer drifted`);
  assert(result.models.latent_parameters > 0 && result.models.bpe_parameters > 0,
    `seed ${seed} model accounting is missing`);
  assert(result.telemetry.dashboard_payload_sha256.match(/^[0-9a-f]{64}$/) &&
    result.telemetry.published === false,
    `seed ${seed} dashboard payload binding is missing or claims publication`);
  assert(result.checkpoints.length === contract.data.training_byte_budgets.length,
    `seed ${seed} checkpoint count drifted`);

  for (const checkpoint of result.checkpoints) {
    assert(checkpoint.latent.raw_bytes === checkpoint.bpe_control.raw_bytes,
      `seed ${seed} checkpoint validation bytes differ`);
    assert(close(checkpoint.comparison.latent_to_bpe_bpb_ratio,
      checkpoint.latent.bits_per_byte / checkpoint.bpe_control.bits_per_byte),
      `seed ${seed} quality ratio drifted`);
    assert(close(checkpoint.estimated_inference_compute.latent_to_bpe_ratio,
      checkpoint.estimated_inference_compute.latent_madds_per_sample /
      checkpoint.estimated_inference_compute.bpe_madds_per_sample),
      `seed ${seed} compute ratio drifted`);
    assert(checkpoint.validation_timing.total_seconds > 0 &&
      checkpoint.validation_timing.raw_bytes_per_second > 0,
      `seed ${seed} validation throughput is missing`);
  }

  const final = result.checkpoints.at(-1);
  const expectedComputeGate = final.estimated_inference_compute.latent_to_bpe_ratio >=
    contract.gates.estimated_compute_ratio_minimum &&
    final.estimated_inference_compute.latent_to_bpe_ratio <=
      contract.gates.estimated_compute_ratio_maximum;
  const expectedQualityGate = final.comparison.latent_to_bpe_bpb_ratio <=
    contract.gates.latent_final_bpb_ratio_maximum;
  assert(result.gates.estimated_compute_parity === expectedComputeGate,
    `seed ${seed} compute gate is inconsistent`);
  assert(result.gates.quality_step_change === expectedQualityGate,
    `seed ${seed} quality gate is inconsistent`);
  assert(result.decision.passed === Object.values(result.gates).every(Boolean),
    `seed ${seed} conjunction is inconsistent`);
  assert(result.status === (result.decision.passed ? "passed" : "failed"),
    `seed ${seed} status is inconsistent`);
  datasetDigests.add(result.data.dataset_digest);
  tokenizerDigests.add(result.tokenizer.sha256);
  assert(aggregate.seeds[index].seed === seed &&
    close(aggregate.seeds[index].latent_bits_per_byte, final.latent.bits_per_byte),
    `seed ${seed} aggregate drifted`);
}

assert(datasetDigests.size === 1 && tokenizerDigests.size === 1,
  "dataset or tokenizer changed between seeds");
const allPassed = results.every((result) => result.decision.passed);
assert(aggregate.all_seed_conjunction_passed === allPassed,
  "aggregate conjunction is inconsistent");
assert(aggregate.decision === (allPassed ? "promote-latent-v3" : "do-not-promote-latent-v3"),
  "aggregate decision is inconsistent");

console.log(`Sero Latent v3 result passed frozen accounting; decision=${aggregate.decision}`);

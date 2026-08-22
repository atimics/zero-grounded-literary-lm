#!/usr/bin/env node

import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contractPath = "benchmarks/sero-latent-v3/contract.json";
const contract = readJson(contractPath);
const model = fs.readFileSync("experiments/sero-latent-v3/model.py", "utf8");
const control = fs.readFileSync("experiments/sero-latent-v3/control.py", "utf8");
const data = fs.readFileSync("experiments/sero-latent-v3/data.py", "utf8");
const train = fs.readFileSync("experiments/sero-latent-v3/train.py", "utf8");

assert(contract.schema === "sero.latent_v3_contract.v1", "wrong V3 contract schema");
assert(contract.status === "preregistered-unrun", "the frozen contract must not claim a result");
assert(JSON.stringify(contract.seeds) === JSON.stringify([0, 1, 2]),
  "V3 requires seeds 0, 1, and 2");
assert(contract.data.minimum_unique_training_bytes === 100_000_000,
  "corpus promotion floor drifted");
assert(contract.data.dataset_id === "sero-pretrain" &&
  contract.data.dataset_version === "2026-08-22.v1" &&
  /^[0-9a-f]{64}$/u.test(contract.data.dataset_digest),
  "official dataset binding drifted");
assert(contract.data.raw_byte_context === 256 && contract.data.batch_size === 8,
  "raw-byte training shape drifted");
assert(JSON.stringify(contract.data.training_byte_budgets) ===
  JSON.stringify([10_000_000, 30_000_000, 100_000_000]), "training budgets drifted");
assert(contract.data.arms_share_exact_windows && !contract.data.document_boundaries_crossed,
  "data parity or document-boundary rule drifted");

const representation = contract.representation;
assert(representation.output_classes === 256 && representation.private_input_bos,
  "V3 must predict exactly 256 bytes with a private input-only BOS");
assert(!representation.end_patch_output && !representation.unknown_byte &&
  !representation.discrete_codebook && !representation.escape_path,
  "V3 regained a forbidden output or codebook path");
assert(representation.chunk_representation === "continuous-contextual-embedding",
  "V3 chunks must remain continuous contextual embeddings");
assert(representation.router === "half-one-minus-adjacent-projected-cosine" &&
  representation.boundary_threshold === 0.5 && representation.first_position_is_boundary,
  "embedding router contract drifted");
assert(representation.ratio_loss_weight === 0.03 &&
  representation.compression_target === "training-bpe-bytes-per-token",
  "compression objective drifted");

assert(contract.bpe_control.algorithm === "lossless-byte-bpe" &&
  contract.bpe_control.vocabulary_size === 4096 &&
  contract.bpe_control.maximum_token_bytes === 8 &&
  contract.bpe_control.tokenizer_training_bytes === 10_000_000,
  "BPE control drifted");
assert(contract.latent_model.global_dimension === 88 &&
  contract.latent_model.global_feed_forward === 240 &&
  contract.latent_model.global_layers === 4,
  "compute-matched latent core drifted");
assert(contract.compute_calibration.scope === "training-only" &&
  contract.compute_calibration.tokenizer_training_bytes === 10_000_000 &&
  contract.compute_calibration.dataset_digest === contract.data.dataset_digest &&
  contract.compute_calibration.measured_bytes_per_token > 1 &&
  contract.compute_calibration.measured_bytes_per_token <= 8 &&
  /^[0-9a-f]{64}$/u.test(contract.compute_calibration.tokenizer_sha256) &&
  /^[0-9a-f]{64}$/u.test(contract.compute_calibration.tokenizer_sample_schedule_sha256) &&
  contract.compute_calibration.latent_to_bpe_ratio_at_target >= 0.85 &&
  contract.compute_calibration.latent_to_bpe_ratio_at_target <= 1.15,
  "compute calibration drifted");
assert(contract.gates.estimated_compute_ratio_minimum === 0.85 &&
  contract.gates.estimated_compute_ratio_maximum === 1.15 &&
  contract.gates.latent_final_bpb_ratio_maximum === 0.99 &&
  contract.gates.all_seeds_required && !contract.gates.aggregate_override,
  "promotion gate drifted");

assert(model.includes("BYTE_VOCAB_SIZE = 256") && model.includes("BOS_ID = 256"),
  "model byte vocabulary drifted");
assert(model.includes("self.byte_embedding.weight[:BYTE_VOCAB_SIZE]"),
  "byte-only tied output is missing");
assert(model.includes("0.5 * (1.0 - similarity)"), "cosine boundary rule is missing");
assert(model.includes("confidence + (1.0 - confidence).detach()"),
  "straight-through upsampling confidence is missing");
assert(!/\beop\b/i.test(model) && !/unknown_id/i.test(model) && !/escape_id/i.test(model),
  "model source contains a forbidden output route");
assert(control.includes("initial_alphabet=[chr(PRIVATE_BYTE_BASE + byte) for byte in range(256)]"),
  "BPE no longer guarantees all raw bytes");
assert(control.includes("if self.decode(ids) != value"), "BPE exact round-trip guard is missing");
assert(data.includes("starts * self.source_weights[document.source_id]"),
  "manifest-weighted window sampling drifted");
assert(train.includes("raw = [window.data for window in windows]") &&
  train.includes("latent_model.loss(target, valid)") &&
  train.includes("encode_batch(tokenizer, raw, device)"),
  "training arms no longer consume the same raw batch");

console.log("Sero Latent v3 frozen contract passed");

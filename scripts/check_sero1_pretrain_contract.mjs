#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contract = JSON.parse(fs.readFileSync(
  "benchmarks/sero1-pretrain-v1/contract.json", "utf8"));
const tokenizer = fs.readFileSync("tokenizers/sero1-byte-bpe-4096.json");
const tokenizerDigest = crypto.createHash("sha256").update(tokenizer).digest("hex");
const model = fs.readFileSync("experiments/sero1-pretrain/model.py", "utf8");
const data = fs.readFileSync("experiments/sero1-pretrain/data.py", "utf8");
const train = fs.readFileSync("experiments/sero1-pretrain/train.py", "utf8");

assert(contract.schema === "sero.pretrain_v1_contract.v1", "wrong Sero 1 contract schema");
assert(contract.status === "preregistered-unrun", "contract must remain preregistered-unrun");
assert(JSON.stringify(contract.seeds) === JSON.stringify([0, 1, 2]) &&
  contract.canonical_seed === 0, "frozen seed set drifted");
assert(contract.data.dataset_id === "sero-pretrain" &&
  contract.data.dataset_version === "2026-08-22.v1" &&
  contract.data.dataset_digest ===
    "6919a2a55495ff3364381d0861f6295412362f6dcf5fff46fda751b779a6d6b6",
"frozen dataset binding drifted");
assert(contract.data.unique_training_bytes === 123153182 &&
  contract.data.unique_validation_bytes === 1316683 &&
  contract.data.unique_test_bytes === 1247826 &&
  contract.data.document_boundaries_crossed === false,
"frozen corpus accounting drifted");
assert(contract.tokenizer.algorithm === "lossless-byte-bpe" &&
  contract.tokenizer.vocabulary_size === 4096 &&
  contract.tokenizer.maximum_token_bytes === 8 &&
  contract.tokenizer.unknown_token === false &&
  contract.tokenizer.artifact_sha256 === tokenizerDigest,
"frozen tokenizer binding drifted");
assert(contract.model.architecture === "dense-causal-tied-embedding-transformer" &&
  contract.model.token_context === 512 && contract.model.dimension === 256 &&
  contract.model.heads === 8 && contract.model.layers === 6 &&
  contract.model.feed_forward === 1056 && contract.model.dropout === 0 &&
  contract.model.expected_parameters === 6021312,
"frozen model shape drifted");
assert(contract.training.epochs === 3 && contract.training.batch_size === 16 &&
  JSON.stringify(contract.training.checkpoint_epochs) === JSON.stringify(
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]),
"frozen training schedule drifted");
assert(contract.optimization.optimizer === "AdamW" &&
  contract.optimization.learning_rate === 0.0003 &&
  JSON.stringify(contract.optimization.betas) === JSON.stringify([0.9, 0.95]) &&
  contract.optimization.weight_decay === 0.1 &&
  contract.optimization.warmup_fraction === 0.02,
"frozen optimizer drifted");
assert(contract.gates.validation_bits_per_byte_maximum_each_seed === 2.1 &&
  contract.gates.test_bits_per_byte_maximum_each_seed === 2.1 &&
  contract.gates.final_validation_must_beat_epoch_one &&
  contract.gates.all_seeds_required && !contract.gates.aggregate_override,
"frozen gates drifted");
assert(model.includes("self.token_embedding.weight") &&
  model.includes("self.input_bos") && model.includes("diagonal=1"),
"tied output, private BOS, or causal mask is missing");
assert(data.includes("for document_index, document in enumerate(raw_documents)") &&
  data.includes("range(0, len(ids), context)") &&
  data.includes("windows do not cover every raw byte exactly once"),
"document-safe complete windowing is missing");
assert(train.includes("torch.use_deterministic_algorithms(True)") &&
  train.includes("document_boundaries_crossed\": False") &&
  train.includes("final_test = evaluate(model, corpus, \"test\""),
"determinism, boundary evidence, or held-out test is missing");

console.log("Sero 1 frozen pretraining contract passed");

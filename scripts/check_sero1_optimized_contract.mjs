#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const contract = JSON.parse(fs.readFileSync(
  "benchmarks/sero1-optimized-v1/contract.json", "utf8"));
const execution = JSON.parse(fs.readFileSync(
  "benchmarks/sero1-optimized-v1/aws-execution.json", "utf8"));
const tokenizer = fs.readFileSync("tokenizers/sero1-byte-bpe-4096.json");
const tokenizerDigest = crypto.createHash("sha256").update(tokenizer).digest("hex");
const data = fs.readFileSync("experiments/sero1-pretrain/data.py", "utf8");
const train = fs.readFileSync("experiments/sero1-optimized/train.py", "utf8");
const builder = fs.readFileSync("scripts/build_sero_article_corpus.py", "utf8");

assert.equal(contract.schema, "sero.optimized_pretrain_contract.v1");
assert.equal(contract.status, "diagnostic-seed0-unrun");
assert.equal(contract.pilot_seed, 0);
assert.equal(contract.data.dataset_id, "sero-pretrain-article");
assert.equal(contract.data.dataset_version, "2026-08-22.v2");
assert.equal(contract.data.dataset_digest,
  "0cefd7a464177abec1ce32349aca957ac2a82d4d53cb0c9a7775defb13ace82d");
assert.equal(contract.data.unique_training_bytes, 123081945);
assert.equal(contract.data.unique_validation_bytes, 1360728);
assert.equal(contract.data.unique_test_bytes, 1230862);
assert.equal(contract.data.split_unit, "original-source-article");
assert.equal(contract.data.articles_present_in_multiple_splits, 0);
assert.equal(contract.data.unmarked_document_boundaries, 0);
assert.equal(contract.tokenizer.artifact_sha256, tokenizerDigest);
assert.equal(contract.tokenizer.end_of_document_byte_hex, "00");
assert.equal(contract.tokenizer.end_of_document_token_id, 188);
assert.equal(contract.model.expected_parameters, 6021312);
assert.equal(contract.training.epochs, 6);
assert.equal(contract.training.batch_size, 16);
assert.deepEqual(contract.training.checkpoint_epochs, [0.5, 1, 2, 3, 4, 5, 6]);
assert.equal(contract.training.unlikelihood_branch_epoch, 5);
assert.equal(contract.objectives.branch_unlikelihood_alpha, 0.1);
assert.equal(contract.objectives.branch_unlikelihood_ngram, 4);
assert.equal(contract.evaluation.primary_metric,
  "content-bits-per-raw-byte-excluding-end-of-document-loss");
assert.equal(contract.pilot_decisions.do_not_open_seeds_1_and_2_until_seed0_report, true);
assert.equal(contract.pilot_decisions.no_promotion_from_this_pilot, true);

assert.ok(builder.includes("reconstruct_articles") &&
  builder.includes("article_sha256") && builder.includes("assign_splits"));
assert.ok(data.includes("class EodTokenizedCorpus") &&
  data.includes("batch_negative_token_ids") && data.includes("lengths.append(0)"));
for (const required of ["mode == \"unlikelihood\"", "model-branch-epoch5.pt",
  "content_bits_per_byte", "end_of_document", "torch.use_deterministic_algorithms(True)"])
  assert.ok(train.includes(required), `optimized trainer omits ${required}`);

assert.equal(execution.schema, "sero.optimized_pretrain_aws_execution.v1");
assert.equal(execution.region, "us-east-1");
assert.equal(execution.instance_type, "g5.xlarge");
assert.equal(execution.on_demand_usd_per_hour, 1.006);
assert.equal(execution.calibration.maximum_updates, 128);
assert.equal(execution.calibration.maximum_instance_seconds, 1800);
assert.equal(execution.base.maximum_instance_seconds, 7200);
assert.equal(execution.unlikelihood_branch.maximum_instance_seconds, 3600);
assert.equal(execution.pilot_maximum_ec2_usd, 3.521);
assert.equal(execution.controls.seeds_1_and_2_closed, true);

for (const file of ["scripts/aws/sero1-optimized-user-data.sh",
  "scripts/aws/sero1-optimized-run-instances.sh"]) {
  const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
}

console.log("Sero 1 optimized pilot contract passed");

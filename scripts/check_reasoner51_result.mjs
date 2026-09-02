import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const dir = "benchmarks/reasoner51-unseen-primitive-v1";
const bytes = name => readFileSync(`${dir}/${name}`);
const hash = value => createHash("sha256").update(value).digest("hex");
const raw = bytes("RESULT.json");
const executionRaw = bytes("EXECUTION.json");
const contractRaw = bytes("contract.json");
const result = JSON.parse(raw);
const execution = JSON.parse(executionRaw);
const provenance = JSON.parse(bytes("PROVENANCE.json"));
const hex = bytes("ARTIFACT.hex").toString().replace(/\s/g, "");
assert.match(hex, /^(?:[0-9a-f]{2})+$/);
const artifact = Buffer.from(hex, "hex");
assert.equal(hash(raw), "105981287a9a1099262d183f4527568eef760326bf8ffad4a8af207fae98db7d");
assert.equal(hash(executionRaw), "9b0dca5235e44998954dfb8f416ba4bb7d535954e90f219072377792950bbc62");
assert.equal(hash(contractRaw), "81e43051427103a79fb7374fb17105a9d748421a696527ed9cb16c9179d39852");
assert.equal(hash(artifact), "02cfe62e3bb61bf8739eccfcd82d591cdb5c142639ba192ffbd54d9cd8a6f049");
assert.equal(artifact.length, 224);
assert.equal(raw.length, provenance.artifacts.result_bytes);
assert.equal(executionRaw.length, provenance.artifacts.execution_bytes);
assert.equal(hash(raw), provenance.artifacts.result_sha256);
assert.equal(hash(executionRaw), provenance.artifacts.execution_sha256);
assert.equal(hash(contractRaw), provenance.contract_sha256);
assert.equal(hash(artifact), provenance.artifacts.source_artifact_sha256);
assert.equal(provenance.source.commit, "287fb462e5f736e037fb235cd23e35348904b0b5");
assert.equal(provenance.artifacts.execution_lock_sha256,
  "a4a25c7af1f88c865f957ac187313097921a0db226cf7820151d0a22b37a9e80");
const gate = result.adapter_verified && result.artifact_frozen_before_target &&
  result.verifier_authoritative && result.source_ablation_control_valid &&
  result.adapter_reconstruction_queries === 8 && result.adapter_challenge_queries === 6 &&
  result.adapter_checks_passed === 6 && result.full_exact_matches === 24 &&
  result.oracle_exact_matches === 24 && result.full_expansions === result.oracle_expansions &&
  result.full_expansions * 100 <= result.target_only_expansions * 80 &&
  ["identity_adapter", "shuffled_adapter", "no_query_adapter", "token_id_lookup"]
    .every(arm => result.full_expansions < result[`${arm}_expansions`]) &&
  result.individual_wins_vs_target_only >= 16 && result.unverified_top_candidates > 0 &&
  result.premature_commits === 0 &&
  result.source_ablation_expansions === result.target_only_expansions;
assert.equal(gate, true);
assert.equal(result.gate_pass, gate);
assert.equal(result.decision, "pass");
assert.equal(execution.decision, result.decision);
assert.equal(execution.execution_count, 1);
assert.equal(execution.retry_count, 0);
assert.equal(execution.post_open_tuning, false);
assert.equal(execution.elapsed_ms, provenance.execution.elapsed_milliseconds);
assert.equal(execution.executed_at_utc, provenance.executed_at_utc);
assert.equal(result.full_expansions, 45);
assert.equal(result.target_only_expansions, 105);
console.log("Reasoner 5.1 result integrity and gate passed");

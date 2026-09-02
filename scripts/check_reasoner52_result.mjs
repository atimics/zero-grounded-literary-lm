import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const dir = "benchmarks/reasoner52-nonlinear-depth-transfer-v1";
const bytes = name => readFileSync(`${dir}/${name}`);
const hash = value => createHash("sha256").update(value).digest("hex");
const raw = bytes("RESULT.json");
const executionRaw = bytes("EXECUTION.json");
const contractRaw = bytes("contract.json");
const r = JSON.parse(raw);
const e = JSON.parse(executionRaw);
const p = JSON.parse(bytes("PROVENANCE.json"));
const hex = bytes("ARTIFACT.hex").toString().replace(/\s/g, "");
assert.match(hex, /^(?:[0-9a-f]{2})+$/);
const artifact = Buffer.from(hex, "hex");
assert.equal(hash(raw), "d177c3588245adb0874ac4d4cdbffcbb20c68626cd3597b8ea35b18dd2e6bc76");
assert.equal(hash(executionRaw), "13f257beb4c5f994909ee99ecd9b347484c12f70b6fbb83e083c56dab420746f");
assert.equal(hash(contractRaw), "0fdad6e0cb40991136d3a61930d95c5a94c3c58d0075b71ef923ceb54f569fc0");
assert.equal(hash(artifact), "7e0e087d14a0380dea21afb008e7a77237a7bd7f660012c789e2615f9b2320e6");
assert.equal(artifact.length, 176);
assert.equal(raw.length, p.artifacts.result_bytes);
assert.equal(executionRaw.length, p.artifacts.execution_bytes);
assert.equal(hash(raw), p.artifacts.result_sha256);
assert.equal(hash(executionRaw), p.artifacts.execution_sha256);
assert.equal(hash(artifact), p.artifacts.source_artifact_sha256);
assert.equal(hash(contractRaw), p.contract_sha256);
assert.equal(p.source.commit, "21328411eb4fd032ac68a5526be263280b97ed6a");
assert.equal(p.artifacts.execution_lock_sha256,
  "d9ba159c5c36751e1776107ae80d0879d18152ca0621faf50b55a02b77c7d868");
const gates = {
  artifact_frozen: r.artifact_frozen_before_target,
  verifier: r.exact_truth_table_authoritative,
  source_ablation: r.source_ablation_control_valid && r.source_ablation_expansions === r.target_only_expansions,
  nonlinear: r.nonlinear_target_episodes === 24,
  exact: r.full_exact_matches === 24 && r.oracle_exact_matches === 24,
  oracle: r.oracle_expansions === 24,
  checks: r.full_truth_table_checks === r.full_expansions,
  aggregate: r.full_expansions * 100 <= r.target_only_expansions * 80,
  controls: ["affine_projection", "degree_blind", "shuffled_source", "source_only"]
    .every(arm => r.full_expansions < r[`${arm}_expansions`]),
  individual_wins: r.individual_wins_vs_target_only >= 16,
  verifier_correction: r.unverified_top_candidates > 0 && r.premature_commits === 0,
};
assert.deepEqual(Object.entries(gates).filter(([, value]) => !value).map(([name]) => name), ["individual_wins"]);
assert.equal(r.gate_pass, Object.values(gates).every(Boolean));
assert.equal(r.decision, "no-go");
assert.equal(e.decision, r.decision);
assert.equal(e.execution_count, 1);
assert.equal(e.retry_count, 0);
assert.equal(e.post_open_tuning, false);
assert.equal(e.elapsed_ms, p.execution.elapsed_milliseconds);
assert.equal(e.executed_at_utc, p.executed_at_utc);
assert.equal(r.full_expansions, 30);
assert.equal(r.target_only_expansions, 44);
assert.equal(r.individual_wins_vs_target_only, 8);
console.log("Reasoner 5.2 recorded decision and integrity passed");

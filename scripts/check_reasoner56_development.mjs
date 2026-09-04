#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const experiment = "reasoner56-passive-noise-development-v1";
const root = `benchmarks/${experiment}`;
const contract = JSON.parse(readFileSync(`${root}/contract.json`, "utf8"));

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function runDevelopment(directory) {
  const result = path.join(directory, "result.json");
  const trace = path.join(directory, "raw-trace.jsonl");
  const artifact = path.join(directory, "artifact.bin");
  const run = spawnSync("./reasoner56",
    ["develop", result, trace, artifact], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return {
    result: readFileSync(result),
    trace: readFileSync(trace),
    artifact: readFileSync(artifact),
  };
}

assert.equal(contract.schema,
  "zero.reasoner56_passive_noise_development_contract.v1");
assert.equal(contract.status, "development-only");
assert.equal(contract.execution.authorized, false);
assert.equal(contract.execution.sealed_seeds_present, false);
assert.equal(contract.execution.scientific_executions, 0);
assert.equal(contract.domain.syntax_programs, 512);
assert.equal(contract.domain.semantic_classes, 427);
assert.equal(contract.channel.sensors, 3);
assert.equal(contract.channel.minimum_leaf_support, 32);
assert.deepEqual(contract.calibration.temperature_grid,
  [0.25, 0.5, 1, 2, 4, 8]);
assert.equal(contract.calibration.candidate_set_coverage, 0.99);

for (const [file, expected] of Object.entries(contract.protected_sources))
  assert.equal(sha256(readFileSync(file)), expected,
    `${file} changed while Reasoner 5.6 was built`);
for (const [file, expected] of Object.entries(contract.implementation.files))
  assert.equal(sha256(readFileSync(file)), expected,
    `${file} hash differs from the development contract`);

const selfTest = spawnSync("./reasoner56", ["--self-test"],
  { encoding: "utf8" });
assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
assert.match(selfTest.stdout, /self-test passed/u);

const firstDirectory = mkdtempSync(path.join(tmpdir(), "reasoner56-a-"));
const secondDirectory = mkdtempSync(path.join(tmpdir(), "reasoner56-b-"));
try {
  const first = runDevelopment(firstDirectory);
  const second = runDevelopment(secondDirectory);
  assert.deepEqual(first.result, second.result,
    "development result is not byte deterministic");
  assert.deepEqual(first.trace, second.trace,
    "development trace is not byte deterministic");
  assert.deepEqual(first.artifact, second.artifact,
    "development artifact is not byte deterministic");

  const committed = {
    result: readFileSync(`${root}/development/result.json`),
    trace: readFileSync(`${root}/development/raw-trace.jsonl`),
    artifact: readFileSync(`${root}/development/artifact.bin`),
  };
  assert.deepEqual(first.result, committed.result,
    "committed development result changed");
  assert.deepEqual(first.trace, committed.trace,
    "committed development trace changed");
  assert.deepEqual(first.artifact, committed.artifact,
    "committed development artifact changed");
  for (const [name, bytes] of Object.entries(committed))
    assert.equal(sha256(bytes), contract.development_outputs[name].sha256,
      `${name} digest differs from the development contract`);

  const result = JSON.parse(first.result.toString("utf8"));
  assert.equal(result.schema, "zero.reasoner56_development_result.v1");
  assert.equal(result.status, "development-only");
  assert.equal(result.scientific_decision, null);
  assert.equal(result.sealed_execution_authorized, false);
  assert.equal(result.syntax_programs, 512);
  assert.equal(result.semantic_classes, 427);
  assert.equal(result.trace_rows, 30);
  assert.equal(result.exact_rows, 30);
  assert.equal(result.normalized_rows, 30);
  assert.equal(result.source_ablation_matches, 6);
  assert.equal(result.fallback_rows, 5);
  assert.equal(result.invalid_first_rejections, 30);
  assert.equal(result.artifact_roundtrip_valid, true);
  assert.equal(result.hidden_field_rejections, 2);
  assert.equal(result.calibration_fit_episodes, 8);
  assert.equal(result.calibration_coverage_episodes, 8);
  assert.match(result.calibration_fit_digest, /^[0-9a-f]{16}$/u);
  assert.match(result.calibration_coverage_digest, /^[0-9a-f]{16}$/u);
  assert.notEqual(result.calibration_fit_digest,
    result.calibration_coverage_digest);
  assert.ok(result.temperature_index >= 0 && result.temperature_index < 6);
  assert.ok(result.conformal_mass_q20 > 0 &&
    result.conformal_mass_q20 <= 1048576);
  assert.equal(result.candidate_set_rows, 6);
  assert.equal(result.candidate_set_truth_covered, 6);

  const rows = first.trace.toString("utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 30);
  const arms = ["full", "source_free", "source_ablation", "one_trim",
    "markov_off"];
  const keys = new Set();
  for (const row of rows) {
    assert.equal(row.schema, "zero.reasoner56_development_trace.v1");
    assert.equal(row.experiment, experiment);
    assert.equal(row.lane, "development");
    assert.ok(arms.includes(row.arm));
    assert.equal(row.exact, true);
    assert.equal(row.certificate_valid, true);
    assert.equal(row.premature_commit, false);
    assert.equal(row.injected_invalid_rejected, true);
    assert.equal(row.global_cap_hit, false);
    assert.ok(Math.abs(row.probability_sum - 1) <= 1e-12);
    assert.ok(row.verifier_checks >= 2);
    assert.equal(row.verifier_checks,
      row.proposal_verifier_checks + row.fallback_verifier_checks);
    assert.ok(row.partial_expansions >= row.verifier_checks);
    assert.equal(row.primary_cost, row.verifier_checks);
    assert.equal(row.candidate_universe_count, 427);
    assert.match(row.candidate_universe_digest, /^[0-9a-f]{16}$/u);
    assert.match(row.initial_evidence_digest, /^[0-9a-f]{16}$/u);
    assert.match(row.verifier_digest, /^[0-9a-f]{16}$/u);
    assert.match(row.artifact_digest, /^[0-9a-f]{16}$/u);
    const key = `${row.episode_id}\0${row.arm}`;
    assert.equal(keys.has(key), false, `duplicate trace row ${key}`);
    keys.add(key);
    if (row.arm === "full" || row.arm === "markov_off")
      assert.ok(row.source_artifact_reads > 0);
    if (["source_free", "source_ablation", "one_trim"].includes(row.arm))
      assert.equal(row.source_artifact_reads, 0);
  }
  for (let episode = 0; episode < 6; ++episode) {
    const group = rows.filter(row => row.episode_id === `dev-${episode}`);
    assert.deepEqual(group.map(row => row.arm), arms);
    for (const field of ["family_id", "cross_family_id",
      "nested_repeat_id", "observation_queries", "candidate_universe_count",
      "candidate_universe_digest", "initial_evidence_digest",
      "verifier_digest", "artifact_digest"])
      assert.equal(new Set(group.map(row => row[field])).size, 1,
        `${field} parity failed on dev-${episode}`);
    const sourceFree = { ...group.find(row => row.arm === "source_free"),
      arm: "common" };
    const sourceAblation = {
      ...group.find(row => row.arm === "source_ablation"), arm: "common",
    };
    assert.deepEqual(sourceAblation, sourceFree,
      `source ablation differs on dev-${episode}`);
  }

  assert.equal(first.artifact.subarray(0, 8).toString("ascii"),
    "R56ART1\0");
  assert.equal(first.artifact.readUInt32LE(8), 1);
  assert.equal(first.artifact.readUInt32LE(12), 17);
  assert.equal(first.artifact.readUInt32LE(16), 8);
  assert.equal(first.artifact.readUInt32LE(20), 3);
  assert.equal(first.artifact.readUInt32LE(24), 512);
  assert.equal(first.artifact.readUInt32LE(28), 427);
  assert.equal(first.artifact.readUInt32LE(32), 3);
  assert.equal(first.artifact.readUInt32LE(40), 32);
  assert.equal(first.artifact.length, contract.artifact.serialized_bytes);
} finally {
  rmSync(firstDirectory, { recursive: true, force: true });
  rmSync(secondDirectory, { recursive: true, force: true });
}

const unauthorized = spawnSync("./reasoner56", ["execute"], {
  encoding: "utf8",
  env: { ...process.env, REASONER56_APPROVAL: "forged" },
});
assert.equal(unauthorized.status, 3);
assert.match(unauthorized.stderr, /not authorized/u);

console.log("Reasoner 5.6 development checks passed");

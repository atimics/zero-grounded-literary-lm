#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

import { stableJson } from "./zero_data_lib.mjs";
import {
  assertManifestDigest,
  assertRawTraceCoverage,
  assertResultReplay,
} from "./lib/reasoner5_harness.mjs";
import {
  R56_ANALYSIS_SETTINGS,
  R56_EXPERIMENT,
  assessR56ChannelReadiness,
  auditR56ProxyTaint,
  buildR56HarnessBundle,
  reconstructR56Result,
} from "./lib/reasoner56_development.mjs";

const root = `benchmarks/${R56_EXPERIMENT}`;
const contractPath = `${root}/contract.json`;
const updateFixtures = process.argv.includes("--update-fixtures");
const sanitizersOnly = process.argv.includes("--sanitizers-only");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function expectFailure(action, pattern) {
  assert.throws(action, pattern);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runSanitizers() {
  const directory = mkdtempSync(path.join(tmpdir(), "reasoner56-sanitize-"));
  try {
    const binary = path.join(directory, "reasoner56-sanitize");
    run(process.env.CC || "cc", [
      "-O1", "-g", "-std=c11", "-Wall", "-Wextra", "-Wpedantic",
      "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
      "reasoner56.c", "reasoner56_cli.c", "-lm", "-o", binary,
    ]);
    run(binary, ["--self-test"], {
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:halt_on_error=1",
        UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1" },
    });
    run(binary, ["develop", path.join(directory, "result.json"),
      path.join(directory, "trace.jsonl"), path.join(directory, "artifact.bin")], {
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:halt_on_error=1",
        UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1" },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (sanitizersOnly) {
  runSanitizers();
  console.log("Reasoner 5.6 sanitizer checks passed");
  process.exit(0);
}

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
assert.equal(contract.schema,
  "zero.reasoner56_passive_noise_development_contract.v2");
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
assert.equal(contract.calibration.fit_program_families, 16);
assert.equal(contract.calibration.coverage_program_families, 99);
assert.equal(contract.calibration.draws_per_program_family, 8);
assert.equal(contract.generators.development_program_families, 8);
assert.equal(contract.generators.development_corruption_families, 8);
assert.equal(contract.generators.nested_repeats, 2);
assert.equal(contract.arms.length, 45);

for (const [file, expected] of Object.entries(contract.protected_sources))
  assert.equal(sha256(readFileSync(file)), expected,
    `${file} changed while Reasoner 5.6 was built`);
if (!updateFixtures) {
  for (const [file, expected] of Object.entries(contract.implementation.files))
    assert.equal(sha256(readFileSync(file)), expected,
      `${file} hash differs from the development contract`);
}

run("./reasoner56", ["--self-test"]);

function runDevelopment(directory) {
  const resultPath = path.join(directory, "result.json");
  const tracePath = path.join(directory, "raw-trace.jsonl");
  const artifactPath = path.join(directory, "artifact.bin");
  run("./reasoner56", ["develop", resultPath, tracePath, artifactPath]);
  return {
    result: readFileSync(resultPath),
    trace: readFileSync(tracePath),
    artifact: readFileSync(artifactPath),
  };
}

const firstDirectory = mkdtempSync(path.join(tmpdir(), "reasoner56-a-"));
const secondDirectory = mkdtempSync(path.join(tmpdir(), "reasoner56-b-"));
try {
  const first = runDevelopment(firstDirectory);
  const second = runDevelopment(secondDirectory);
  assert.deepEqual(first.result, second.result,
    "development result must be byte deterministic");
  assert.deepEqual(first.trace, second.trace,
    "development trace must be byte deterministic");
  assert.deepEqual(first.artifact, second.artifact,
    "development artifact must be byte deterministic");

  const nativeResult = JSON.parse(first.result.toString("utf8"));
  const nativeRows = first.trace.toString("utf8").trim().split("\n")
    .map(JSON.parse);
  assert.equal(nativeResult.schema, "zero.reasoner56_development_result.v2");
  assert.equal(nativeResult.status, "development-only");
  assert.equal(nativeResult.scientific_decision, null);
  assert.equal(nativeResult.sealed_execution_authorized, false);
  assert.equal(nativeResult.episodes, 128);
  assert.equal(nativeResult.trace_rows, 5760);
  assert.equal(nativeResult.exact_rows, 5760);
  assert.equal(nativeResult.normalized_rows, 5760);
  assert.equal(nativeResult.source_ablation_matches, 128);
  assert.equal(nativeResult.invalid_first_rejections, 5760);
  assert.equal(nativeResult.artifact_roundtrip_valid, true);
  assert.equal(nativeResult.hidden_field_rejections, 2);
  assert.equal(nativeResult.calibration_fit_episodes, 16);
  assert.equal(nativeResult.calibration_coverage_episodes, 99);
  assert.equal(nativeResult.calibration_fit_families, 16);
  assert.equal(nativeResult.calibration_coverage_families, 99);
  assert.equal(nativeResult.proxy_audit_passed, true);
  assert.equal(nativeResult.taint_audit_passed, true);
  assert.ok(nativeResult.target_only_median_cost >= 16);
  assert.equal(nativeRows.length, 5760);
  assert.equal(new Set(nativeRows.map(row => row.episode_id)).size, 128);
  assert.equal(new Set(nativeRows.map(row => row.arm)).size, 45);
  assert.ok(nativeRows.every(row => row.exact && row.certificate_valid &&
    row.injected_invalid_rejected && !row.global_cap_hit &&
    Math.abs(row.probability_sum - 1) <= 1e-12));
  assert.ok(nativeRows.every(row => row.primary_cost === row.verifier_checks &&
    row.verifier_checks === row.proposal_verifier_checks +
      row.fallback_verifier_checks &&
    row.partial_expansions >= row.verifier_checks &&
    row.observation_queries === 18 && row.observations_consumed === 18));

  const bundle = buildR56HarnessBundle({ nativeRows, nativeResult,
    artifactBytes: first.artifact });
  assert.equal(bundle.rawRows.length, 5760);
  assert.equal(bundle.coverage.rows, 5760);
  assert.equal(bundle.replayReceipt.episodes, 128);
  assert.equal(bundle.result.status, "development-only");
  assert.equal(bundle.result.scientific_decision, null);
  assert.equal(bundle.result.exactness.all_final_answers_exact, true);
  assert.equal(bundle.audit.passed, true);
  assert.equal(bundle.audit.accuracy_delta, 0);
  assert.equal(bundle.readiness.scope, "development-only");
  assert.deepEqual(bundle.assessment.harness_gate.failures,
    contract.development_expected_gate_failures);

  const harnessRaw = Buffer.from(bundle.rawRows.map(row =>
    `${JSON.stringify(row)}\n`).join(""));
  const harnessCompressed = gzipSync(harnessRaw, { level: 9, mtime: 0 });
  harnessCompressed[9] = 255;
  const generated = {
    result: first.result,
    trace: first.trace,
    artifact: first.artifact,
    manifest: Buffer.from(stableJson(bundle.manifest)),
    harness_trace: harnessCompressed,
    harness_result: Buffer.from(stableJson(bundle.result)),
    audit: Buffer.from(stableJson(bundle.audit)),
    assessment: Buffer.from(stableJson(bundle.assessment)),
  };

  if (updateFixtures) {
    for (const [name, bytes] of Object.entries(generated)) {
      const output = contract.development_outputs[name];
      assert.ok(output, `contract needs a development output for ${name}`);
      writeFileSync(output.path, bytes);
    }
  } else {
    for (const [name, bytes] of Object.entries(generated)) {
      const output = contract.development_outputs[name];
      const committed = readFileSync(output.path);
      assert.deepEqual(bytes, committed,
        `${name} differs from the committed development fixture`);
      assert.equal(sha256(committed), output.sha256,
        `${name} digest differs from the development contract`);
    }
  }

  const badManifest = structuredClone(bundle.manifest);
  badManifest.source_artifact.sha256 = "0".repeat(64);
  expectFailure(() => assertManifestDigest(badManifest), /SHA-256|digest/u);

  const taintedRows = [...bundle.rawRows];
  const sourceIndex = taintedRows.findIndex(row => row.arm === "source_free");
  taintedRows[sourceIndex] = { ...taintedRows[sourceIndex],
    source_artifact_reads: 1 };
  expectFailure(() => assertRawTraceCoverage({ manifest: bundle.manifest,
    rawTraces: taintedRows }), /read the source artifact/u);
  const taintedAudit = auditR56ProxyTaint(bundle.manifest, taintedRows,
    nativeResult);
  assert.equal(taintedAudit.passed, false);

  const leakingManifest = structuredClone(bundle.manifest);
  for (const episode of leakingManifest.episodes) {
    const orderSlot = episode.content.evaluator.episode_spec.order_slot;
    episode.cross_family_id = `mechanism-${orderSlot}`;
  }
  const leakingAudit = auditR56ProxyTaint(leakingManifest, bundle.rawRows,
    nativeResult);
  assert.equal(leakingAudit.passed, false);
  assert.equal(leakingAudit.maximum_template_fraction_per_nonopaque_cell, 1);

  const changedResult = structuredClone(bundle.result);
  changedResult.result_sha256 = "0".repeat(64);
  expectFailure(() => assertResultReplay({
    experiment: R56_EXPERIMENT,
    manifest: bundle.manifest,
    rawTraces: bundle.rawRows,
    reconstruct: reconstructR56Result,
    analysisSettings: R56_ANALYSIS_SETTINGS,
    result: changedResult,
  }), /does not reproduce/u);

  const changedReadiness = assessR56ChannelReadiness(nativeRows, {
    ...bundle.audit, passed: false,
  });
  assert.equal(changedReadiness.status, "development-no-go");
  assert.deepEqual(changedReadiness.failures,
    ["interface_and_proxy_audits_clean"]);

  assert.equal(first.artifact.subarray(0, 8).toString("ascii"), "R56ART1\0");
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

runSanitizers();
console.log(updateFixtures ?
  "Reasoner 5.6 development fixtures updated" :
  "Reasoner 5.6 development checks passed");

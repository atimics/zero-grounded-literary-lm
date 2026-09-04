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
  canonicalDigest,
  assertManifestDigest,
  assertRawTraceCoverage,
  assertResultReplay,
} from "./lib/reasoner5_harness.mjs";
import {
  R56_ANALYSIS_SETTINGS,
  R56_EXPERIMENT,
  assertR56CalibrationCoverageReplay,
  assessR56ChannelReadiness,
  auditR56ProxyTaint,
  buildR56HarnessBundle,
  reconstructR56Result,
  selectSemanticSplits,
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
  "zero.reasoner56_passive_noise_development_contract.v4");
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
assert.equal(contract.shared_harness.commit,
  "2303a1a1769a7e4ccd32f5167e18645550651509");
assert.equal(sha256(readFileSync("scripts/lib/reasoner5_harness.mjs")),
  contract.shared_harness.library_sha256,
"shared harness hash differs from the R5.6 contract");
assert.equal(contract.shared_harness.bootstrap_receipt_schema, "v2");
assert.equal(contract.shared_harness.confidence_interval_method,
  "ordinary-percentile-bootstrap");
assert.equal(contract.shared_harness.p_value_method,
  "recentered-null-bootstrap");

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
  assert.equal(nativeResult.schema, "zero.reasoner56_development_result.v3");
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
  assert.equal(nativeResult.calibration_coverage_records.length, 99);
  assert.ok(nativeResult.calibration_coverage_records.every((record, index) =>
    record.family_index === index && record.draws === 8 &&
    record.all_draws_covered === true &&
    Number.isInteger(record.worst_truth_cumulative_mass_q20) &&
    record.worst_truth_cumulative_mass_q20 >= 1 &&
    record.worst_truth_cumulative_mass_q20 <= 1048576));
  assert.equal(nativeResult.proxy_audit_passed, true);
  assert.equal(nativeResult.taint_audit_passed, true);
  assert.equal(nativeResult.conformal_mass_q20, 1048576);
  assert.equal(nativeResult.candidate_set_total_size, 128 * 427);
  assert.equal(nativeResult.candidate_set_truth_covered, 128);
  assert.ok(nativeResult.target_only_median_cost >= 16);
  assert.equal(nativeRows.length, 5760);
  assert.equal(new Set(nativeRows.map(row => row.episode_id)).size, 128);
  assert.equal(new Set(nativeRows.map(row => row.arm)).size, 45);
  assert.ok(nativeRows.every(row => row.exact && row.certificate_valid &&
    row.injected_invalid_rejected && !row.global_cap_hit &&
    Math.abs(row.probability_sum - 1) <= 1e-12));
  assert.ok(nativeRows.every(row => row.candidate_set_size === 427 &&
    row.candidate_set_contains_truth));
  assert.ok(nativeRows.every(row => row.primary_cost === row.verifier_checks &&
    row.verifier_checks === row.proposal_verifier_checks +
      row.fallback_verifier_checks &&
    row.partial_expansions >= row.verifier_checks &&
    row.observation_queries === 18 && row.observations_consumed === 18));

  const splits = selectSemanticSplits();
  const splitClasses = [splits.source, splits.fit, splits.coverage,
    splits.development, splits.sealed].flat();
  assert.equal(new Set(splitClasses).size, splitClasses.length,
    "semantic classes must stay disjoint across every registered lane");
  const byEpisodeArm = new Map(nativeRows.map(row =>
    [`${row.episode_id}:${row.arm}`, row]));
  for (const episodeId of new Set(nativeRows.map(row => row.episode_id))) {
    const sourceFree = structuredClone(byEpisodeArm.get(
      `${episodeId}:source_free`));
    const sourceAblation = structuredClone(byEpisodeArm.get(
      `${episodeId}:source_ablation`));
    delete sourceFree.arm;
    delete sourceAblation.arm;
    assert.deepEqual(sourceAblation, sourceFree,
      `source-free aliases diverged for ${episodeId}`);
  }

  const bundle = buildR56HarnessBundle({ nativeRows, nativeResult,
    artifactBytes: first.artifact });
  assert.equal(bundle.rawRows.length, 5760);
  assert.equal(bundle.coverage.rows, 5760);
  assert.equal(bundle.replayReceipt.episodes, 128);
  assert.equal(bundle.calibrationReplayReceipt.families, 99);
  assert.equal(bundle.calibrationReplayReceipt.episodes, 792);
  assert.equal(bundle.calibrationReplayReceipt.covered, 99);
  assert.equal(bundle.manifest.calibration_coverage_receipt.candidate_set_rule,
    "exact-full-universe-at-threshold-one");
  assert.ok(bundle.manifest.calibration_coverage_receipt.families.every(
    family => family.all_draws_covered && family.draws.every(draw =>
      draw.candidate_set_size === 427 &&
      draw.candidate_set_contains_truth)));
  assert.equal(bundle.result.status, "development-only");
  assert.equal(bundle.result.scientific_decision, null);
  assert.equal(bundle.result.exactness.all_final_answers_exact, true);
  const inferences = [
    bundle.result.registered_analysis.primary,
    ...bundle.result.registered_analysis.strata.map(item => item.inference),
    ...bundle.result.registered_analysis.mechanisms.map(item => item.inference),
  ];
  assert.ok(inferences.every(inference =>
    inference.interval.schema.endsWith("_bootstrap.v2") &&
    inference.interval.confidence_interval_method ===
      "ordinary-percentile-bootstrap" &&
    inference.interval.p_value_method === "recentered-null-bootstrap" &&
    /^[0-9a-f]{64}$/u.test(inference.interval.null_bootstrap_sha256)));
  assert.equal(bundle.result.registered_analysis.primary.interval
    .null_bootstrap_sha256,
  contract.shared_harness.primary_null_bootstrap_sha256);
  assert.equal(bundle.audit.passed, true);
  assert.equal(bundle.audit.accuracy_delta, 0);
  assert.ok(bundle.audit.severity.accuracy_delta <= 0.02);
  assert.ok(bundle.audit.maximum_severity_fraction_per_nonopaque_cell < 1);
  assert.equal(bundle.readiness.scope, "development-only");
  assert.equal(bundle.readiness.status, "development-no-go");
  assert.deepEqual(bundle.readiness.failures,
    contract.development_expected_readiness_failures);
  assert.equal(bundle.readiness.metrics.candidate_set.full_mean_size, 427);
  assert.equal(bundle.readiness.metrics.candidate_set
    .program_prior_only_mean_size, 427);
  assert.equal(bundle.readiness.metrics.candidate_set.size_ratio, 1);
  assert.equal(bundle.readiness.metrics.candidate_set.coverage_families, 99);
  assert.equal(bundle.readiness.metrics.candidate_set.covered_families, 99);
  assert.ok(bundle.readiness.metrics.candidate_set
    .one_sided_95_wilson_lower >= 0.97);
  assert.equal(bundle.readiness.metrics.interface_and_proxy_audits
    .sealed.status, "pending-preregistration");
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

  const badCalibrationManifest = structuredClone(bundle.manifest);
  const badCalibrationReceipt =
    badCalibrationManifest.calibration_coverage_receipt;
  badCalibrationReceipt.families[0].draws[0].content_sha256 = "0".repeat(64);
  const badCalibrationBody = structuredClone(badCalibrationReceipt);
  delete badCalibrationBody.receipt_sha256;
  badCalibrationReceipt.receipt_sha256 = canonicalDigest(
    "r56-calibration-coverage-receipt", badCalibrationBody);
  expectFailure(() => assertR56CalibrationCoverageReplay(
    badCalibrationManifest, first.artifact), /content digest changed/u);

  const forgedCoverageManifest = structuredClone(bundle.manifest);
  const forgedCoverageReceipt =
    forgedCoverageManifest.calibration_coverage_receipt;
  forgedCoverageReceipt.families[0].all_draws_covered = false;
  const forgedCoverageBody = structuredClone(forgedCoverageReceipt);
  delete forgedCoverageBody.receipt_sha256;
  forgedCoverageReceipt.receipt_sha256 = canonicalDigest(
    "r56-calibration-coverage-receipt", forgedCoverageBody);
  expectFailure(() => assertR56CalibrationCoverageReplay(
    forgedCoverageManifest, first.artifact), /family coverage changed/u);

  const forgedNativeResult = structuredClone(nativeResult);
  forgedNativeResult.calibration_coverage_records[0].all_draws_covered = false;
  expectFailure(() => buildR56HarnessBundle({ nativeRows,
    nativeResult: forgedNativeResult, artifactBytes: first.artifact }),
  /native calibration coverage differs from independent replay/u);

  const forgedDrawManifest = structuredClone(bundle.manifest);
  const forgedDrawReceipt = forgedDrawManifest.calibration_coverage_receipt;
  forgedDrawReceipt.families[0].draws[0].candidate_set_size = 1;
  const forgedDrawBody = structuredClone(forgedDrawReceipt);
  delete forgedDrawBody.receipt_sha256;
  forgedDrawReceipt.receipt_sha256 = canonicalDigest(
    "r56-calibration-coverage-receipt", forgedDrawBody);
  expectFailure(() => assertR56CalibrationCoverageReplay(
    forgedDrawManifest, first.artifact), /coverage outcome changed/u);

  const changedArtifact = Buffer.from(first.artifact);
  changedArtifact[128] ^= 1;
  expectFailure(() => assertR56CalibrationCoverageReplay(bundle.manifest,
    changedArtifact), /artifact SHA-256 changed/u);

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

  const severityLeakingManifest = structuredClone(bundle.manifest);
  for (const episode of severityLeakingManifest.episodes) {
    const orderSlot = episode.content.evaluator.episode_spec.order_slot;
    episode.content.evaluator.episode_spec.corruption_family.severity =
      1 + orderSlot % 4;
  }
  const severityLeakingAudit = auditR56ProxyTaint(severityLeakingManifest,
    bundle.rawRows, nativeResult);
  assert.equal(severityLeakingAudit.passed, false);
  assert.equal(severityLeakingAudit
    .maximum_severity_fraction_per_nonopaque_cell, 1);

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
  }, bundle.manifest, first.artifact);
  assert.equal(changedReadiness.status, "development-no-go");
  assert.deepEqual(changedReadiness.failures,
    contract.development_expected_readiness_failures);
  assert.equal(changedReadiness.metrics.interface_and_proxy_audits
    .development.status, "failed");

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

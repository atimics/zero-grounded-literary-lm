#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertManifestReplay,
  buildResultFromRawTraces,
  canonicalDigest,
} from "./lib/reasoner5_harness.mjs";
import {
  R59A_ANALYSIS_SETTINGS,
  R59A_ARMS,
  R59A_EXPERIMENT,
  R59A_SOURCE_ISOLATED_ARMS,
  buildR59Manifest,
  buildR59SourceArtifact,
  createR59ReplayRegistry,
  generateR59RawRows,
  reconstructR59Development,
} from "./lib/reasoner59a_symbolic.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root,
  "benchmarks/reasoner59a-symbolic-transfer-v1");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function atomicWrite(path, bytes) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

function sourceReceipt(paths) {
  return Object.fromEntries(paths.map(path => {
    const bytes = readFileSync(resolve(root, path));
    return [path, { bytes: bytes.length, sha256: sha256(bytes) }];
  }));
}

function developmentNote(result) {
  const primary = result.registered_analysis.primary;
  const headroom = result.registered_analysis.headroom;
  const directions = result.development_measurements.transfer_directions;
  const failedStrata = result.registered_analysis.strata.filter(item =>
    item.inference.interval.point_ratio > 0.9 ||
    item.inference.interval.upper_ratio >= 1).map(item => item.name);
  const directionLines = directions.map(direction =>
    `- ${direction.source_generator} to ${direction.target_generator}: ` +
    `${direction.full_primary_cost.toLocaleString("en-US")} full checks and ` +
    `${direction.target_only_primary_cost.toLocaleString("en-US")} ` +
    "target-only checks;").join("\n");
  return `# Reasoner 5.9a development result

Status: \`${result.decision}\` development evidence.

The symbolic prerequisite ran on 16 generated families with two public tie
orders per family. This produced 32 episodes and 1,280 arm rows. Every answer
was checked against all 25,344 symbolic scenes. The checker executes every raw
row again from the frozen manifest and source artifact. It then rebuilds every
answer, certificate, counter, family statistic, and final result.

The full source prior had a family-weighted geometric mean cost ratio of
${primary.summary.family_weighted_geometric_mean_ratio.toFixed(4)} against target-only. It won
${primary.summary.wins} of 16 families. Its one-sided 99.5 percent upper ratio was
${primary.interval.upper_ratio.toFixed(4)}. The registered upper-limit test therefore did not
pass. The target-only median was ${headroom.median_primary_cost.toFixed(1)} verifier checks,
inside the frozen 16 through 64 measurement range.

The two transfer directions had different totals:

${directionLines}

The common gate failures were ${result.gate.failures.join(", ")}.
The required stratum failures were ${failedStrata.join(", ")}.
Exactness, invalid-first rejection, fallback charging, source-ablation
equality, proposal-record binding, work-charge floors, subtype-preserving
derangement integrity, and the source-free measurement floor passed. The
derangement randomization p-value was above its registered maximum.

This result is a development diagnostic. It supports a redesign of the
generator-transfer prior before a sealed 5.9a run. Reasoner 5.9b stays closed.
Its parser, renderer, pixel-family manifest, controls, and analysis still need
complete hash commitments before any sealed 5.9a seed can open.
`;
}

function main() {
  if (!process.argv.includes("--write"))
    throw new Error("development fixture generation requires explicit --write");
  const work = mkdtempSync(resolve(tmpdir(), "reasoner59a-development-"));
  try {
    const corePath = resolve(work, "CORE-DEVELOPMENT.json");
    execFileSync(resolve(root, "reasoner59a"), ["development", corePath], {
      stdio: "inherit",
    });
    const coreBytes = readFileSync(corePath);
    const artifact = buildR59SourceArtifact();
    const manifest = buildR59Manifest(artifact);
    const replay = assertManifestReplay(manifest, createR59ReplayRegistry());
    const rawTraces = generateR59RawRows(manifest, artifact);
    const result = buildResultFromRawTraces({
      experiment: R59A_EXPERIMENT,
      manifest,
      rawTraces,
      reconstruct: reconstructR59Development,
      analysisSettings: R59A_ANALYSIS_SETTINGS,
      expectedArms: R59A_ARMS,
      selectedLanes: ["development"],
      sourceIsolatedArms: R59A_SOURCE_ISOLATED_ARMS,
    });
    mkdirSync(output, { recursive: true });
    const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const traceBytes = Buffer.from(
      `${rawTraces.map(row => JSON.stringify(row)).join("\n")}\n`);
    const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    atomicWrite(resolve(output, "CORE-DEVELOPMENT.json"), coreBytes);
    atomicWrite(resolve(output, "SOURCE-ARTIFACT.json"), artifactBytes);
    atomicWrite(resolve(output, "MANIFEST.json"), manifestBytes);
    atomicWrite(resolve(output, "DEVELOPMENT-TRACE.jsonl"), traceBytes);
    atomicWrite(resolve(output, "DEVELOPMENT.json"), resultBytes);
    atomicWrite(resolve(output, "DEVELOPMENT.md"), developmentNote(result));
    const contractBody = {
      schema: "zero.reasoner59a_development_contract.v1",
      experiment: R59A_EXPERIMENT,
      status: "development-only",
      stage: "reasoner59a-symbolic-prerequisite",
      execution: {
        authorized: false,
        sealed_seeds_present: false,
        scientific_executions: 0,
      },
      future_reasoner59b: {
        status: "execution-closed",
        design_frozen: false,
        must_freeze_before_sealed_reasoner59a_opening: true,
        required_commitments: [
          "parser_bytes_sha256",
          "renderer_code_sha256",
          "renderer_settings_sha256",
          "paired_pixel_manifest_sha256",
          "controls_sha256",
          "analysis_sha256",
        ],
      },
      source_files: sourceReceipt([
        "Makefile",
        "reasoner59a.h",
        "reasoner59a.c",
        "reasoner59a_cli.c",
        "scripts/lib/reasoner5_harness.mjs",
        "scripts/lib/reasoner59a_symbolic.mjs",
        "scripts/run_reasoner59a_development.mjs",
        "scripts/check_reasoner59a_development.mjs",
        "benchmarks/reasoner59a-symbolic-transfer-v1/SPEC.md",
        "benchmarks/reasoner59a-symbolic-transfer-v1/DEVELOPMENT.md",
        "benchmarks/reasoner5-next-set-v1/PLAN.json",
      ]),
      fixtures: {
        "CORE-DEVELOPMENT.json": { bytes: coreBytes.length,
          sha256: sha256(coreBytes) },
        "SOURCE-ARTIFACT.json": { bytes: artifactBytes.length,
          sha256: sha256(artifactBytes) },
        "MANIFEST.json": { bytes: manifestBytes.length,
          sha256: sha256(manifestBytes) },
        "DEVELOPMENT-TRACE.jsonl": { bytes: traceBytes.length,
          sha256: sha256(traceBytes) },
        "DEVELOPMENT.json": { bytes: resultBytes.length,
          sha256: sha256(resultBytes) },
      },
      receipts: {
        source_artifact_sha256: artifact.artifact_sha256,
        manifest_sha256: manifest.manifest_sha256,
        manifest_replay_sha256: replay.replay_sha256,
        raw_trace_sha256: result.raw_trace_sha256,
        result_sha256: result.result_sha256,
        result_decision: result.decision,
      },
    };
    const contract = {
      ...contractBody,
      contract_sha256: canonicalDigest("reasoner59a-development-contract",
        contractBody),
    };
    atomicWrite(resolve(output, "CONTRACT.json"),
      `${JSON.stringify(contract, null, 2)}\n`);
    console.log(`Reasoner 5.9a development fixture: ${rawTraces.length} rows; ` +
      `manifest replay ${replay.replay_sha256}; decision ${result.decision}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();

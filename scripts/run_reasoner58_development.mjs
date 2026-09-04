#!/usr/bin/env node

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
} from "./lib/reasoner5_harness.mjs";
import {
  R58_ANALYSIS_SETTINGS,
  R58_ARMS,
  R58_EXPERIMENT,
  R58_SOURCE_ISOLATED_ARMS,
  buildR58Manifest,
  createR58ReplayRegistry,
  generateR58RawRows,
  parseR58Artifact,
  reconstructR58Development,
} from "./lib/reasoner58_replay.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root,
  "benchmarks/reasoner58-compositional-behavior-transfer-v1");

function atomicWrite(path, bytes) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

function main() {
  if (!process.argv.includes("--write")) {
    throw new Error("development fixture generation requires explicit --write");
  }
  const work = mkdtempSync(resolve(tmpdir(), "reasoner58-development-"));
  try {
    const corePath = resolve(work, "CORE-DEVELOPMENT.json");
    const artifactPath = resolve(work, "SOURCE_ARTIFACT.hex");
    execFileSync(resolve(root, "reasoner58"), ["development", corePath,
      artifactPath], { stdio: "inherit" });
    const coreBytes = readFileSync(corePath);
    const artifactText = readFileSync(artifactPath, "utf8").trim();
    const artifact = parseR58Artifact(Buffer.from(artifactText, "hex"));
    const manifest = buildR58Manifest(artifact);
    const replay = assertManifestReplay(manifest, createR58ReplayRegistry());
    const rawTraces = generateR58RawRows(manifest, artifact);
    const result = buildResultFromRawTraces({
      experiment: R58_EXPERIMENT,
      manifest,
      rawTraces,
      reconstruct: reconstructR58Development,
      analysisSettings: R58_ANALYSIS_SETTINGS,
      expectedArms: R58_ARMS,
      selectedLanes: ["development"],
      sourceIsolatedArms: R58_SOURCE_ISOLATED_ARMS,
    });
    mkdirSync(output, { recursive: true });
    atomicWrite(resolve(output, "CORE-DEVELOPMENT.json"), coreBytes);
    atomicWrite(resolve(output, "SOURCE_ARTIFACT.hex"), `${artifactText}\n`);
    atomicWrite(resolve(output, "MANIFEST.json"),
      `${JSON.stringify(manifest, null, 2)}\n`);
    atomicWrite(resolve(output, "DEVELOPMENT-TRACE.jsonl"),
      `${rawTraces.map(row => JSON.stringify(row)).join("\n")}\n`);
    atomicWrite(resolve(output, "DEVELOPMENT.json"),
      `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Reasoner 5.8 development fixture: ${rawTraces.length} rows; ` +
      `manifest replay ${replay.replay_sha256}; decision ${result.decision}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();

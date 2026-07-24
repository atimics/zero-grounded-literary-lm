#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SAMPLE_COUNT = 64;

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function indices(total, count = SAMPLE_COUNT) {
  if (!Number.isInteger(total) || total < count || count < 2) {
    fail("invalid stratified sample dimensions");
  }
  return Array.from(
    { length: count },
    (_, index) => Math.floor(index * (total - 1) / (count - 1)),
  );
}

export function sample(bundle, output) {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  fs.mkdirSync(output, { recursive: true });
  const datasets = {};
  for (const [id, metadata] of Object.entries(manifest.datasets)) {
    const source = path.join(bundle, metadata.path);
    if (sha256(source) !== metadata.sha256) fail(`${id} source hash mismatch`);
    const lines = fs.readFileSync(source, "utf8").replace(/\n$/u, "").split("\n");
    const header = lines.shift();
    if (lines.length !== metadata.cases) fail(`${id} case count mismatch`);
    const selectedIndices = indices(lines.length);
    const destination = path.join(output, `${id}.tsv`);
    fs.writeFileSync(
      destination,
      `${header}\n${selectedIndices.map((index) => lines[index]).join("\n")}\n`,
    );
    datasets[id] = {
      path: path.basename(destination),
      sha256: sha256(destination),
      bytes: fs.statSync(destination).size,
      cases: SAMPLE_COUNT,
      source_sha256: metadata.sha256,
      selection: "64 evenly spaced ordinals including first and last",
      ordinals: selectedIndices,
    };
  }
  const result = {
    schema: "zero.external_eval_calibration_bundle.v1",
    source_manifest_sha256: sha256(path.join(bundle, "manifest.json")),
    datasets,
  };
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function selfTest() {
  const actual = indices(100);
  if (actual.length !== 64 || actual[0] !== 0 || actual[63] !== 99 ||
      new Set(actual).size !== 64) {
    fail("stratified index self-test failed");
  }
  console.log("ZERO-EVAL-1 calibration sampling self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const bundleIndex = process.argv.indexOf("--bundle");
    const outputIndex = process.argv.indexOf("--output");
    if (bundleIndex < 0 || outputIndex < 0) {
      fail("usage: sample_zero_eval1_calibration.mjs --bundle DIR --output DIR");
    }
    console.log(JSON.stringify(
      sample(process.argv[bundleIndex + 1], process.argv[outputIndex + 1]),
      null,
      2,
    ));
  }
}

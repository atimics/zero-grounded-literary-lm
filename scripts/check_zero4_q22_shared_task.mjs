#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

if (process.argv.length !== 4) {
  fail("usage: check_zero4_q22_shared_task.mjs MANIFEST GENERATED_DIRECTORY");
}

const manifestPath = path.resolve(process.argv[2]);
const outputDirectory = path.resolve(process.argv[3]);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.schema !== "zero.q22_shared_task_surface.v1" ||
    manifest.shared_task_id !== "zero-solomon.q22-operation.v1") {
  fail("unexpected shared-task manifest");
}

for (const name of ["dataset", "eval_set"]) {
  const binding = manifest[name];
  if (!binding || !/^[a-f0-9]{64}$/.test(binding.sha256)) fail(`invalid ${name} binding`);
  const file = path.join(outputDirectory, binding.path);
  if (sha256(file) !== binding.sha256) fail(`${name} SHA-256 mismatch`);
}

const training = fs.readFileSync(path.join(outputDirectory, manifest.dataset.path), "utf8")
  .trim().split("\n").map(JSON.parse);
if (training.length !== manifest.records.train || training.some((record) => record.split !== "train")) {
  fail("shared dataset must contain only the frozen training split");
}

const evaluation = fs.readFileSync(path.join(outputDirectory, manifest.eval_set.path), "utf8")
  .trim().split("\n");
if (evaluation[0] !== "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary" ||
    evaluation.length - 1 !== manifest.records.eval) {
  fail("shared evaluation set has the wrong shape");
}

const trainingIds = new Set(training.map((record) => record.id));
const evaluationIds = evaluation.slice(1).map((row) => row.split("\t", 1)[0]);
if (new Set(evaluationIds).size !== evaluationIds.length ||
    evaluationIds.some((id) => trainingIds.has(id) || !id.startsWith("quantity-request/promotion/"))) {
  fail("training and evaluation IDs are not disjoint");
}

for (const [name, binding] of Object.entries(manifest.source_files)) {
  if (sha256(path.resolve(path.dirname(manifestPath), "../..", binding.path)) !== binding.sha256) {
    fail(`${name} source SHA-256 mismatch`);
  }
}

console.log(`q22 shared task surface passed: ${training.length} training rows, ${evaluationIds.length} disjoint evaluation rows`);

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

if (process.argv.length !== 4) fail("usage: check_q22_compositional_shared_task.mjs MANIFEST GENERATED_DIRECTORY");
const manifestPath = path.resolve(process.argv[2]);
const generated = path.resolve(process.argv[3]);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema !== "zero.q22_compositional_shared_task_surface.v1" ||
    manifest.shared_task_id !== "zero-solomon.q22-compositional-routing.v1") fail("shared-task manifest identity drifted");
if (manifest.generation.train !== manifest.records.train || manifest.generation.eval !== manifest.records.eval ||
    manifest.generation.seed !== 23) fail("generation contract drifted");
const expectedInvariants = {
  common_prefix: "Route this quantity case.",
  common_prefix_tokens: 4,
  class_count: 5,
  prefix_only_exact_rate_ppm: 200000,
  train_template_families: 30,
  promotion_template_families: 20,
  template_families_disjoint: true,
  normalized_template_surfaces_disjoint: true,
  decoy_classes_balanced_per_target: true,
  literal_operation_identifiers_absent_from_inputs: true,
};
for (const [name, value] of Object.entries(expectedInvariants)) {
  if (manifest.invariants[name] !== value) fail(`${name} invariant drifted`);
}

for (const name of ["canonical", "dataset", "eval_set"]) {
  const binding = manifest[name];
  if (!binding || sha256(path.join(generated, binding.path)) !== binding.sha256) fail(`${name} binding drifted`);
}
for (const [name, binding] of Object.entries(manifest.source_files)) {
  const source = path.resolve(path.dirname(manifestPath), "../..", binding.path);
  if (sha256(source) !== binding.sha256) fail(`${name} source binding drifted`);
}

const canonical = fs.readFileSync(path.join(generated, manifest.canonical.path), "utf8").trimEnd().split("\n").map(JSON.parse);
const training = fs.readFileSync(path.join(generated, manifest.dataset.path), "utf8").trimEnd().split("\n").map(JSON.parse);
const evaluation = fs.readFileSync(path.join(generated, manifest.eval_set.path), "utf8").trimEnd().split("\n");
if (canonical.length !== manifest.records.train + manifest.records.eval || training.length !== manifest.records.train ||
    training.some((record) => record.split !== "train") || evaluation.length - 1 !== manifest.records.eval) fail("shared-task record counts drifted");
if (evaluation[0] !== "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary") fail("evaluation header drifted");

const trainingIds = new Set(training.map((record) => record.id));
const evaluationRows = evaluation.slice(1).map((line) => line.split("\t"));
if (evaluationRows.some((fields) => fields.length !== 8 || trainingIds.has(fields[0]))) fail("evaluation split is not disjoint");
const prefixKeys = new Set(canonical.map((record) => record.input.split(/\s+/).slice(0, 4).join(" ")));
if (prefixKeys.size !== 1 || [...prefixKeys][0] !== manifest.invariants.common_prefix) fail("common prefix invariant drifted");
const evalCounts = new Map();
for (const fields of evaluationRows) evalCounts.set(fields[4], (evalCounts.get(fields[4]) ?? 0) + 1);
if (evalCounts.size !== 5 || [...evalCounts.values()].some((count) => count !== manifest.records.eval / 5)) fail("evaluation classes are not balanced");
const prefixMajority = Math.max(...evalCounts.values());
if (Math.floor(prefixMajority * 1000000 / manifest.records.eval) !== manifest.invariants.prefix_only_exact_rate_ppm) fail("prefix-only baseline drifted");

const trainFamilies = new Set(training.map((record) => record.template_family));
const evalFamilies = new Set(canonical.filter((record) => record.split === "promotion").map((record) => record.template_family));
if (trainFamilies.size !== manifest.invariants.train_template_families ||
    evalFamilies.size !== manifest.invariants.promotion_template_families) fail("template-family count drifted");
if ([...trainFamilies].some((family) => evalFamilies.has(family))) fail("template families overlap");
const trainSignatures = new Set(training.map((record) => record.template_signature));
const evalSignatures = new Set(canonical.filter((record) => record.split === "promotion").map((record) => record.template_signature));
if ([...trainSignatures].some((signature) => evalSignatures.has(signature))) fail("normalized template surfaces overlap");
if (canonical.some((record) => record.input.includes("quantity."))) fail("literal operation identifier leaked into an input");

for (const split of ["train", "promotion"]) {
  const splitRecords = canonical.filter((record) => record.split === split);
  const targetCounts = new Map();
  const decoyCounts = new Map();
  for (const record of splitRecords) {
    targetCounts.set(record.task, (targetCounts.get(record.task) ?? 0) + 1);
    const key = `${record.task}/${record.decoy_task}`;
    decoyCounts.set(key, (decoyCounts.get(key) ?? 0) + 1);
  }
  const perTarget = splitRecords.length / manifest.invariants.class_count;
  if (targetCounts.size !== manifest.invariants.class_count ||
      [...targetCounts.values()].some((count) => count !== perTarget)) fail(`${split} target balance drifted`);
  const perDecoy = perTarget / (manifest.invariants.class_count - 1);
  if (decoyCounts.size !== manifest.invariants.class_count * (manifest.invariants.class_count - 1) ||
      [...decoyCounts.values()].some((count) => count !== perDecoy)) fail(`${split} decoy balance drifted`);
}

console.log(`Q22 compositional shared task passed: ${training.length} train, ${evaluationRows.length} disjoint promotion, prefix-only ${manifest.invariants.prefix_only_exact_rate_ppm} ppm`);

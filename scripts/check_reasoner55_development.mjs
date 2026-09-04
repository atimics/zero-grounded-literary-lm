#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root,
  "benchmarks/reasoner55-generated-primitive-transfer-v1");
const resultPath = process.argv[2] ?? resolve(fixture, "DEVELOPMENT.json");
const tracePath = process.argv[3] ?? resolve(fixture, "DEVELOPMENT-TRACE.jsonl");
const artifactPath = process.argv[4] ?? resolve(fixture, "SOURCE_ARTIFACT.hex");
const contractPath = resolve(fixture, "contract.json");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : Math.floor((ordered[middle - 1] + ordered[middle]) / 2);
}

function sameFields(left, right, fields, label) {
  for (const field of fields) {
    check(left[field] === right[field], `${label}: ${field} differs`);
  }
}

const resultBytes = readFileSync(resultPath);
const traceBytes = readFileSync(tracePath);
const artifactText = readFileSync(artifactPath, "utf8").trim();
const contract = JSON.parse(readFileSync(contractPath));
const result = JSON.parse(resultBytes);
const lines = traceBytes.toString("utf8").trim().split("\n");
const rows = lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`trace row ${index + 1}: ${error.message}`);
  }
});

check(result.schema === "zero.reasoner55_development.v1",
  "unexpected development schema");
check(contract.schema === "zero.reasoner55_development_contract.v1",
  "unexpected development contract schema");
check(contract.experiment === result.experiment,
  "contract and result experiment IDs differ");
check(contract.status === "development-only" &&
  contract.execution.authorized === false &&
  contract.execution.allowed_lane === "development" &&
  contract.execution.sealed_manifest === null &&
  contract.execution.sealed_seed_family === null &&
  contract.execution.cloud_run === null,
  "contract execution boundary changed");
for (const [field, path] of [
  ["core_sha256", "reasoner55.c"],
  ["header_sha256", "reasoner55.h"],
  ["cli_sha256", "reasoner55_cli.c"],
  ["development_checker_sha256", "scripts/check_reasoner55_development.mjs"],
]) {
  check(sha256(readFileSync(resolve(root, path))) ===
    contract.implementation[field], `implementation digest changed for ${path}`);
}
for (const [field, path] of [
  ["reasoner51_c_sha256", "reasoner51.c"],
  ["reasoner52_c_sha256", "reasoner52.c"],
  ["reasoner5_followup_c_sha256", "reasoner5_followup.c"],
]) {
  check(sha256(readFileSync(resolve(root, path))) ===
    contract.implementation.protected_predecessors[field],
  `protected predecessor changed for ${path}`);
}
check(result.experiment === "reasoner55-generated-primitive-transfer-v1",
  "unexpected experiment ID");
check(result.status === "development-only", "fixture must stay development-only");
check(result.execution_authorized === false,
  "development fixture must keep execution authorization false");
check(JSON.stringify(result.field) ===
  JSON.stringify({ modulus: 5, lanes: 3, points: 125 }),
  "unexpected finite field");
check(JSON.stringify(result.program) === JSON.stringify({
  primitives: 8, length: 4, syntax_candidates: 4096,
}), "unexpected program grammar");
check(result.source_families === 128, "expected 128 source families");
check(result.development_families === 8, "expected 8 development families");
check(result.generator_environments === 4, "expected four generator environments");
check(result.episodes === 32, "expected 32 development episodes");
check(result.trace_rows === 1280 && rows.length === 1280,
  "expected 1,280 arm rows");
check(result.proposal_budget === 64 && result.global_cap === 4096,
  "unexpected search caps");
check(result.derangements === 31, "expected 31 frozen derangements");
check(result.adapter.reconstructions === 8 && result.adapter.exact === 8,
  "every development adapter must reconstruct exactly");
check(result.adapter.domain_checks === 8 * 8 * 125,
  "adapter must check every primitive on every vector");
check(result.generator_sequence_differences === 4,
  "independent generators must differ on every paired fixture");
check(result.semantic_collisions > 0,
  "the syntax universe must contain semantic collisions");
check(result.source_ablation.matches === result.source_ablation.cases &&
  result.source_ablation.cases === 32,
  "source ablation must match the source-free path");
check(result.full_oracle.matches === result.full_oracle.cases &&
  result.full_oracle.cases === 32,
  "exact adapter and oracle must match");
check(result.target_only_headroom.median >= 16 &&
  result.target_only_headroom.median <= 64,
  "target-only development median must be between 16 and 64");
check(result.development_selection.strongest_source_free_arm === "target_only" &&
  result.development_selection.target_only_primary_cost <=
    result.development_selection.source_free_jit_primary_cost,
  "development must freeze the strongest source-free comparator");

check(/^[0-9a-f]{64}$/.test(result.artifact_sha256),
  "invalid artifact digest");
check(/^[0-9a-f]{64}$/.test(result.raw_trace_sha256),
  "invalid trace digest");
check(sha256(traceBytes) === result.raw_trace_sha256,
  "raw trace digest mismatch");
check(contract.trace.raw_sha256 === result.raw_trace_sha256,
  "contract trace digest mismatch");
check(/^[0-9a-f]+$/.test(artifactText) && artifactText.length % 2 === 0,
  "source artifact must be canonical lowercase hex");
const artifact = Buffer.from(artifactText, "hex");
check(artifact.length === 1823, "unexpected source artifact size");
check(sha256(artifact) === result.artifact_sha256,
  "source artifact digest mismatch");
check(contract.source_artifact.sha256 === result.artifact_sha256,
  "contract artifact digest mismatch");
check(artifact.subarray(0, 8).toString("ascii") === "R55A0001",
  "unexpected source artifact magic");
check([...artifact.subarray(8, 13)].join(",") === "5,3,8,4,2",
  "unexpected source artifact header");
let artifactOffset = 13;
for (let generator = 0; generator < 2; generator += 1) {
  check(artifact[artifactOffset] === generator,
    `artifact guide ${generator}: wrong generator ID`);
  artifactOffset += 1;
  check(artifact.readUInt32LE(artifactOffset) === 64,
    `artifact guide ${generator}: wrong source family count`);
  artifactOffset += 4;
  check(artifact.readUInt32LE(artifactOffset) === 64,
    `artifact guide ${generator}: wrong source solution count`);
  artifactOffset += 4 + (4 * ((4 * 8) + (3 * 8 * 8)));
}
check(artifactOffset === artifact.length, "source artifact has trailing bytes");

const expectedBaseArms = [
  "target_only", "adapter_only", "raw_lexical", "full",
  "oracle_adapter", "frequency_lexical", "source_free_jit",
  "source_ablation", "source_only",
];
const expectedArms = [
  ...expectedBaseArms,
  ...Array.from({ length: 31 }, (_, index) =>
    `shuffled_${String(index).padStart(2, "0")}`),
];
check(result.arms.length === expectedArms.length, "unexpected arm summary count");
check(result.arms.map(({ arm }) => arm).join("|") === expectedArms.join("|"),
  "arm summary order changed");

const hashFields = [
  "ast_sha256", "behavior_sha256", "episode_spec_sha256",
  "allowed_actions_digest", "latent_episode_digest",
  "potential_response_digest", "candidate_universe_digest",
  "initial_evidence_digest", "grammar_digest", "verifier_digest",
  "caps_digest", "accepted_semantic_sha256", "proposal_order_sha256",
];
const parityFields = [
  "ast_sha256", "behavior_sha256", "episode_spec_sha256",
  "allowed_actions_digest", "latent_episode_digest",
  "potential_response_digest", "candidate_universe_digest",
  "initial_evidence_digest", "grammar_digest", "verifier_digest",
  "caps_digest",
];
const equalityFields = [
  "exact", "certificate_valid", "premature_commit", "primary_cost",
  "verifier_checks", "partial_expansions", "observation_queries",
  "verifier_domain_points", "fallback_started", "fallback_work_counted",
  "global_cap_hit", "injected_invalid", "injected_invalid_rejected",
  "injected_counterexample_index", "source_artifact_reads",
  "accepted_semantic_sha256", "proposal_order_sha256",
];
const sourceArms = new Set([
  "raw_lexical", "full", "oracle_adapter", "frequency_lexical",
  "source_only", ...expectedArms.filter((arm) => arm.startsWith("shuffled_")),
]);
const episodeRows = new Map();
const familyRows = new Map();
const environmentKeys = new Set();
for (const [index, row] of rows.entries()) {
  const label = `trace row ${index + 1}`;
  check(row.schema === "zero.reasoner55_trace_row.v1", `${label}: schema`);
  check(row.experiment === result.experiment, `${label}: experiment`);
  check(row.lane === "development", `${label}: lane`);
  check(["syntax-first", "skeleton-first"].includes(row.source_generator_id),
    `${label}: source generator`);
  check(["syntax-first", "skeleton-first"].includes(row.generator_id),
    `${label}: target generator`);
  check(row.cross_family_id === null, `${label}: cross family must be null`);
  check(["tie-0", "tie-1"].includes(row.nested_repeat_id),
    `${label}: nested repeat`);
  check(row.shift_stratum ===
    (row.source_generator_id === row.generator_id
      ? "same-generator" : "cross-generator"), `${label}: shift stratum`);
  check(expectedArms.includes(row.arm), `${label}: unknown arm`);
  check(row.exact === true && row.certificate_valid === true,
    `${label}: exact certificate`);
  check(row.premature_commit === false, `${label}: premature commit`);
  check(row.verifier_checks > 0 && row.verifier_checks <= 4096,
    `${label}: verifier count`);
  check(row.partial_expansions >= row.verifier_checks,
    `${label}: partial expansion accounting`);
  check(row.observation_queries === 0, `${label}: observation count`);
  check(row.wall_ns === 0 && row.peak_bytes === 0,
    `${label}: deterministic development resources`);
  check(row.verifier_domain_points === 125, `${label}: verifier domain`);
  check(row.fallback_work_counted === true, `${label}: fallback accounting`);
  check(row.global_cap_hit === false, `${label}: unexpected cap hit`);
  check(row.primary_cost === row.verifier_checks,
    `${label}: primary cost accounting`);
  check(row.injected_invalid === true && row.injected_invalid_rejected === true,
    `${label}: invalid-first rejection`);
  check(Number.isInteger(row.injected_counterexample_index) &&
    row.injected_counterexample_index >= 0 &&
    row.injected_counterexample_index < 125,
    `${label}: injected counterexample`);
  for (const field of hashFields)
    check(/^[0-9a-f]{64}$/.test(row[field]), `${label}: ${field}`);
  check(row.accepted_semantic_sha256 === row.behavior_sha256,
    `${label}: accepted semantics`);
  check(row.source_artifact_reads === (sourceArms.has(row.arm) ? 905 : 0),
    `${label}: source artifact read accounting`);
  environmentKeys.add(`${row.source_generator_id}|${row.generator_id}`);
  const episode = episodeRows.get(row.episode_id) ?? [];
  episode.push(row);
  episodeRows.set(row.episode_id, episode);
  const familyKey = `${row.source_generator_id}|${row.generator_id}|${row.family_id}`;
  const family = familyRows.get(familyKey) ?? [];
  family.push(row);
  familyRows.set(familyKey, family);
}
check(environmentKeys.size === 4, "all four generator environments are required");
check(episodeRows.size === 32, "expected 32 distinct episode IDs");
check(familyRows.size === 16, "expected 16 independent environment-family units");

for (const [episodeId, episode] of episodeRows) {
  check(episode.length === 40, `${episodeId}: expected 40 arms`);
  const byArm = new Map(episode.map((row) => [row.arm, row]));
  check(byArm.size === 40, `${episodeId}: duplicate or missing arm`);
  check(expectedArms.every((arm) => byArm.has(arm)),
    `${episodeId}: incomplete arm set`);
  for (const row of episode.slice(1))
    sameFields(episode[0], row, parityFields, `${episodeId}: arm parity`);
  sameFields(byArm.get("source_free_jit"), byArm.get("source_ablation"),
    equalityFields, `${episodeId}: source ablation`);
  sameFields(byArm.get("full"), byArm.get("oracle_adapter"),
    equalityFields, `${episodeId}: oracle adapter`);
  sameFields(byArm.get("target_only"), byArm.get("adapter_only"),
    equalityFields, `${episodeId}: guide-off factorial parity`);
}

for (const [familyId, family] of familyRows) {
  check(new Set(family.map((row) => row.nested_repeat_id)).size === 2,
    `${familyId}: expected two nested tie repeats`);
  check(family.length === 80, `${familyId}: expected 80 nested arm rows`);
}

for (const arm of result.arms) {
  const armRows = rows.filter((row) => row.arm === arm.arm);
  check(armRows.length === 32, `${arm.arm}: expected 32 rows`);
  const sums = {
    primary_cost: 0,
    verifier_checks: 0,
    partial_expansions: 0,
    exact_answers: 0,
    fallback_episodes: 0,
    global_cap_hits: 0,
    invalid_first_rejected: 0,
  };
  for (const row of armRows) {
    sums.primary_cost += row.primary_cost;
    sums.verifier_checks += row.verifier_checks;
    sums.partial_expansions += row.partial_expansions;
    sums.exact_answers += Number(row.exact);
    sums.fallback_episodes += Number(row.fallback_started);
    sums.global_cap_hits += Number(row.global_cap_hit);
    sums.invalid_first_rejected += Number(row.injected_invalid_rejected);
  }
  check(Object.entries(sums).every(([key, value]) => arm[key] === value),
    `${arm.arm}: summary does not replay from raw rows`);
}

const targetCosts = rows
  .filter((row) => row.arm === "target_only")
  .map((row) => row.primary_cost);
check(result.target_only_headroom.minimum === Math.min(...targetCosts) &&
  result.target_only_headroom.median === median(targetCosts) &&
  result.target_only_headroom.maximum === Math.max(...targetCosts),
  "target-only headroom summary mismatch");

console.log(`Reasoner 5.5 development checks passed: ${rows.length} rows, ` +
  `${familyRows.size} family units, artifact ${result.artifact_sha256}`);

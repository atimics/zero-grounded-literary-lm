#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import {
  assertInjectedInvalidRejected,
  assertManifestReplay,
  assertRawTraceCoverage,
  assertRankerView,
  assertRegisteredOverlap,
  assertResultReplay,
  assertSourceAblationMatches,
  assertVerifiedSearchReceipt,
  canonicalCandidateOrder,
  candidateSemanticDigest,
  overlapReceipt,
  runVerifiedSearch,
} from "./lib/reasoner5_harness.mjs";
import {
  R58_ANALYSIS_SETTINGS,
  R58_ARMS,
  R58_BASE_ARMS,
  R58_DERANGEMENT_ARMS,
  R58_EXPERIMENT,
  R58_RANKER_POLICY,
  R58_SHIFT_STRATA,
  R58_SOURCE_ISOLATED_ARMS,
  buildR58Manifest,
  createR58ReplayRegistry,
  enumerateR58Universe,
  executeR58Program,
  parseR58Artifact,
  reconstructR58SourceCounts,
  r58UniverseSha256,
  reconstructR58Development,
} from "./lib/reasoner58_replay.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root,
  "benchmarks/reasoner58-compositional-behavior-transfer-v1");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsed(path) {
  return JSON.parse(readFileSync(resolve(fixture, path), "utf8"));
}

const core = parsed("CORE-DEVELOPMENT.json");
const manifest = parsed("MANIFEST.json");
const result = parsed("DEVELOPMENT.json");
const artifactText = readFileSync(resolve(fixture, "SOURCE_ARTIFACT.hex"),
  "utf8").trim();
const artifactBytes = Buffer.from(artifactText, "hex");
const artifact = parseR58Artifact(artifactBytes);
const traceBytes = readFileSync(resolve(fixture, "DEVELOPMENT-TRACE.jsonl"));
const rawTraces = traceBytes.toString("utf8").trim().split("\n")
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`R5.8 raw trace row ${index + 1}: ${error.message}`);
    }
  });

assert.equal(core.schema, "zero.reasoner58_core_development.v1");
assert.equal(core.status, "development-only");
assert.equal(core.execution_authorized, false);
assert.deepEqual(core.field, { modulus: 17, domain_points: 17 });
assert.deepEqual(core.program, {
  operations: 8,
  source_max_depth: 2,
  target_max_depth: 3,
});
assert.equal(core.syntax_programs, 585);
assert.equal(core.semantic_classes, 428);
assert.equal(core.semantic_collisions, 157);
assert.equal(core.nonlinear_classes, 333);
assert.equal(core.source_tasks, 64);
assert.equal(core.artifact_bytes, 2608);
assert.equal(core.artifact_sha256, sha256(artifactBytes));
assert.equal(artifact.sha256, core.artifact_sha256);
assert.equal(artifact.sourceTasks, 64);
assert.equal(artifact.guide.positiveLabels, core.positive_labels);
assert.equal(artifact.guide.negativeLabels, core.negative_labels);

const universe = enumerateR58Universe();
assert.equal(universe.syntaxPrograms, 585);
assert.equal(universe.semanticClasses, 428);
assert.equal(universe.semanticCollisions, 157);
assert.deepEqual(universe.classesByDepth, [1, 8, 56, 363]);
assert.equal(new Set(universe.candidates.map(candidate =>
  candidate.semantic.join(","))).size, 428,
"full 17-value behavior must define semantic identity");
assert.equal(r58UniverseSha256(universe), core.universe_sha256,
  "C and JavaScript universes differ");
for (const candidate of universe.candidates)
  assert.deepEqual(executeR58Program(candidate.ast.operations),
    candidate.semantic, "candidate truth table changed");

const corruptArtifact = Buffer.from(artifactBytes);
corruptArtifact[100] ^= 1;
assert.throws(() => parseR58Artifact(corruptArtifact), /checksum/u,
  "artifact corruption must fail closed");

assert.equal(manifest.experiment_id, R58_EXPERIMENT);
assert.equal(manifest.status, "development-only");
assert.deepEqual(manifest.execution, {
  authorized: false,
  sealed_seeds_present: false,
  scientific_executions: 0,
});
assert.deepEqual(manifest.family_counts, {
  "source-training": 64,
  calibration: 8,
  development: 12,
  sealed: 12,
});
assert.deepEqual(manifest.episode_counts, {
  "source-training": 64,
  calibration: 8,
  development: 12,
  sealed: 0,
});
assert.equal(manifest.source_artifact.sha256, artifact.sha256);
assert.equal(manifest.source_artifact.canonical_bytes, 2608);
assert.equal(manifest.source_artifact.source_tasks, 64);
assert.equal(manifest.source_artifact.training_family_ids.length, 64);
assert.equal(new Set(manifest.source_artifact.training_family_ids).size, 64);
const sourceEpisodes = manifest.episodes.filter(episode =>
  episode.lane === "source-training");
assert.equal(sourceEpisodes.length, 64,
  "every artifact-contributing source family needs an exact episode");
assert.deepEqual(new Set(sourceEpisodes.map(episode => episode.family_id)),
  new Set(manifest.source_artifact.training_family_ids));
const sourceCounts = reconstructR58SourceCounts(manifest.episodes);
for (const field of ["positiveLabels", "negativeLabels", "featurePositive",
  "featureNegative", "transitionPositive", "transitionNegative",
  "rawTokenPositive", "rawTokenNegative"])
  assert.deepEqual(sourceCounts[field], artifact.guide[field],
    `source artifact ${field} does not replay from all source episodes`);
assert.equal(manifest.episodes.some(episode => episode.lane === "sealed"), false);
assert.equal(JSON.stringify(manifest).includes("sealed_root"), false);
assert.equal(manifest.execution.sealed_seeds_present, false);

const rebuiltManifest = buildR58Manifest(artifact);
assert.equal(rebuiltManifest.manifest_sha256, manifest.manifest_sha256,
  "development manifest is not deterministic");
assert.deepEqual(rebuiltManifest, manifest,
  "stored development manifest differs from regeneration");
const replay = assertManifestReplay(manifest, createR58ReplayRegistry());
assert.equal(replay.episodes, 84);

const developmentEpisodes = manifest.episodes.filter(episode =>
  episode.lane === "development");
assert.equal(developmentEpisodes.length, 12);
for (const shift of R58_SHIFT_STRATA) {
  const selected = developmentEpisodes.filter(episode =>
    episode.shift_stratum === shift);
  assert.equal(selected.length, 3, `${shift} needs three generated families`);
  assert.equal(new Set(selected.map(episode => episode.generator_id)).size, 2,
    `${shift} needs both independent generators`);
}
for (const registered of manifest.split_divergence) {
  const actual = overlapReceipt(manifest.episodes, registered.field,
    registered.left_lane, registered.right_lane);
  assertRegisteredOverlap(actual, registered);
  assert(registered.union_count > 0);
  assert(registered.jaccard_divergence >= 0 &&
    registered.jaccard_divergence <= 1);
}

for (const episode of manifest.episodes) {
  assertRankerView(episode.content.public, {
    whitelist: episode.ranker_policy.leaf_whitelist,
    leafContracts: episode.ranker_policy.leaf_contracts,
  });
  assert.equal(JSON.stringify(episode.content.public)
    .includes(JSON.stringify(episode.content.evaluator.behavior)), false,
  "public ranker bytes contain the hidden full behavior");
}
const hiddenInjection = structuredClone(developmentEpisodes[0].content.public);
hiddenInjection.Hidden_Target = [0];
assert.throws(() => assertRankerView(hiddenInjection, {
  whitelist: [...R58_RANKER_POLICY.leaf_whitelist, "Hidden_Target"],
  leafContracts: {
    ...R58_RANKER_POLICY.leaf_contracts,
    Hidden_Target: { type: "json", provenance: "public-constant" },
  },
}), /evaluator field/u, "case-insensitive hidden fields must fail closed");
const wrongPublicType = structuredClone(developmentEpisodes[0].content.public);
wrongPublicType.examples[0].observed_symbol = "0";
assert.throws(() => assertRankerView(wrongPublicType, {
  whitelist: R58_RANKER_POLICY.leaf_whitelist,
  leafContracts: R58_RANKER_POLICY.leaf_contracts,
}), /registered type/u, "public ranker leaf types must be exact");

assert.equal(rawTraces.length, 12 * R58_ARMS.length);
assert.deepEqual(R58_BASE_ARMS, [
  "full", "target_only", "source_free_jit", "source_ablation",
  "transition_only", "raw_token", "behavior_off", "shuffled_behavior",
  "token_permuted", "source_only", "oracle_truth_rank",
]);
assert.equal(R58_DERANGEMENT_ARMS.length, 31);
const coverage = assertRawTraceCoverage({
  manifest,
  rawTraces,
  expectedArms: R58_ARMS,
  selectedLanes: ["development"],
  sourceIsolatedArms: R58_SOURCE_ISOLATED_ARMS,
});
assert.equal(coverage.rows, 504);
assert.equal(coverage.episodes, 12);
assert.equal(coverage.exactness.all_final_answers_exact, true);
assert.equal(coverage.exactness.all_certificates_valid, true);
assert.equal(coverage.exactness.premature_commits, 0);
assert.equal(coverage.exactness.all_injected_invalid_first_candidates_rejected,
  true);
assert.equal(coverage.exactness.fallback_work_counted, true);
assert.equal(coverage.cost_totals.wall_ns, null);
assert.equal(coverage.cost_totals.peak_bytes, null);
for (const row of rawTraces) {
  assertVerifiedSearchReceipt(row.verified_search);
  assertInjectedInvalidRejected(row.verified_search);
  assert.equal(row.primary_cost, row.partial_expansions);
  assert.equal(row.exact, true);
  assert.equal(row.global_cap_hit, false);
}
assert(rawTraces.filter(row => row.arm === "target_only")
  .every(row => row.fallback_started),
"target-only enumeration must exercise charged canonical fallback");
assert(rawTraces.filter(row => R58_SOURCE_ISOLATED_ARMS.includes(row.arm))
  .every(row => row.source_artifact_reads === 0));
assert(rawTraces.filter(row => row.arm === "behavior_off")
  .every(row => row.source_artifact_reads === artifactBytes.length));

for (const episode of developmentEpisodes) {
  const rows = rawTraces.filter(row => row.episode_id === episode.episode_id);
  const sourceFree = rows.find(row => row.arm === "source_free_jit");
  const sourceAblation = rows.find(row => row.arm === "source_ablation");
  assertSourceAblationMatches([sourceAblation], [sourceFree]);
  const full = structuredClone(rows.find(row => row.arm === "full"));
  const tokenPermuted = structuredClone(rows.find(row =>
    row.arm === "token_permuted"));
  delete full.arm;
  delete tokenPermuted.arm;
  assert.deepEqual(tokenPermuted, full,
    "consistent token permutation changed behavior-based search");
}

assertResultReplay({
  experiment: R58_EXPERIMENT,
  manifest,
  rawTraces,
  reconstruct: reconstructR58Development,
  analysisSettings: R58_ANALYSIS_SETTINGS,
  result,
  expectedArms: R58_ARMS,
  selectedLanes: ["development"],
  sourceIsolatedArms: R58_SOURCE_ISOLATED_ARMS,
});
assert.equal(result.status, "development-only");
assert.equal(result.execution_authorized, false);
assert.equal(result.development_measurements.episodes, 12);
assert.equal(result.development_measurements.rows, 504);
assert.equal(result.registered_analysis.headroom.comparator_arm,
  "source_free_jit");
assert(result.registered_analysis.headroom.median_primary_cost >= 16,
  "source-free development headroom is below the registered floor");

const tinyCandidates = [0, 1, 2].map(value => ({
  semantic: [value],
  ast: { operation: value },
  partial_expansions: value === 0 ? 0 : 1,
}));
const tinyFallback = canonicalCandidateOrder(tinyCandidates);
const rejectUntilTwo = candidate => candidate.semantic[0] === 2 ? {
  accepted: true,
  certificate_valid: true,
  certificate: { value: 2 },
  answer_ir: { value: 2 },
} : {
  accepted: false,
  certificate_valid: false,
  counterexample: { expected: 2, actual: candidate.semantic[0] },
};
const capped = runVerifiedSearch({
  proposals: [tinyCandidates[0]],
  fallback: tinyFallback,
  candidate_universe: tinyCandidates,
  verify: rejectUntilTwo,
  global_cap: 1,
  injected_invalid_sha256: candidateSemanticDigest(tinyCandidates[0]),
});
assert.equal(capped.solved, false);
assert.equal(capped.global_cap_hit, true);
assert.equal(capped.censoring_reason, "global-cap");
assert.equal(capped.primary_cost, 2);
assertVerifiedSearchReceipt(capped);
const exhausted = runVerifiedSearch({
  proposals: [tinyCandidates[0]],
  fallback: tinyFallback,
  candidate_universe: tinyCandidates,
  verify: candidate => ({
    accepted: false,
    certificate_valid: false,
    counterexample: { rejected: candidate.semantic[0] },
  }),
  global_cap: 4,
  injected_invalid_sha256: candidateSemanticDigest(tinyCandidates[0]),
});
assert.equal(exhausted.solved, false);
assert.equal(exhausted.fallback_exhausted, true);
assert.equal(exhausted.censoring_reason, "fallback-exhausted");
assert.equal(exhausted.primary_cost, 5);
assertVerifiedSearchReceipt(exhausted);

console.log(`Reasoner 5.8 development checks passed: ${rawTraces.length} rows, ` +
  `${manifest.source_artifact.source_tasks} source tasks, ` +
  `${universe.semanticClasses} semantic classes, result ${result.result_sha256}`);

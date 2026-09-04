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
  canonicalBytes,
  canonicalCandidateOrder,
  canonicalDigest,
  candidateSemanticDigest,
  createSplitState,
  overlapReceipt,
  registerFamily,
  runVerifiedSearch,
} from "./lib/reasoner5_harness.mjs";
import {
  R59A_AMBIGUITY_MINIMUM,
  R59A_ANALYSIS_SETTINGS,
  R59A_ARMS,
  R59A_CONCEPT_GENERATORS,
  R59A_DERANGEMENT_ARMS,
  R59A_EXPERIMENT,
  R59A_HEADROOM_MAXIMUM,
  R59A_HEADROOM_MINIMUM,
  R59A_JOINT_CANDIDATE_CAP,
  R59A_RANKER_POLICY,
  R59A_SCENE_COUNT,
  R59A_SHIFT_STRATA,
  R59A_SOURCE_ISOLATED_ARMS,
  R59A_SUPPORT_BUILDERS,
  R59A_TRANSFER_DIRECTIONS,
  applyR59AstSurfaceBijection,
  applyR59CandidateSurfaceBijection,
  applyR59EvaluatorSurfaceBijection,
  applyR59SurfaceBijection,
  buildR59Derangements,
  buildR59Manifest,
  buildR59SourceArtifact,
  createR59ReplayRegistry,
  enumerateR59Scenes,
  enumerateR59Universe,
  evaluateR59Candidate,
  executeR59Arm,
  generateR59RawRows,
  parseR59SourceArtifact,
  r59BehaviorForCandidate,
  r59BehaviorSha256ForAst,
  r59GeneratorSplitPlan,
  r59HeldOutCompoundSignature,
  r59SceneUniverseSha256,
  r59SmokeReceipts,
  rankR59Candidates,
  rankR59OracleCandidates,
  reconstructR59Development,
  reconstructR59SourceArtifact,
  scoreR59Candidate,
  withoutR59SourceComponent,
} from "./lib/reasoner59a_symbolic.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root,
  "benchmarks/reasoner59a-symbolic-transfer-v1");
const SHA256 = /^[0-9a-f]{64}$/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsed(name) {
  return JSON.parse(readFileSync(resolve(fixture, name), "utf8"));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] :
    (sorted[middle - 1] + sorted[middle]) / 2;
}

const core = parsed("CORE-DEVELOPMENT.json");
const artifact = parseR59SourceArtifact(parsed("SOURCE-ARTIFACT.json"));
const manifest = parsed("MANIFEST.json");
const result = parsed("DEVELOPMENT.json");
const contract = parsed("CONTRACT.json");
const traceBytes = readFileSync(resolve(fixture, "DEVELOPMENT-TRACE.jsonl"));
const rawTraces = traceBytes.toString("utf8").trim().split("\n")
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`R5.9a raw trace row ${index + 1}: ${error.message}`);
    }
  });

assert.equal(contract.schema, "zero.reasoner59a_development_contract.v1");
assert.equal(contract.status, "development-only");
assert.deepEqual(contract.execution, {
  authorized: false,
  sealed_seeds_present: false,
  scientific_executions: 0,
});
assert.equal(contract.future_reasoner59b.status, "execution-closed");
assert.equal(contract.future_reasoner59b.design_frozen, false);
assert.equal(
  contract.future_reasoner59b.must_freeze_before_sealed_reasoner59a_opening,
  true);
const contractBody = structuredClone(contract);
delete contractBody.contract_sha256;
assert.equal(contract.contract_sha256,
  canonicalDigest("reasoner59a-development-contract", contractBody));
for (const [path, receipt] of Object.entries(contract.source_files)) {
  const bytes = readFileSync(resolve(root, path));
  assert.equal(bytes.length, receipt.bytes, `${path} byte receipt changed`);
  assert.equal(sha256(bytes), receipt.sha256, `${path} hash receipt changed`);
}
for (const [name, receipt] of Object.entries(contract.fixtures)) {
  const bytes = readFileSync(resolve(fixture, name));
  assert.equal(bytes.length, receipt.bytes, `${name} byte receipt changed`);
  assert.equal(sha256(bytes), receipt.sha256, `${name} hash receipt changed`);
}

assert.equal(core.schema, "zero.reasoner59a_core_development.v1");
assert.equal(core.status, "development-only");
assert.equal(core.execution_authorized, false);
assert.equal(core.scene_count, R59A_SCENE_COUNT);
assert.deepEqual(core.smoke_behaviors, r59SmokeReceipts(),
  "C and JavaScript exact interpreters differ on smoke behaviors");

const scenes = enumerateR59Scenes();
assert.equal(scenes.length, R59A_SCENE_COUNT);
assert.equal(R59A_SCENE_COUNT,
  4 * 18 + 6 * (18 ** 2) + 4 * (18 ** 3));
for (const scene of scenes) {
  assert(scene.objects.length >= 1 && scene.objects.length <= 3);
  assert.deepEqual(scene.objects.map(object => object.cell),
    [...scene.objects.map(object => object.cell)].sort((left, right) =>
      left - right));
  assert.equal(new Set(scene.objects.map(object => object.cell)).size,
    scene.objects.length);
}
assert.match(r59SceneUniverseSha256(), SHA256);

const universe = enumerateR59Universe();
assert.equal(universe.forms.length, 33);
assert.equal(universe.jointPairs, universe.forms.length * 8 * 7);
assert.equal(universe.jointPairs, 1_848);
assert(universe.jointPairs <= R59A_JOINT_CANDIDATE_CAP);
assert.equal(universe.semanticClasses, 560);
assert.equal(universe.semanticCollisions, 1_288);
assert.equal(universe.rawPairs.length, universe.jointPairs);
assert.equal(new Set(universe.rawPairs.map(pair => pair.ast_sha256)).size,
  universe.jointPairs);
assert.equal(universe.candidates.reduce((sum, candidate) =>
  sum + candidate.joint_pair_multiplicity, 0), universe.jointPairs,
"complete AST and legend enumeration must never truncate");
assert.equal(new Set(universe.candidates.map(candidate =>
  candidate.semantic.behavior_sha256)).size, universe.semanticClasses);
for (const candidate of universe.candidates) {
  const behavior = r59BehaviorForCandidate(candidate);
  assert.equal(behavior.length, Math.ceil(R59A_SCENE_COUNT / 8));
  assert.equal(sha256(behavior), candidate.semantic.behavior_sha256);
  assert(candidate.ast.form.node_count <= 7);
  const surfaced = applyR59CandidateSurfaceBijection(candidate);
  assert.equal(r59BehaviorSha256ForAst(surfaced.ast),
    candidate.semantic.behavior_sha256);
  assert.deepEqual(applyR59CandidateSurfaceBijection(surfaced), candidate,
    "candidate surface bijection must be an involution");
}
for (const pair of universe.rawPairs) {
  const surfaced = applyR59AstSurfaceBijection(pair.ast);
  assert.equal(r59BehaviorSha256ForAst(surfaced), pair.behavior_sha256);
  assert.deepEqual(applyR59AstSurfaceBijection(surfaced), pair.ast,
    "raw AST surface bijection must be an involution");
}
const splitPlan = r59GeneratorSplitPlan();
assert.match(splitPlan.split_sha256, SHA256);
for (const stratum of splitPlan.strata) {
  const lanes = Object.values(stratum.signatures_by_lane);
  assert.equal(new Set(lanes.flat()).size,
    lanes.reduce((sum, values) => sum + values.length, 0),
  `${stratum.stratum} compound signatures must be split before generation`);
}

const rebuiltArtifact = buildR59SourceArtifact();
for (const sourceGenerator of R59A_CONCEPT_GENERATORS)
  for (const candidate of universe.candidates)
    assert.equal(scoreR59Candidate(candidate, artifact, "full", null,
      sourceGenerator), scoreR59Candidate(candidate, rebuiltArtifact, "full",
      null, sourceGenerator), "artifact roundtrip changed a prior score");
const uniformArtifact = structuredClone(artifact);
for (const component of uniformArtifact.components)
  for (const table of Object.values(component.feature_groups)) {
    table.counts.fill(1);
    table.total = table.counts.length;
    table.log_prob_q20.fill(Math.round(Math.log(1 / table.total) *
      (1 << 20)));
  }
for (const sourceGenerator of R59A_CONCEPT_GENERATORS) {
  const scores = new Set(universe.candidates.map(candidate =>
    scoreR59Candidate(candidate, uniformArtifact, "full", null,
      sourceGenerator)));
  assert.equal(scores.size, 1,
    "uniform categorical tables must give equal prior scores at equal length");
}

assert.equal(artifact.schema, "zero.reasoner59a_concept_prior.v1");
assert.equal(artifact.components.length, 2);
assert.equal(artifact.source_family_ids.length, 64);
assert.equal(new Set(artifact.source_family_ids).size, 64);
for (const component of artifact.components) {
  assert.equal(component.source_family_ids.length, 32);
  assert.notEqual(component.source_generator, component.target_generator);
  for (const table of Object.values(component.feature_groups)) {
    assert.equal(table.counts.reduce((sum, value) => sum + value, 0),
      table.total);
    assert(Math.abs(table.counts.reduce((sum, value) =>
      sum + value / table.total, 0) - 1) < 1e-12);
  }
  assert.equal(Object.values(component.feature_groups).reduce((sum, table) =>
    sum + table.counts.reduce((inner, count) => inner + count, 0) -
      table.keys.length, 0), component.training_cost.feature_updates,
  "artifact event counts must equal replayed source feature events");
}
const corruptedArtifact = structuredClone(artifact);
corruptedArtifact.components[0].feature_groups.atom.counts[0] += 1;
assert.throws(() => parseR59SourceArtifact(corruptedArtifact), /digest/u,
  "artifact mutation must fail its receipt");

assert.equal(manifest.experiment_id, R59A_EXPERIMENT);
assert.equal(manifest.status, "development-only");
assert.deepEqual(manifest.execution, {
  authorized: false,
  sealed_seeds_present: false,
  scientific_executions: 0,
});
assert.deepEqual(manifest.family_counts, {
  "source-training": 64,
  calibration: 8,
  development: 16,
  sealed: 16,
});
assert.deepEqual(manifest.episode_counts, {
  "source-training": 64,
  calibration: 8,
  development: 32,
  sealed: 0,
});
assert.equal(manifest.domain.joint_ast_legend_pairs, 1_848);
assert.equal(manifest.domain.enumerator_truncates, false);
assert.equal(manifest.domain.semantic_classes, 560);
assert.equal(manifest.ordered_stage_contract.reasoner59b,
  "pixel-stage-closed");
assert.equal(manifest.ordered_stage_contract
  .full_reasoner59b_freeze_required_before_sealed_reasoner59a, true);
assert(Object.values(manifest.ordered_stage_contract
  .required_reasoner59b_commitments).every(value => value === null));
assert.equal(manifest.episodes.some(episode => episode.lane === "sealed"),
  false);
assert.equal(JSON.stringify(manifest).includes("sealed_root"), false);
const surfaceRegistration = manifest.controls.surface_bijection;
const surfaceRegistrationBody = structuredClone(surfaceRegistration);
delete surfaceRegistrationBody.receipt_sha256;
assert.equal(surfaceRegistration.receipt_sha256,
  canonicalDigest("reasoner59a-surface-bijection", surfaceRegistrationBody));
assert.notEqual(surfaceRegistration.original_ast_sequence_sha256,
  surfaceRegistration.surfaced_ast_sequence_sha256);
assert.equal(surfaceRegistration.artifact_sha256, artifact.artifact_sha256);
const generatedFamilies = manifest.families.filter(family =>
  family.lane !== "sealed");
assert.equal(new Set(generatedFamilies.map(family =>
  family.family_spec.target_class_commitment)).size, generatedFamilies.length,
"target behavior classes must stay disjoint across generated families");
assert.equal(buildR59Manifest(artifact).manifest_sha256,
  manifest.manifest_sha256);
assert.deepEqual(buildR59Manifest(artifact), manifest);
const replay = assertManifestReplay(manifest, createR59ReplayRegistry());
assert.equal(replay.episodes, 104);
assert.equal(contract.receipts.manifest_replay_sha256, replay.replay_sha256);
const reconstructedArtifact = reconstructR59SourceArtifact(manifest.episodes);
assert.equal(canonicalDigest("reasoner59a-source-artifact",
  reconstructedArtifact), artifact.artifact_sha256);
assert.deepEqual(new Set(manifest.episodes.filter(episode =>
  episode.lane === "source-training").map(episode => episode.family_id)),
new Set(artifact.source_family_ids));

for (const episode of manifest.episodes) {
  const draw = episode.content.evaluator.episode_spec.generator_draw;
  const drawBody = structuredClone(draw);
  delete drawBody.receipt_sha256;
  assert.equal(draw.receipt_sha256,
    canonicalDigest("reasoner59a-generator-draw", drawBody));
  const target = universe.candidates[
    episode.content.evaluator.episode_spec.target_class_index];
  assert.equal(target.semantic.behavior_sha256,
    draw.selected_behavior_sha256);
  const family = manifest.families.find(item =>
    item.family_id === episode.family_id);
  assert.equal(draw.receipt_sha256,
    family.family_spec.generator_draw_sha256);
  assert.equal(r59HeldOutCompoundSignature(target),
    family.family_spec.held_out_compound_signature);
  if (draw.mechanism === "syntax-first") {
    const pair = universe.rawPairs[draw.raw_pair_index];
    assert.equal(pair.ast_sha256, draw.raw_ast_sha256);
    assert.equal(pair.class_index, target.class_index);
    continue;
  }
  assert.equal(draw.mechanism, "behavior-constraint-first");
  const semanticStratum = episode.content.evaluator.episode_spec.semantic_stratum
    .replace(/^source-/u, "");
  const laneSignatures = splitPlan.strata.find(item =>
    item.stratum === semanticStratum).signatures_by_lane[episode.lane];
  const legal = universe.candidates.filter(candidate =>
    laneSignatures.includes(r59HeldOutCompoundSignature(candidate)) &&
    candidate.positive_scenes === draw.constraint.exact_positive_scenes &&
    draw.constraint.probe_scene_indices.every((sceneIndex, index) =>
      evaluateR59Candidate(candidate, sceneIndex) ===
        draw.constraint.probe_labels[index])).sort((left, right) =>
    left.ast.form.node_count - right.ast.form.node_count ||
    canonicalBytes(left.ast).compare(canonicalBytes(right.ast)));
  assert(legal.length > 0);
  assert.equal(legal[0].class_index, target.class_index,
    "behavior-first must select the shortest legal AST after the constraint");
}

const developmentFamilies = manifest.families.filter(family =>
  family.lane === "development");
assert.equal(developmentFamilies.length, 16);
for (const direction of R59A_TRANSFER_DIRECTIONS) {
  const families = developmentFamilies.filter(family =>
    family.generator_id === direction.id);
  assert.equal(families.length, 8);
  assert(families.every(family =>
    family.family_spec.source_concept_mechanism ===
      direction.sourceGenerator &&
    family.family_spec.target_concept_mechanism ===
      direction.targetGenerator));
  for (const stratum of R59A_SHIFT_STRATA)
    assert.deepEqual(new Set(families.filter(family =>
      family.shift_stratum === stratum).map(family =>
      family.family_spec.support_mechanism)),
    new Set(R59A_SUPPORT_BUILDERS));
}
for (const episode of manifest.episodes.filter(item =>
  item.lane === "development")) {
  assert(episode.content.evaluator.episode_spec.consistent_semantic_classes >=
    R59A_AMBIGUITY_MINIMUM);
  assert.equal(episode.generator_id,
    `${episode.content.evaluator.episode_spec.source_concept_generator}=>` +
    episode.content.evaluator.episode_spec.target_concept_generator);
}

const splitProbe = createSplitState({ experiment_id: "r59a-split-probe" });
const duplicateSpec = {
  schema: "zero.reasoner59a_family_spec.v1",
  concept_mechanism: "probe",
  semantic_stratum: "probe",
};
registerFamily(splitProbe, { family_id: "source-probe",
  lane: "source-training", generator_id: "probe-source",
  shift_stratum: "probe", family_spec: duplicateSpec });
assert.throws(() => registerFamily(splitProbe, { family_id: "target-probe",
  lane: "development", generator_id: "probe-target",
  shift_stratum: "probe", family_spec: duplicateSpec }), /fingerprint/u,
"same semantic family must not cross split lanes under a new ID");
for (const registered of manifest.split_overlap) {
  const actual = overlapReceipt(manifest.episodes, registered.field,
    registered.left_lane, registered.right_lane);
  assertRegisteredOverlap(actual, registered);
}
assert.equal(manifest.compound_split_overlap.length, 2);
for (const registered of manifest.compound_split_overlap) {
  const laneValues = lane => new Set(manifest.episodes.filter(episode =>
    episode.lane === lane).flatMap(episode =>
    episode.content.evaluator.held_out_compounds));
  const left = laneValues(registered.left_lane);
  const right = laneValues(registered.right_lane);
  const overlap = [...left].filter(value => right.has(value)).sort();
  assert.equal(overlap.length, 0,
    `${registered.left_lane} leaked a held-out target compound`);
  assert.equal(registered.overlap_count, 0);
  assert.equal(registered.overlap_sha256,
    canonicalDigest("reasoner59a-compound-overlap", overlap));
}

for (const episode of manifest.episodes)
  assertRankerView(episode.content.public, {
    whitelist: R59A_RANKER_POLICY.leaf_whitelist,
    leafContracts: R59A_RANKER_POLICY.leaf_contracts,
  });
const publicProbe = structuredClone(manifest.episodes.find(episode =>
  episode.lane === "development").content.public);
publicProbe.support[0].scene.target = "leak";
assert.throws(() => assertRankerView(publicProbe, {
  whitelist: R59A_RANKER_POLICY.leaf_whitelist,
  leafContracts: R59A_RANKER_POLICY.leaf_contracts,
}), /schema/u);
const uppercaseLeak = structuredClone(manifest.episodes.find(episode =>
  episode.lane === "development").content.public);
uppercaseLeak.TARGET = "leak";
assert.throws(() => assertRankerView(uppercaseLeak, {
  whitelist: [...R59A_RANKER_POLICY.leaf_whitelist, "TARGET"],
  leafContracts: { ...R59A_RANKER_POLICY.leaf_contracts,
    TARGET: { type: "string", provenance: "public-constant" } },
}), /evaluator field/u);
const missingLeaf = structuredClone(manifest.episodes.find(episode =>
  episode.lane === "development").content.public);
delete missingLeaf.ranking_order_key;
assert.throws(() => assertRankerView(missingLeaf, {
  whitelist: R59A_RANKER_POLICY.leaf_whitelist,
  leafContracts: R59A_RANKER_POLICY.leaf_contracts,
}), /schema/u);

const developmentEpisodes = manifest.episodes.filter(episode =>
  episode.lane === "development");
const orderDigest = order => order.map(candidateSemanticDigest);
for (const episode of developmentEpisodes) {
  const direction = R59A_TRANSFER_DIRECTIONS.find(item =>
    item.id === episode.generator_id);
  const full = rankR59Candidates(episode.content.public, universe.candidates,
    artifact, "full", direction.sourceGenerator);
  const surfacedPublic = applyR59SurfaceBijection(episode.content.public);
  assert.notEqual(canonicalDigest("reasoner59a-public-surface",
    surfacedPublic), canonicalDigest("reasoner59a-public-surface",
    episode.content.public));
  assert.deepEqual(applyR59SurfaceBijection(surfacedPublic),
    episode.content.public,
  "public surface bijection must be an involution");
  const surfacedEvaluator = applyR59EvaluatorSurfaceBijection(
    episode.content.evaluator);
  assert.notEqual(canonicalDigest("reasoner59a-evaluator-surface",
    surfacedEvaluator.ast), canonicalDigest("reasoner59a-evaluator-surface",
    episode.content.evaluator.ast));
  assert.deepEqual(applyR59EvaluatorSurfaceBijection(surfacedEvaluator),
    episode.content.evaluator,
  "evaluator surface bijection must be an involution");
  const surfaced = rankR59Candidates(
    surfacedPublic, universe.candidates,
    artifact, "surface_bijection", direction.sourceGenerator);
  assert.deepEqual(orderDigest(surfaced), orderDigest(full),
    "consistent surface bijection changed semantic order");
  const changedEvaluator = structuredClone(episode.content.evaluator);
  changedEvaluator.target = { behavior_sha256: "0".repeat(64) };
  assert.deepEqual(orderDigest(rankR59Candidates(episode.content.public,
    universe.candidates, artifact, "full", direction.sourceGenerator)),
  orderDigest(full), "evaluator-only target tainted the ranker path");
  const changedLabels = structuredClone(episode.content.public);
  for (const support of changedLabels.support) support.label = !support.label;
  assert.deepEqual(orderDigest(rankR59Candidates(changedLabels,
    universe.candidates, artifact, "source_only", direction.sourceGenerator)),
  orderDigest(rankR59Candidates(episode.content.public, universe.candidates,
    artifact, "source_only", direction.sourceGenerator)),
  "source-only ranking read public target evidence");
  const oracle = rankR59OracleCandidates(episode.content.public,
    universe.candidates,
    episode.content.evaluator.behavior.behavior_sha256);
  assert.equal(oracle[0].semantic.behavior_sha256,
    episode.content.evaluator.behavior.behavior_sha256);
}

for (const removedGenerator of R59A_CONCEPT_GENERATORS) {
  const removed = withoutR59SourceComponent(artifact, removedGenerator);
  let oppositeChanged = false;
  for (const episode of developmentEpisodes) {
    const direction = R59A_TRANSFER_DIRECTIONS.find(item =>
      item.id === episode.generator_id);
    const original = orderDigest(rankR59Candidates(episode.content.public,
      universe.candidates, artifact, "full", direction.sourceGenerator));
    const ablated = orderDigest(rankR59Candidates(episode.content.public,
      universe.candidates, removed, "full", direction.sourceGenerator));
    if (direction.sourceGenerator !== removedGenerator) {
      assert.deepEqual(ablated, original,
        "removing one source component changed the other direction");
    }
  }
  for (const episode of developmentEpisodes.filter(item =>
    item.generator_id.startsWith(`${removedGenerator}=>`))) {
    const original = orderDigest(rankR59Candidates(episode.content.public,
      universe.candidates, artifact, "full", removedGenerator));
    const ablated = orderDigest(rankR59Candidates(episode.content.public,
      universe.candidates, removed, "full", removedGenerator));
    oppositeChanged ||= JSON.stringify(original) !== JSON.stringify(ablated);
  }
  assert(oppositeChanged,
    `${removedGenerator} component must affect its opposite direction`);
}

const synthetic = [0, 1, 2].map(value => ({ semantic: { value },
  ast: { value }, partial_expansions: 1 }));
const capped = runVerifiedSearch({
  proposals: synthetic.slice(0, 2),
  fallback: canonicalCandidateOrder(synthetic),
  candidate_universe: synthetic,
  verify: candidate => ({ accepted: false, certificate_valid: false,
    counterexample: { value: candidate.semantic.value } }),
  global_cap: 2,
  injected_invalid_sha256: candidateSemanticDigest(synthetic[0]),
});
assert.equal(capped.solved, false);
assert.equal(capped.global_cap_hit, true);
assert.equal(capped.primary_cost, 3);
assert.equal(capped.censoring_reason, "global-cap");
assertVerifiedSearchReceipt(capped);
assertInjectedInvalidRejected(capped);

const derangements = buildR59Derangements();
assert.equal(derangements.permutations.length, 31);
assert.equal(new Set(derangements.permutations.map(value =>
  JSON.stringify(value))).size, 31);
for (const permutation of derangements.permutations)
  for (const [group, values] of Object.entries(permutation)) {
    assert.deepEqual([...values].sort((left, right) => left - right),
      Array.from({ length: values.length }, (_, index) => index));
    assert(values.every((value, index) => value !== index));
    const keys = artifact.components[0].feature_groups[group].keys;
    assert(values.every((value, index) =>
      keys[value].split(":", 1)[0] === keys[index].split(":", 1)[0]),
    `${group} derangement crossed a registered event subtype`);
    for (const component of artifact.components)
      assert.deepEqual(values.map(index =>
        component.feature_groups[group].counts[index]).sort((left, right) =>
        left - right), [...component.feature_groups[group].counts]
        .sort((left, right) => left - right));
  }
assert.deepEqual(manifest.derangement_registration.subtype_partitions,
  derangements.subtype_partitions);
assert.equal(manifest.derangement_registration.sha256, derangements.sha256);

assert.equal(rawTraces.length, developmentEpisodes.length * R59A_ARMS.length);
const regeneratedRawTraces = generateR59RawRows(manifest, artifact);
assert.deepEqual(regeneratedRawTraces, rawTraces,
  "raw traces must re-execute exactly from the manifest and source artifact");
const coverage = assertRawTraceCoverage({ manifest, rawTraces,
  expectedArms: R59A_ARMS, selectedLanes: ["development"],
  sourceIsolatedArms: R59A_SOURCE_ISOLATED_ARMS });
assert.equal(coverage.exactness.all_final_answers_exact, true);
assert.equal(coverage.exactness.all_certificates_valid, true);
assert.equal(coverage.exactness.all_injected_invalid_first_candidates_rejected,
  true);
const developmentEpisodeById = new Map(developmentEpisodes.map(episode =>
  [episode.episode_id, episode]));
for (const row of rawTraces) {
  assertVerifiedSearchReceipt(row.verified_search);
  assertInjectedInvalidRejected(row.verified_search);
  assert.equal(row.primary_cost, row.verified_search.primary_cost);
  assert.equal(row.verifier_checks, row.verified_search.verifier_checks);
  assert.equal(row.partial_expansions,
    row.verified_search.partial_expansions);
  assert.equal(r59BehaviorSha256ForAst(row.answer_ir),
    developmentEpisodeById.get(row.episode_id).content.evaluator.behavior
      .behavior_sha256,
    "accepted answer IR must resolve to the episode target behavior");
  const family = developmentFamilies.find(item =>
    item.family_id === row.family_id);
  assert.equal(row.generator_id,
    `${family.family_spec.source_concept_mechanism}=>` +
    family.family_spec.target_concept_mechanism);
}
assertSourceAblationMatches(rawTraces.filter(row =>
  row.arm === "source_ablation"), rawTraces.filter(row =>
  row.arm === "source_free_jit"));
for (const family of developmentFamilies) {
  const costs = rawTraces.filter(row => row.family_id === family.family_id &&
    row.arm === "target_only").map(row => row.primary_cost);
  assert.equal(costs.length, 2);
  assert(median(costs) >= R59A_HEADROOM_MINIMUM &&
    median(costs) <= R59A_HEADROOM_MAXIMUM,
  `${family.family_id} target-only headroom changed`);
}
for (const episode of developmentEpisodes) {
  const oracle = rawTraces.find(row => row.episode_id === episode.episode_id &&
    row.arm === "oracle_program_order");
  assert.equal(oracle.primary_cost, 2,
    "oracle must still pay for the injected invalid candidate");
}

const replayedResult = assertResultReplay({
  experiment: R59A_EXPERIMENT,
  manifest,
  rawTraces,
  reconstruct: reconstructR59Development,
  analysisSettings: R59A_ANALYSIS_SETTINGS,
  result,
  expectedArms: R59A_ARMS,
  selectedLanes: ["development"],
  sourceIsolatedArms: R59A_SOURCE_ISOLATED_ARMS,
});
assert.equal(replayedResult.result_sha256, result.result_sha256);
assert.equal(result.status, "development-only");
assert.equal(result.execution_authorized, false);
assert.equal(result.exactness.all_final_answers_exact, true);
assert.equal(result.registered_analysis.primary.summary.independent_families,
  16);
assert.equal(result.registered_analysis.primary.interval.fixed_environments, 2);
assert.deepEqual(Object.keys(result.registered_analysis.primary.interval
  .environment_summaries).sort(), R59A_TRANSFER_DIRECTIONS.map(item =>
  item.id).sort());
const registeredStrata = result.registered_analysis.strata.map(item =>
  item.name).sort();
assert.deepEqual(registeredStrata, [
  ...R59A_SHIFT_STRATA.map(name => `shift:${name}`),
  ...R59A_TRANSFER_DIRECTIONS.map(direction => `direction:${direction.id}`),
  ...R59A_SUPPORT_BUILDERS.map(builder => `support:${builder}`),
].sort(), "common gate must include shifts, directions, and support builders");
assert.equal(manifest.analysis_contract.common_gate_registration
  .primary_strata.length, 8);
assert.equal(result.development_measurements.episodes, 32);
assert.equal(result.development_measurements.rows, 1_280);
assert.equal(contract.receipts.result_decision, result.decision);
assert.equal(contract.receipts.result_sha256, result.result_sha256);
assert.equal(contract.receipts.raw_trace_sha256, result.raw_trace_sha256);
assert.equal(contract.receipts.source_artifact_sha256,
  artifact.artifact_sha256);
assert.equal(contract.receipts.manifest_sha256, manifest.manifest_sha256);

const directOracle = executeR59Arm(developmentEpisodes[0],
  universe.candidates, withoutR59SourceComponent(artifact,
    R59A_CONCEPT_GENERATORS[0]), "oracle_program_order");
assert.equal(directOracle.search.primary_cost, 2);
assert.equal(directOracle.sourceArtifactReads, 0);

console.log(`Reasoner 5.9a development checks passed: ${universe.jointPairs} ` +
  `complete AST/legend pairs, ${universe.semanticClasses} exact behavior ` +
  `classes, ${rawTraces.length} replayed rows, decision ${result.decision}`);

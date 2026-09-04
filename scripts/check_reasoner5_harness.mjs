#!/usr/bin/env node

import assert from "node:assert/strict";

import { stableJson } from "./zero_data_lib.mjs";
import {
  REASONER5_SPLIT_LANES,
  REASONER5_TRACE_ROW_FIELDS,
  aggregateNestedFamilies,
  analysisFunctionDigest,
  armParityReceipt,
  assertArmParity,
  assertFamilyInferenceReceipt,
  assertInjectedInvalidRejected,
  assertManifestReplay,
  assertRegisteredOverlap,
  assertResultReplay,
  assertSourceAblationMatches,
  assertVerifiedSearchReceipt,
  buildRankerView,
  buildResultFromRawTraces,
  candidateMultisetReceipt,
  candidateSemanticDigest,
  canonicalCandidateOrder,
  canonicalBytes,
  canonicalDigest,
  createReplayRegistry,
  createDeterministicRng,
  createSplitState,
  derangementPValue,
  deriveSeed,
  finalizeManifest,
  familyInferenceReceipt,
  freezeFamilySplits,
  normalizeHexSeed,
  oneWayClusterBootstrap,
  orderHolmByCalibratedNullPValue,
  overlapReceipt,
  portableNumber,
  portableNumbers,
  reconstructCommonGate,
  registerReplayPipeline,
  registerEpisode,
  registerFamily,
  replayFunctionDigest,
  runVerifiedSearch,
  sampleIndex,
  twoWayClusterBootstrap,
  wilsonLowerBound,
} from "./lib/reasoner5_harness.mjs";

const DEVELOPMENT_SEED_A = "0123456789abcdef";
const DEVELOPMENT_SEED_B = "fedcba9876543210";
const ANALYSIS_SETTINGS = Object.freeze({
  cost_field: "primary_cost",
  full_arm: "full",
  comparator_arm: "target_only",
  bootstrap_replicates: 256,
  primary_alpha: 0.01,
});
const GATE_REGISTRATION = Object.freeze({
  primary_alpha: 0.01,
  primary_strata: ["id"],
  formal_mechanisms: [],
  crossed_design: false,
  marginal_axes: [],
  derangements: 31,
  mechanism_family_alpha: 0.05,
  factorial_interaction_required: false,
});
const RANKER_LEAF_WHITELIST = Object.freeze([
  "observations[].input",
  "observations[].observed",
  "masks[]",
  "allowed_actions[].input",
  "allowed_actions[].sensor",
]);
const DERANGEMENT_ARMS = Object.freeze(Array.from({ length: 31 }, (_, index) =>
  `shuffled_${String(index).padStart(2, "0")}`));
const EXPECTED_ARMS = Object.freeze([
  "full",
  "target_only",
  "source_free",
  "source_ablation",
  ...DERANGEMENT_ARMS,
]);

function replayFixtureEpisode(recipe) {
  return episodeContent(recipe.seed_binding.derivation_path[0],
    recipe.seed_binding.root_seed, recipe.seed_binding.derivation_path[1],
    recipe.seed_binding.derivation_path[2]);
}

const FIXTURE_GENERATOR_SHA256 = canonicalDigest("generator",
  "reasoner5-harness-fixture-v1");
const FIXTURE_INPUT_GENERATOR_SHA256 = canonicalDigest("input-generator",
  "reasoner5-harness-input-v1");
const FIXTURE_REPLAY_FUNCTION_SHA256 = replayFunctionDigest(
  replayFixtureEpisode);

function fixtureReplayRegistry() {
  const registry = createReplayRegistry();
  registerReplayPipeline(registry, {
    generator_sha256: FIXTURE_GENERATOR_SHA256,
    input_generator_sha256: FIXTURE_INPUT_GENERATOR_SHA256,
    replay_function_sha256: FIXTURE_REPLAY_FUNCTION_SHA256,
    replay: replayFixtureEpisode,
  });
  return registry;
}

function expectFailure(action, pattern) {
  assert.throws(action, pattern);
}

function familyId(lane, index = 0) {
  return `${lane}-family-${index}`;
}

function replayRecipe(label, fields = {}) {
  return {
    schema: "zero.reasoner5_replay_recipe.v1",
    generator_sha256: FIXTURE_GENERATOR_SHA256,
    input_generator_sha256: FIXTURE_INPUT_GENERATOR_SHA256,
    replay_function_sha256: FIXTURE_REPLAY_FUNCTION_SHA256,
    seed_binding: {
      root_seed: fields.development_seed ?? deriveSeed(DEVELOPMENT_SEED_A,
        label),
      derivation_path: [fields.lane ?? label, fields.suffix ?? "fixture",
        fields.family_index ?? 0],
    },
  };
}

function seedReference(recipe) {
  return canonicalDigest("episode-seed-reference", recipe);
}

function fixtureCandidates() {
  return Array.from({ length: 12 }, (_, index) => ({
    semantic: [index],
    ast: { op: "constant", value: index },
    partial_expansions: 1,
  }));
}

function fixtureSearch(checks) {
  const candidates = fixtureCandidates();
  const truth = candidates.at(-1);
  const proposals = [...candidates.slice(0, checks - 1), truth];
  return runVerifiedSearch({
    proposals,
    fallback: canonicalCandidateOrder(candidates),
    candidate_universe: candidates,
    global_cap: 64,
    injected_invalid_sha256: candidateSemanticDigest(candidates[0]),
    verify: candidate => candidate.semantic[0] === truth.semantic[0] ? {
      accepted: true,
      certificate_valid: true,
      certificate: { checked_domain: "fixture-domain", points: 12 },
      answer_ir: { semantic: candidate.semantic },
    } : {
      accepted: false,
      certificate_valid: false,
      counterexample: { input: 0, expected: truth.semantic[0],
        actual: candidate.semantic[0] },
    },
  });
}

function reconstructFixtureResult(rows) {
  const units = aggregateNestedFamilies(rows);
  return {
    trace_rows: rows.length,
    family_units: units.length,
    family_summary_sha256: canonicalDigest("family-summary", units),
  };
}

function addFamilies(state, count = 1) {
  for (const [laneIndex, lane] of REASONER5_SPLIT_LANES.entries()) {
    for (let index = 0; index < count; ++index) {
      registerFamily(state, {
        family_id: familyId(lane, index),
        lane,
        generator_id: index % 2 ? "semantic-skeleton" : "syntax-first",
        shift_stratum: "fixture-id",
        family_spec: {
          domain: "self-test",
          parameter_value: laneIndex * count + index,
        },
      });
    }
  }
}

function episodeContent(lane, seed, suffix = "0", familyIndex = 0) {
  const value = sampleIndex(seed, 0, 17, `${lane}-${suffix}`);
  const laneIndex = REASONER5_SPLIT_LANES.indexOf(lane);
  return {
    public: {
      observations: [{ input: value, observed: (value + 1) % 17 }],
      masks: [false],
      allowed_actions: [{ input: 0, sensor: 0 }],
    },
    evaluator: {
      ast: { op: `${lane}-op-${suffix}`, arguments: [value] },
      behavior: {
        output_type: `lane-${laneIndex}-family-${familyIndex}`,
        table: Array.from({ length: 17 }, (_, x) => (x + value) % 17),
      },
      episode_spec: { mechanism: `${lane}-mechanism-${suffix}`, value },
      atoms: ["common-atom", `${lane}-atom`],
      typed_subtrees: ["common:int->int", `${lane}:int->int`],
      family_id: familyId(lane, familyIndex),
      generator_seed: seed,
      latent_state: { value },
    },
  };
}

function parityBundle(label) {
  const candidates = fixtureCandidates();
  const common = {
    candidates,
    grammar: { name: "fixture-grammar", version: 1 },
    initial_evidence: { label },
    allowed_actions: [{ input: 0, sensor: 0 }],
    latent_episode: { label, hidden: true },
    potential_response: { label, function: "fixture-response" },
    verifier: { name: "fixture-verifier", version: 1 },
    caps: { global_cap: 64 },
  };
  const receipts = EXPECTED_ARMS.map(arm =>
    armParityReceipt({ arm, ...common }));
  return {
    expected_arms: EXPECTED_ARMS,
    arm_parity_receipts: receipts,
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: RANKER_LEAF_WHITELIST,
      leaf_contracts: {
        "observations[].input": {
          type: "integer", provenance: "generated-query",
        },
        "observations[].observed": {
          type: "integer", provenance: "observed-response",
        },
        "masks[]": { type: "boolean", provenance: "public-mask" },
        "allowed_actions[].input": {
          type: "integer", provenance: "allowed-action",
        },
        "allowed_actions[].sensor": {
          type: "integer", provenance: "allowed-action",
        },
      },
    },
    trace_binding: {
      candidate_universe_digest: canonicalDigest("candidate-universe",
        receipts[0].candidate_multiset),
      grammar_digest: receipts[0].grammar_sha256,
      initial_evidence_digest: receipts[0].initial_evidence_sha256,
      allowed_actions_digest: receipts[0].allowed_actions_sha256,
      latent_episode_digest: receipts[0].latent_episode_sha256,
      potential_response_digest: receipts[0].potential_response_sha256,
      verifier_digest: receipts[0].verifier_sha256,
      caps_digest: receipts[0].caps_sha256,
    },
  };
}

function buildManifest(seed, analysisFunction = reconstructFixtureResult) {
  const state = createSplitState({ experiment_id: "reasoner5-harness-self-test" });
  addFamilies(state, 4);
  expectFailure(() => registerEpisode(state, {}), /family splits must freeze/u);
  freezeFamilySplits(state);
  expectFailure(() => registerFamily(state, {
    family_id: "late", lane: "sealed", generator_id: "late",
    shift_stratum: "late-id",
    family_spec: { name: "late" },
  }), /before episode generation/u);
  for (const lane of REASONER5_SPLIT_LANES) {
    for (let familyIndex = 0; familyIndex < 4; ++familyIndex) {
      const developmentSeed = deriveSeed(seed, lane, familyIndex);
      const suffix = `main-${familyIndex}`;
      const content = episodeContent(lane, developmentSeed, suffix,
        familyIndex);
      const recipe = replayRecipe(`${lane}-${suffix}`, {
        lane,
        development_seed: developmentSeed,
        suffix,
        family_index: familyIndex,
      });
      registerEpisode(state, {
        episode_id: `${lane}-episode-${familyIndex}`,
        lane,
        family_id: familyId(lane, familyIndex),
        nested_repeat_id: "repeat-0",
        seed_ref: seedReference(recipe),
        replay_recipe: recipe,
        ...parityBundle(`${lane}-${suffix}`),
        ...content,
      });
    }
  }
  return finalizeManifest(state, {
    generator_hashes: {
      syntax_first: canonicalDigest("generator", "syntax-first-v1"),
      semantic_skeleton: canonicalDigest("generator", "semantic-skeleton-v1"),
    },
    analysis_contract: {
      schema: "zero.reasoner5_analysis_contract.v1",
      expected_arms: EXPECTED_ARMS,
      selected_lanes: ["development"],
      source_isolated_arms: ["target_only", "source_free",
        "source_ablation"],
      primary_cost_rule: "verified-search",
      analysis_settings_sha256: canonicalDigest("analysis-settings",
        ANALYSIS_SETTINGS),
      analysis_function_sha256: analysisFunctionDigest(analysisFunction),
      common_gate_registration: GATE_REGISTRATION,
      trace_schema: "zero.reasoner5_trace_row.v1",
      primary_analysis: {
        full_arm: "full",
        comparator_arm: "target_only",
        unit_fields: ["generator_id", "family_id"],
        design: "one-way",
        direction: "lower",
        seed: DEVELOPMENT_SEED_A,
        replicates: 64,
        alpha: 0.01,
        environment_field: "generator_id",
      },
      stratum_analyses: [{
        name: "id",
        field: "shift_stratum",
        values: ["fixture-id"],
        full_arm: "full",
        comparator_arm: "target_only",
        unit_fields: ["generator_id", "family_id"],
        design: "one-way",
        direction: "lower",
        seed: DEVELOPMENT_SEED_B,
        replicates: 64,
        alpha: 0.05,
        environment_field: "generator_id",
      }],
      mechanism_analyses: [],
      factorial_analysis: null,
      derangement_analysis: {
        observed_arm: "full",
        reference_arms: DERANGEMENT_ARMS,
        unit_fields: ["generator_id", "family_id"],
      },
      source_ablation: {
        ablation_arm: "source_ablation",
        source_free_arm: "source_free",
      },
      headroom: {
        comparator_arm: "target_only",
        median_primary_cost_min: 2,
      },
    },
  });
}

function testCanonicalDataAndSeeds() {
  const left = { z: [3, 2, 1], a: { y: true, x: "value" } };
  const right = { a: { x: "value", y: true }, z: [3, 2, 1] };
  assert.deepEqual(canonicalBytes(left), canonicalBytes(right));
  assert.equal(canonicalDigest("fixture", left), canonicalDigest("fixture", right));
  assert.match(canonicalDigest("fixture", left), /^[0-9a-f]{64}$/u);
  assert.equal(normalizeHexSeed(DEVELOPMENT_SEED_A), DEVELOPMENT_SEED_A);
  expectFailure(() => normalizeHexSeed(123), /non-empty string/u);
  expectFailure(() => normalizeHexSeed("1234"), /16 to 64/u);
  assert.equal(deriveSeed(DEVELOPMENT_SEED_A, "family", 3),
    deriveSeed(DEVELOPMENT_SEED_A, "family", 3));
  assert.notEqual(deriveSeed(DEVELOPMENT_SEED_A, "family", 3),
    deriveSeed(DEVELOPMENT_SEED_B, "family", 3));
  const first = createDeterministicRng(DEVELOPMENT_SEED_A, "fixture");
  const second = createDeterministicRng(DEVELOPMENT_SEED_A, "fixture");
  for (let index = 0; index < 20; ++index)
    assert.equal(first.nextUint64(), second.nextUint64());
  for (let counter = 0; counter < 20; ++counter) {
    const sampled = sampleIndex(DEVELOPMENT_SEED_A, counter, 7);
    assert.ok(sampled >= 0 && sampled < 7);
  }
  expectFailure(() => canonicalBytes({ value: undefined }), /non-JSON/u);
  expectFailure(() => canonicalBytes({ value: Number.NaN }), /non-canonical/u);
  expectFailure(() => canonicalBytes({ value: Number.POSITIVE_INFINITY }),
    /non-canonical/u);
  expectFailure(() => canonicalBytes({ value: -0 }), /non-canonical/u);
  expectFailure(() => canonicalBytes({ value: 1n }), /non-JSON/u);
  const cycle = {};
  cycle.self = cycle;
  expectFailure(() => canonicalBytes(cycle), /cycle/u);
}

function crossLaneState() {
  const state = createSplitState({ experiment_id: "cross-lane-self-test" });
  registerFamily(state, {
    family_id: "source", lane: "source-training", generator_id: "g0",
    shift_stratum: "source-id",
    family_spec: { name: "source" },
  });
  registerFamily(state, {
    family_id: "target", lane: "sealed", generator_id: "g1",
    shift_stratum: "target-id",
    family_spec: { name: "target" },
  });
  freezeFamilySplits(state);
  return state;
}

function registerCrossLaneSource(state) {
  const recipe = replayRecipe("source");
  registerEpisode(state, {
    episode_id: "source-episode",
    lane: "source-training",
    family_id: "source",
    nested_repeat_id: "r0",
    seed_ref: seedReference(recipe),
    replay_recipe: recipe,
    ...parityBundle("source"),
    public: {
      observations: [{ input: 0, observed: 1 }],
      masks: [false],
      allowed_actions: [{ input: 0, sensor: 0 }],
    },
    evaluator: {
      ast: { op: "shared" },
      behavior: [1, 2, 3],
      episode_spec: { evidence: [4, 5] },
      atoms: ["shared"],
      typed_subtrees: ["shared:int->int"],
    },
  });
}

function testSplitsReplayAndOverlap() {
  const first = buildManifest(DEVELOPMENT_SEED_A);
  const replayed = buildManifest(DEVELOPMENT_SEED_A);
  const changed = buildManifest(DEVELOPMENT_SEED_B);
  assert.deepEqual(canonicalBytes(first), canonicalBytes(replayed));
  assert.equal(first.manifest_sha256, replayed.manifest_sha256);
  assert.notEqual(first.manifest_sha256, changed.manifest_sha256);
  const duplicateFamilyState = createSplitState({
    experiment_id: "duplicate-family-self-test",
  });
  registerFamily(duplicateFamilyState, {
    family_id: "source-family", lane: "source-training", generator_id: "g0",
    shift_stratum: "source-id", family_spec: { semantic_task: "same" },
  });
  expectFailure(() => registerFamily(duplicateFamilyState, {
    family_id: "sealed-family", lane: "sealed", generator_id: "g1",
    shift_stratum: "sealed-id", family_spec: { semantic_task: "same" },
  }), /family fingerprint duplicates/u);
  expectFailure(() => {
    const state = createSplitState({ experiment_id: "reserved-manifest" });
    addFamilies(state);
    freezeFamilySplits(state);
    finalizeManifest(state, { schema: "attacker-controlled" });
  }, /manifest extra field schema is reserved/u);
  assert.deepEqual(first.split_order, REASONER5_SPLIT_LANES);
  const replayReceipt = assertManifestReplay(first, fixtureReplayRegistry());
  assert.equal(replayReceipt.episodes, REASONER5_SPLIT_LANES.length * 4);
  expectFailure(() => assertManifestReplay(first, createReplayRegistry()),
    /no hash-matched replay pipeline/u);
  expectFailure(() => registerReplayPipeline(createReplayRegistry(), {
    generator_sha256: FIXTURE_GENERATOR_SHA256,
    input_generator_sha256: FIXTURE_INPUT_GENERATOR_SHA256,
    replay_function_sha256: FIXTURE_REPLAY_FUNCTION_SHA256,
    replay: recipe => replayFixtureEpisode(recipe),
  }), /function differs from its registered digest/u);
  function spoofedReplay() { return { attacker: true }; }
  Object.defineProperty(spoofedReplay, "toString", {
    value: () => replayFixtureEpisode.toString(),
  });
  expectFailure(() => registerReplayPipeline(createReplayRegistry(), {
    generator_sha256: FIXTURE_GENERATOR_SHA256,
    input_generator_sha256: FIXTURE_INPUT_GENERATOR_SHA256,
    replay_function_sha256: FIXTURE_REPLAY_FUNCTION_SHA256,
    replay: spoofedReplay,
  }), /function differs from its registered digest/u);
  expectFailure(() => registerEpisode(crossLaneState(), {
    episode_id: "unknown-cross-family",
    lane: "sealed",
    family_id: "target",
    cross_family_id: "unregistered-corruption-family",
    nested_repeat_id: "r0",
    seed_ref: "0".repeat(64),
  }), /unknown episode cross family/u);
  const crossedState = createSplitState({
    experiment_id: "registered-cross-family-self-test",
  });
  registerFamily(crossedState, {
    family_id: "program-family", lane: "development", generator_id: "g0",
    shift_stratum: "crossed", family_spec: { axis: "program", value: 0 },
  });
  registerFamily(crossedState, {
    family_id: "corruption-family", lane: "development", generator_id: "g1",
    shift_stratum: "crossed", family_spec: { axis: "corruption", value: 0 },
  });
  freezeFamilySplits(crossedState);
  const crossedRecipe = replayRecipe("registered-cross-family", {
    lane: "development",
  });
  registerEpisode(crossedState, {
    episode_id: "registered-cross-episode",
    lane: "development",
    family_id: "program-family",
    cross_family_id: "corruption-family",
    nested_repeat_id: "r0",
    seed_ref: seedReference(crossedRecipe),
    replay_recipe: crossedRecipe,
    ...parityBundle("registered-cross-family"),
    ...episodeContent("development", DEVELOPMENT_SEED_A, "crossed", 0),
  });
  assert.equal(finalizeManifest(crossedState).episodes[0].cross_family_id,
    "corruption-family");
  const countTamper = JSON.parse(stableJson(first));
  countTamper.family_counts.calibration += 1;
  const countTamperBody = { ...countTamper };
  delete countTamperBody.manifest_sha256;
  countTamper.manifest_sha256 = canonicalDigest(
    "generated-family-manifest", countTamperBody);
  expectFailure(() => assertManifestReplay(countTamper,
    fixtureReplayRegistry()), /split counts differ/u);

  const atomOverlap = overlapReceipt(first.episodes, "atoms",
    "source-training", "sealed");
  const subtreeOverlap = overlapReceipt(first.episodes, "typed_subtrees",
    "source-training", "sealed");
  assert.equal(atomOverlap.overlap_count, 1);
  assert.equal(subtreeOverlap.overlap_count, 1);
  assertRegisteredOverlap(atomOverlap, { ...atomOverlap });
  expectFailure(() => assertRegisteredOverlap(atomOverlap, {
    ...atomOverlap, overlap_count: 0,
  }), /registered overlap changed/u);

  for (const duplicate of ["ast", "behavior", "episode_spec"]) {
    const state = crossLaneState();
    registerCrossLaneSource(state);
    const evaluator = {
      ast: { op: "target" },
      behavior: [9, 8, 7],
      episode_spec: { evidence: [6] },
      atoms: ["target"],
      typed_subtrees: ["target:int->int"],
    };
    evaluator[duplicate] = state.episodes[0].content.evaluator[duplicate];
    const recipe = replayRecipe(`target-${duplicate}`);
    expectFailure(() => registerEpisode(state, {
      episode_id: `target-${duplicate}`,
      lane: "sealed",
      family_id: "target",
      nested_repeat_id: "r0",
      seed_ref: seedReference(recipe),
      replay_recipe: recipe,
      ...parityBundle(`target-${duplicate}`),
      public: {
        observations: [{ input: 0, observed: 2 }],
        masks: [false],
        allowed_actions: [{ input: 0, sensor: 0 }],
      },
      evaluator,
    }), new RegExp(`${duplicate === "episode_spec" ? "episode" : duplicate} fingerprint crosses`, "u"));
  }

  const rollback = crossLaneState();
  registerCrossLaneSource(rollback);
  const rejectedAst = { op: "must-remain-available" };
  const rejectedRecipe = replayRecipe("target-rejected");
  expectFailure(() => registerEpisode(rollback, {
    episode_id: "target-rejected",
    lane: "sealed",
    family_id: "target",
    nested_repeat_id: "r0",
    seed_ref: seedReference(rejectedRecipe),
    replay_recipe: rejectedRecipe,
    ...parityBundle("target-rejected"),
    public: {
      observations: [{ input: 0, observed: 2 }],
      masks: [false],
      allowed_actions: [{ input: 0, sensor: 0 }],
    },
    evaluator: {
      ast: rejectedAst,
      behavior: rollback.episodes[0].content.evaluator.behavior,
      episode_spec: { evidence: [99] },
      atoms: ["target"],
      typed_subtrees: ["target:int->int"],
    },
  }), /behavior fingerprint crosses/u);
  const acceptedRecipe = replayRecipe("target-after-rollback");
  registerEpisode(rollback, {
    episode_id: "target-after-rollback",
    lane: "sealed",
    family_id: "target",
    nested_repeat_id: "r1",
    seed_ref: seedReference(acceptedRecipe),
    replay_recipe: acceptedRecipe,
    ...parityBundle("target-after-rollback"),
    public: {
      observations: [{ input: 0, observed: 3 }],
      masks: [false],
      allowed_actions: [{ input: 0, sensor: 0 }],
    },
    evaluator: {
      ast: rejectedAst,
      behavior: [10, 11, 12],
      episode_spec: { evidence: [100] },
      atoms: ["target"],
      typed_subtrees: ["target:int->int"],
    },
  });
  assert.equal(rollback.episodes.length, 2);
}

function testRankerViewsAndParity() {
  const manifest = buildManifest(DEVELOPMENT_SEED_A);
  const episode = manifest.episodes[0];
  const view = buildRankerView(episode);
  assert.deepEqual(Object.keys(view).sort(),
    ["allowed_actions", "masks", "observations"]);
  assert.equal("evaluator" in view, false);
  expectFailure(() => buildRankerView({
    public: { observations: [], family_id: "hidden" },
    evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["observations[]", "family_id"],
      leaf_contracts: {
        "observations[]": { type: "json", provenance: "generated-query" },
        family_id: { type: "string", provenance: "public-constant" },
      },
    },
  }),
  /exposes evaluator field family_id/u);
  expectFailure(() => buildRankerView({
    public: { observations: [], extra: true }, evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["observations[]"],
      leaf_contracts: {
        "observations[]": { type: "json", provenance: "generated-query" },
      },
    },
  }), /complete registered schema/u);
  expectFailure(() => buildRankerView({
    public: { observations: [{ input: "hidden-alias" }] }, evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["observations[].input"],
      leaf_contracts: {
        "observations[].input": {
          type: "integer", provenance: "generated-query",
        },
      },
    },
  }), /differs from its registered type/u);
  expectFailure(() => buildRankerView({
    public: { observations: [{ input: 4 }] }, evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["observations[].input"],
      leaf_contracts: {
        "observations[].input": {
          type: "integer", provenance: "evaluator-target",
        },
      },
    },
  }), /unknown provenance/u);
  expectFailure(() => buildRankerView({
    public: { observations: [{ input: 0, target: 4 }] }, evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["observations[].input"],
      leaf_contracts: {
        "observations[].input": {
          type: "integer", provenance: "generated-query",
        },
      },
    },
  }), /complete registered schema/u);
  expectFailure(() => buildRankerView({
    public: { x: 1 }, evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["x", "y"],
      leaf_contracts: {
        x: { type: "integer", provenance: "public-constant" },
        y: { type: "integer", provenance: "public-constant" },
      },
    },
  }), /complete registered schema/u);
  expectFailure(() => buildRankerView({
    public: { observations: [
      { input: 1, observed: 2 },
      { input: 3 },
    ] },
    evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["observations[].input", "observations[].observed"],
      leaf_contracts: {
        "observations[].input": {
          type: "integer", provenance: "generated-query",
        },
        "observations[].observed": {
          type: "integer", provenance: "observed-response",
        },
      },
    },
  }), /complete registered schema/u);
  expectFailure(() => buildRankerView({
    public: { TARGET: 7 }, evaluator: {},
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: ["TARGET"],
      leaf_contracts: {
        TARGET: { type: "integer", provenance: "public-constant" },
      },
    },
  }), /exposes evaluator field TARGET/u);

  const candidates = [
    { semantic: [0, 1, 2], ast: { op: "a" } },
    { semantic: [2, 1, 0], ast: { op: "b" } },
    { semantic: [0, 1, 2], ast: { op: "a" } },
  ];
  const receipt = candidateMultisetReceipt(candidates);
  const permuted = candidateMultisetReceipt([candidates[2], candidates[1],
    candidates[0]]);
  assert.equal(receipt.count, 3);
  assert.equal(receipt.distinct_count, 2);
  assert.equal(receipt.semantic_multiset_sha256,
    permuted.semantic_multiset_sha256);
  assert.equal(receipt.canonical_order_sha256,
    permuted.canonical_order_sha256);
  assert.notEqual(receipt.semantic_multiset_sha256,
    candidateMultisetReceipt([...candidates,
      { semantic: [3], ast: { op: "c" } }])
      .semantic_multiset_sha256);
  assert.notEqual(receipt.semantic_ast_pair_multiset_sha256,
    candidateMultisetReceipt([
      { ...candidates[0], ast: { op: "changed" } },
      candidates[1], candidates[2],
    ]).semantic_ast_pair_multiset_sha256);
  assert.notEqual(receipt.candidate_record_multiset_sha256,
    candidateMultisetReceipt([
      { ...candidates[0], partial_expansions: 9 },
      candidates[1], candidates[2],
    ]).candidate_record_multiset_sha256);

  const common = {
    candidates,
    grammar: { version: 1, operations: ["add", "scale"] },
    initial_evidence: [{ input: 0, output: 1 }],
    allowed_actions: [{ input: 1, sensor: 0 }],
    latent_episode: { target: "evaluator-only" },
    potential_response: { root: "response-root" },
    verifier: { domain: "GF(17)" },
    caps: { verifier_checks: 64 },
  };
  const full = armParityReceipt({ arm: "full", ...common });
  const target = armParityReceipt({ arm: "target_only", ...common });
  const parity = assertArmParity([full, target]);
  assert.deepEqual(parity.arms, ["full", "target_only"]);
  const changed = armParityReceipt({ arm: "changed", ...common,
    caps: { verifier_checks: 65 } });
  expectFailure(() => assertArmParity([full, changed]), /changed caps_sha256/u);
}

function testVerifierAndAblation() {
  const invalid = { semantic: [1, 1, 1], name: "invalid" };
  const duplicateInvalid = { semantic: [1, 1, 1], name: "duplicate" };
  const truth = { semantic: [2, 2, 2], name: "truth" };
  const invalidDigest = candidateSemanticDigest(invalid);
  const search = runVerifiedSearch({
    proposals: [invalid, duplicateInvalid],
    fallback: canonicalCandidateOrder([invalid, duplicateInvalid, truth]),
    candidate_universe: [invalid, duplicateInvalid, truth],
    global_cap: 4,
    injected_invalid_sha256: invalidDigest,
    verify: candidate => {
      assert.equal(Object.isFrozen(candidate), true);
      assert.equal(Object.isFrozen(candidate.semantic), true);
      return candidate.semantic[0] === 2 ? {
      accepted: true,
      certificate_valid: true,
      certificate: { domain_points_checked: 125 },
      answer_ir: { semantic: candidate.semantic },
    } : {
      accepted: false,
      certificate_valid: false,
      counterexample: { input: [0, 0, 0], expected: [2, 2, 2],
        actual: candidate.semantic },
      };
    },
  });
  assert.equal(search.solved, true);
  assert.equal(search.verifier_checks, 2);
  assert.equal(search.distinct_semantic_classes, 2);
  assert.equal(search.fallback_started, true);
  assert.equal(search.accepted_candidate_sha256,
    candidateSemanticDigest(truth));
  assertVerifiedSearchReceipt(search);
  const forgedExpansion = structuredClone(search);
  forgedExpansion.expansion_trace[0].candidate_sha256 = canonicalDigest(
    "forged-expansion", 0);
  delete forgedExpansion.search_sha256;
  forgedExpansion.search_sha256 = canonicalDigest("verified-search-receipt",
    forgedExpansion);
  expectFailure(() => assertVerifiedSearchReceipt(forgedExpansion),
    /expansion differs from its verifier trace/u);
  expectFailure(() => assertVerifiedSearchReceipt({
    ...search,
    verifier_checks: search.verifier_checks + 1,
  }), /digest changed/u);
  assertInjectedInvalidRejected(search);
  expectFailure(() => assertInjectedInvalidRejected({
    ...search, injected_invalid: { ...search.injected_invalid, rejected: false },
  }), /must reject/u);
  expectFailure(() => runVerifiedSearch({
    proposals: [{ semantic: [99], ast: { op: "outside" } }],
    fallback: [truth],
    candidate_universe: [truth],
    global_cap: 4,
    verify: () => ({ accepted: false, certificate_valid: false,
      counterexample: { input: 0 } }),
  }), /proposal falls outside/u);
  const charged = {
    semantic: [3],
    ast: { op: "charged" },
    partial_expansions: 7,
    public_label: "registered",
  };
  const chargedFallback = canonicalCandidateOrder([charged]);
  expectFailure(() => runVerifiedSearch({
    proposals: [{ ...charged, partial_expansions: 0 }],
    fallback: chargedFallback,
    candidate_universe: [charged],
    global_cap: 1,
    verify: () => ({ accepted: true, certificate_valid: true,
      certificate: { exact: true }, answer_ir: { value: 3 } }),
  }), /below the frozen candidate baseline/u);
  expectFailure(() => runVerifiedSearch({
    proposals: [{ ...charged, public_label: "changed" }],
    fallback: chargedFallback,
    candidate_universe: [charged],
    global_cap: 1,
    verify: () => ({ accepted: true, certificate_valid: true,
      certificate: { exact: true }, answer_ir: { value: 3 } }),
  }), /proposal falls outside/u);
  const surcharged = runVerifiedSearch({
    proposals: [{ ...charged, partial_expansions: 11 }],
    fallback: chargedFallback,
    candidate_universe: [charged],
    global_cap: 1,
    verify: () => ({ accepted: true, certificate_valid: true,
      certificate: { exact: true }, answer_ir: { value: 3 } }),
  });
  assert.equal(surcharged.partial_expansions, 11);
  assertVerifiedSearchReceipt(surcharged);
  const canonicalFallback = canonicalCandidateOrder([invalid, truth]);
  expectFailure(() => runVerifiedSearch({
    proposals: [invalid],
    fallback: [...canonicalFallback].reverse(),
    candidate_universe: [invalid, truth],
    global_cap: 4,
    verify: candidate => ({ accepted: candidate.semantic[0] === 2,
      certificate_valid: candidate.semantic[0] === 2,
      ...(candidate.semantic[0] === 2 ? {
        certificate: { exact: true }, answer_ir: { value: 2 },
      } : { counterexample: { input: 0 } }),
    }),
  }), /fallback order differs/u);
  const capped = runVerifiedSearch({
    proposals: [invalid],
    fallback: canonicalCandidateOrder([invalid, truth]),
    candidate_universe: [invalid, truth],
    global_cap: 1,
    verify: candidate => ({ accepted: false, certificate_valid: false,
      counterexample: { candidate: candidate.semantic } }),
  });
  assert.equal(capped.solved, false);
  assert.equal(capped.global_cap_hit, true);
  assert.equal(capped.fallback_exhausted, false);
  assert.equal(capped.censoring_reason, "global-cap");
  assert.equal(capped.primary_cost, 2);
  assert.equal(capped.fallback_receipt.censoring_charge, 1);
  assertVerifiedSearchReceipt(capped);
  const exhausted = runVerifiedSearch({
    proposals: [invalid],
    fallback: canonicalFallback,
    candidate_universe: [invalid, truth],
    global_cap: 5,
    verify: candidate => ({ accepted: false, certificate_valid: false,
      counterexample: { candidate: candidate.semantic } }),
  });
  assert.equal(exhausted.solved, false);
  assert.equal(exhausted.global_cap_hit, false);
  assert.equal(exhausted.fallback_exhausted, true);
  assert.equal(exhausted.censoring_reason, "fallback-exhausted");
  assert.equal(exhausted.primary_cost, 6);
  assert.equal(exhausted.fallback_receipt.censoring_charge, 1);
  assertVerifiedSearchReceipt(exhausted);

  const ablation = [{ arm: "source_ablation", step: 0,
    candidate_sha256: invalidDigest, source_artifact_reads: 0,
    accepted: false }];
  const sourceFree = [{ arm: "source_free", step: 0,
    candidate_sha256: invalidDigest, source_artifact_reads: 0,
    accepted: false }];
  assertSourceAblationMatches(ablation, sourceFree);
  expectFailure(() => assertSourceAblationMatches(ablation, [{
    ...sourceFree[0], accepted: true,
  }]), /differs from the source-free/u);
  expectFailure(() => assertSourceAblationMatches([{
    ...ablation[0], source_artifact_reads: 1,
  }], sourceFree), /must read zero source-artifact bytes/u);
}

function longRows(families, crosses = [null], repeats = ["r0", "r1"]) {
  const rows = [];
  for (const [familyIndex, family] of families.entries()) {
    for (const [crossIndex, cross] of crosses.entries()) {
      for (const [repeatIndex, repeat] of repeats.entries()) {
        const common = {
          schema: "zero.reasoner5_trace_row.v1",
          generator_id: "syntax-first",
          family_id: family,
          cross_family_id: cross,
          nested_repeat_id: repeat,
          episode_id: `${family}-${cross ?? "one-way"}-${repeat}`,
        };
        const comparator = 12 + familyIndex + crossIndex + repeatIndex;
        const full = 5 + familyIndex + crossIndex + repeatIndex;
        rows.push({ ...common, arm: "full", primary_cost: full });
        rows.push({ ...common, arm: "target_only", primary_cost: comparator });
      }
    }
  }
  return rows;
}

function rawTraceRows(manifest) {
  const rows = [];
  for (const episode of manifest.episodes.filter(item =>
    item.lane === "development")) {
    for (const arm of EXPECTED_ARMS) {
      const primaryCost = arm === "full" ? 5 : arm === "target_only" ? 12 :
        ["source_free", "source_ablation"].includes(arm) ? 8 :
          10 + DERANGEMENT_ARMS.indexOf(arm) % 2;
      const search = fixtureSearch(primaryCost);
      rows.push({
        schema: "zero.reasoner5_trace_row.v1",
        experiment: manifest.experiment_id,
        episode_id: episode.episode_id,
        arm,
        lane: episode.lane,
        family_id: episode.family_id,
        cross_family_id: episode.cross_family_id,
        generator_id: episode.generator_id,
        shift_stratum: episode.shift_stratum,
        nested_repeat_id: episode.nested_repeat_id,
        episode_bytes_sha256: episode.episode_bytes_sha256,
        ast_sha256: episode.fingerprints.ast_sha256,
        behavior_sha256: episode.fingerprints.behavior_sha256,
        episode_spec_sha256: episode.fingerprints.episode_spec_sha256,
        ...episode.trace_binding,
        verified_search: search,
        execution_trace_sha256: search.search_sha256,
        primary_cost: search.primary_cost,
        verifier_checks: search.verifier_checks,
        partial_expansions: search.partial_expansions,
        fallback_verifier_checks: search.fallback_verifier_checks,
        fallback_partial_expansions: search.fallback_partial_expansions,
        observation_queries: 0,
        wall_ns: 1000 + primaryCost,
        peak_bytes: 4096,
        source_artifact_reads: ["full", ...DERANGEMENT_ARMS].includes(arm) ?
          1 : 0,
        exact: search.solved,
        certificate_valid: search.solved &&
          typeof search.certificate_sha256 === "string",
        premature_commit: search.premature_commits > 0,
        fallback_started: search.fallback_started,
        global_cap_hit: search.global_cap_hit,
        fallback_exhausted: search.fallback_exhausted,
        censoring_reason: search.censoring_reason,
        injected_invalid: search.injected_invalid !== null,
        injected_invalid_rejected: search.injected_invalid?.rejected === true,
        answer_ir: search.answer_ir,
        answer_ir_sha256: search.answer_ir_sha256,
        certificate_sha256: search.certificate_sha256,
        fallback_receipt: search.fallback_receipt,
      });
    }
  }
  return rows;
}

function withVerifiedSearch(row, search) {
  return {
    ...row,
    verified_search: search,
    execution_trace_sha256: search.search_sha256,
    primary_cost: search.primary_cost,
    verifier_checks: search.verifier_checks,
    partial_expansions: search.partial_expansions,
    fallback_verifier_checks: search.fallback_verifier_checks,
    fallback_partial_expansions: search.fallback_partial_expansions,
    exact: search.solved,
    certificate_valid: search.solved &&
      typeof search.certificate_sha256 === "string",
    premature_commit: search.premature_commits > 0,
    fallback_started: search.fallback_started,
    global_cap_hit: search.global_cap_hit,
    fallback_exhausted: search.fallback_exhausted,
    censoring_reason: search.censoring_reason,
    injected_invalid: search.injected_invalid !== null,
    injected_invalid_rejected: search.injected_invalid?.rejected === true,
    answer_ir: search.answer_ir,
    answer_ir_sha256: search.answer_ir_sha256,
    certificate_sha256: search.certificate_sha256,
    fallback_receipt: search.fallback_receipt,
  };
}

function testFamilyStatistics() {
  const rows = longRows(["f0", "f1", "f2"]);
  expectFailure(() => aggregateNestedFamilies(rows, {
    unitFields: ["episode_id"],
  }), /not a family-level axis/u);
  const units = aggregateNestedFamilies(rows, {
    unitFields: ["generator_id", "family_id"],
  });
  assert.equal(units.length, 3);
  assert.ok(units.every(unit => unit.nested_measurements === 2));
  assert.ok(units.every(unit => unit.win));
  const one = oneWayClusterBootstrap(units, {
    seed: DEVELOPMENT_SEED_A, replicates: 256,
  });
  const oneReplay = oneWayClusterBootstrap(units, {
    seed: DEVELOPMENT_SEED_A, replicates: 256,
  });
  assert.deepEqual(one, oneReplay);
  assert.ok(one.point_ratio < 1 && one.upper_ratio < 1);
  assert.equal(one.independent_units, 3);
  const fixedEnvironments = oneWayClusterBootstrap([
    { generator_environment: "a", mean_log_ratio: 1 },
    { generator_environment: "b", mean_log_ratio: -1 },
    { generator_environment: "b", mean_log_ratio: -1 },
    { generator_environment: "b", mean_log_ratio: -1 },
  ], {
    seed: DEVELOPMENT_SEED_A,
    replicates: 32,
    environmentField: "generator_environment",
  });
  assert.equal(fixedEnvironments.fixed_environment_weighting, "equal");
  assert.equal(fixedEnvironments.point_log_ratio, 0);

  const crossedRows = longRows(["p0", "p1"], ["c0", "c1"], ["r0"]);
  const crossed = aggregateNestedFamilies(crossedRows, {
    unitFields: ["family_id", "cross_family_id"],
  });
  assert.equal(crossed.length, 4);
  const two = twoWayClusterBootstrap(crossed, {
    seed: DEVELOPMENT_SEED_B, replicates: 256,
  });
  const twoReplay = twoWayClusterBootstrap(crossed, {
    seed: DEVELOPMENT_SEED_B, replicates: 256,
  });
  assert.deepEqual(two, twoReplay);
  assert.deepEqual([two.row_families, two.column_families,
    two.complete_cells], [2, 2, 4]);
  assert.equal(two.row_marginal_summary.independent_families, 2);
  assert.equal(two.column_marginal_summary.independent_families, 2);
  expectFailure(() => twoWayClusterBootstrap(crossed.slice(0, -1), {
    seed: DEVELOPMENT_SEED_B, replicates: 16,
  }), /complete family crossing/u);

  const lower = wilsonLowerBound(60, 100);
  assert.ok(lower > 0.5 && lower < 0.6);
  assert.ok(wilsonLowerBound(80, 100) > lower);
  const reference = Array.from({ length: 31 }, (_, index) => index + 1);
  const randomization = derangementPValue(0, reference);
  assert.equal(randomization.p_value, 1 / 32);
  assert.equal(randomization.beats_median, true);
}

function testRecenteredNullBootstrap() {
  const oneWayUnits = [-4, 1, 1, 1].map((meanLogRatio, index) => ({
    family_id: `null-one-${index}`,
    mean_log_ratio: meanLogRatio,
  }));
  const oneWay = oneWayClusterBootstrap(oneWayUnits, {
    seed: DEVELOPMENT_SEED_A,
    replicates: 257,
  });
  assert.equal(oneWay.schema,
    "zero.reasoner5_one_way_cluster_bootstrap.v2");
  assert.equal(oneWay.confidence_interval_method,
    "ordinary-percentile-bootstrap");
  assert.equal(oneWay.p_value_method, "recentered-null-bootstrap");
  assert.deepEqual([oneWay.lower_log_ratio, oneWay.upper_log_ratio], [-1.5, 1]);
  assert.notEqual(oneWay.one_sided_p_lower_than_zero,
    oneWay.uncentered_sign_tail_fraction_lower);
  assert.match(oneWay.null_bootstrap_sha256, /^[0-9a-f]{64}$/u);
  assert.notEqual(oneWay.null_bootstrap_sha256, oneWay.bootstrap_sha256);

  const stratifiedUnits = [
    { generator: "a", mean_log_ratio: -4 },
    { generator: "a", mean_log_ratio: 1 },
    { generator: "b", mean_log_ratio: 1 },
    { generator: "b", mean_log_ratio: 1 },
  ];
  const stratified = oneWayClusterBootstrap(stratifiedUnits, {
    seed: DEVELOPMENT_SEED_A,
    replicates: 257,
    environmentField: "generator",
  });
  assert.equal(stratified.schema,
    "zero.reasoner5_stratified_one_way_cluster_bootstrap.v2");
  assert.equal(stratified.fixed_environments, 2);
  assert.equal(stratified.fixed_environment_weighting, "equal");
  assert.deepEqual([stratified.lower_log_ratio, stratified.upper_log_ratio],
    [-1.5, 1]);
  assert.notEqual(stratified.one_sided_p_lower_than_zero,
    stratified.uncentered_sign_tail_fraction_lower);
  assert.match(stratified.null_bootstrap_sha256, /^[0-9a-f]{64}$/u);

  const crossed = [
    { family_id: "r0", cross_family_id: "c0", mean_log_ratio: -4 },
    { family_id: "r0", cross_family_id: "c1", mean_log_ratio: 1 },
    { family_id: "r1", cross_family_id: "c0", mean_log_ratio: 1 },
    { family_id: "r1", cross_family_id: "c1", mean_log_ratio: 1 },
  ];
  const twoWay = twoWayClusterBootstrap(crossed, {
    seed: DEVELOPMENT_SEED_A,
    replicates: 257,
  });
  assert.equal(twoWay.schema,
    "zero.reasoner5_two_way_cluster_bootstrap.v2");
  assert.deepEqual([twoWay.lower_log_ratio, twoWay.upper_log_ratio], [-4, 1]);
  assert.notEqual(twoWay.one_sided_p_lower_than_zero,
    twoWay.uncentered_sign_tail_fraction_lower);
  assert.match(twoWay.null_bootstrap_sha256, /^[0-9a-f]{64}$/u);

  const inference = familyInferenceReceipt(oneWayUnits, {
    design: "one-way",
    direction: "lower",
    seed: DEVELOPMENT_SEED_A,
    replicates: 257,
    alpha: 0.05,
  });
  const changedNullDigest = structuredClone(inference);
  changedNullDigest.interval.null_bootstrap_sha256 = "0".repeat(64);
  expectFailure(() => assertFamilyInferenceReceipt(changedNullDigest),
    /does not replay/u);

  const mechanism = (name, values) => ({
    name,
    inference: familyInferenceReceipt(values.map((meanLogRatio, index) => ({
      family_id: `${name}-${index}`,
      mean_log_ratio: meanLogRatio,
    })), {
      design: "one-way",
      direction: "higher",
      seed: DEVELOPMENT_SEED_A,
      replicates: 257,
      alpha: 0.05,
    }),
  });
  const mechanisms = [
    mechanism("null-first", [-5, -5, 4, 7]),
    mechanism("tail-first", [-5, -1, 4, 4]),
  ];
  const uncenteredOrder = [...mechanisms].sort((left, right) =>
    left.inference.interval.uncentered_sign_tail_fraction_higher -
      right.inference.interval.uncentered_sign_tail_fraction_higher)
    .map(item => item.name);
  assert.deepEqual(uncenteredOrder, ["tail-first", "null-first"]);
  assert.deepEqual(orderHolmByCalibratedNullPValue(mechanisms)
    .map(item => item.name), ["null-first", "tail-first"]);
  expectFailure(() => orderHolmByCalibratedNullPValue([{
    name: "legacy-tail",
    inference: {
      interval: {
        p_value_method: "uncentered-sign-tail",
        one_sided_p_higher_than_zero: 0.01,
      },
    },
  }]), /calibrated null p-value/u);
}

function passingGate() {
  const universe = candidateMultisetReceipt([
    { semantic: [0], ast: { op: "fixture" } },
  ]);
  const primaryUnits = Array.from({ length: 8 }, (_, index) => ({
    family_id: `gate-family-${index}`,
    mean_log_ratio: Math.log(0.7),
  }));
  const primaryInference = familyInferenceReceipt(primaryUnits, {
    design: "one-way",
    direction: "lower",
    seed: DEVELOPMENT_SEED_A,
    replicates: 64,
    alpha: 0.01,
  });
  const stratumInference = familyInferenceReceipt(primaryUnits, {
    design: "one-way",
    direction: "lower",
    seed: DEVELOPMENT_SEED_B,
    replicates: 64,
    alpha: 0.05,
  });
  return {
    integrity_valid: true,
    measurement_floor: false,
    registration: GATE_REGISTRATION,
    exact: {
      all_final_answers_exact: true,
      all_certificates_valid: true,
      premature_commits: 0,
      all_injected_invalid_first_candidates_rejected: true,
      all_primary_episodes_solved_within_global_cap: true,
      fallback_receipts: [{
        complete: true,
        candidate_universe: universe,
        fallback: universe,
        charged_verifier_checks: 1,
        charged_partial_expansions: 0,
        censoring_charge: 0,
        all_work_charged: true,
      }],
    },
    primary: { inference: primaryInference },
    strata: [
      { name: "id", inference: stratumInference },
    ],
    mechanisms: [],
    derangement: {
      observed: 0,
      values: Array.from({ length: 31 }, (_, index) => index + 1),
    },
    source_ablation_matches_source_free: true,
  };
}

function reconstructWithInventedGate(rows) {
  return {
    trace_rows: rows.length,
    gate_input: {
      measurement_floor: false,
      primary: { ratio: 0.01 },
      strata: [],
      mechanisms: [],
      derangement: { observed: 0, values: Array(31).fill(1) },
      source_ablation_matches_source_free: true,
    },
  };
}

function testGateAndTraceReplay() {
  const passed = reconstructCommonGate(passingGate());
  assert.equal(passed.decision, "pass");
  assert.deepEqual(passed.failures, []);
  const missedInference = familyInferenceReceipt(
    Array.from({ length: 8 }, (_, index) => ({
      family_id: `miss-family-${index}`,
      mean_log_ratio: Math.log(0.81),
    })), {
      design: "one-way", direction: "lower", seed: DEVELOPMENT_SEED_A,
      replicates: 64, alpha: 0.01,
    });
  const missed = reconstructCommonGate({
    ...passingGate(), primary: { inference: missedInference },
  });
  assert.equal(missed.decision, "no-go");
  assert.deepEqual(missed.failures, ["primary_ratio"]);
  const mechanismMissInference = familyInferenceReceipt(
    Array.from({ length: 8 }, (_, index) => ({
      family_id: `mechanism-miss-${index}`,
      mean_log_ratio: Math.log(0.9),
    })), {
      design: "one-way", direction: "higher", seed: DEVELOPMENT_SEED_B,
      replicates: 64, alpha: 0.05,
    });
  const mechanismMiss = reconstructCommonGate({
    ...passingGate(),
    registration: {
      ...GATE_REGISTRATION,
      formal_mechanisms: ["markov-off"],
    },
    mechanisms: [{ name: "markov-off", inference: mechanismMissInference }],
  });
  assert.equal(mechanismMiss.decision, "no-go");
  assert.ok(mechanismMiss.failures.includes("mechanism_effects"));
  assert.equal(reconstructCommonGate({ integrity_valid: false }).decision,
    "invalid-run");
  assert.equal(reconstructCommonGate({ ...passingGate(),
    measurement_floor: true }).decision, "measurement-floor");
  assert.equal(reconstructCommonGate({
    ...passingGate(),
    measurement_floor: true,
    exact: { ...passingGate().exact, all_final_answers_exact: false },
  }).decision, "invalid-run");
  assert.equal(reconstructCommonGate({
    ...passingGate(),
    primary: { inference: {
      ...passingGate().primary.inference,
      receipt_sha256: "0".repeat(64),
    } },
  }).decision, "invalid-run");

  const manifest = buildManifest(DEVELOPMENT_SEED_A);
  const rawTraces = rawTraceRows(manifest);
  for (const row of rawTraces)
    assert.deepEqual(Object.keys(row).sort(),
      [...REASONER5_TRACE_ROW_FIELDS].sort());
  const reconstruct = reconstructFixtureResult;
  const result = buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces,
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  });
  assert.match(result.result_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.decision, "pass");
  assert.equal(result.registered_analysis.primary.interval.point_ratio,
    portableNumber(Math.exp(portableNumber(Math.log(6 / 13)))));
  assert.equal(portableNumber(0.6309092162584323),
    portableNumber(0.6309092162584324));
  assert.deepEqual(portableNumbers({ value: 1.8793185096513947 }),
    { value: 1.87931850965139 });
  assert.equal(result.registered_analysis.derangement.values.length, 31);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces: rawTraces.map(row => row.arm === "source_ablation" ? {
      ...row,
      observation_queries: row.observation_queries + 1,
    } : row),
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  }), /source ablation differs from the source-free implementation path/u);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces: rawTraces.map((row, index) => index === 0 ? {
      ...row,
      complete_hidden_target: { ast: "leak" },
    } : row),
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  }), /raw trace row differs from its fixed schema/u);
  const episodeUnitManifest = structuredClone(manifest);
  episodeUnitManifest.analysis_contract.primary_analysis.unit_fields =
    ["generator_id", "episode_id"];
  delete episodeUnitManifest.manifest_sha256;
  episodeUnitManifest.manifest_sha256 = canonicalDigest(
    "generated-family-manifest", episodeUnitManifest);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest: episodeUnitManifest,
    rawTraces,
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  }), /unit field episode_id is not a family-level axis/u);
  const inventedManifest = buildManifest(DEVELOPMENT_SEED_A,
    reconstructWithInventedGate);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest: inventedManifest,
    rawTraces: rawTraceRows(inventedManifest),
    reconstruct: reconstructWithInventedGate,
    analysisSettings: ANALYSIS_SETTINGS,
  }), /reconstructed result field gate_input is reserved/u);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces,
    reconstruct: () => ({
      schema: "attacker-controlled",
      gate_input: (() => {
        const { registration, exact, integrity_valid, ...gateInput } =
          passingGate();
        return gateInput;
      })(),
    }),
    analysisSettings: ANALYSIS_SETTINGS,
  }), /analysis function differs from the manifest contract/u);
  assertResultReplay({ experiment: "reasoner5-harness-self-test", manifest,
    rawTraces, reconstruct, analysisSettings: ANALYSIS_SETTINGS, result });
  const equalCostRows = rawTraces.map(row => row.arm === "full" ?
    withVerifiedSearch(row, fixtureSearch(12)) : row);
  const equalCostResult = buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces: equalCostRows,
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  });
  assert.equal(equalCostResult.decision, "no-go");
  assert.ok(equalCostResult.gate.failures.includes("primary_ratio"));
  expectFailure(() => assertResultReplay({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces: rawTraces.map((row, index) => index === 0 ?
      { ...row, primary_cost: row.primary_cost + 1 } : row),
    reconstruct, analysisSettings: ANALYSIS_SETTINGS,
    result,
  }), /summary differs from verified search|does not reproduce/u);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces: rawTraces.map((row, index) => index === 0 ? {
      ...row,
      exact: false,
    } : row),
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  }), /summary differs from verified search/u);
  expectFailure(() => buildResultFromRawTraces({
    experiment: "reasoner5-harness-self-test",
    manifest,
    rawTraces: rawTraces.map(row => row.arm === "source_ablation" ?
      withVerifiedSearch(row, fixtureSearch(9)) : row),
    reconstruct,
    analysisSettings: ANALYSIS_SETTINGS,
  }), /source ablation differs from the source-free implementation path/u);
  expectFailure(() => assertResultReplay({
    experiment: "reasoner5-harness-self-test", manifest, rawTraces,
    reconstruct, analysisSettings: ANALYSIS_SETTINGS,
    result: { ...result, trace_rows: result.trace_rows + 1 },
  }), /does not reproduce/u);
}

testCanonicalDataAndSeeds();
testSplitsReplayAndOverlap();
testRankerViewsAndParity();
testVerifierAndAblation();
testFamilyStatistics();
testRecenteredNullBootstrap();
testGateAndTraceReplay();

const coverage = {
  canonical_sha256: true,
  hex_seed_handling: true,
  split_before_episode: true,
  cross_lane_ast_behavior_episode_rejection: true,
  byte_identical_manifest_replay: true,
  hash_bound_replay_registry: true,
  intrinsic_function_source_hashing: true,
  manifest_structure_replay: true,
  registered_cross_family_axis: true,
  registered_atom_subtree_overlap: true,
  whitelist_ranker_view: true,
  typed_public_projection: true,
  complete_ranker_leaf_schema: true,
  case_insensitive_hidden_field_rejection: true,
  candidate_multiset_arm_parity: true,
  exact_invalid_candidate_rejection: true,
  proposal_record_binding: true,
  proposal_work_charge_floor: true,
  proposal_work_surcharge: true,
  verified_search_receipt_replay: true,
  expansion_verifier_trace_cross_link: true,
  canonical_fallback_order: true,
  cap_plus_one_censoring: true,
  exhausted_fallback_cap_plus_one_censoring: true,
  source_ablation_trace_identity: true,
  nested_family_aggregation: true,
  family_level_unit_restriction: true,
  portable_numerical_receipts: true,
  one_way_cluster_bootstrap: true,
  ordinary_percentile_confidence_bounds: true,
  recentered_null_one_way_bootstrap: true,
  recentered_null_stratified_one_way_bootstrap: true,
  recentered_null_two_way_bootstrap: true,
  null_bootstrap_digest_binding: true,
  holm_uses_calibrated_null_p_values: true,
  complete_crossing_two_way_bootstrap: true,
  wilson_lower_bound: true,
  derangement_randomization: true,
  common_gate_reconstruction: true,
  mechanism_miss_is_no_go: true,
  exactness_before_measurement_floor: true,
  registered_raw_trace_analysis: true,
  strict_raw_trace_keys: true,
  raw_trace_result_replay: true,
};
assert.equal(Object.values(coverage).every(Boolean), true);
process.stdout.write(`${stableJson({
  schema: "zero.reasoner5_harness_self_test.v1",
  status: "pass",
  coverage,
})}`);

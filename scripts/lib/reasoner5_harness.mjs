import { isDeepStrictEqual } from "node:util";

import {
  assert as requireValue,
  sha256,
  stableJson,
} from "../zero_data_lib.mjs";

export const REASONER5_SPLIT_LANES = Object.freeze([
  "source-training",
  "calibration",
  "development",
  "sealed",
]);

export const REASONER5_EVALUATOR_ONLY_FIELDS = Object.freeze([
  "family_id",
  "shift_stratum",
  "generator_seed",
  "tie_salt",
  "renderer_family",
  "corruption_family",
  "response_tape_index",
  "latent_state",
  "target",
  "hidden_target",
  "clean_value",
  "clean_values",
  "exact_test_domain",
  "corruption_rate",
  "corruption_location",
  "corruption_direction",
  "channel_template",
  "channel_severity",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const HEX_SEED = /^[0-9a-f]{16,64}$/u;
const MASK64 = (1n << 64n) - 1n;
const FUNCTION_TO_STRING = Function.prototype.toString;
const REPLAY_REGISTRIES = new WeakMap();
const TRACE_BINDING_FIELDS = Object.freeze([
  "candidate_universe_digest",
  "grammar_digest",
  "initial_evidence_digest",
  "allowed_actions_digest",
  "latent_episode_digest",
  "potential_response_digest",
  "verifier_digest",
  "caps_digest",
]);
const FAMILY_ASSIGNMENT_FIELDS = new Set([
  "lane",
  "split_lane",
  "family_id",
  "generator_id",
  "episode_id",
  "nested_repeat_id",
  "seed",
  "seed_ref",
  "tie_salt",
  "nonce",
]);
const PUBLIC_PROVENANCE_CLASSES = new Set([
  "allowed-action",
  "generated-query",
  "observed-response",
  "public-constant",
  "public-mask",
]);
const FAMILY_UNIT_FIELDS = new Set([
  "family_id",
  "cross_family_id",
  "generator_id",
]);
export const REASONER5_TRACE_ROW_FIELDS = Object.freeze([
  "allowed_actions_digest",
  "answer_ir",
  "answer_ir_sha256",
  "arm",
  "ast_sha256",
  "behavior_sha256",
  "candidate_universe_digest",
  "caps_digest",
  "certificate_sha256",
  "certificate_valid",
  "censoring_reason",
  "cross_family_id",
  "episode_bytes_sha256",
  "episode_id",
  "episode_spec_sha256",
  "exact",
  "execution_trace_sha256",
  "experiment",
  "fallback_exhausted",
  "fallback_partial_expansions",
  "fallback_receipt",
  "fallback_started",
  "fallback_verifier_checks",
  "family_id",
  "generator_id",
  "global_cap_hit",
  "grammar_digest",
  "initial_evidence_digest",
  "injected_invalid",
  "injected_invalid_rejected",
  "lane",
  "latent_episode_digest",
  "nested_repeat_id",
  "observation_queries",
  "parity_digest",
  "partial_expansions",
  "peak_bytes",
  "potential_response_digest",
  "premature_commit",
  "primary_cost",
  "schema",
  "shift_stratum",
  "source_artifact_reads",
  "verified_search",
  "verifier_checks",
  "verifier_digest",
  "wall_ns",
]);
const CANDIDATE_SNAPSHOT_CACHE = new WeakMap();
const CANDIDATE_RECEIPT_CACHE = new WeakMap();
const CANDIDATE_ORDER_CACHE = new WeakMap();
const CANDIDATE_PROPOSAL_CACHE = new WeakMap();

function plainObject(value, label) {
  requireValue(value !== null && typeof value === "object" &&
    !Array.isArray(value), `${label} must be an object`);
}

function stringValue(value, label) {
  requireValue(typeof value === "string" && value.length > 0,
    `${label} must be a non-empty string`);
}

function safeInteger(value, label, minimum = 0) {
  requireValue(Number.isSafeInteger(value) && value >= minimum,
    `${label} must be a safe integer at least ${minimum}`);
}

function finiteNumber(value, label, minimum = -Infinity) {
  requireValue(Number.isFinite(value) && value >= minimum,
    `${label} must be a finite number at least ${minimum}`);
}

function assertExactKeys(value, expected, label) {
  plainObject(value, label);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  const extra = actualKeys.filter(key => !expectedKeys.includes(key));
  const missing = expectedKeys.filter(key => !actualKeys.includes(key));
  requireValue(isDeepStrictEqual(actualKeys, expectedKeys),
    `${label} differs from its fixed schema; extra=${extra.join(",")}; missing=${missing.join(",")}`);
}

function functionSource(fn, label) {
  requireValue(typeof fn === "function", `${label} must be a function`);
  const source = FUNCTION_TO_STRING.call(fn);
  requireValue(!source.includes("[native code]"),
    `${label} must have inspectable JavaScript source`);
  return source;
}

function assertFamilyUnitFields(fields, label, { crossed = false } = {}) {
  requireValue(Array.isArray(fields) && fields.length > 0 &&
    sortedUnique(fields).length === fields.length,
  `${label} needs unique unit fields`);
  for (const field of fields) {
    stringValue(field, `${label} unit field`);
    requireValue(FAMILY_UNIT_FIELDS.has(field),
      `${label} unit field ${field} is not a family-level axis`);
  }
  requireValue(fields.includes("family_id"),
    `${label} must include family_id`);
  requireValue(crossed === fields.includes("cross_family_id"),
    crossed ? `${label} must include cross_family_id` :
      `${label} cannot include cross_family_id in a one-way design`);
}

function assertCanonicalJsonValue(value, label = "canonical value",
  path = "$", ancestors = new Set()) {
  if (value === null || typeof value === "boolean" ||
      typeof value === "string") return;
  if (typeof value === "number") {
    requireValue(Number.isFinite(value) && !Object.is(value, -0),
      `${label} has a non-canonical number at ${path}`);
    return;
  }
  requireValue(typeof value === "object",
    `${label} has a non-JSON value at ${path}`);
  requireValue(!ancestors.has(value), `${label} has a cycle at ${path}`);
  requireValue(Object.getOwnPropertySymbols(value).length === 0,
    `${label} has a symbol key at ${path}`);
  const prototype = Object.getPrototypeOf(value);
  requireValue(Array.isArray(value) ? prototype === Array.prototype :
    prototype === Object.prototype || prototype === null,
  `${label} has a non-plain object at ${path}`);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    const keys = Object.keys(descriptors).filter(key => key !== "length");
    requireValue(keys.length === value.length,
      `${label} has a sparse or extended array at ${path}`);
    for (let index = 0; index < value.length; ++index) {
      const descriptor = descriptors[index];
      requireValue(descriptor !== undefined && "value" in descriptor &&
        descriptor.enumerable,
      `${label} has an accessor or hidden array item at ${path}[${index}]`);
      assertCanonicalJsonValue(descriptor.value, label, `${path}[${index}]`,
        nextAncestors);
    }
    return;
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    requireValue("value" in descriptor && descriptor.enumerable,
      `${label} has an accessor or hidden property at ${path}.${key}`);
    assertCanonicalJsonValue(descriptor.value, label, `${path}.${key}`,
      nextAncestors);
  }
}

function cloneJson(value, label = "JSON value") {
  assertCanonicalJsonValue(value, label);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function isDeepFrozen(value) {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assertFamilySpecIndependent(value) {
  for (const key of collectObjectKeys(value)) {
    const normalized = key.toLowerCase();
    requireValue(!FAMILY_ASSIGNMENT_FIELDS.has(normalized) &&
      !/(^|_)seed($|_)/u.test(normalized),
    `family_spec contains split-assignment field ${key}`);
  }
}

function validateReplayRecipe(recipe) {
  plainObject(recipe, "episode replay recipe");
  const keys = Object.keys(recipe).sort();
  requireValue(isDeepStrictEqual(keys, ["generator_sha256",
    "input_generator_sha256", "replay_function_sha256", "schema",
    "seed_binding"]),
  "episode replay recipe has fields outside the fixed schema");
  requireValue(recipe.schema === "zero.reasoner5_replay_recipe.v1",
    "episode replay recipe has the wrong schema");
  for (const field of ["generator_sha256", "input_generator_sha256",
    "replay_function_sha256"])
    requireValue(typeof recipe[field] === "string" && SHA256.test(recipe[field]),
      `episode replay recipe needs ${field}`);
  plainObject(recipe.seed_binding, "episode replay seed binding");
  requireValue(isDeepStrictEqual(Object.keys(recipe.seed_binding).sort(),
    ["derivation_path", "root_seed"]),
  "episode replay seed binding has fields outside the fixed schema");
  normalizeHexSeed(recipe.seed_binding.root_seed,
    "episode replay root seed");
  requireValue(Array.isArray(recipe.seed_binding.derivation_path) &&
    recipe.seed_binding.derivation_path.length > 0 &&
    recipe.seed_binding.derivation_path.length <= 16,
  "episode replay derivation path must contain 1 to 16 parts");
  for (const part of recipe.seed_binding.derivation_path)
    requireValue((typeof part === "string" && part.length > 0 &&
      part.length <= 128) || Number.isSafeInteger(part),
    "episode replay derivation parts must be bounded strings or integers");
  assertCanonicalJsonValue(recipe, "episode replay recipe");
  return recipe;
}

function fieldDigest(kind, value) {
  return canonicalDigest(kind, value);
}

function getUnitField(unit, field) {
  if (Object.hasOwn(unit, field)) return unit[field];
  if (unit.unit && Object.hasOwn(unit.unit, field)) return unit.unit[field];
  return undefined;
}

export function canonicalBytes(value) {
  assertCanonicalJsonValue(value);
  return Buffer.from(stableJson(value), "utf8");
}

export function canonicalDigest(kind, value) {
  stringValue(kind, "canonical digest kind");
  return sha256(canonicalBytes({
    schema: "zero.reasoner5_canonical.v1",
    kind,
    value,
  }));
}

export function normalizeHexSeed(value, label = "seed") {
  stringValue(value, label);
  requireValue(HEX_SEED.test(value),
    `${label} must contain 16 to 64 lowercase hexadecimal characters`);
  return value;
}

export function deriveSeed(rootSeed, ...parts) {
  normalizeHexSeed(rootSeed, "root seed");
  return canonicalDigest("derived-seed", { root_seed: rootSeed, parts })
    .slice(0, 16);
}

export function createDeterministicRng(rootSeed, namespace = "default") {
  normalizeHexSeed(rootSeed, "root seed");
  stringValue(namespace, "RNG namespace");
  let state = BigInt(`0x${deriveSeed(rootSeed, namespace)}`);
  return {
    nextUint64() {
      state = (state + 0x9e3779b97f4a7c15n) & MASK64;
      let value = state;
      value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
      value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK64;
      return (value ^ (value >> 31n)) & MASK64;
    },
    index(bound) {
      safeInteger(bound, "RNG bound", 1);
      const size = 1n << 64n;
      const divisor = BigInt(bound);
      const limit = size - (size % divisor);
      let value;
      do value = this.nextUint64(); while (value >= limit);
      return Number(value % divisor);
    },
  };
}

export function sampleIndex(rootSeed, counter, bound, namespace = "sample") {
  safeInteger(counter, "sample counter");
  const rng = createDeterministicRng(deriveSeed(rootSeed, counter), namespace);
  return rng.index(bound);
}

function splitIndexes() {
  return {
    families: new Map(),
    family_specs: new Map(),
    ast: new Map(),
    behavior: new Map(),
    episode: new Map(),
  };
}

export function createSplitState({ experiment_id, lanes = REASONER5_SPLIT_LANES }) {
  stringValue(experiment_id, "experiment ID");
  requireValue(Array.isArray(lanes) && lanes.length > 1,
    "split lanes must contain at least two lanes");
  const uniqueLanes = sortedUnique(lanes);
  requireValue(uniqueLanes.length === lanes.length,
    "split lanes must be unique");
  for (const lane of lanes) stringValue(lane, "split lane");
  const state = {
    schema: "zero.reasoner5_split_state.v1",
    experiment_id,
    phase: "families",
    lanes: Object.freeze([...lanes]),
    families: [],
    episodes: [],
    rejection_counts: {
      cross_lane_family: 0,
      cross_lane_ast: 0,
      cross_lane_behavior: 0,
      cross_lane_episode: 0,
    },
  };
  Object.defineProperty(state, "_indexes", {
    enumerable: false,
    value: splitIndexes(),
  });
  return state;
}

export function registerFamily(state, family) {
  plainObject(state, "split state");
  plainObject(family, "family");
  requireValue(state.phase === "families",
    "all families must be registered before episode generation");
  stringValue(family.family_id, "family ID");
  stringValue(family.lane, "family lane");
  stringValue(family.generator_id, "family generator ID");
  stringValue(family.shift_stratum, "family shift stratum");
  requireValue(Object.hasOwn(family, "family_spec"),
    "family registration needs a family_spec");
  assertFamilySpecIndependent(family.family_spec);
  requireValue(state.lanes.includes(family.lane),
    `unknown family lane ${family.lane}`);
  requireValue(!collectObjectKeys(family).some(key =>
    /(^|_)seed($|_)/u.test(key.toLowerCase())),
    "family registration must finish before seed assignment");
  requireValue(!state._indexes.families.has(family.family_id),
    `duplicate family ID ${family.family_id}`);
  const record = cloneJson(family, "family registration");
  record.family_spec_sha256 = canonicalDigest("task-family-specification",
    record.family_spec);
  const prior = state._indexes.family_specs.get(record.family_spec_sha256);
  if (prior !== undefined) {
    if (prior.lane !== record.lane)
      state.rejection_counts.cross_lane_family += 1;
    throw new Error(`family fingerprint duplicates ${prior.family_id} in ${prior.lane}`);
  }
  const stored = deepFreeze(record);
  state._indexes.family_specs.set(stored.family_spec_sha256, stored);
  state._indexes.families.set(stored.family_id, stored);
  state.families.push(stored);
  return cloneJson(stored);
}

export function freezeFamilySplits(state) {
  plainObject(state, "split state");
  requireValue(state.phase === "families", "family split is already frozen");
  requireValue(state.families.length > 0, "family split must contain families");
  Object.freeze(state.families);
  state.phase = "episodes";
  return state;
}

function fingerprintConflict(state, kind, digest, lane, familyId) {
  const prior = state._indexes[kind].get(digest);
  if (prior !== undefined && prior.lane !== lane) {
    state.rejection_counts[`cross_lane_${kind}`] += 1;
    throw new Error(`${kind} fingerprint crosses ${prior.lane} and ${lane}`);
  }
  requireValue(prior === undefined || prior.family_id === familyId,
    `${kind} fingerprint is shared by independent families ${prior?.family_id} and ${familyId}`);
}

export function registerEpisode(state, episode) {
  plainObject(state, "split state");
  plainObject(episode, "episode");
  requireValue(state.phase === "episodes",
    "family splits must freeze before episode generation");
  for (const field of ["episode_id", "lane", "family_id",
    "nested_repeat_id"]) {
    stringValue(episode[field], `episode ${field}`);
  }
  requireValue(typeof episode.seed_ref === "string" && SHA256.test(episode.seed_ref),
    "episode seed_ref must be a lowercase SHA-256 commitment");
  const family = state._indexes.families.get(episode.family_id);
  requireValue(family !== undefined, `unknown episode family ${episode.family_id}`);
  requireValue(family.lane === episode.lane,
    `episode lane differs from family ${episode.family_id}`);
  requireValue(!state.episodes.some(item => item.episode_id === episode.episode_id),
    `duplicate episode ID ${episode.episode_id}`);
  requireValue(episode.cross_family_id === undefined ||
    episode.cross_family_id === null ||
    (typeof episode.cross_family_id === "string" &&
      episode.cross_family_id.length > 0),
  "episode cross_family_id must be null or a registered family ID");
  if (episode.cross_family_id !== undefined &&
      episode.cross_family_id !== null) {
    const crossFamily = state._indexes.families.get(episode.cross_family_id);
    requireValue(crossFamily !== undefined,
      `unknown episode cross family ${episode.cross_family_id}`);
    requireValue(crossFamily.lane === episode.lane,
      `episode lane differs from cross family ${episode.cross_family_id}`);
    requireValue(crossFamily.family_id !== family.family_id,
      "episode family and cross family must differ");
  }
  plainObject(episode.public, "episode public view");
  plainObject(episode.evaluator, "episode evaluator view");
  validateReplayRecipe(episode.replay_recipe);
  requireValue(episode.seed_ref === canonicalDigest("episode-seed-reference",
    episode.replay_recipe),
  "episode seed_ref does not match its full replay recipe");
  assertRankerPolicy(episode.ranker_policy);
  assertRankerView(episode.public, {
    whitelist: episode.ranker_policy.leaf_whitelist,
    leafContracts: episode.ranker_policy.leaf_contracts,
  });
  plainObject(episode.trace_binding, "episode trace binding");
  for (const field of TRACE_BINDING_FIELDS)
    requireValue(SHA256.test(episode.trace_binding[field]),
      `episode trace binding needs ${field}`);
  requireValue(!Object.hasOwn(episode.trace_binding, "parity_digest"),
    "episode parity digest is computed by the harness");
  requireValue(Array.isArray(episode.arm_parity_receipts),
    "episode needs arm parity receipts");
  requireValue(Array.isArray(episode.expected_arms),
    "episode needs expected arm names");
  const armParity = assertArmParity(episode.arm_parity_receipts, {
    expectedArms: episode.expected_arms,
  });
  const parityBase = episode.arm_parity_receipts[0];
  const expectedTraceBinding = {
    candidate_universe_digest: canonicalDigest("candidate-universe",
      parityBase.candidate_multiset),
    grammar_digest: parityBase.grammar_sha256,
    initial_evidence_digest: parityBase.initial_evidence_sha256,
    allowed_actions_digest: parityBase.allowed_actions_sha256,
    latent_episode_digest: parityBase.latent_episode_sha256,
    potential_response_digest: parityBase.potential_response_sha256,
    verifier_digest: parityBase.verifier_sha256,
    caps_digest: parityBase.caps_sha256,
  };
  requireValue(isDeepStrictEqual(episode.trace_binding, expectedTraceBinding),
    "episode trace binding differs from its checked arm parity receipts");
  for (const field of ["ast", "behavior", "episode_spec"])
    requireValue(Object.hasOwn(episode.evaluator, field),
      `episode evaluator view needs ${field}`);
  const fingerprints = {
    ast_sha256: canonicalDigest("complete-target-ast", episode.evaluator.ast),
    behavior_sha256: canonicalDigest("complete-program-behavior",
      episode.evaluator.behavior),
    episode_spec_sha256: canonicalDigest("complete-episode-specification",
      episode.evaluator.episode_spec),
  };
  const content = {
    public: cloneJson(episode.public, "episode public view"),
    evaluator: cloneJson(episode.evaluator, "episode evaluator view"),
  };
  const traceBinding = {
    ...cloneJson(episode.trace_binding, "episode trace binding"),
    parity_digest: armParity.parity_sha256,
  };
  const episodeBytes = {
    schema: "zero.reasoner5_episode.v1",
    episode_id: episode.episode_id,
    lane: episode.lane,
    family_id: episode.family_id,
    cross_family_id: episode.cross_family_id ?? null,
    generator_id: family.generator_id,
    shift_stratum: family.shift_stratum,
    nested_repeat_id: episode.nested_repeat_id,
    seed_ref: episode.seed_ref,
    ranker_policy: cloneJson(episode.ranker_policy, "episode ranker policy"),
    arm_parity: {
      arms: [...armParity.arms].sort(),
      parity_sha256: armParity.parity_sha256,
    },
    trace_binding: traceBinding,
    content,
  };
  const record = {
    ...episodeBytes,
    replay_recipe: cloneJson(episode.replay_recipe, "episode replay recipe"),
    fingerprints,
    episode_bytes_sha256: canonicalDigest("episode-bytes", episodeBytes),
  };
  const stored = deepFreeze(record);
  fingerprintConflict(state, "ast", fingerprints.ast_sha256, episode.lane,
    episode.family_id);
  fingerprintConflict(state, "behavior", fingerprints.behavior_sha256,
    episode.lane, episode.family_id);
  fingerprintConflict(state, "episode", fingerprints.episode_spec_sha256,
    episode.lane, episode.family_id);
  const owner = { lane: episode.lane, family_id: episode.family_id };
  state.episodes.push(stored);
  state._indexes.ast.set(fingerprints.ast_sha256, owner);
  state._indexes.behavior.set(fingerprints.behavior_sha256, owner);
  state._indexes.episode.set(fingerprints.episode_spec_sha256, owner);
  return cloneJson(stored);
}

function validateSplitState(state) {
  const families = new Map();
  const familySpecs = new Map();
  for (const family of state.families) {
    plainObject(family, "stored family");
    stringValue(family.family_id, "stored family ID");
    requireValue(state.lanes.includes(family.lane),
      `stored family ${family.family_id} has an unknown lane`);
    requireValue(!families.has(family.family_id),
      `stored family ID ${family.family_id} is duplicated`);
    const familyDigest = canonicalDigest("task-family-specification",
      family.family_spec);
    requireValue(family.family_spec_sha256 === familyDigest,
      `stored family ${family.family_id} fingerprint changed`);
    const priorFamily = familySpecs.get(familyDigest);
    requireValue(priorFamily === undefined,
      `stored family fingerprint duplicates ${priorFamily?.family_id}`);
    families.set(family.family_id, family);
    familySpecs.set(familyDigest, family);
  }
  const episodeIds = new Set();
  const indexes = { ast: new Map(), behavior: new Map(), episode: new Map() };
  for (const episode of state.episodes) {
    plainObject(episode, "stored episode");
    requireValue(!episodeIds.has(episode.episode_id),
      `stored episode ID ${episode.episode_id} is duplicated`);
    episodeIds.add(episode.episode_id);
    const family = families.get(episode.family_id);
    requireValue(family !== undefined && family.lane === episode.lane,
      `stored episode ${episode.episode_id} changed family or lane`);
    if (episode.cross_family_id !== null) {
      const crossFamily = families.get(episode.cross_family_id);
      requireValue(crossFamily !== undefined &&
        crossFamily.lane === episode.lane &&
        crossFamily.family_id !== family.family_id,
      `stored episode ${episode.episode_id} changed cross family or lane`);
    }
    requireValue(episode.generator_id === family.generator_id &&
      episode.shift_stratum === family.shift_stratum,
    `stored episode ${episode.episode_id} changed family metadata`);
    validateReplayRecipe(episode.replay_recipe);
    requireValue(episode.seed_ref === canonicalDigest("episode-seed-reference",
      episode.replay_recipe),
    `stored episode ${episode.episode_id} changed its replay recipe`);
    assertRankerPolicy(episode.ranker_policy);
    assertRankerView(episode.content.public, {
      whitelist: episode.ranker_policy.leaf_whitelist,
      leafContracts: episode.ranker_policy.leaf_contracts,
    });
    requireValue(episode.trace_binding.parity_digest ===
      episode.arm_parity.parity_sha256,
    `stored episode ${episode.episode_id} changed its parity receipt`);
    const expected = {
      ast_sha256: canonicalDigest("complete-target-ast",
        episode.content.evaluator.ast),
      behavior_sha256: canonicalDigest("complete-program-behavior",
        episode.content.evaluator.behavior),
      episode_spec_sha256: canonicalDigest("complete-episode-specification",
        episode.content.evaluator.episode_spec),
    };
    requireValue(isDeepStrictEqual(expected, episode.fingerprints),
      `stored episode ${episode.episode_id} fingerprints changed`);
    for (const [kind, digest] of [["ast", expected.ast_sha256],
      ["behavior", expected.behavior_sha256],
      ["episode", expected.episode_spec_sha256]]) {
      const prior = indexes[kind].get(digest);
      requireValue(prior === undefined || (prior.lane === episode.lane &&
        prior.family_id === episode.family_id),
      `stored ${kind} fingerprint crosses family or lane boundaries`);
      indexes[kind].set(digest,
        { lane: episode.lane, family_id: episode.family_id });
    }
    const bytes = {
      schema: episode.schema,
      episode_id: episode.episode_id,
      lane: episode.lane,
      family_id: episode.family_id,
      cross_family_id: episode.cross_family_id,
      generator_id: episode.generator_id,
      shift_stratum: episode.shift_stratum,
      nested_repeat_id: episode.nested_repeat_id,
      seed_ref: episode.seed_ref,
      ranker_policy: episode.ranker_policy,
      arm_parity: episode.arm_parity,
      trace_binding: episode.trace_binding,
      content: episode.content,
    };
    requireValue(episode.episode_bytes_sha256 ===
      canonicalDigest("episode-bytes", bytes),
    `stored episode ${episode.episode_id} byte digest changed`);
  }
}

export function finalizeManifest(state, extra = {}) {
  plainObject(state, "split state");
  requireValue(state.phase === "episodes",
    "manifest finalization needs a frozen family split");
  validateSplitState(state);
  const familyCounts = Object.fromEntries(state.lanes.map(lane =>
    [lane, state.families.filter(family => family.lane === lane).length]));
  const episodeCounts = Object.fromEntries(state.lanes.map(lane =>
    [lane, state.episodes.filter(episode => episode.lane === lane).length]));
  plainObject(extra, "manifest extra fields");
  const reserved = new Set(["schema", "experiment_id", "split_order",
    "family_counts", "episode_counts", "rejection_counts", "families",
    "episodes", "manifest_sha256"]);
  for (const key of Object.keys(extra))
    requireValue(!reserved.has(key), `manifest extra field ${key} is reserved`);
  const body = {
    schema: "zero.reasoner5_generated_family_manifest.v1",
    experiment_id: state.experiment_id,
    split_order: [...state.lanes],
    family_counts: familyCounts,
    episode_counts: episodeCounts,
    rejection_counts: cloneJson(state.rejection_counts),
    families: cloneJson([...state.families]).sort((left, right) =>
      left.family_id.localeCompare(right.family_id)),
    episodes: cloneJson([...state.episodes]).sort((left, right) =>
      left.episode_id.localeCompare(right.episode_id)),
    ...cloneJson(extra),
  };
  return {
    ...body,
    manifest_sha256: canonicalDigest("generated-family-manifest", body),
  };
}

export function assertManifestDigest(manifest) {
  plainObject(manifest, "manifest");
  requireValue(manifest.schema ===
    "zero.reasoner5_generated_family_manifest.v1",
  "manifest has the wrong schema");
  requireValue(isDeepStrictEqual(manifest.split_order,
    REASONER5_SPLIT_LANES), "manifest has the wrong split order");
  requireValue(Array.isArray(manifest.families) &&
    Array.isArray(manifest.episodes),
  "manifest needs family and episode arrays");
  requireValue(SHA256.test(manifest.manifest_sha256),
    "manifest needs a lowercase SHA-256 digest");
  const body = cloneJson(manifest);
  delete body.manifest_sha256;
  const actual = canonicalDigest("generated-family-manifest", body);
  requireValue(actual === manifest.manifest_sha256,
    "manifest SHA-256 does not match its canonical body");
  validateSplitState({
    lanes: manifest.split_order,
    families: manifest.families,
    episodes: manifest.episodes,
  });
  const familyCounts = Object.fromEntries(manifest.split_order.map(lane =>
    [lane, manifest.families.filter(family => family.lane === lane).length]));
  const episodeCounts = Object.fromEntries(manifest.split_order.map(lane =>
    [lane, manifest.episodes.filter(episode => episode.lane === lane).length]));
  requireValue(isDeepStrictEqual(manifest.family_counts, familyCounts) &&
    isDeepStrictEqual(manifest.episode_counts, episodeCounts),
  "manifest split counts differ from its records");
  return actual;
}

export function replayFunctionDigest(replay) {
  return canonicalDigest("episode-replay-function-source",
    functionSource(replay, "episode replay"));
}

export function analysisFunctionDigest(reconstruct) {
  return canonicalDigest("analysis-function-source",
    functionSource(reconstruct, "raw-trace reconstruction"));
}

export function createReplayRegistry() {
  const registry = Object.freeze({
    schema: "zero.reasoner5_replay_registry.v1",
  });
  REPLAY_REGISTRIES.set(registry, new Map());
  return registry;
}

function replayRegistryMap(registry) {
  requireValue(registry !== null && typeof registry === "object" &&
    REPLAY_REGISTRIES.has(registry),
  "episode replay needs a harness replay registry");
  return REPLAY_REGISTRIES.get(registry);
}

function replayRegistryKey(generatorSha256, inputGeneratorSha256,
  replayFunctionSha256) {
  return `${generatorSha256}\u0000${inputGeneratorSha256}\u0000${replayFunctionSha256}`;
}

export function registerReplayPipeline(registry, {
  generator_sha256,
  input_generator_sha256,
  replay_function_sha256,
  replay,
}) {
  for (const [field, value] of [["generator_sha256", generator_sha256],
    ["input_generator_sha256", input_generator_sha256],
    ["replay_function_sha256", replay_function_sha256]])
    requireValue(typeof value === "string" && SHA256.test(value),
      `replay pipeline needs ${field}`);
  requireValue(replayFunctionDigest(replay) === replay_function_sha256,
    "replay pipeline function differs from its registered digest");
  const pipelines = replayRegistryMap(registry);
  const key = replayRegistryKey(generator_sha256, input_generator_sha256,
    replay_function_sha256);
  requireValue(!pipelines.has(key), "replay pipeline is already registered");
  pipelines.set(key, Object.freeze({ replay, replay_function_sha256 }));
  return key;
}

export function assertManifestReplay(manifest, registry) {
  plainObject(manifest, "manifest");
  assertManifestDigest(manifest);
  const pipelines = replayRegistryMap(registry);
  const receipts = [];
  for (const episode of manifest.episodes) {
    validateReplayRecipe(episode.replay_recipe);
    const key = replayRegistryKey(episode.replay_recipe.generator_sha256,
      episode.replay_recipe.input_generator_sha256,
      episode.replay_recipe.replay_function_sha256);
    const pipeline = pipelines.get(key);
    requireValue(pipeline !== undefined,
      `episode ${episode.episode_id} has no hash-matched replay pipeline`);
    requireValue(replayFunctionDigest(pipeline.replay) ===
      pipeline.replay_function_sha256 &&
      pipeline.replay_function_sha256 ===
        episode.replay_recipe.replay_function_sha256,
    `episode ${episode.episode_id} replay function source changed`);
    const content = pipeline.replay(cloneJson(episode.replay_recipe,
      "episode replay recipe"));
    plainObject(content, "replayed episode content");
    const replayed = {
      schema: episode.schema,
      episode_id: episode.episode_id,
      lane: episode.lane,
      family_id: episode.family_id,
      cross_family_id: episode.cross_family_id,
      generator_id: episode.generator_id,
      shift_stratum: episode.shift_stratum,
      nested_repeat_id: episode.nested_repeat_id,
      seed_ref: episode.seed_ref,
      ranker_policy: episode.ranker_policy,
      arm_parity: episode.arm_parity,
      trace_binding: episode.trace_binding,
      content,
    };
    const digest = canonicalDigest("episode-bytes", replayed);
    requireValue(digest === episode.episode_bytes_sha256,
      `episode replay changed bytes for ${episode.episode_id}`);
    receipts.push({ episode_id: episode.episode_id, sha256: digest });
  }
  return {
    episodes: receipts.length,
    replay_sha256: canonicalDigest("episode-replay-receipts", receipts),
  };
}

function valueSet(episodes, lane, field) {
  const values = [];
  for (const episode of episodes.filter(item => item.lane === lane)) {
    const list = episode.content?.evaluator?.[field];
    requireValue(Array.isArray(list),
      `episode ${episode.episode_id} needs evaluator ${field}`);
    for (const value of list)
      values.push(canonicalDigest(`overlap-${field}`, value));
  }
  return new Set(values);
}

export function overlapReceipt(episodes, field, leftLane, rightLane) {
  requireValue(["atoms", "typed_subtrees"].includes(field),
    "overlap field must be atoms or typed_subtrees");
  const left = valueSet(episodes, leftLane, field);
  const right = valueSet(episodes, rightLane, field);
  const overlap = [...left].filter(value => right.has(value)).sort();
  return {
    field,
    left_lane: leftLane,
    right_lane: rightLane,
    left_distinct: left.size,
    right_distinct: right.size,
    overlap_count: overlap.length,
    overlap_sha256: canonicalDigest(`${field}-overlap`, overlap),
  };
}

export function assertRegisteredOverlap(actual, registered) {
  plainObject(actual, "actual overlap receipt");
  plainObject(registered, "registered overlap receipt");
  for (const field of ["field", "left_lane", "right_lane", "left_distinct",
    "right_distinct", "overlap_count", "overlap_sha256"])
    requireValue(actual[field] === registered[field],
      `registered overlap changed at ${field}`);
  return true;
}

function collectObjectKeys(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, output);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectObjectKeys(item, output);
    }
  }
  return output;
}

const RANKER_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)*$/u;

function rankerPathParts(path) {
  requireValue(RANKER_PATH.test(path),
    `ranker whitelist path ${path} has invalid syntax`);
  return path.split(".").map(part => ({
    field: part.endsWith("[]") ? part.slice(0, -2) : part,
    array: part.endsWith("[]"),
  }));
}

function assertPublicPath(path) {
  const hidden = new Set(REASONER5_EVALUATOR_ONLY_FIELDS.map(field =>
    field.toLowerCase()));
  for (const part of rankerPathParts(path))
    requireValue(!hidden.has(part.field.toLowerCase()),
      `ranker policy exposes evaluator field ${part.field}`);
}

function buildRankerSchema(whitelist, leafContracts) {
  const root = { children: new Map(), contract: null };
  for (const path of whitelist) {
    let node = root;
    for (const [index, part] of rankerPathParts(path).entries()) {
      requireValue(node.contract === null,
        `ranker path ${path} extends a registered leaf`);
      const prior = node.children.get(part.field);
      if (prior !== undefined)
        requireValue(prior.array === part.array,
          `ranker field ${part.field} has conflicting array shape`);
      const child = prior ?? { array: part.array, children: new Map(),
        contract: null };
      node.children.set(part.field, child);
      node = child;
      if (index === rankerPathParts(path).length - 1) {
        requireValue(node.children.size === 0 && node.contract === null,
          `ranker path ${path} conflicts with another leaf`);
        node.contract = leafContracts[path];
      }
    }
  }
  return root;
}

function assertRankerSchemaValue(value, node, path = "ranker") {
  if (node.contract !== null) {
    requireValue(rankerLeafTypeMatches(value, node.contract.type),
      `ranker field ${path} differs from its registered type`);
    return;
  }
  plainObject(value, `ranker field ${path}`);
  requireValue(isDeepStrictEqual(Object.keys(value).sort(),
    [...node.children.keys()].sort()),
  `ranker field ${path} differs from its complete registered schema`);
  for (const [field, child] of node.children) {
    const nextPath = path === "ranker" ? field : `${path}.${field}`;
    const item = value[field];
    if (child.array) {
      requireValue(Array.isArray(item),
        `ranker field ${nextPath} must be an array`);
      for (const member of item)
        assertRankerSchemaValue(member, child, `${nextPath}[]`);
    } else {
      requireValue(!Array.isArray(item),
        `ranker field ${nextPath} must not be an array`);
      assertRankerSchemaValue(item, child, nextPath);
    }
  }
}

function assertRankerPolicy(policy) {
  plainObject(policy, "episode ranker policy");
  requireValue(policy.schema === "zero.reasoner5_ranker_policy.v1",
    "episode ranker policy has the wrong schema");
  requireValue(isDeepStrictEqual(Object.keys(policy).sort(),
    ["leaf_contracts", "leaf_whitelist", "schema"]),
  "episode ranker policy has fields outside the fixed schema");
  requireValue(Array.isArray(policy.leaf_whitelist) &&
    policy.leaf_whitelist.length > 0,
  "episode ranker policy needs a leaf whitelist");
  for (const path of policy.leaf_whitelist) {
    stringValue(path, "episode ranker whitelist path");
    assertPublicPath(path);
  }
  requireValue(sortedUnique(policy.leaf_whitelist).length ===
    policy.leaf_whitelist.length,
  "episode ranker whitelist paths must be unique");
  plainObject(policy.leaf_contracts, "episode ranker leaf contracts");
  requireValue(isDeepStrictEqual(Object.keys(policy.leaf_contracts).sort(),
    [...policy.leaf_whitelist].sort()),
  "episode ranker leaf contracts must match the whitelist");
  for (const [path, contract] of Object.entries(policy.leaf_contracts)) {
    plainObject(contract, `episode ranker leaf contract ${path}`);
    requireValue(isDeepStrictEqual(Object.keys(contract).sort(),
      ["provenance", "type"]),
    `episode ranker leaf contract ${path} has fields outside the schema`);
    requireValue(["boolean", "integer", "json", "null", "number",
      "string"].includes(contract.type),
    `episode ranker leaf contract ${path} has an unknown type`);
    requireValue(PUBLIC_PROVENANCE_CLASSES.has(contract.provenance),
      `episode ranker leaf contract ${path} has unknown provenance`);
  }
  return policy;
}

function rankerLeafTypeMatches(value, type) {
  if (type === "json") return true;
  if (type === "null") return value === null;
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" &&
    Number.isFinite(value) && !Object.is(value, -0);
  return typeof value === type;
}

export function assertRankerView(view, {
  whitelist,
  leafContracts,
} = {}) {
  plainObject(view, "ranker view");
  requireValue(Array.isArray(whitelist) && whitelist.length > 0,
    "ranker whitelist must be a non-empty leaf-path array");
  for (const path of whitelist) {
    stringValue(path, "ranker whitelist path");
    assertPublicPath(path);
  }
  requireValue(sortedUnique(whitelist).length === whitelist.length,
    "ranker whitelist paths must be unique");
  plainObject(leafContracts, "ranker leaf contracts");
  requireValue(isDeepStrictEqual(Object.keys(leafContracts).sort(),
    [...whitelist].sort()),
  "ranker leaf contracts must match the whitelist");
  const schema = buildRankerSchema(whitelist, leafContracts);
  assertRankerSchemaValue(view, schema);
  const hidden = new Set(REASONER5_EVALUATOR_ONLY_FIELDS.map(field =>
    field.toLowerCase()));
  for (const key of collectObjectKeys(view))
    requireValue(!hidden.has(key.toLowerCase()),
      `ranker view exposes evaluator field ${key}`);
  return true;
}

export function buildRankerView(episode) {
  const content = episode.content ?? episode;
  plainObject(content, "episode content");
  plainObject(content.public, "episode public fields");
  plainObject(content.evaluator, "episode evaluator fields");
  assertRankerPolicy(episode.ranker_policy);
  const view = cloneJson(content.public);
  assertRankerView(view, {
    whitelist: episode.ranker_policy.leaf_whitelist,
    leafContracts: episode.ranker_policy.leaf_contracts,
  });
  return view;
}

export function candidateSemanticDigest(candidate) {
  assertCanonicalJsonValue(candidate, "candidate");
  if (candidate && typeof candidate === "object" &&
      typeof candidate.semantic_digest === "string") {
    requireValue(SHA256.test(candidate.semantic_digest),
      "candidate semantic digest must be a lowercase SHA-256 digest");
    requireValue(Object.hasOwn(candidate, "semantic"),
      "candidate semantic digest needs its canonical semantic value");
    requireValue(candidate.semantic_digest ===
      canonicalDigest("candidate-semantic-class", candidate.semantic),
    "candidate semantic digest does not match its semantic value");
    return candidate.semantic_digest;
  }
  const semantic = candidate && typeof candidate === "object" &&
    Object.hasOwn(candidate, "semantic") ? candidate.semantic : candidate;
  return canonicalDigest("candidate-semantic-class", semantic);
}

export function candidateAstDigest(candidate) {
  assertCanonicalJsonValue(candidate, "candidate");
  if (candidate && typeof candidate === "object" &&
      typeof candidate.ast_digest === "string") {
    requireValue(SHA256.test(candidate.ast_digest),
      "candidate AST digest must be a lowercase SHA-256 digest");
    requireValue(Object.hasOwn(candidate, "ast"),
      "candidate AST digest needs its canonical AST value");
    requireValue(candidate.ast_digest === canonicalDigest("candidate-ast",
      candidate.ast), "candidate AST digest does not match its AST value");
    return candidate.ast_digest;
  }
  const ast = candidate && typeof candidate === "object" &&
    Object.hasOwn(candidate, "ast") ? candidate.ast :
    (candidate && typeof candidate === "object" &&
      Object.hasOwn(candidate, "semantic") ? candidate.semantic : candidate);
  return canonicalDigest("candidate-ast", ast);
}

function candidateOrderEntry(candidate) {
  return {
    semantic_sha256: candidateSemanticDigest(candidate),
    ast_sha256: candidateAstDigest(candidate),
    record_sha256: canonicalDigest("candidate-record", candidate),
  };
}

function candidateProposalEntry(candidate) {
  const record = cloneJson(candidate, "candidate proposal record");
  let partialExpansions = 0;
  if (record !== null && typeof record === "object" &&
      !Array.isArray(record) && Object.hasOwn(record, "partial_expansions")) {
    partialExpansions = record.partial_expansions;
    delete record.partial_expansions;
  }
  return {
    record_sha256: canonicalDigest("candidate-proposal-record", record),
    partial_expansions: partialExpansions,
  };
}

function compareCandidateEntries(left, right) {
  return left.semantic_sha256.localeCompare(right.semantic_sha256) ||
    left.ast_sha256.localeCompare(right.ast_sha256) ||
    left.record_sha256.localeCompare(right.record_sha256);
}

function candidateSequenceDigest(candidates) {
  return canonicalDigest("candidate-canonical-order",
    candidates.map(candidateOrderEntry));
}

export function canonicalCandidateOrder(candidates) {
  requireValue(Array.isArray(candidates) && candidates.length > 0,
    "canonical candidate order needs a non-empty array");
  return cloneJson(candidates, "canonical candidate order").map(candidate => ({
    candidate,
    entry: candidateOrderEntry(candidate),
  })).sort((left, right) => compareCandidateEntries(left.entry, right.entry))
    .map(item => item.candidate);
}

export function candidateMultisetReceipt(candidates) {
  requireValue(Array.isArray(candidates) && candidates.length > 0,
    "candidate multiset must be a non-empty array");
  if (isDeepFrozen(candidates) && CANDIDATE_RECEIPT_CACHE.has(candidates))
    return cloneJson(CANDIDATE_RECEIPT_CACHE.get(candidates));
  const snapshots = cloneJson(candidates, "candidate multiset");
  const digests = snapshots.map(candidateSemanticDigest).sort();
  const astDigests = snapshots.map(candidateAstDigest).sort();
  const pairDigests = snapshots.map(candidate => canonicalDigest(
    "candidate-semantic-ast-pair", {
      semantic_sha256: candidateSemanticDigest(candidate),
      ast_sha256: candidateAstDigest(candidate),
    })).sort();
  const recordDigests = snapshots.map(candidate =>
    canonicalDigest("candidate-record", candidate)).sort();
  const canonicalOrder = canonicalCandidateOrder(snapshots);
  const receipt = {
    schema: "zero.reasoner5_candidate_multiset.v1",
    count: digests.length,
    distinct_count: new Set(digests).size,
    semantic_multiset_sha256: canonicalDigest("candidate-semantic-multiset",
      digests),
    ast_multiset_sha256: canonicalDigest("candidate-ast-multiset", astDigests),
    semantic_ast_pair_multiset_sha256: canonicalDigest(
      "candidate-semantic-ast-pair-multiset", pairDigests),
    candidate_record_multiset_sha256: canonicalDigest(
      "candidate-record-multiset", recordDigests),
    canonical_order_sha256: candidateSequenceDigest(canonicalOrder),
  };
  if (isDeepFrozen(candidates)) CANDIDATE_RECEIPT_CACHE.set(candidates,
    deepFreeze(cloneJson(receipt)));
  return receipt;
}

export function armParityReceipt({
  arm,
  candidates,
  grammar,
  initial_evidence,
  allowed_actions,
  latent_episode,
  potential_response,
  verifier,
  caps,
}) {
  stringValue(arm, "arm name");
  const receipt = {
    schema: "zero.reasoner5_arm_parity.v1",
    arm,
    candidate_multiset: candidateMultisetReceipt(candidates),
    grammar_sha256: fieldDigest("grammar", grammar),
    initial_evidence_sha256: fieldDigest("initial-evidence", initial_evidence),
    allowed_actions_sha256: fieldDigest("allowed-actions", allowed_actions),
    latent_episode_sha256: fieldDigest("latent-episode", latent_episode),
    potential_response_sha256: fieldDigest("potential-response",
      potential_response),
    verifier_sha256: fieldDigest("verifier", verifier),
    caps_sha256: fieldDigest("caps", caps),
  };
  return {
    ...receipt,
    receipt_sha256: canonicalDigest("arm-parity-receipt", receipt),
  };
}

export function assertArmParity(receipts, { expectedArms = null } = {}) {
  requireValue(Array.isArray(receipts) && receipts.length > 1,
    "arm parity needs at least two receipts");
  const fields = ["candidate_multiset", "grammar_sha256",
    "initial_evidence_sha256", "allowed_actions_sha256",
    "latent_episode_sha256", "potential_response_sha256", "verifier_sha256",
    "caps_sha256"];
  const arms = receipts.map(receipt => {
    plainObject(receipt, "arm parity receipt");
    requireValue(receipt.schema === "zero.reasoner5_arm_parity.v1",
      "arm parity receipt has the wrong schema");
    stringValue(receipt.arm, "arm parity receipt arm");
    requireValue(SHA256.test(receipt.receipt_sha256),
      "arm parity receipt needs a lowercase SHA-256 digest");
    const body = cloneJson(receipt, "arm parity receipt");
    delete body.receipt_sha256;
    requireValue(receipt.receipt_sha256 ===
      canonicalDigest("arm-parity-receipt", body),
    `arm parity receipt digest changed for ${receipt.arm}`);
    return receipt.arm;
  });
  requireValue(sortedUnique(arms).length === arms.length,
    "arm parity receipt arms must be unique");
  if (expectedArms !== null) {
    requireValue(Array.isArray(expectedArms) && expectedArms.length > 1 &&
      sortedUnique(expectedArms).length === expectedArms.length,
    "expected parity arms must be a unique array");
    requireValue(isDeepStrictEqual([...arms].sort(), [...expectedArms].sort()),
      "arm parity receipt arms differ from the frozen contract");
  }
  for (let index = 1; index < receipts.length; ++index) {
    for (const field of fields)
      requireValue(isDeepStrictEqual(receipts[0][field], receipts[index][field]),
        `arm parity changed ${field} for ${receipts[index].arm}`);
  }
  return {
    arms,
    parity_sha256: canonicalDigest("arm-parity-set",
      Object.fromEntries(fields.map(field => [field, receipts[0][field]]))),
  };
}

export function runVerifiedSearch({
  proposals,
  fallback,
  candidate_universe,
  verify,
  global_cap,
  injected_invalid_sha256,
}) {
  requireValue(Array.isArray(proposals) && Array.isArray(fallback) &&
    Array.isArray(candidate_universe),
    "verified search candidates must be arrays");
  requireValue(typeof verify === "function", "exact verifier must be a function");
  requireValue(injected_invalid_sha256 === undefined ||
    (typeof injected_invalid_sha256 === "string" &&
      SHA256.test(injected_invalid_sha256)),
  "injected invalid candidate needs a lowercase SHA-256 digest");
  safeInteger(global_cap, "global verifier cap", 1);
  const snapshotCandidates = (candidates, label) => {
    if (isDeepFrozen(candidates) && CANDIDATE_SNAPSHOT_CACHE.has(candidates))
      return CANDIDATE_SNAPSHOT_CACHE.get(candidates);
    const snapshots = candidates.map(candidate => {
      const snapshot = deepFreeze(cloneJson(candidate, `${label} candidate`));
      const expansions = snapshot && typeof snapshot === "object" &&
        Object.hasOwn(snapshot, "partial_expansions") ?
        snapshot.partial_expansions : 0;
      safeInteger(expansions, `${label} candidate partial expansions`);
      return snapshot;
    });
    deepFreeze(snapshots);
    if (isDeepFrozen(candidates))
      CANDIDATE_SNAPSHOT_CACHE.set(candidates, snapshots);
    return snapshots;
  };
  const universeCandidates = snapshotCandidates(candidate_universe,
    "candidate universe");
  const fallbackCandidates = snapshotCandidates(fallback, "fallback");
  const proposalCandidates = snapshotCandidates(proposals, "proposal");
  const universeReceipt = candidateMultisetReceipt(universeCandidates);
  const fallbackReceipt = candidateMultisetReceipt(fallbackCandidates);
  requireValue(isDeepStrictEqual(universeReceipt, fallbackReceipt),
    "fallback must cover the complete canonical candidate universe");
  let canonicalFallback = CANDIDATE_ORDER_CACHE.get(universeCandidates);
  if (canonicalFallback === undefined) {
    canonicalFallback = deepFreeze(canonicalCandidateOrder(universeCandidates));
    CANDIDATE_ORDER_CACHE.set(universeCandidates, canonicalFallback);
  }
  requireValue(isDeepStrictEqual(fallbackCandidates, canonicalFallback),
    "fallback order differs from the canonical candidate order");
  const fallbackOrderSha256 = candidateSequenceDigest(fallbackCandidates);
  let universeProposalRecords = CANDIDATE_PROPOSAL_CACHE.get(
    universeCandidates);
  if (universeProposalRecords === undefined) {
    universeProposalRecords = new Map();
    for (const candidate of universeCandidates) {
      const entry = candidateProposalEntry(candidate);
      const prior = universeProposalRecords.get(entry.record_sha256) ?? 0;
      universeProposalRecords.set(entry.record_sha256,
        Math.max(prior, entry.partial_expansions));
    }
    CANDIDATE_PROPOSAL_CACHE.set(universeCandidates,
      universeProposalRecords);
  }
  for (const candidate of proposalCandidates) {
    const entry = candidateProposalEntry(candidate);
    const baseline = universeProposalRecords.get(entry.record_sha256);
    requireValue(baseline !== undefined,
      "proposal falls outside the canonical candidate universe due to a " +
      "record mismatch");
    requireValue(entry.partial_expansions >= baseline,
      "proposal partial expansions fall below the frozen candidate baseline");
  }
  const seen = new Set();
  const trace = [];
  const evaluatorTrace = [];
  const expansionTrace = [];
  let solved = false;
  let acceptedDigest = null;
  let acceptedAnswer = null;
  let acceptedAnswerSha256 = null;
  let acceptedCertificateSha256 = null;
  let globalCapHit = false;
  let fallbackExhausted = false;
  let stoppedByCap = false;
  for (const [phase, candidates] of [["proposal", proposalCandidates],
    ["fallback", fallbackCandidates]]) {
    let completedPhase = true;
    for (const candidate of candidates) {
      if (trace.length >= global_cap) {
        stoppedByCap = true;
        completedPhase = false;
        break;
      }
      const digest = candidateSemanticDigest(candidate);
      const astDigest = candidateAstDigest(candidate);
      const recordDigest = canonicalDigest("candidate-record", candidate);
      const partialExpansions = candidate && typeof candidate === "object" &&
        Object.hasOwn(candidate, "partial_expansions") ?
        candidate.partial_expansions : 0;
      const duplicateSemantic = seen.has(digest);
      expansionTrace.push({
        ordinal: expansionTrace.length,
        phase,
        candidate_sha256: digest,
        candidate_ast_sha256: astDigest,
        candidate_record_sha256: recordDigest,
        duplicate_semantic: duplicateSemantic,
        charged_partial_expansions: partialExpansions,
      });
      if (duplicateSemantic) continue;
      seen.add(digest);
      const raw = verify(candidate);
      const verdict = raw;
      plainObject(verdict, "verifier verdict");
      requireValue(typeof verdict.accepted === "boolean",
        "verifier verdict needs an accepted boolean");
      requireValue(typeof verdict.certificate_valid === "boolean",
        "verifier verdict needs an explicit certificate_valid boolean");
      requireValue(!(verdict.accepted && !verdict.certificate_valid),
        "an accepted verifier verdict must have a valid certificate");
      let certificateSha256 = null;
      let counterexampleSha256 = null;
      if (verdict.accepted) {
        requireValue(Object.hasOwn(verdict, "certificate"),
          "an accepted verifier verdict needs its certificate");
        requireValue(Object.hasOwn(verdict, "answer_ir"),
          "an accepted verifier verdict needs its final Answer IR");
        certificateSha256 = canonicalDigest("exact-verifier-certificate",
          verdict.certificate);
        const answerIr = cloneJson(verdict.answer_ir,
          "exact verifier final Answer IR");
        const answerIrSha256 = canonicalDigest("final-answer-ir", answerIr);
        evaluatorTrace.push({
          ordinal: trace.length,
          candidate_sha256: digest,
          accepted: true,
          certificate: cloneJson(verdict.certificate,
            "exact verifier certificate"),
          certificate_sha256: certificateSha256,
          answer_ir: answerIr,
          answer_ir_sha256: answerIrSha256,
        });
      } else {
        requireValue(Object.hasOwn(verdict, "counterexample"),
          "a rejected verifier verdict needs its first counterexample");
        counterexampleSha256 = canonicalDigest("exact-verifier-counterexample",
          verdict.counterexample);
        evaluatorTrace.push({
          ordinal: trace.length,
          candidate_sha256: digest,
          accepted: false,
          counterexample: cloneJson(verdict.counterexample,
            "exact verifier counterexample"),
          counterexample_sha256: counterexampleSha256,
        });
      }
      const committed = verdict.accepted && verdict.certificate_valid;
      trace.push({
        ordinal: trace.length,
        phase,
        candidate_sha256: digest,
        verifier_accepted: verdict.accepted,
        certificate_valid: verdict.certificate_valid,
        certificate_sha256: certificateSha256,
        counterexample_sha256: counterexampleSha256,
        accepted: committed,
        charged_verifier_check: 1,
        partial_expansions: partialExpansions,
      });
      if (committed) {
        solved = true;
        acceptedDigest = digest;
        acceptedAnswer = cloneJson(verdict.answer_ir,
          "accepted final Answer IR");
        acceptedAnswerSha256 = canonicalDigest("final-answer-ir",
          acceptedAnswer);
        acceptedCertificateSha256 = certificateSha256;
        completedPhase = false;
        break;
      }
    }
    if (phase === "fallback" && completedPhase && !solved && !stoppedByCap)
      fallbackExhausted = true;
    if (solved || stoppedByCap) break;
  }
  globalCapHit = !solved && stoppedByCap;
  requireValue(solved || globalCapHit || fallbackExhausted,
    "unsolved search has no censoring reason");
  const censoringReason = solved ? null :
    (globalCapHit ? "global-cap" : "fallback-exhausted");
  const injection = injected_invalid_sha256 === undefined ? null : {
    candidate_sha256: injected_invalid_sha256,
    checked_first: trace[0]?.candidate_sha256 === injected_invalid_sha256,
    rejected: trace[0]?.candidate_sha256 === injected_invalid_sha256 &&
      trace[0]?.verifier_accepted === false,
  };
  const body = {
    schema: "zero.reasoner5_verified_search.v1",
    global_cap: global_cap,
    solved,
    accepted_candidate_sha256: solved ? acceptedDigest : null,
    answer_ir: solved ? acceptedAnswer : null,
    answer_ir_sha256: solved ? acceptedAnswerSha256 : null,
    certificate_sha256: solved ? acceptedCertificateSha256 : null,
    premature_commits: 0,
    verifier_checks: trace.length,
    distinct_semantic_classes: seen.size,
    fallback_started: expansionTrace.some(row => row.phase === "fallback"),
    global_cap_hit: globalCapHit,
    fallback_exhausted: fallbackExhausted,
    censoring_reason: censoringReason,
    primary_cost: solved ? trace.length : global_cap + 1,
    proposal_verifier_checks: trace.filter(row => row.phase === "proposal").length,
    fallback_verifier_checks: trace.filter(row => row.phase === "fallback").length,
    partial_expansions: expansionTrace.reduce((sum, row) =>
      sum + row.charged_partial_expansions, 0),
    fallback_partial_expansions: expansionTrace
      .filter(row => row.phase === "fallback")
      .reduce((sum, row) => sum + row.charged_partial_expansions, 0),
    fallback_receipt: {
      complete: true,
      candidate_universe: universeReceipt,
      fallback: fallbackReceipt,
      canonical_order_sha256: fallbackOrderSha256,
      fallback_verifier_checks: trace.filter(row => row.phase === "fallback").length,
      fallback_candidate_occurrences: expansionTrace
        .filter(row => row.phase === "fallback").length,
      fallback_partial_expansions: expansionTrace
        .filter(row => row.phase === "fallback")
        .reduce((sum, row) => sum + row.charged_partial_expansions, 0),
      charged_verifier_checks: trace.reduce((sum, row) =>
        sum + row.charged_verifier_check, 0),
      charged_partial_expansions: expansionTrace.reduce((sum, row) =>
        sum + row.charged_partial_expansions, 0),
      censoring_charge: solved ? 0 : 1,
      censoring_reason: censoringReason,
      all_work_charged: trace.every(row => row.charged_verifier_check === 1) &&
        trace.length === seen.size && expansionTrace.every(row =>
          Number.isSafeInteger(row.charged_partial_expansions) &&
          row.charged_partial_expansions >= 0),
    },
    injected_invalid: injection,
    trace,
    evaluator_trace: evaluatorTrace,
    expansion_trace: expansionTrace,
  };
  return {
    ...body,
    search_sha256: canonicalDigest("verified-search-receipt", body),
  };
}

function assertCandidateMultisetReceiptShape(receipt, label) {
  assertExactKeys(receipt, ["schema", "count", "distinct_count",
    "semantic_multiset_sha256", "ast_multiset_sha256",
    "semantic_ast_pair_multiset_sha256",
    "candidate_record_multiset_sha256", "canonical_order_sha256"], label);
  requireValue(receipt.schema === "zero.reasoner5_candidate_multiset.v1",
    `${label} has the wrong schema`);
  safeInteger(receipt.count, `${label} count`, 1);
  safeInteger(receipt.distinct_count, `${label} distinct count`, 1);
  requireValue(receipt.distinct_count <= receipt.count,
    `${label} distinct count exceeds its count`);
  for (const field of ["semantic_multiset_sha256", "ast_multiset_sha256",
    "semantic_ast_pair_multiset_sha256", "candidate_record_multiset_sha256",
    "canonical_order_sha256"])
    requireValue(typeof receipt[field] === "string" && SHA256.test(receipt[field]),
      `${label} needs ${field}`);
}

export function assertVerifiedSearchReceipt(search) {
  assertExactKeys(search, ["schema", "global_cap", "solved",
    "accepted_candidate_sha256", "answer_ir", "answer_ir_sha256",
    "certificate_sha256", "premature_commits", "verifier_checks",
    "distinct_semantic_classes", "fallback_started", "global_cap_hit",
    "fallback_exhausted", "censoring_reason", "primary_cost",
    "proposal_verifier_checks", "fallback_verifier_checks",
    "partial_expansions", "fallback_partial_expansions", "fallback_receipt",
    "injected_invalid", "trace", "evaluator_trace", "expansion_trace",
    "search_sha256"], "verified search receipt");
  requireValue(search.schema === "zero.reasoner5_verified_search.v1",
    "verified search receipt has the wrong schema");
  requireValue(typeof search.search_sha256 === "string" &&
    SHA256.test(search.search_sha256),
  "verified search receipt needs a lowercase SHA-256 digest");
  const body = cloneJson(search, "verified search receipt");
  delete body.search_sha256;
  requireValue(search.search_sha256 === canonicalDigest(
    "verified-search-receipt", body),
  "verified search receipt digest changed");
  safeInteger(search.global_cap, "verified search global cap", 1);
  for (const field of ["solved", "fallback_started", "global_cap_hit",
    "fallback_exhausted"])
    requireValue(typeof search[field] === "boolean",
      `verified search receipt needs boolean ${field}`);
  for (const field of ["verifier_checks", "distinct_semantic_classes",
    "primary_cost", "proposal_verifier_checks", "fallback_verifier_checks",
    "partial_expansions", "fallback_partial_expansions",
    "premature_commits"])
    safeInteger(search[field], `verified search ${field}`);
  requireValue(search.premature_commits === 0,
    "verified search committed before exact verification");
  requireValue(Array.isArray(search.trace) &&
    Array.isArray(search.evaluator_trace) &&
    Array.isArray(search.expansion_trace),
  "verified search receipt needs all trace arrays");
  requireValue(search.trace.length === search.verifier_checks &&
    search.evaluator_trace.length === search.trace.length,
  "verified search trace lengths disagree");
  const semanticSeen = new Set();
  let acceptedRows = 0;
  for (const [index, row] of search.trace.entries()) {
    assertExactKeys(row, ["ordinal", "phase", "candidate_sha256",
      "verifier_accepted", "certificate_valid", "certificate_sha256",
      "counterexample_sha256", "accepted", "charged_verifier_check",
      "partial_expansions"], "verified search trace row");
    requireValue(row.ordinal === index &&
      ["proposal", "fallback"].includes(row.phase),
    "verified search trace order or phase changed");
    for (const field of ["candidate_sha256", "certificate_sha256",
      "counterexample_sha256"])
      requireValue(row[field] === null ||
        (typeof row[field] === "string" && SHA256.test(row[field])),
      `verified search trace has invalid ${field}`);
    requireValue(!semanticSeen.has(row.candidate_sha256),
      "verified search verified one semantic class more than once");
    semanticSeen.add(row.candidate_sha256);
    requireValue(row.charged_verifier_check === 1,
      "verified search trace omitted a verifier charge");
    safeInteger(row.partial_expansions,
      "verified search trace partial expansions");
    for (const field of ["verifier_accepted", "certificate_valid", "accepted"])
      requireValue(typeof row[field] === "boolean",
        `verified search trace needs boolean ${field}`);
    requireValue(row.accepted ===
      (row.verifier_accepted && row.certificate_valid),
    "verified search trace commit differs from verifier and certificate");
    requireValue(!(row.verifier_accepted && !row.certificate_valid),
      "verified search accepted a candidate without a valid certificate");
    if (row.accepted) acceptedRows += 1;
    const evaluator = search.evaluator_trace[index];
    assertExactKeys(evaluator, row.accepted ? ["ordinal", "candidate_sha256",
      "accepted", "certificate", "certificate_sha256", "answer_ir",
      "answer_ir_sha256"] : ["ordinal", "candidate_sha256", "accepted",
      "counterexample", "counterexample_sha256"],
    "verified search evaluator trace row");
    requireValue(evaluator.ordinal === index &&
      evaluator.candidate_sha256 === row.candidate_sha256 &&
      evaluator.accepted === row.accepted,
    "verified search evaluator trace differs from public trace");
    if (row.accepted) {
      requireValue(row.counterexample_sha256 === null &&
        row.certificate_sha256 === canonicalDigest(
          "exact-verifier-certificate", evaluator.certificate) &&
        evaluator.certificate_sha256 === row.certificate_sha256 &&
        evaluator.answer_ir_sha256 === canonicalDigest("final-answer-ir",
          evaluator.answer_ir),
      "verified search accepted proof receipt changed");
    } else {
      requireValue(row.certificate_sha256 === null &&
        row.counterexample_sha256 === canonicalDigest(
          "exact-verifier-counterexample", evaluator.counterexample) &&
        evaluator.counterexample_sha256 === row.counterexample_sha256,
      "verified search counterexample receipt changed");
    }
  }
  const expansionSeen = new Set();
  let verifierIndex = 0;
  let lastFallbackEntry = null;
  for (const [index, row] of search.expansion_trace.entries()) {
    assertExactKeys(row, ["ordinal", "phase", "candidate_sha256",
      "candidate_ast_sha256", "candidate_record_sha256",
      "duplicate_semantic", "charged_partial_expansions"],
    "verified search expansion row");
    requireValue(row.ordinal === index &&
      ["proposal", "fallback"].includes(row.phase),
    "verified search expansion order or phase changed");
    requireValue(SHA256.test(row.candidate_sha256) &&
      SHA256.test(row.candidate_ast_sha256) &&
      SHA256.test(row.candidate_record_sha256),
    "verified search expansion needs candidate digests");
    requireValue(row.duplicate_semantic === expansionSeen.has(
      row.candidate_sha256),
    "verified search duplicate-semantic marker changed");
    expansionSeen.add(row.candidate_sha256);
    safeInteger(row.charged_partial_expansions,
      "verified search charged partial expansions");
    if (row.phase === "fallback") {
      const entry = {
        semantic_sha256: row.candidate_sha256,
        ast_sha256: row.candidate_ast_sha256,
        record_sha256: row.candidate_record_sha256,
      };
      requireValue(lastFallbackEntry === null ||
        compareCandidateEntries(lastFallbackEntry, entry) <= 0,
      "verified search fallback expansion order is not canonical");
      lastFallbackEntry = entry;
    }
    if (!row.duplicate_semantic) {
      const verifierRow = search.trace[verifierIndex];
      requireValue(verifierRow !== undefined &&
        verifierRow.phase === row.phase &&
        verifierRow.candidate_sha256 === row.candidate_sha256 &&
        verifierRow.partial_expansions === row.charged_partial_expansions,
      "verified search expansion differs from its verifier trace");
      verifierIndex += 1;
    }
  }
  requireValue(verifierIndex === search.trace.length,
    "verified search verifier trace has no matching expansion");
  requireValue(search.distinct_semantic_classes === semanticSeen.size &&
    search.verifier_checks === semanticSeen.size,
  "verified search semantic-class counters disagree");
  requireValue(search.proposal_verifier_checks === search.trace.filter(row =>
    row.phase === "proposal").length &&
    search.fallback_verifier_checks === search.trace.filter(row =>
      row.phase === "fallback").length,
  "verified search phase counters disagree");
  requireValue(search.partial_expansions === search.expansion_trace.reduce(
    (sum, row) => sum + row.charged_partial_expansions, 0) &&
    search.fallback_partial_expansions === search.expansion_trace
      .filter(row => row.phase === "fallback")
      .reduce((sum, row) => sum + row.charged_partial_expansions, 0),
  "verified search expansion counters disagree");
  requireValue(search.fallback_started === search.expansion_trace.some(row =>
    row.phase === "fallback"),
  "verified search fallback-start marker changed");
  requireValue(search.solved ?
    !search.global_cap_hit && !search.fallback_exhausted &&
      search.censoring_reason === null :
    search.global_cap_hit !== search.fallback_exhausted &&
      search.censoring_reason === (search.global_cap_hit ?
        "global-cap" : "fallback-exhausted"),
  "verified search censoring markers disagree");
  requireValue(!search.global_cap_hit ||
    search.verifier_checks === search.global_cap,
  "verified search cap-hit marker changed");
  requireValue(!search.fallback_exhausted ||
    search.expansion_trace.filter(row => row.phase === "fallback").length ===
      search.fallback_receipt.fallback.count,
  "verified search exhausted marker changed");
  requireValue(search.primary_cost === (search.solved ?
    search.verifier_checks : search.global_cap + 1),
  "verified search primary cost differs from cap accounting");
  requireValue(search.solved ? acceptedRows === 1 &&
    search.trace.at(-1).accepted === true : acceptedRows === 0,
  "verified search solved marker differs from accepted trace");
  if (search.solved) {
    const evaluator = search.evaluator_trace.at(-1);
    requireValue(search.accepted_candidate_sha256 ===
      search.trace.at(-1).candidate_sha256 &&
      search.answer_ir_sha256 === canonicalDigest("final-answer-ir",
        search.answer_ir) &&
      search.answer_ir_sha256 === evaluator.answer_ir_sha256 &&
      search.certificate_sha256 === evaluator.certificate_sha256,
    "verified search final answer receipt changed");
  } else {
    requireValue(search.accepted_candidate_sha256 === null &&
      search.answer_ir === null && search.answer_ir_sha256 === null &&
      search.certificate_sha256 === null,
    "unsolved verified search contains a final answer");
  }
  assertExactKeys(search.fallback_receipt, ["complete",
    "candidate_universe", "fallback", "canonical_order_sha256",
    "fallback_verifier_checks", "fallback_candidate_occurrences",
    "fallback_partial_expansions", "charged_verifier_checks",
    "charged_partial_expansions", "censoring_charge", "censoring_reason",
    "all_work_charged"], "verified search fallback receipt");
  assertCandidateMultisetReceiptShape(search.fallback_receipt.candidate_universe,
    "verified search candidate universe");
  assertCandidateMultisetReceiptShape(search.fallback_receipt.fallback,
    "verified search fallback universe");
  requireValue(isDeepStrictEqual(search.fallback_receipt.candidate_universe,
    search.fallback_receipt.fallback),
  "verified search fallback differs from its candidate universe");
  requireValue(search.fallback_receipt.canonical_order_sha256 ===
    search.fallback_receipt.candidate_universe.canonical_order_sha256,
  "verified search fallback order differs from its canonical universe");
  requireValue(search.fallback_receipt.complete === true &&
    search.fallback_receipt.all_work_charged === true &&
    search.fallback_receipt.fallback_verifier_checks ===
      search.fallback_verifier_checks &&
    search.fallback_receipt.fallback_candidate_occurrences ===
      search.expansion_trace.filter(row => row.phase === "fallback").length &&
    search.fallback_receipt.fallback_partial_expansions ===
      search.fallback_partial_expansions &&
    search.fallback_receipt.charged_verifier_checks ===
      search.verifier_checks &&
    search.fallback_receipt.charged_partial_expansions ===
      search.partial_expansions &&
    search.fallback_receipt.censoring_charge === (search.solved ? 0 : 1) &&
    search.fallback_receipt.censoring_reason === search.censoring_reason,
  "verified search fallback receipt counters disagree");
  if (search.injected_invalid !== null) {
    requireValue(SHA256.test(search.injected_invalid.candidate_sha256) &&
      search.injected_invalid.checked_first ===
        (search.trace[0]?.candidate_sha256 ===
          search.injected_invalid.candidate_sha256) &&
      search.injected_invalid.rejected ===
        (search.trace[0]?.candidate_sha256 ===
          search.injected_invalid.candidate_sha256 &&
          search.trace[0]?.verifier_accepted === false),
    "verified search invalid-candidate receipt changed");
  }
  return true;
}

export function assertInjectedInvalidRejected(search) {
  plainObject(search, "verified search result");
  requireValue(search.injected_invalid !== null,
    "verified search needs an invalid-candidate injection receipt");
  requireValue(search.injected_invalid.checked_first,
    "injected invalid candidate must be checked first");
  requireValue(search.injected_invalid.rejected,
    "exact verifier must reject the injected invalid candidate");
  return true;
}

export function assertSourceAblationMatches(sourceAblationTrace,
  sourceFreeTrace, { omit = ["arm"] } = {}) {
  requireValue(Array.isArray(sourceAblationTrace) && Array.isArray(sourceFreeTrace),
    "source-ablation comparison needs two trace arrays");
  cloneJson(sourceAblationTrace, "source-ablation trace");
  cloneJson(sourceFreeTrace, "source-free trace");
  requireValue(isDeepStrictEqual(omit, ["arm"]),
    "source-ablation comparison may omit only registered arm identity");
  for (const [label, trace] of [["source ablation", sourceAblationTrace],
    ["source-free", sourceFreeTrace]]) {
    for (const row of trace) {
      requireValue(Object.hasOwn(row, "source_artifact_reads") &&
        row.source_artifact_reads === 0,
      `${label} path must read zero source-artifact bytes`);
    }
  }
  const withoutArm = trace => trace.map(row => Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== "arm")));
  const left = withoutArm(sourceAblationTrace);
  const right = withoutArm(sourceFreeTrace);
  requireValue(isDeepStrictEqual(left, right),
    "source ablation differs from the source-free implementation path");
  return true;
}

function armCost(row, costField) {
  finiteNumber(row[costField], `${row.arm} ${costField}`, 0);
  return row[costField];
}

export function aggregateNestedFamilies(rows, {
  fullArm = "full",
  comparatorArm = "target_only",
  unitFields = ["family_id"],
  episodeField = "episode_id",
  repeatField = "nested_repeat_id",
  costField = "primary_cost",
} = {}) {
  requireValue(Array.isArray(rows) && rows.length > 0,
    "family aggregation needs trace rows");
  assertFamilyUnitFields(unitFields, "family aggregation", {
    crossed: unitFields.includes("cross_family_id"),
  });
  const episodes = new Map();
  for (const row of rows) {
    plainObject(row, "trace row");
    for (const field of [...unitFields, episodeField, repeatField, "arm"])
      requireValue(row[field] !== undefined && row[field] !== null,
        `trace row needs ${field}`);
    const key = canonicalDigest("paired-episode-key",
      Object.fromEntries([...unitFields, episodeField, repeatField]
        .map(field => [field, row[field]])));
    if (!episodes.has(key)) episodes.set(key, new Map());
    requireValue(!episodes.get(key).has(row.arm),
      `duplicate ${row.arm} row for paired episode ${row[episodeField]}`);
    episodes.get(key).set(row.arm, row);
  }
  const pairs = [];
  for (const arms of episodes.values()) {
    requireValue(arms.has(fullArm) && arms.has(comparatorArm),
      `paired episode needs ${fullArm} and ${comparatorArm}`);
    const full = arms.get(fullArm);
    const comparator = arms.get(comparatorArm);
    const fullCost = armCost(full, costField);
    const comparatorCost = armCost(comparator, costField);
    pairs.push({
      unit: Object.fromEntries(unitFields.map(field => [field, full[field]])),
      episode_id: full[episodeField],
      nested_repeat_id: full[repeatField],
      full_cost: fullCost,
      comparator_cost: comparatorCost,
      log_cost_ratio: Math.log((fullCost + 1) / (comparatorCost + 1)),
    });
  }
  const grouped = new Map();
  for (const pair of pairs) {
    const key = canonicalDigest("family-unit", pair.unit);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(pair);
  }
  return [...grouped.values()].map(group => {
    const repeatKeys = group.map(pair =>
      `${pair.episode_id}\u0000${pair.nested_repeat_id}`);
    requireValue(new Set(repeatKeys).size === repeatKeys.length,
      "nested repeat IDs must be unique inside a family unit");
    const mean = field => group.reduce((sum, row) => sum + row[field], 0) /
      group.length;
    const meanLog = mean("log_cost_ratio");
    return {
      ...group[0].unit,
      unit: group[0].unit,
      nested_measurements: group.length,
      mean_full_cost: mean("full_cost"),
      mean_comparator_cost: mean("comparator_cost"),
      mean_log_ratio: meanLog,
      geometric_mean_ratio: Math.exp(meanLog),
      win: meanLog < 0,
      tie: meanLog === 0,
    };
  }).sort((left, right) => stableJson(left.unit).localeCompare(stableJson(right.unit)));
}

export function summarizeFamilyUnits(units,
  { wilsonZ = 1.6448536269514722 } = {}) {
  requireValue(Array.isArray(units) && units.length > 0,
    "family summary needs independent units");
  const logRatios = units.map(unit => {
    finiteNumber(unit.mean_log_ratio, "family mean log ratio");
    return unit.mean_log_ratio;
  });
  const ratios = logRatios.map(Math.exp).sort((left, right) => left - right);
  const middle = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[middle] :
    (ratios[middle - 1] + ratios[middle]) / 2;
  const wins = logRatios.filter(value => value < 0).length;
  const ties = logRatios.filter(value => value === 0).length;
  const losses = logRatios.length - wins - ties;
  const meanLog = logRatios.reduce((sum, value) => sum + value, 0) /
    logRatios.length;
  return {
    schema: "zero.reasoner5_family_summary.v1",
    independent_families: units.length,
    family_weighted_geometric_mean_ratio: Math.exp(meanLog),
    family_weighted_median_ratio: median,
    wins,
    ties,
    losses,
    win_rate: wins / units.length,
    wilson_lower: wilsonLowerBound(wins, units.length, wilsonZ),
  };
}

export function factorialInteractionFamilies(rows, {
  adapterGuideArm = "adapter_plus_guide",
  adapterOnlyArm = "adapter_only",
  guideOnlyArm = "guide_only",
  rawArm = "raw",
  unitFields = ["generator_id", "family_id"],
  episodeField = "episode_id",
  repeatField = "nested_repeat_id",
  costField = "primary_cost",
} = {}) {
  requireValue(Array.isArray(rows) && rows.length > 0,
    "factorial interaction needs trace rows");
  assertFamilyUnitFields(unitFields, "factorial interaction", {
    crossed: unitFields.includes("cross_family_id"),
  });
  const requiredArms = [adapterGuideArm, adapterOnlyArm, guideOnlyArm, rawArm];
  const episodes = new Map();
  for (const row of rows) {
    for (const field of [...unitFields, episodeField, repeatField, "arm"])
      requireValue(row[field] !== undefined && row[field] !== null,
        `factorial trace row needs ${field}`);
    const key = canonicalDigest("factorial-episode",
      Object.fromEntries([...unitFields, episodeField, repeatField]
        .map(field => [field, row[field]])));
    if (!episodes.has(key)) episodes.set(key, new Map());
    requireValue(!episodes.get(key).has(row.arm),
      `duplicate factorial arm ${row.arm} in ${row[episodeField]}`);
    episodes.get(key).set(row.arm, row);
  }
  const values = [];
  for (const arms of episodes.values()) {
    for (const arm of requiredArms)
      requireValue(arms.has(arm), `factorial episode needs arm ${arm}`);
    const row = arms.get(adapterGuideArm);
    const logCost = arm => Math.log(armCost(arms.get(arm), costField) + 1);
    values.push({
      unit: Object.fromEntries(unitFields.map(field => [field, row[field]])),
      interaction: logCost(adapterGuideArm) - logCost(adapterOnlyArm) -
        logCost(guideOnlyArm) + logCost(rawArm),
    });
  }
  const grouped = new Map();
  for (const value of values) {
    const key = canonicalDigest("factorial-family-unit", value.unit);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return [...grouped.values()].map(group => {
    const mean = group.reduce((sum, value) => sum + value.interaction, 0) /
      group.length;
    return {
      ...group[0].unit,
      unit: group[0].unit,
      nested_measurements: group.length,
      mean_interaction: mean,
      mean_log_ratio: mean,
      useful_interaction: mean < 0,
    };
  }).sort((left, right) => stableJson(left.unit).localeCompare(stableJson(right.unit)));
}

function conservativeQuantile(sorted, probability) {
  finiteNumber(probability, "quantile probability", 0);
  requireValue(probability <= 1, "quantile probability must be at most one");
  requireValue(sorted.length > 0, "quantile input must contain values");
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1);
  return sorted[index];
}

function bootstrapReceipt(units, samples, nullSamples, alpha, kind,
  pointLogOverride = null) {
  const pointLog = pointLogOverride ??
    units.reduce((sum, unit) => sum + unit.mean_log_ratio, 0) / units.length;
  requireValue(samples.length > 0 && nullSamples.length === samples.length,
    "bootstrap and recentered null samples must have equal nonzero length");
  for (const value of samples)
    finiteNumber(value, "ordinary bootstrap sample");
  for (const value of nullSamples)
    finiteNumber(value, "recentered null bootstrap sample");
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const sortedNullSamples = [...nullSamples]
    .sort((left, right) => left - right);
  const lowerLog = conservativeQuantile(sortedSamples, alpha);
  const upperLog = conservativeQuantile(sortedSamples, 1 - alpha);
  const oneSidedPLower = (sortedNullSamples.filter(value =>
    value <= pointLog).length + 1) / (sortedNullSamples.length + 1);
  const oneSidedPHigher = (sortedNullSamples.filter(value =>
    value >= pointLog).length + 1) / (sortedNullSamples.length + 1);
  const uncenteredTailLower = (sortedSamples.filter(value => value >= 0)
    .length + 1) / (sortedSamples.length + 1);
  const uncenteredTailHigher = (sortedSamples.filter(value => value <= 0)
    .length + 1) / (sortedSamples.length + 1);
  return {
    schema: `zero.reasoner5_${kind}_bootstrap.v2`,
    independent_units: units.length,
    replicates: samples.length,
    alpha,
    point_log_ratio: pointLog,
    point_ratio: Math.exp(pointLog),
    lower_log_ratio: lowerLog,
    upper_log_ratio: upperLog,
    lower_ratio: Math.exp(lowerLog),
    upper_ratio: Math.exp(upperLog),
    confidence_interval_method: "ordinary-percentile-bootstrap",
    p_value_method: "recentered-null-bootstrap",
    null_hypothesis_point_log_ratio: 0,
    one_sided_p_lower_than_zero: oneSidedPLower,
    one_sided_p_higher_than_zero: oneSidedPHigher,
    uncentered_sign_tail_fraction_lower: uncenteredTailLower,
    uncentered_sign_tail_fraction_higher: uncenteredTailHigher,
    bootstrap_sha256: canonicalDigest(`${kind}-bootstrap-samples`,
      sortedSamples),
    null_bootstrap_sha256: canonicalDigest(
      `${kind}-recentered-null-bootstrap-samples`, sortedNullSamples),
  };
}

export function oneWayClusterBootstrap(units, {
  seed,
  replicates = 2000,
  alpha = 0.05,
  environmentField = null,
} = {}) {
  requireValue(Array.isArray(units) && units.length > 1,
    "one-way bootstrap needs at least two family units");
  normalizeHexSeed(seed, "bootstrap seed");
  safeInteger(replicates, "bootstrap replicates", 1);
  finiteNumber(alpha, "bootstrap alpha", 0);
  requireValue(alpha > 0 && alpha < 0.5,
    "bootstrap alpha must lie between zero and one half");
  for (const unit of units)
    finiteNumber(unit.mean_log_ratio, "family mean log ratio");
  const environments = new Map();
  for (const unit of units) {
    const environment = environmentField === null ? "__all__" :
      getUnitField(unit, environmentField);
    requireValue(environment !== undefined,
      `family unit needs fixed environment ${environmentField}`);
    if (!environments.has(environment)) environments.set(environment, []);
    environments.get(environment).push(unit);
  }
  const pointLog = [...environments.values()].reduce((sum, environmentUnits) =>
    sum + environmentUnits.reduce((inner, unit) =>
      inner + unit.mean_log_ratio, 0) / environmentUnits.length, 0) /
    environments.size;
  const rng = createDeterministicRng(seed, environmentField === null ?
    "one-way-cluster-bootstrap" : "stratified-one-way-cluster-bootstrap");
  const samples = [];
  const nullSamples = [];
  for (let replicate = 0; replicate < replicates; ++replicate) {
    let sum = 0;
    for (const environmentUnits of environments.values()) {
      let environmentSum = 0;
      for (let draw = 0; draw < environmentUnits.length; ++draw)
        environmentSum += environmentUnits[rng.index(environmentUnits.length)]
          .mean_log_ratio;
      sum += environmentSum / environmentUnits.length;
    }
    const sample = sum / environments.size;
    samples.push(sample);
    nullSamples.push(sample - pointLog);
  }
  const receipt = bootstrapReceipt(units, samples, nullSamples, alpha,
    environmentField === null ? "one_way_cluster" :
      "stratified_one_way_cluster", pointLog);
  return {
    ...receipt,
    fixed_environments: environmentField === null ? 1 : environments.size,
    fixed_environment_weighting: "equal",
    environment_summaries: Object.fromEntries([...environments.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([environment, environmentUnits]) =>
        [environment, summarizeFamilyUnits(environmentUnits)])),
  };
}

export function twoWayClusterBootstrap(units, {
  seed,
  rowField = "family_id",
  columnField = "cross_family_id",
  replicates = 2000,
  alpha = 0.05,
} = {}) {
  requireValue(Array.isArray(units) && units.length > 0,
    "two-way bootstrap needs crossed family cells");
  normalizeHexSeed(seed, "bootstrap seed");
  safeInteger(replicates, "bootstrap replicates", 1);
  finiteNumber(alpha, "bootstrap alpha", 0);
  requireValue(alpha > 0 && alpha < 0.5,
    "bootstrap alpha must lie between zero and one half");
  const rows = sortedUnique(units.map(unit => getUnitField(unit, rowField)));
  const columns = sortedUnique(units.map(unit => getUnitField(unit, columnField)));
  requireValue(!rows.includes(undefined) && !columns.includes(undefined),
    "crossed cells need both family axes");
  const cells = new Map();
  for (const unit of units) {
    finiteNumber(unit.mean_log_ratio, "crossed-cell mean log ratio");
    const key = stableJson([getUnitField(unit, rowField),
      getUnitField(unit, columnField)]);
    requireValue(!cells.has(key), `duplicate crossed cell ${key.trim()}`);
    cells.set(key, unit.mean_log_ratio);
  }
  requireValue(cells.size === rows.length * columns.length,
    "two-way bootstrap requires a complete family crossing");
  for (const row of rows)
    for (const column of columns)
      requireValue(cells.has(stableJson([row, column])),
        `missing crossed cell ${row} by ${column}`);
  const pointLog = [...cells.values()].reduce((sum, value) => sum + value, 0) /
    cells.size;
  const rng = createDeterministicRng(seed, "two-way-cluster-bootstrap");
  const samples = [];
  const nullSamples = [];
  for (let replicate = 0; replicate < replicates; ++replicate) {
    const sampledRows = rows.map(() => rows[rng.index(rows.length)]);
    const sampledColumns = columns.map(() => columns[rng.index(columns.length)]);
    let sum = 0;
    for (const row of sampledRows)
      for (const column of sampledColumns)
        sum += cells.get(stableJson([row, column]));
    const sample = sum / (sampledRows.length * sampledColumns.length);
    samples.push(sample);
    nullSamples.push(sample - pointLog);
  }
  const receipt = bootstrapReceipt(units, samples, nullSamples, alpha,
    "two_way_cluster", pointLog);
  const rowUnits = rows.map(row => ({
    [rowField]: row,
    mean_log_ratio: columns.reduce((sum, column) =>
      sum + cells.get(stableJson([row, column])), 0) / columns.length,
  }));
  const columnUnits = columns.map(column => ({
    [columnField]: column,
    mean_log_ratio: rows.reduce((sum, row) =>
      sum + cells.get(stableJson([row, column])), 0) / rows.length,
  }));
  return {
    ...receipt,
    row_families: rows.length,
    column_families: columns.length,
    complete_cells: cells.size,
    row_marginal_summary: summarizeFamilyUnits(rowUnits),
    column_marginal_summary: summarizeFamilyUnits(columnUnits),
  };
}

export function familyInferenceReceipt(units, {
  design = "one-way",
  direction = "lower",
  seed,
  replicates = 2000,
  alpha = 0.05,
  environmentField = null,
  rowField = "family_id",
  columnField = "cross_family_id",
  wilsonZ = 1.6448536269514722,
} = {}) {
  requireValue(["one-way", "two-way"].includes(design),
    "family inference design must be one-way or two-way");
  requireValue(["lower", "higher"].includes(direction),
    "family inference direction must be lower or higher");
  const unitSnapshot = cloneJson(units, "family inference units");
  const settings = {
    design,
    direction,
    seed: normalizeHexSeed(seed, "family inference seed"),
    replicates,
    alpha,
    environment_field: environmentField,
    row_field: rowField,
    column_field: columnField,
    wilson_z: wilsonZ,
  };
  const summary = summarizeFamilyUnits(unitSnapshot, { wilsonZ });
  const interval = design === "one-way" ? oneWayClusterBootstrap(unitSnapshot, {
    seed: settings.seed,
    replicates,
    alpha,
    environmentField,
  }) : twoWayClusterBootstrap(unitSnapshot, {
    seed: settings.seed,
    replicates,
    alpha,
    rowField,
    columnField,
  });
  const body = {
    schema: "zero.reasoner5_family_inference.v1",
    settings,
    units: unitSnapshot,
    summary,
    interval,
  };
  return {
    ...body,
    receipt_sha256: canonicalDigest("family-inference-receipt", body),
  };
}

export function assertFamilyInferenceReceipt(receipt) {
  plainObject(receipt, "family inference receipt");
  plainObject(receipt.settings, "family inference settings");
  const expected = familyInferenceReceipt(receipt.units, {
    design: receipt.settings.design,
    direction: receipt.settings.direction,
    seed: receipt.settings.seed,
    replicates: receipt.settings.replicates,
    alpha: receipt.settings.alpha,
    environmentField: receipt.settings.environment_field,
    rowField: receipt.settings.row_field,
    columnField: receipt.settings.column_field,
    wilsonZ: receipt.settings.wilson_z,
  });
  requireValue(isDeepStrictEqual(receipt, expected),
    "family inference receipt does not replay");
  return expected;
}

export function orderHolmByCalibratedNullPValue(mechanisms) {
  requireValue(Array.isArray(mechanisms),
    "Holm ordering needs formal mechanism inferences");
  const names = new Set();
  for (const mechanism of mechanisms) {
    plainObject(mechanism, "Holm mechanism");
    stringValue(mechanism.name, "Holm mechanism name");
    requireValue(!names.has(mechanism.name),
      `Holm mechanism name ${mechanism.name} is duplicated`);
    names.add(mechanism.name);
    plainObject(mechanism.inference, `${mechanism.name} inference`);
    plainObject(mechanism.inference.interval,
      `${mechanism.name} inference interval`);
    requireValue(mechanism.inference.interval.p_value_method ===
      "recentered-null-bootstrap",
    `${mechanism.name} Holm ordering needs a calibrated null p-value`);
    const pValue = mechanism.inference.interval
      .one_sided_p_higher_than_zero;
    finiteNumber(pValue, `${mechanism.name} calibrated null p-value`, 0);
    requireValue(pValue <= 1,
      `${mechanism.name} calibrated null p-value must be at most one`);
  }
  return [...mechanisms].sort((left, right) =>
    left.inference.interval.one_sided_p_higher_than_zero -
      right.inference.interval.one_sided_p_higher_than_zero ||
    left.name.localeCompare(right.name));
}

export function wilsonLowerBound(wins, total,
  z = 1.6448536269514722) {
  safeInteger(wins, "Wilson wins");
  safeInteger(total, "Wilson total", 1);
  requireValue(wins <= total, "Wilson wins must not exceed total");
  finiteNumber(z, "Wilson z value", 0);
  const rate = wins / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = rate + z2 / (2 * total);
  const radius = z * Math.sqrt((rate * (1 - rate) + z2 / (4 * total)) /
    total);
  return Math.max(0, (center - radius) / denominator);
}

export function derangementPValue(observed, derangements,
  { lowerIsBetter = true } = {}) {
  finiteNumber(observed, "observed derangement statistic");
  requireValue(Array.isArray(derangements) && derangements.length > 0,
    "derangement reference must contain values");
  for (const value of derangements)
    finiteNumber(value, "derangement statistic");
  const ordered = [...derangements].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle] :
    (ordered[middle - 1] + ordered[middle]) / 2;
  const extreme = derangements.filter(value => lowerIsBetter ?
    value <= observed : value >= observed).length;
  return {
    observed,
    derangements: derangements.length,
    median,
    beats_median: lowerIsBetter ? observed < median : observed > median,
    p_value: (extreme + 1) / (derangements.length + 1),
  };
}

export function reconstructCommonGate(input) {
  if (input === null || typeof input !== "object" ||
      Array.isArray(input) || input.integrity_valid !== true)
    return { decision: "invalid-run", passed: false,
      failures: ["integrity_valid"], checks: { integrity_valid: false } };
  try {
    plainObject(input.registration, "common gate registration");
    const registration = input.registration;
    finiteNumber(registration.primary_alpha, "registered primary alpha", 0);
    requireValue(registration.primary_alpha > 0 &&
      registration.primary_alpha <= 0.05,
    "registered primary alpha must lie above zero and at most 0.05");
    requireValue(Array.isArray(registration.primary_strata) &&
      registration.primary_strata.length > 0,
    "registered primary strata must be non-empty");
    requireValue(Array.isArray(registration.formal_mechanisms) &&
      registration.formal_mechanisms.length <= 2,
    "registered formal mechanisms must contain at most two names");
    requireValue(typeof registration.crossed_design === "boolean",
      "registered crossed design flag must be boolean");
    requireValue(Array.isArray(registration.marginal_axes),
      "registered marginal axes must be an array");
    requireValue(registration.crossed_design ?
      registration.marginal_axes.length === 2 :
      registration.marginal_axes.length === 0,
    "registered marginal axes must match the crossed design");
    requireValue(registration.derangements === 31,
      "common gate requires exactly 31 registered derangements");
    requireValue(registration.mechanism_family_alpha === 0.05,
      "registered mechanism family alpha must be 0.05");
    requireValue(typeof registration.factorial_interaction_required ===
      "boolean", "registered factorial flag must be boolean");
    for (const [label, values] of [["primary stratum",
      registration.primary_strata], ["formal mechanism",
      registration.formal_mechanisms], ["marginal axis",
      registration.marginal_axes]]) {
      for (const value of values) stringValue(value, `registered ${label}`);
      requireValue(sortedUnique(values).length === values.length,
        `registered ${label} names must be unique`);
    }
    plainObject(input.exact, "exactness gate");
    plainObject(input.primary, "primary gate");
    requireValue(Array.isArray(input.exact.fallback_receipts) &&
      input.exact.fallback_receipts.length > 0,
    "exactness gate needs derived fallback receipts");
    const fallbackWorkCounted = input.exact.fallback_receipts.every(receipt => {
      plainObject(receipt, "fallback receipt");
      plainObject(receipt.candidate_universe,
        "fallback candidate-universe receipt");
      plainObject(receipt.fallback, "fallback enumeration receipt");
      safeInteger(receipt.charged_verifier_checks,
        "fallback charged verifier checks");
      safeInteger(receipt.charged_partial_expansions,
        "fallback charged partial expansions");
      safeInteger(receipt.censoring_charge, "fallback censoring charge");
      return receipt.complete === true && receipt.all_work_charged === true &&
        isDeepStrictEqual(receipt.candidate_universe, receipt.fallback);
    });
    requireValue(typeof input.measurement_floor === "boolean",
      "measurement floor flag must be explicit");
    const exactFailures = [
      ["all_final_answers_exact", input.exact.all_final_answers_exact === true],
      ["all_certificates_valid", input.exact.all_certificates_valid === true],
      ["no_premature_commits", input.exact.premature_commits === 0],
      ["invalid_first_candidates_rejected",
        input.exact.all_injected_invalid_first_candidates_rejected === true],
      ["all_primary_episodes_solved",
        input.exact.all_primary_episodes_solved_within_global_cap === true],
      ["fallback_work_counted", fallbackWorkCounted],
    ].filter(([, passed]) => !passed).map(([name]) => name);
    if (exactFailures.length > 0)
      return { decision: "invalid-run", passed: false,
        failures: exactFailures, checks: Object.fromEntries([
          ["integrity_valid", true],
          ...exactFailures.map(name => [name, false]),
        ]) };
    if (input.measurement_floor) {
      return { decision: "measurement-floor", passed: false,
        failures: ["measurement_floor"], checks: {
          integrity_valid: true, exact_run_valid: true,
          measurement_floor: true,
        } };
    }
    requireValue(Array.isArray(input.strata), "primary strata must be an array");
    requireValue(Array.isArray(input.mechanisms),
      "formal mechanism contrasts must be an array");
    requireValue(input.marginals === undefined,
      "marginal family summaries are derived from the primary receipt");
    const namedMap = (values, names, label) => {
      requireValue(values.length === names.length,
        `${label} count differs from the registration`);
      const map = new Map();
      for (const value of values) {
        plainObject(value, label);
        stringValue(value.name ?? value.axis, `${label} name`);
        const name = value.name ?? value.axis;
        requireValue(!map.has(name), `${label} name ${name} is duplicated`);
        map.set(name, value);
      }
      requireValue(names.every(name => map.has(name)),
        `${label} names differ from the registration`);
      return map;
    };
    const strata = namedMap(input.strata, registration.primary_strata,
      "primary stratum");
    const mechanisms = namedMap(input.mechanisms,
      registration.formal_mechanisms, "formal mechanism");
    const validateInference = (value, label, direction, alpha) => {
      plainObject(value.inference, `${label} inference`);
      const inference = assertFamilyInferenceReceipt(value.inference);
      requireValue(inference.settings.direction === direction,
        `${label} inference has the wrong direction`);
      requireValue(inference.settings.alpha === alpha,
        `${label} inference has the wrong alpha`);
      return inference;
    };
    const primary = validateInference(input.primary, "primary", "lower",
      registration.primary_alpha);
    requireValue(registration.crossed_design ?
      primary.settings.design === "two-way" :
      primary.settings.design === "one-way",
    "primary inference design differs from the registration");
    const stratumInferences = [...strata.entries()].map(([name, stratum]) =>
      [name, validateInference(stratum, `primary stratum ${name}`, "lower",
        0.05)]);
    const mechanismValues = orderHolmByCalibratedNullPValue(
      [...mechanisms.entries()].map(([name, mechanism]) => ({
        name,
        mechanism,
        inference: mechanism.inference,
      }))).map(value => ({
        ...value,
        p_value: value.inference.interval.one_sided_p_higher_than_zero,
      }));
    const mechanismInferences = new Map();
    for (const [index, value] of mechanismValues.entries()) {
      const alpha = registration.mechanism_family_alpha /
        (mechanismValues.length - index);
      const inference = validateInference(value.mechanism,
        `formal mechanism ${value.name}`, "higher", alpha);
      mechanismInferences.set(value.name, {
        inference,
        p_value: value.p_value,
        holm_alpha: alpha,
      });
    }
    const marginalSummaries = registration.crossed_design ? [
      primary.interval.row_marginal_summary,
      primary.interval.column_marginal_summary,
    ] : [];
    requireValue(marginalSummaries.length === registration.marginal_axes.length,
      "derived marginal count differs from the registration");
    for (const stratum of strata.values()) {
      requireValue(Object.keys(stratum).every(key =>
        ["name", "inference"].includes(key)),
      "primary stratum contains caller-computed measurements");
    }
    requireValue(input.derangement &&
      Array.isArray(input.derangement.values) &&
      input.derangement.values.length === 31,
    "common gate requires exactly 31 derangement values");
    const derangement = derangementPValue(input.derangement.observed,
      input.derangement.values);
    let factorialPass = true;
    if (registration.factorial_interaction_required) {
      plainObject(input.factorial, "factorial interaction gate");
      const factorial = validateInference(input.factorial,
        "factorial interaction", "lower", registration.primary_alpha);
      factorialPass = factorial.interval.upper_log_ratio < 0;
    } else {
      requireValue(input.factorial === undefined,
        "unregistered factorial gate is present");
    }
    const checks = {
      integrity_valid: true,
      all_final_answers_exact: input.exact.all_final_answers_exact === true,
      all_certificates_valid: input.exact.all_certificates_valid === true,
      no_premature_commits: input.exact.premature_commits === 0,
      invalid_first_candidates_rejected:
        input.exact.all_injected_invalid_first_candidates_rejected === true,
      all_primary_episodes_solved:
        input.exact.all_primary_episodes_solved_within_global_cap === true,
      fallback_work_counted: fallbackWorkCounted,
      primary_ratio: primary.interval.point_ratio <= 0.8,
      primary_upper_limit: primary.interval.upper_ratio < 1,
      family_win_rate: primary.summary.win_rate >= 0.6,
      family_win_lower_limit: primary.summary.wilson_lower > 0.5,
      marginal_win_gates: marginalSummaries.every(marginal =>
        marginal.win_rate >= 0.6 && marginal.wilson_lower > 0.5),
      primary_strata: stratumInferences.every(([, inference]) =>
        inference.interval.point_ratio <= 0.9 &&
        inference.interval.upper_ratio < 1),
      mechanism_effects: [...mechanismInferences.values()].every(value =>
        value.p_value <= value.holm_alpha &&
        value.inference.interval.point_ratio >= 1.1 &&
        value.inference.interval.lower_ratio > 1),
      factorial_interaction: factorialPass,
      derangement_median: derangement.beats_median,
      derangement_randomization: derangement.p_value <= 0.05,
      source_ablation_matches_source_free:
        input.source_ablation_matches_source_free === true,
    };
    const failures = Object.entries(checks)
      .filter(([, passed]) => !passed).map(([name]) => name);
    return {
      decision: failures.length === 0 ? "pass" : "no-go",
      passed: failures.length === 0,
      failures,
      checks,
      registration_sha256: canonicalDigest("common-gate-registration",
        registration),
      derangement,
    };
  } catch (error) {
    return {
      decision: "invalid-run",
      passed: false,
      failures: ["gate_contract"],
      checks: { integrity_valid: true, gate_contract: false },
      error: error.message,
    };
  }
}

function registeredAnalysisContract(manifest) {
  plainObject(manifest.analysis_contract, "manifest analysis contract");
  const contract = manifest.analysis_contract;
  requireValue(contract.schema === "zero.reasoner5_analysis_contract.v1",
    "manifest analysis contract has the wrong schema");
  for (const [field, minimum] of [["expected_arms", 2],
    ["selected_lanes", 1], ["source_isolated_arms", 1]]) {
    requireValue(Array.isArray(contract[field]) &&
      contract[field].length >= minimum &&
      sortedUnique(contract[field]).length === contract[field].length,
    `manifest analysis contract needs unique ${field}`);
    for (const value of contract[field])
      stringValue(value, `manifest analysis contract ${field}`);
  }
  requireValue(contract.source_isolated_arms.every(arm =>
    contract.expected_arms.includes(arm)),
  "source-isolated arms must be registered expected arms");
  requireValue(SHA256.test(contract.analysis_settings_sha256),
    "manifest analysis contract needs an analysis settings digest");
  requireValue(SHA256.test(contract.analysis_function_sha256),
    "manifest analysis contract needs an analysis function digest");
  plainObject(contract.common_gate_registration,
    "manifest common gate registration");
  requireValue(contract.trace_schema === "zero.reasoner5_trace_row.v1",
    "manifest analysis contract has the wrong trace schema");
  requireValue(["verified-search", "partial-expansions"].includes(
    contract.primary_cost_rule),
  "manifest analysis contract has an unsupported primary cost rule");
  const validateComparison = (comparison, label) => {
    plainObject(comparison, label);
    for (const field of ["full_arm", "comparator_arm"])
      requireValue(contract.expected_arms.includes(comparison[field]),
        `${label} has an unregistered ${field}`);
    requireValue(comparison.full_arm !== comparison.comparator_arm,
      `${label} must compare two different arms`);
    requireValue(["one-way", "two-way"].includes(comparison.design),
      `${label} has an unsupported design`);
    assertFamilyUnitFields(comparison.unit_fields, label, {
      crossed: comparison.design === "two-way",
    });
    requireValue(["lower", "higher"].includes(comparison.direction),
      `${label} has an unsupported direction`);
    normalizeHexSeed(comparison.seed, `${label} seed`);
    safeInteger(comparison.replicates, `${label} replicates`, 1);
    finiteNumber(comparison.alpha, `${label} alpha`, 0);
    requireValue(comparison.alpha > 0 && comparison.alpha < 0.5,
      `${label} alpha must lie between zero and one half`);
    requireValue(comparison.environment_field === null ||
      comparison.environment_field === undefined ||
      comparison.environment_field === "generator_id",
    `${label} environment field must be null or generator_id`);
    if (comparison.environment_field)
      requireValue(comparison.design === "one-way" &&
        comparison.unit_fields.includes("generator_id"),
      `${label} generator environment requires a one-way generator_id unit`);
    if (comparison.design === "two-way") {
      requireValue(new Set([comparison.row_field,
        comparison.column_field]).size === 2 &&
        new Set([comparison.row_field, comparison.column_field]).has(
          "family_id") &&
        new Set([comparison.row_field, comparison.column_field]).has(
          "cross_family_id"),
      `${label} crossed fields must be family_id and cross_family_id`);
      for (const field of [comparison.row_field, comparison.column_field])
        requireValue(typeof field === "string" &&
          comparison.unit_fields.includes(field),
        `${label} crossed fields must be independent unit fields`);
      requireValue(comparison.row_field !== comparison.column_field,
        `${label} crossed fields must differ`);
    }
    return comparison;
  };
  validateComparison(contract.primary_analysis, "registered primary analysis");
  requireValue(contract.primary_analysis.alpha ===
    contract.common_gate_registration.primary_alpha &&
    contract.primary_analysis.direction === "lower" &&
    contract.primary_analysis.design ===
      (contract.common_gate_registration.crossed_design ? "two-way" :
        "one-way"),
  "registered primary analysis differs from the common gate");
  requireValue(Array.isArray(contract.stratum_analyses),
    "manifest analysis contract needs stratum analyses");
  requireValue(Array.isArray(contract.mechanism_analyses),
    "manifest analysis contract needs mechanism analyses");
  for (const analysis of [...contract.stratum_analyses,
    ...contract.mechanism_analyses]) {
    stringValue(analysis.name, "registered named analysis");
    validateComparison(analysis, `registered analysis ${analysis.name}`);
  }
  requireValue(sortedUnique(contract.stratum_analyses.map(item => item.name))
    .length === contract.stratum_analyses.length,
  "registered stratum analysis names must be unique");
  requireValue(sortedUnique(contract.mechanism_analyses.map(item => item.name))
    .length === contract.mechanism_analyses.length,
  "registered mechanism analysis names must be unique");
  requireValue(isDeepStrictEqual(contract.stratum_analyses.map(item =>
    item.name).sort(), [...contract.common_gate_registration.primary_strata]
    .sort()), "registered stratum analyses differ from the common gate");
  requireValue(isDeepStrictEqual(contract.mechanism_analyses.map(item =>
    item.name).sort(), [...contract.common_gate_registration.formal_mechanisms]
    .sort()), "registered mechanism analyses differ from the common gate");
  for (const stratum of contract.stratum_analyses) {
    stringValue(stratum.field, `registered stratum ${stratum.name} field`);
    requireValue(Array.isArray(stratum.values) && stratum.values.length > 0,
      `registered stratum ${stratum.name} needs values`);
    requireValue(stratum.direction === "lower" && stratum.alpha === 0.05,
      `registered stratum ${stratum.name} needs the common lower-tail gate`);
  }
  for (const mechanism of contract.mechanism_analyses)
    requireValue(mechanism.direction === "higher" &&
      mechanism.alpha ===
        contract.common_gate_registration.mechanism_family_alpha,
    `registered mechanism ${mechanism.name} needs the common higher-tail gate`);
  requireValue((contract.factorial_analysis !== null) ===
    contract.common_gate_registration.factorial_interaction_required,
  "registered factorial analysis differs from the common gate");
  if (contract.factorial_analysis !== null) {
    const factorial = contract.factorial_analysis;
    plainObject(factorial, "registered factorial analysis");
    for (const field of ["adapter_guide_arm", "adapter_only_arm",
      "guide_only_arm", "raw_arm"])
      requireValue(contract.expected_arms.includes(factorial[field]),
        `registered factorial analysis has an unregistered ${field}`);
    requireValue(new Set([factorial.adapter_guide_arm,
      factorial.adapter_only_arm, factorial.guide_only_arm,
      factorial.raw_arm]).size === 4,
    "registered factorial analysis needs four different arms");
    requireValue(["one-way", "two-way"].includes(factorial.design) &&
      factorial.direction === "lower",
    "registered factorial analysis needs a supported lower-tail design");
    assertFamilyUnitFields(factorial.unit_fields,
      "registered factorial analysis", {
        crossed: factorial.design === "two-way",
      });
    normalizeHexSeed(factorial.seed, "registered factorial seed");
    safeInteger(factorial.replicates, "registered factorial replicates", 1);
    requireValue(factorial.alpha ===
      contract.common_gate_registration.primary_alpha,
    "registered factorial alpha differs from the common gate");
    requireValue(factorial.environment_field === null ||
      factorial.environment_field === undefined ||
      factorial.environment_field === "generator_id",
    "registered factorial environment must be null or generator_id");
    if (factorial.environment_field)
      requireValue(factorial.design === "one-way" &&
        factorial.unit_fields.includes("generator_id"),
      "registered factorial generator environment needs a one-way generator_id unit");
    if (factorial.design === "two-way") {
      requireValue(factorial.unit_fields.includes(factorial.row_field) &&
        factorial.unit_fields.includes(factorial.column_field) &&
        new Set([factorial.row_field, factorial.column_field]).size === 2 &&
        new Set([factorial.row_field, factorial.column_field]).has(
          "family_id") &&
        new Set([factorial.row_field, factorial.column_field]).has(
          "cross_family_id"),
      "registered factorial crossed fields must be family_id and cross_family_id");
    }
  }
  plainObject(contract.derangement_analysis,
    "registered derangement analysis");
  requireValue(contract.expected_arms.includes(
    contract.derangement_analysis.observed_arm),
  "registered derangement observed arm is unknown");
  requireValue(Array.isArray(contract.derangement_analysis.reference_arms) &&
    contract.derangement_analysis.reference_arms.length ===
      contract.common_gate_registration.derangements &&
    sortedUnique(contract.derangement_analysis.reference_arms).length ===
      contract.derangement_analysis.reference_arms.length &&
    contract.derangement_analysis.reference_arms.every(arm =>
      contract.expected_arms.includes(arm)),
  "registered derangement arms differ from the common gate");
  requireValue(!contract.derangement_analysis.reference_arms.includes(
    contract.derangement_analysis.observed_arm),
  "registered derangement references include the observed arm");
  assertFamilyUnitFields(contract.derangement_analysis.unit_fields,
    "registered derangement analysis", {
      crossed: contract.common_gate_registration.crossed_design,
    });
  plainObject(contract.source_ablation, "registered source ablation");
  for (const field of ["ablation_arm", "source_free_arm"])
    requireValue(contract.expected_arms.includes(contract.source_ablation[field]) &&
      contract.source_isolated_arms.includes(contract.source_ablation[field]),
    `registered source ablation has an unisolated ${field}`);
  requireValue(contract.source_ablation.ablation_arm !==
    contract.source_ablation.source_free_arm,
  "registered source ablation arms must differ");
  plainObject(contract.headroom, "registered headroom rule");
  requireValue(contract.expected_arms.includes(contract.headroom.comparator_arm),
    "registered headroom comparator is unknown");
  safeInteger(contract.headroom.median_primary_cost_min,
    "registered headroom minimum", 1);
  return contract;
}

function comparisonRows(rawTraces, comparison) {
  let rows = rawTraces;
  if (comparison.field !== undefined) {
    stringValue(comparison.field, `registered analysis ${comparison.name} field`);
    requireValue(Array.isArray(comparison.values) &&
      comparison.values.length > 0,
    `registered analysis ${comparison.name} needs filter values`);
    const allowed = new Set(comparison.values.map(value => stableJson(value)));
    rows = rows.filter(row => allowed.has(stableJson(row[comparison.field])));
  }
  requireValue(rows.length > 0,
    `registered analysis ${comparison.name ?? "comparison"} selected no rows`);
  return rows;
}

function deriveComparison(rawTraces, comparison, alphaOverride = null) {
  const rows = comparisonRows(rawTraces, comparison);
  const units = aggregateNestedFamilies(rows, {
    fullArm: comparison.full_arm,
    comparatorArm: comparison.comparator_arm,
    unitFields: comparison.unit_fields,
    costField: "primary_cost",
  });
  return familyInferenceReceipt(units, {
    design: comparison.design,
    direction: comparison.direction,
    seed: comparison.seed,
    replicates: comparison.replicates,
    alpha: alphaOverride ?? comparison.alpha,
    environmentField: comparison.environment_field ?? null,
    rowField: comparison.row_field ?? "family_id",
    columnField: comparison.column_field ?? "cross_family_id",
    wilsonZ: comparison.wilson_z ?? 1.6448536269514722,
  });
}

function deriveFactorial(rawTraces, comparison) {
  const rows = comparisonRows(rawTraces, comparison);
  const units = factorialInteractionFamilies(rows, {
    adapterGuideArm: comparison.adapter_guide_arm,
    adapterOnlyArm: comparison.adapter_only_arm,
    guideOnlyArm: comparison.guide_only_arm,
    rawArm: comparison.raw_arm,
    unitFields: comparison.unit_fields,
    costField: "primary_cost",
  });
  return familyInferenceReceipt(units, {
    design: comparison.design,
    direction: "lower",
    seed: comparison.seed,
    replicates: comparison.replicates,
    alpha: comparison.alpha,
    environmentField: comparison.environment_field ?? null,
    rowField: comparison.row_field ?? "family_id",
    columnField: comparison.column_field ?? "cross_family_id",
    wilsonZ: comparison.wilson_z ?? 1.6448536269514722,
  });
}

function absoluteArmStatistic(rawTraces, arm, unitFields) {
  const grouped = new Map();
  for (const row of rawTraces.filter(item => item.arm === arm)) {
    const unit = Object.fromEntries(unitFields.map(field => {
      requireValue(row[field] !== undefined && row[field] !== null,
        `derangement row needs unit field ${field}`);
      return [field, row[field]];
    }));
    const key = stableJson(unit);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(Math.log(row.primary_cost + 1));
  }
  requireValue(grouped.size > 0, `derangement arm ${arm} selected no rows`);
  const unitMeans = [...grouped.values()].map(values =>
    values.reduce((sum, value) => sum + value, 0) / values.length);
  return unitMeans.reduce((sum, value) => sum + value, 0) /
    unitMeans.length;
}

function deriveSourceAblation(rawTraces, registration) {
  const selected = rawTraces.filter(row => [registration.ablation_arm,
    registration.source_free_arm].includes(row.arm));
  const episodes = new Map();
  for (const row of selected) {
    if (!episodes.has(row.episode_id)) episodes.set(row.episode_id, new Map());
    const arms = episodes.get(row.episode_id);
    requireValue(!arms.has(row.arm),
      `source ablation has duplicate ${row.episode_id} ${row.arm}`);
    arms.set(row.arm, row);
  }
  requireValue(episodes.size > 0, "source ablation selected no episodes");
  const pairs = [];
  for (const [episodeId, arms] of episodes) {
    requireValue(arms.has(registration.ablation_arm) &&
      arms.has(registration.source_free_arm),
    `source ablation needs both registered arms for ${episodeId}`);
    const ablation = arms.get(registration.ablation_arm);
    const sourceFree = arms.get(registration.source_free_arm);
    assertSourceAblationMatches([ablation], [sourceFree]);
    const operational = Object.fromEntries(Object.entries(ablation)
      .filter(([key]) => key !== "arm"));
    pairs.push({ episode_id: episodeId,
      operational_row_sha256: canonicalDigest(
        "source-ablation-operational-row", operational) });
  }
  pairs.sort((left, right) => left.episode_id.localeCompare(right.episode_id));
  return {
    matches: true,
    episodes: pairs.length,
    receipt_sha256: canonicalDigest("source-ablation-pairs", pairs),
  };
}

function deriveHeadroom(rawTraces, registration) {
  const costs = rawTraces.filter(row =>
    row.arm === registration.comparator_arm).map(row => row.primary_cost)
    .sort((left, right) => left - right);
  requireValue(costs.length > 0, "headroom comparator selected no rows");
  const middle = Math.floor(costs.length / 2);
  const median = costs.length % 2 ? costs[middle] :
    (costs[middle - 1] + costs[middle]) / 2;
  return {
    comparator_arm: registration.comparator_arm,
    median_primary_cost: median,
    registered_minimum: registration.median_primary_cost_min,
    measurement_floor: median < registration.median_primary_cost_min,
  };
}

export function deriveRegisteredAnalysis(rawTraces, manifest) {
  requireValue(Array.isArray(rawTraces), "registered analysis needs raw traces");
  const contract = registeredAnalysisContract(manifest);
  const primary = deriveComparison(rawTraces, contract.primary_analysis);
  const strata = contract.stratum_analyses.map(analysis => ({
    name: analysis.name,
    inference: deriveComparison(rawTraces, analysis),
  }));
  const provisionalMechanisms = orderHolmByCalibratedNullPValue(
    contract.mechanism_analyses.map(analysis => ({
      name: analysis.name,
      analysis,
      inference: deriveComparison(rawTraces, analysis,
        contract.common_gate_registration.mechanism_family_alpha),
    })));
  const mechanisms = provisionalMechanisms.map((item, index) => ({
    name: item.analysis.name,
    inference: deriveComparison(rawTraces, item.analysis,
      contract.common_gate_registration.mechanism_family_alpha /
      (provisionalMechanisms.length - index)),
  }));
  const derangementConfig = contract.derangement_analysis;
  const derangement = {
    observed: absoluteArmStatistic(rawTraces,
      derangementConfig.observed_arm, derangementConfig.unit_fields),
    values: derangementConfig.reference_arms.map(arm =>
      absoluteArmStatistic(rawTraces, arm, derangementConfig.unit_fields)),
  };
  const sourceAblation = deriveSourceAblation(rawTraces,
    contract.source_ablation);
  const headroom = deriveHeadroom(rawTraces, contract.headroom);
  const factorial = contract.factorial_analysis === null ? null :
    deriveFactorial(rawTraces, contract.factorial_analysis);
  const gateInput = {
    measurement_floor: headroom.measurement_floor,
    primary: { inference: primary },
    strata,
    mechanisms,
    derangement,
    source_ablation_matches_source_free: sourceAblation.matches,
    ...(factorial === null ? {} : { factorial: { inference: factorial } }),
  };
  const receipt = {
    schema: "zero.reasoner5_registered_analysis.v1",
    primary,
    strata,
    mechanisms,
    derangement,
    source_ablation: sourceAblation,
    headroom,
    ...(factorial === null ? {} : { factorial }),
  };
  return {
    ...receipt,
    gate_input: gateInput,
    analysis_sha256: canonicalDigest("registered-analysis", receipt),
  };
}

function assertOptionalContractArray(actual, registered, label) {
  if (actual !== undefined && actual !== null)
    requireValue(isDeepStrictEqual(actual, registered),
      `${label} differs from the manifest analysis contract`);
}

export function assertRawTraceCoverage({
  manifest,
  rawTraces,
  expectedArms = null,
  selectedLanes = null,
  sourceIsolatedArms = null,
}) {
  const manifestSha256 = assertManifestDigest(manifest);
  requireValue(Array.isArray(rawTraces), "raw traces must be an array");
  cloneJson(rawTraces, "raw traces");
  const contract = registeredAnalysisContract(manifest);
  assertOptionalContractArray(expectedArms, contract.expected_arms,
    "expected arms");
  assertOptionalContractArray(selectedLanes, contract.selected_lanes,
    "selected lanes");
  assertOptionalContractArray(sourceIsolatedArms,
    contract.source_isolated_arms, "source-isolated arms");
  const registeredArms = contract.expected_arms;
  const registeredLanes = contract.selected_lanes;
  const isolatedArms = contract.source_isolated_arms;
  for (const lane of registeredLanes)
    requireValue(manifest.split_order.includes(lane),
      `trace coverage selected unknown lane ${lane}`);
  const episodes = manifest.episodes.filter(episode =>
    registeredLanes.includes(episode.lane));
  requireValue(episodes.length > 0,
    "trace coverage selected no manifest episodes");
  for (const episode of episodes)
    requireValue(isDeepStrictEqual([...episode.arm_parity.arms].sort(),
      [...registeredArms].sort()),
    `episode ${episode.episode_id} arms differ from the analysis contract`);
  const byId = new Map(episodes.map(episode => [episode.episode_id, episode]));
  const families = new Map(manifest.families.map(family =>
    [family.family_id, family]));
  const seen = new Set();
  for (const row of rawTraces) {
    assertExactKeys(row, REASONER5_TRACE_ROW_FIELDS, "raw trace row");
    requireValue(row.schema === contract.trace_schema,
      "raw trace row has the wrong schema");
    requireValue(row.experiment === manifest.experiment_id,
      "raw trace row has the wrong experiment");
    const episode = byId.get(row.episode_id);
    requireValue(episode !== undefined,
      `raw trace has unregistered episode ${row.episode_id}`);
    const family = families.get(episode.family_id);
    requireValue(family !== undefined,
      `raw trace has unregistered family ${episode.family_id}`);
    requireValue(registeredArms.includes(row.arm),
      `raw trace has unregistered arm ${row.arm}`);
    const key = `${row.episode_id}\u0000${row.arm}`;
    requireValue(!seen.has(key), `raw trace duplicates ${row.episode_id} ${row.arm}`);
    seen.add(key);
    for (const field of ["lane", "family_id", "cross_family_id",
      "generator_id", "shift_stratum", "nested_repeat_id"])
      requireValue(row[field] === episode[field],
        `raw trace ${row.episode_id} changed ${field}`);
    requireValue(row.generator_id === family.generator_id &&
      row.shift_stratum === family.shift_stratum,
    `raw trace ${row.episode_id} changed family metadata`);
    requireValue(row.episode_bytes_sha256 === episode.episode_bytes_sha256,
      `raw trace ${row.episode_id} changed episode digest`);
    for (const [rowField, manifestField] of [["ast_sha256", "ast_sha256"],
      ["behavior_sha256", "behavior_sha256"],
      ["episode_spec_sha256", "episode_spec_sha256"]])
      requireValue(row[rowField] === episode.fingerprints[manifestField],
        `raw trace ${row.episode_id} changed ${rowField}`);
    for (const field of [...TRACE_BINDING_FIELDS, "parity_digest"])
      requireValue(row[field] === episode.trace_binding[field],
        `raw trace ${row.episode_id} changed ${field}`);
    plainObject(row.verified_search,
      `raw trace ${row.episode_id} verified search`);
    assertVerifiedSearchReceipt(row.verified_search);
    const search = row.verified_search;
    requireValue(episode.trace_binding.candidate_universe_digest ===
      canonicalDigest("candidate-universe",
        search.fallback_receipt.candidate_universe),
    `raw trace ${row.episode_id} search universe differs from arm parity`);
    requireValue(row.execution_trace_sha256 === search.search_sha256,
      `raw trace ${row.episode_id} execution trace digest changed`);
    for (const field of ["primary_cost", "verifier_checks",
      "partial_expansions", "fallback_verifier_checks",
      "fallback_partial_expansions", "observation_queries",
      "source_artifact_reads"])
      safeInteger(row[field], `raw trace ${row.episode_id} ${field}`);
    for (const field of ["wall_ns", "peak_bytes"])
      requireValue(row[field] === null || Number.isSafeInteger(row[field]),
        `raw trace ${row.episode_id} ${field} must be null or a safe integer`);
    for (const field of ["exact", "certificate_valid", "premature_commit",
      "fallback_started", "global_cap_hit", "fallback_exhausted",
      "injected_invalid", "injected_invalid_rejected"])
      requireValue(typeof row[field] === "boolean",
        `raw trace ${row.episode_id} needs boolean ${field}`);
    requireValue(row.censoring_reason === null ||
      ["global-cap", "fallback-exhausted"].includes(row.censoring_reason),
    `raw trace ${row.episode_id} has an invalid censoring reason`);
    const derivedPrimaryCost = contract.primary_cost_rule ===
      "verified-search" ? search.primary_cost : search.partial_expansions;
    requireValue(row.primary_cost === derivedPrimaryCost &&
      row.verifier_checks === search.verifier_checks &&
      row.partial_expansions === search.partial_expansions &&
      row.fallback_verifier_checks === search.fallback_verifier_checks &&
      row.fallback_partial_expansions ===
        search.fallback_partial_expansions &&
      row.exact === search.solved &&
      row.certificate_valid === (search.solved &&
        typeof search.certificate_sha256 === "string") &&
      row.premature_commit === (search.premature_commits > 0) &&
      row.fallback_started === search.fallback_started &&
      row.global_cap_hit === search.global_cap_hit &&
      row.fallback_exhausted === search.fallback_exhausted &&
      row.censoring_reason === search.censoring_reason &&
      row.injected_invalid === (search.injected_invalid !== null) &&
      row.injected_invalid_rejected ===
        (search.injected_invalid?.rejected === true) &&
      row.answer_ir_sha256 === search.answer_ir_sha256 &&
      row.certificate_sha256 === search.certificate_sha256 &&
      isDeepStrictEqual(row.answer_ir, search.answer_ir) &&
      isDeepStrictEqual(row.fallback_receipt, search.fallback_receipt),
    `raw trace ${row.episode_id} summary differs from verified search`);
    plainObject(row.fallback_receipt,
      `raw trace ${row.episode_id} fallback receipt`);
    const fallbackReceipt = row.fallback_receipt;
    plainObject(fallbackReceipt.candidate_universe,
      `raw trace ${row.episode_id} fallback candidate universe`);
    plainObject(fallbackReceipt.fallback,
      `raw trace ${row.episode_id} fallback enumeration`);
    for (const field of ["fallback_verifier_checks",
      "fallback_candidate_occurrences", "fallback_partial_expansions",
      "charged_verifier_checks", "charged_partial_expansions",
      "censoring_charge"])
      safeInteger(fallbackReceipt[field],
        `raw trace ${row.episode_id} fallback receipt ${field}`);
    requireValue(isDeepStrictEqual(fallbackReceipt.candidate_universe,
      fallbackReceipt.fallback),
    `raw trace ${row.episode_id} fallback is not the registered universe`);
    requireValue(fallbackReceipt.fallback_verifier_checks ===
      row.fallback_verifier_checks &&
      fallbackReceipt.fallback_partial_expansions ===
        row.fallback_partial_expansions &&
      fallbackReceipt.charged_verifier_checks === row.verifier_checks &&
      fallbackReceipt.charged_partial_expansions === row.partial_expansions &&
      fallbackReceipt.censoring_charge === (row.exact ? 0 : 1) &&
      fallbackReceipt.censoring_reason === row.censoring_reason &&
      row.fallback_started ===
        (fallbackReceipt.fallback_candidate_occurrences > 0),
    `raw trace ${row.episode_id} counters differ from its fallback receipt`);
    if (isolatedArms.includes(row.arm))
      requireValue(row.source_artifact_reads === 0,
        `raw trace ${row.episode_id} ${row.arm} read the source artifact`);
  }
  const expectedRows = episodes.length * registeredArms.length;
  requireValue(rawTraces.length === expectedRows && seen.size === expectedRows,
    `raw trace coverage must contain ${expectedRows} episode-arm rows`);
  for (const episode of episodes)
    for (const arm of registeredArms)
      requireValue(seen.has(`${episode.episode_id}\u0000${arm}`),
        `raw trace is missing ${episode.episode_id} ${arm}`);
  const exactness = {
    schema: "zero.reasoner5_trace_exactness.v1",
    all_final_answers_exact: rawTraces.every(row => row.verified_search.solved &&
      row.verified_search.answer_ir_sha256 !== null),
    all_certificates_valid: rawTraces.every(row =>
      row.verified_search.certificate_sha256 !== null),
    premature_commits: rawTraces.reduce((sum, row) =>
      sum + row.verified_search.premature_commits, 0),
    all_injected_invalid_first_candidates_rejected: rawTraces.every(row =>
      row.verified_search.injected_invalid?.checked_first === true &&
      row.verified_search.injected_invalid?.rejected === true),
    all_primary_episodes_solved_within_global_cap: rawTraces.every(row =>
      row.verified_search.solved &&
      row.verified_search.certificate_sha256 !== null &&
      !row.verified_search.global_cap_hit),
    fallback_work_counted: rawTraces.every(row =>
      row.fallback_receipt.complete === true &&
      row.fallback_receipt.all_work_charged === true),
  };
  const costTotals = {
    primary_cost: rawTraces.reduce((sum, row) => sum + row.primary_cost, 0),
    verifier_checks: rawTraces.reduce((sum, row) => sum + row.verifier_checks, 0),
    partial_expansions: rawTraces.reduce((sum, row) =>
      sum + row.partial_expansions, 0),
    fallback_verifier_checks: rawTraces.reduce((sum, row) =>
      sum + row.fallback_verifier_checks, 0),
    fallback_partial_expansions: rawTraces.reduce((sum, row) =>
      sum + row.fallback_partial_expansions, 0),
    observation_queries: rawTraces.reduce((sum, row) =>
      sum + row.observation_queries, 0),
    wall_ns: rawTraces.every(row => row.wall_ns !== null) ?
      rawTraces.reduce((sum, row) => sum + row.wall_ns, 0) : null,
    peak_bytes: rawTraces.every(row => row.peak_bytes !== null) ?
      Math.max(...rawTraces.map(row => row.peak_bytes)) : null,
    source_artifact_reads: rawTraces.reduce((sum, row) =>
      sum + row.source_artifact_reads, 0),
  };
  const receipt = {
    schema: "zero.reasoner5_trace_coverage.v1",
    manifest_sha256: manifestSha256,
    analysis_contract_sha256: canonicalDigest("analysis-contract", contract),
    selected_lanes: [...registeredLanes],
    expected_arms: [...registeredArms],
    episodes: episodes.length,
    rows: rawTraces.length,
  };
  return {
    ...receipt,
    coverage_sha256: canonicalDigest("trace-coverage", receipt),
    exactness,
    cost_totals: costTotals,
  };
}

export function buildResultFromRawTraces({
  experiment,
  manifest,
  rawTraces,
  reconstruct,
  analysisSettings,
  expectedArms,
  selectedLanes,
  sourceIsolatedArms,
}) {
  stringValue(experiment, "result experiment");
  plainObject(manifest, "result manifest");
  requireValue(Array.isArray(rawTraces), "raw traces must be an array");
  requireValue(typeof reconstruct === "function",
    "raw-trace reconstruction must be a function");
  plainObject(analysisSettings, "analysis settings");
  requireValue(experiment === manifest.experiment_id,
    "result experiment differs from the manifest");
  const analysisSettingsSha256 = canonicalDigest("analysis-settings",
    analysisSettings);
  const contract = registeredAnalysisContract(manifest);
  requireValue(analysisSettingsSha256 === contract.analysis_settings_sha256,
    "analysis settings differ from the manifest contract");
  const analysisFunctionSha256 = analysisFunctionDigest(reconstruct);
  requireValue(analysisFunctionSha256 === contract.analysis_function_sha256,
    "analysis function differs from the manifest contract");
  const coverage = assertRawTraceCoverage({ manifest, rawTraces, expectedArms,
    selectedLanes, sourceIsolatedArms });
  const payload = reconstruct(cloneJson(rawTraces));
  plainObject(payload, "reconstructed result payload");
  const analysisPayload = cloneJson(payload, "reconstructed result payload");
  const reserved = new Set(["schema", "experiment", "manifest_sha256",
    "raw_trace_sha256", "trace_coverage_sha256",
    "analysis_settings_sha256", "analysis_function_sha256", "integrity",
    "exactness", "cost_totals",
    "decision", "gate", "gate_input", "registered_analysis", "analysis",
    "provenance", "result_sha256"]);
  for (const key of Object.keys(analysisPayload))
    requireValue(!reserved.has(key),
      `reconstructed result field ${key} is reserved`);
  const manifestSha256 = assertManifestDigest(manifest);
  const rawTraceSha256 = canonicalDigest("raw-traces", rawTraces);
  const registeredAnalysis = deriveRegisteredAnalysis(rawTraces, manifest);
  const gateInput = registeredAnalysis.gate_input;
  delete registeredAnalysis.gate_input;
  const exactGate = {
    ...coverage.exactness,
    fallback_receipts: rawTraces.map(row =>
      cloneJson(row.fallback_receipt, "raw fallback receipt")),
  };
  const gate = reconstructCommonGate({
    ...gateInput,
    integrity_valid: true,
    registration: cloneJson(contract.common_gate_registration,
      "registered common gate"),
    exact: exactGate,
  });
  const provenance = {
    schema: "zero.reasoner5_result_provenance.v1",
    manifest_sha256: manifestSha256,
    raw_trace_sha256: rawTraceSha256,
    trace_coverage_sha256: coverage.coverage_sha256,
    analysis_contract_sha256: coverage.analysis_contract_sha256,
    analysis_settings_sha256: analysisSettingsSha256,
    analysis_function_sha256: analysisFunctionSha256,
    common_gate_registration_sha256: canonicalDigest(
      "common-gate-registration", contract.common_gate_registration),
    episodes: coverage.episodes,
    rows: coverage.rows,
  };
  const body = {
    ...analysisPayload,
    schema: "zero.reasoner5_trace_result.v1",
    experiment,
    manifest_sha256: manifestSha256,
    raw_trace_sha256: rawTraceSha256,
    trace_coverage_sha256: coverage.coverage_sha256,
    analysis_settings_sha256: analysisSettingsSha256,
    analysis_function_sha256: analysisFunctionSha256,
    integrity: {
      manifest_digest_valid: true,
      trace_contract_valid: true,
      coverage_sha256: coverage.coverage_sha256,
    },
    exactness: coverage.exactness,
    cost_totals: coverage.cost_totals,
    registered_analysis: registeredAnalysis,
    decision: gate.decision,
    gate,
    provenance,
  };
  return {
    ...body,
    result_sha256: canonicalDigest("trace-result", body),
  };
}

export function assertResultReplay({
  experiment,
  manifest,
  rawTraces,
  reconstruct,
  analysisSettings,
  result,
  expectedArms,
  selectedLanes,
  sourceIsolatedArms,
}) {
  const replayed = buildResultFromRawTraces({ experiment, manifest, rawTraces,
    reconstruct, analysisSettings, expectedArms, selectedLanes,
    sourceIsolatedArms });
  requireValue(isDeepStrictEqual(replayed, result),
    "result does not reproduce from its raw traces");
  return {
    result_sha256: replayed.result_sha256,
    raw_trace_sha256: replayed.raw_trace_sha256,
  };
}

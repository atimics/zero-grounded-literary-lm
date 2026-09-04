import { createHash } from "node:crypto";
import assert from "node:assert/strict";

import {
  REASONER5_TRACE_ROW_FIELDS,
  analysisFunctionDigest,
  armParityReceipt,
  assertRankerView,
  canonicalCandidateOrder,
  canonicalDigest,
  candidateSemanticDigest,
  createDeterministicRng,
  createReplayRegistry,
  createSplitState,
  finalizeManifest,
  freezeFamilySplits,
  overlapReceipt,
  registerEpisode,
  registerFamily,
  registerReplayPipeline,
  replayFunctionDigest,
  runVerifiedSearch,
} from "./reasoner5_harness.mjs";

export const R58_EXPERIMENT =
  "reasoner58-compositional-behavior-transfer-v1";
export const R58_SOURCE_ROOT = "58a17e2026000000";
export const R58_CALIBRATION_ROOT = "58ca11b202600001";
export const R58_DEVELOPMENT_ROOT = "58de7e1026000001";
export const R58_MODULUS = 17;
export const R58_MAX_DEPTH = 3;
export const R58_GENERATORS = Object.freeze([
  "syntax-first",
  "behavior-skeleton",
]);
export const R58_SHIFT_STRATA = Object.freeze([
  "known-operation-new-composition",
  "changed-semantic-class-order",
  "new-cross-class-composition",
  "longer-tree-deeper-partial-chain",
]);
export const R58_BASE_ARMS = Object.freeze([
  "full",
  "target_only",
  "source_free_jit",
  "source_ablation",
  "transition_only",
  "raw_token",
  "behavior_off",
  "shuffled_behavior",
  "token_permuted",
  "source_only",
  "oracle_truth_rank",
]);
export const R58_DERANGEMENT_ARMS = Object.freeze(
  Array.from({ length: 31 }, (_, index) =>
    `shuffled_${String(index).padStart(2, "0")}`),
);
export const R58_ARMS = Object.freeze([
  ...R58_BASE_ARMS,
  ...R58_DERANGEMENT_ARMS,
]);
export const R58_SOURCE_ISOLATED_ARMS = Object.freeze([
  "target_only",
  "source_free_jit",
  "source_ablation",
  "oracle_truth_rank",
]);

const OPERATION_SPECS = Object.freeze([
  Object.freeze({ name: "translate-1", algebraicForm: "x+c",
    coefficient: 1, constant: 1 }),
  Object.freeze({ name: "translate-4", algebraicForm: "x+c",
    coefficient: 1, constant: 4 }),
  Object.freeze({ name: "scale-2", algebraicForm: "a*x",
    coefficient: 2, constant: 0 }),
  Object.freeze({ name: "scale-3", algebraicForm: "a*x",
    coefficient: 3, constant: 0 }),
  Object.freeze({ name: "negate", algebraicForm: "-x",
    coefficient: 16, constant: 0 }),
  Object.freeze({ name: "square", algebraicForm: "x^2",
    coefficient: 1, constant: 0 }),
  Object.freeze({ name: "cube", algebraicForm: "x^3",
    coefficient: 1, constant: 0 }),
  Object.freeze({ name: "mixed-x2-x-1", algebraicForm: "x^2+x+1",
    coefficient: 1, constant: 1 }),
]);

const PATTERNS = Object.freeze(["AAN", "NAA", "ANA", "NNN"]);
const LANE_CODE = Object.freeze({
  "source-training": 0,
  calibration: 1,
  development: 2,
  sealed: 3,
});
const LANE_ROOT = Object.freeze({
  "source-training": R58_SOURCE_ROOT,
  calibration: R58_CALIBRATION_ROOT,
  development: R58_DEVELOPMENT_ROOT,
});
const SHA256 = /^[0-9a-f]{64}$/u;

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export const R58_RANKER_POLICY = Object.freeze({
  schema: "zero.reasoner5_ranker_policy.v1",
  leaf_whitelist: Object.freeze([
    "protocol",
    "examples[].input_symbol",
    "examples[].observed_symbol",
    "grammar.operations[].surface_symbol",
    "grammar.operations[].algebraic_form",
    "grammar.operations[].coefficient",
    "grammar.operations[].constant",
  ]),
  leaf_contracts: Object.freeze({
    protocol: Object.freeze({ type: "string", provenance: "public-constant" }),
    "examples[].input_symbol": Object.freeze({ type: "integer",
      provenance: "generated-query" }),
    "examples[].observed_symbol": Object.freeze({ type: "integer",
      provenance: "observed-response" }),
    "grammar.operations[].surface_symbol": Object.freeze({ type: "string",
      provenance: "public-constant" }),
    "grammar.operations[].algebraic_form": Object.freeze({ type: "string",
      provenance: "public-constant" }),
    "grammar.operations[].coefficient": Object.freeze({ type: "integer",
      provenance: "public-constant" }),
    "grammar.operations[].constant": Object.freeze({ type: "integer",
      provenance: "public-constant" }),
  }),
});

export const R58_ANALYSIS_SETTINGS = Object.freeze({
  schema: "zero.reasoner58_development_analysis_settings.v1",
  primary_cost: "unique canonical semantic partial programs popped",
  family_unit: ["generator_id", "family_id"],
  nested_repeat: "nested_repeat_id",
  bootstrap_replicates: 2000,
  primary_alpha: 0.01,
  stratum_alpha: 0.05,
  mechanism_family_alpha: 0.05,
  derangements: 31,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mod17(value) {
  const remainder = value % R58_MODULUS;
  if (Object.is(remainder, -0)) return 0;
  return remainder < 0 ? remainder + R58_MODULUS : remainder;
}

export function applyR58Operation(operation, value) {
  const x = mod17(value);
  switch (operation) {
    case 0: return mod17(x + 1);
    case 1: return mod17(x + 4);
    case 2: return mod17(2 * x);
    case 3: return mod17(3 * x);
    case 4: return mod17(-x);
    case 5: return mod17(x * x);
    case 6: return mod17(x * x * x);
    case 7: return mod17(x * x + x + 1);
    default: throw new Error(`unknown R5.8 operation ${operation}`);
  }
}

export function executeR58Program(operations) {
  assert(Array.isArray(operations) && operations.length <= R58_MAX_DEPTH);
  return Array.from({ length: R58_MODULUS }, (_, input) =>
    operations.reduce((value, operation) =>
      applyR58Operation(operation, value), input));
}

function operationsFromIndex(length, syntaxIndex) {
  const operations = Array(length).fill(0);
  let value = syntaxIndex;
  for (let position = length - 1; position >= 0; position -= 1) {
    operations[position] = value % OPERATION_SPECS.length;
    value = Math.floor(value / OPERATION_SPECS.length);
  }
  return operations;
}

export function enumerateR58Universe() {
  const byBehavior = new Map();
  let syntaxPrograms = 0;
  for (let depth = 0; depth <= R58_MAX_DEPTH; depth += 1) {
    const count = OPERATION_SPECS.length ** depth;
    for (let syntaxIndex = 0; syntaxIndex < count; syntaxIndex += 1) {
      const operations = operationsFromIndex(depth, syntaxIndex);
      const semantic = executeR58Program(operations);
      const key = semantic.join(",");
      syntaxPrograms += 1;
      if (!byBehavior.has(key)) {
        byBehavior.set(key, {
          class_index: byBehavior.size,
          semantic,
          ast: {
            type: "gf17-unary",
            operations,
          },
          partial_expansions: 1,
        });
      }
    }
  }
  const candidates = [...byBehavior.values()];
  return {
    syntaxPrograms,
    semanticClasses: candidates.length,
    semanticCollisions: syntaxPrograms - candidates.length,
    classesByDepth: Array.from({ length: R58_MAX_DEPTH + 1 }, (_, depth) =>
      candidates.filter(candidate => candidate.ast.operations.length === depth)
        .length),
    candidates,
  };
}

export function r58UniverseSha256(universe = enumerateR58Universe()) {
  const hash = createHash("sha256");
  for (const candidate of universe.candidates) {
    const operations = [...candidate.ast.operations];
    while (operations.length < R58_MAX_DEPTH) operations.push(0);
    hash.update(Buffer.from([candidate.ast.operations.length, ...operations,
      ...candidate.semantic]));
  }
  return hash.digest("hex");
}

function distinctOutputs(semantic) {
  return new Set(semantic).size;
}

function fixedPoints(semantic) {
  return semantic.reduce((count, value, input) => count + (value === input), 0);
}

function polynomialDegree(semantic) {
  const differences = [...semantic];
  for (let degree = 0; degree < R58_MODULUS; degree += 1) {
    if (differences.slice(0, R58_MODULUS - degree)
      .every(value => value === differences[0])) return degree;
    for (let index = 0; index + 1 < R58_MODULUS - degree; index += 1)
      differences[index] = mod17(differences[index + 1] - differences[index]);
  }
  return R58_MODULUS - 1;
}

function signatureBucket(semantic) {
  let hash = 2166136261;
  for (const value of semantic) {
    hash = (hash ^ value) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash & 31;
}

function featureIndices(candidate) {
  const operations = candidate.ast.operations;
  const semantic = candidate.semantic;
  const distinct = distinctOutputs(semantic);
  const nonlinear = operations.some(operation => operation >= 5);
  return [
    distinct - 1,
    17 + fixedPoints(semantic),
    34 + (R58_MODULUS - distinct),
    51 + polynomialDegree(semantic),
    68 + Number(distinct === R58_MODULUS),
    70 + operations.length,
    74 + signatureBucket(semantic),
    106 + (operations.at(-1) ?? 0),
    114 + Number(nonlinear),
  ];
}

function transitionIndices(candidate) {
  return candidate.ast.operations.map((operation, index, operations) =>
    (index === 0 ? OPERATION_SPECS.length : operations[index - 1]) *
      OPERATION_SPECS.length + operation);
}

function rawTokenIndices(candidate) {
  return candidate.ast.operations.map((operation, index) =>
    index * OPERATION_SPECS.length + operation);
}

function checkArtifactWeights(guide) {
  assert.equal(guide.featurePositive.length, 116);
  assert.equal(guide.featureNegative.length, 116);
  assert.equal(guide.featureLogOddsQ20.length, 116);
  assert.equal(guide.transitionPositive.length, 72);
  assert.equal(guide.transitionNegative.length, 72);
  assert.equal(guide.transitionLogOddsQ20.length, 72);
  assert.equal(guide.rawTokenPositive.length, 24);
  assert.equal(guide.rawTokenNegative.length, 24);
  assert.equal(guide.rawTokenLogOddsQ20.length, 24);
}

export function parseR58Artifact(bytes) {
  assert(Buffer.isBuffer(bytes), "R5.8 artifact must be bytes");
  assert.equal(bytes.length, 2608, "R5.8 artifact byte count");
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "R58A0001");
  assert.equal(sha256(bytes.subarray(0, -32)), bytes.subarray(-32).toString("hex"),
    "R5.8 artifact checksum");
  let offset = 8;
  assert.equal(bytes.readUInt16LE(offset), 1); offset += 2;
  assert.deepEqual([...bytes.subarray(offset, offset + 4)], [17, 8, 2, 3]);
  offset += 4;
  const featureCells = bytes.readUInt16LE(offset); offset += 2;
  const transitionCells = bytes.readUInt16LE(offset); offset += 2;
  const rawTokenCells = bytes.readUInt16LE(offset); offset += 2;
  assert.deepEqual([featureCells, transitionCells, rawTokenCells], [116, 72, 24]);
  const sourceTasks = bytes.readUInt32LE(offset); offset += 4;
  const positiveLabels = bytes.readUInt32LE(offset); offset += 4;
  const negativeLabels = bytes.readUInt32LE(offset); offset += 4;
  const readCells = count => {
    const positive = [];
    const negative = [];
    const logOddsQ20 = [];
    for (let index = 0; index < count; index += 1) {
      positive.push(bytes.readUInt32LE(offset)); offset += 4;
      negative.push(bytes.readUInt32LE(offset)); offset += 4;
      logOddsQ20.push(bytes.readInt32LE(offset)); offset += 4;
    }
    return { positive, negative, logOddsQ20 };
  };
  const feature = readCells(featureCells);
  const transition = readCells(transitionCells);
  const rawToken = readCells(rawTokenCells);
  assert.equal(offset, bytes.length - 32, "R5.8 artifact trailing bytes");
  const guide = {
    positiveLabels,
    negativeLabels,
    featurePositive: feature.positive,
    featureNegative: feature.negative,
    featureLogOddsQ20: feature.logOddsQ20,
    transitionPositive: transition.positive,
    transitionNegative: transition.negative,
    transitionLogOddsQ20: transition.logOddsQ20,
    rawTokenPositive: rawToken.positive,
    rawTokenNegative: rawToken.negative,
    rawTokenLogOddsQ20: rawToken.logOddsQ20,
  };
  checkArtifactWeights(guide);
  return {
    schema: "R58A0001",
    bytes,
    sha256: sha256(bytes),
    sourceTasks,
    guide,
  };
}

function derangeFeature(feature, derangement) {
  if (derangement === 0) return feature;
  if (feature < 17) return (feature + derangement) % 17;
  if (feature < 34) return 17 + (feature - 17 + derangement * 3) % 17;
  if (feature < 51) return 34 + (feature - 34 + derangement * 5) % 17;
  if (feature < 68) return 51 + (feature - 51 + derangement * 7) % 17;
  if (feature < 70) return 68 + (feature - 68 + derangement) % 2;
  if (feature < 74) return 70 + (feature - 70 + derangement) % 4;
  if (feature < 106) return 74 + (feature - 74 + derangement * 9) % 32;
  return feature;
}

export function scoreR58Candidate(candidate, artifact, mode = "full",
  derangement = 0, surfaceByOperation = null) {
  const guide = artifact.guide;
  let score = 0n;
  if (["full", "behavior-off", "shuffled"].includes(mode)) {
    if (mode !== "behavior-off") {
      const features = featureIndices(candidate);
      for (const original of [...features.slice(0, 7), features[8]]) {
        const feature = mode === "shuffled"
          ? derangeFeature(original, derangement)
          : original;
        score += BigInt(guide.featureLogOddsQ20[feature]);
      }
    }
    score += BigInt(guide.featureLogOddsQ20[featureIndices(candidate)[7]]);
  }
  if (["full", "behavior-off", "transition-only", "shuffled"].includes(mode))
    for (const transition of transitionIndices(candidate))
      score += BigInt(guide.transitionLogOddsQ20[transition]);
  if (mode === "raw-token")
    for (const [position, operation] of candidate.ast.operations.entries()) {
      const token = surfaceByOperation === null ? operation :
        surfaceByOperation[operation];
      score += BigInt(guide.rawTokenLogOddsQ20[
        position * OPERATION_SPECS.length + token]);
    }
  const number = Number(score);
  assert(Number.isSafeInteger(number), "R5.8 Q20 score exceeds int64-safe JS range");
  return number;
}

function candidatePattern(candidate) {
  return candidate.ast.operations.map(operation => operation < 5 ? "A" : "N")
    .join("");
}

function behaviorSkeletonOrder(left, right) {
  const leftKey = [distinctOutputs(left.semantic), fixedPoints(left.semantic),
    polynomialDegree(left.semantic), signatureBucket(left.semantic),
    ...left.semantic];
  const rightKey = [distinctOutputs(right.semantic), fixedPoints(right.semantic),
    polynomialDegree(right.semantic), signatureBucket(right.semantic),
    ...right.semantic];
  for (let index = 0; index < leftKey.length; index += 1)
    if (leftKey[index] !== rightKey[index]) return leftKey[index] - rightKey[index];
  return left.class_index - right.class_index;
}

function selectEpisodeCandidate(lane, generatorIndex, stratumIndex, ordinal,
  rootSeed) {
  const universe = enumerateR58Universe();
  if (lane === "source-training") {
    const allSource = universe.candidates.filter(candidate =>
      candidate.ast.operations.length > 0 &&
      candidate.ast.operations.length <= 2);
    const pool = allSource.filter((_, index) => index % 2 === generatorIndex);
    if (generatorIndex === 1) pool.sort(behaviorSkeletonOrder);
    return pool[ordinal];
  }
  const partition = (lane === "calibration" ? 0 : 2) + generatorIndex;
  const pool = universe.candidates.filter(candidate =>
    candidate.ast.operations.length === 3 &&
    candidatePattern(candidate) === PATTERNS[stratumIndex] &&
    candidate.class_index % 4 === partition);
  if (generatorIndex === 1) pool.sort(behaviorSkeletonOrder);
  const rng = createDeterministicRng(rootSeed,
    `r58-program-${lane}-${generatorIndex}-${stratumIndex}`);
  return pool[(rng.index(pool.length) + ordinal) % pool.length];
}

function surfacePermutation(rootSeed, coordinates) {
  const values = Array.from({ length: OPERATION_SPECS.length }, (_, index) => index);
  const rng = createDeterministicRng(rootSeed,
    `r58-surface-${coordinates.join("-")}`);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = rng.index(index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function exampleInputs(rootSeed, coordinates, generatorIndex) {
  const rng = createDeterministicRng(rootSeed,
    `r58-input-${coordinates.join("-")}`);
  const inputs = [];
  if (generatorIndex === 1) {
    inputs.push(0);
  } else {
    while (inputs.length < 1) {
      const value = rng.index(R58_MODULUS);
      if (!inputs.includes(value)) inputs.push(value);
    }
  }
  return inputs;
}

function typedSubtrees(operations) {
  return Array.from({ length: operations.length }, (_, index) => ({
    input_type: "GF17",
    output_type: "GF17",
    role: index === operations.length - 1 ? "root" : "inner",
    operations: operations.slice(0, index + 1).map(operation =>
      OPERATION_SPECS[operation].name),
  }));
}

export function replayR58Episode(recipe) {
  assert.equal(recipe.schema, "zero.reasoner5_replay_recipe.v1");
  const path = recipe.seed_binding.derivation_path;
  assert.equal(path[0], "reasoner58-episode-v1");
  const [, laneCode, generatorIndex, stratumIndex, ordinal] = path;
  const lane = Object.keys(LANE_CODE).find(key => LANE_CODE[key] === laneCode);
  assert(lane && lane !== "sealed", "R5.8 replay lane");
  assert([0, 1].includes(generatorIndex), "R5.8 replay generator");
  assert(Number.isInteger(stratumIndex) && stratumIndex >= 0 &&
    stratumIndex < R58_SHIFT_STRATA.length, "R5.8 replay stratum");
  assert(Number.isInteger(ordinal) && ordinal >= 0, "R5.8 replay ordinal");
  const rootSeed = recipe.seed_binding.root_seed;
  const coordinates = [laneCode, generatorIndex, stratumIndex, ordinal];
  const candidate = selectEpisodeCandidate(lane, generatorIndex,
    stratumIndex, ordinal, rootSeed);
  const surface = lane === "source-training"
    ? Array.from({ length: OPERATION_SPECS.length }, (_, index) => index)
    : surfacePermutation(rootSeed, coordinates);
  const symbolByOperation = Array(OPERATION_SPECS.length);
  for (let symbol = 0; symbol < surface.length; symbol += 1)
    symbolByOperation[surface[symbol]] = `u${symbol}`;
  const inputs = exampleInputs(rootSeed, coordinates, generatorIndex);
  const examples = inputs.map(input => ({
    input_symbol: input,
    observed_symbol: candidate.semantic[input],
  }));
  const publicView = {
    protocol: "zero.reasoner58_public.v1",
    examples,
    grammar: {
      operations: surface.map((operation, symbol) => ({
        surface_symbol: `u${symbol}`,
        algebraic_form: OPERATION_SPECS[operation].algebraicForm,
        coefficient: OPERATION_SPECS[operation].coefficient,
        constant: OPERATION_SPECS[operation].constant,
      })),
    },
  };
  const operations = candidate.ast.operations;
  return {
    public: publicView,
    evaluator: {
      ast: {
        type: "gf17-unary",
        operations: operations.map(operation => symbolByOperation[operation]),
        operation_roles: [...operations],
      },
      behavior: [...candidate.semantic],
      episode_spec: {
        protocol: "zero.reasoner58_episode_spec.v1",
        lane_code: laneCode,
        generator_code: generatorIndex,
        stratum_code: stratumIndex,
        ordinal,
        operation_roles: [...operations],
        example_inputs: [...inputs],
        surface_permutation: [...surface],
      },
      atoms: [...new Set(operations)].sort((left, right) => left - right)
        .map(operation => ({
          input_type: "GF17",
          output_type: "GF17",
          operation: OPERATION_SPECS[operation].name,
        })),
      typed_subtrees: typedSubtrees(operations),
      exact_test_domain: Array.from({ length: R58_MODULUS }, (_, index) => index),
    },
  };
}

const GENERATOR_SPECS = R58_GENERATORS.map((generator, index) => ({
  schema: "zero.reasoner58_program_generator.v1",
  generator,
  index,
  rule: index === 0 ? "syntax-first canonical enumeration" :
    "behavior signature skeleton then shortest syntax",
}));
const INPUT_GENERATOR_SPECS = R58_GENERATORS.map((generator, index) => ({
  schema: "zero.reasoner58_input_generator.v1",
  generator,
  rule: index === 0 ? "two seeded distinct field values" :
    "fixed finite-field anchors zero and one",
}));
export const R58_GENERATOR_DIGESTS = Object.freeze(GENERATOR_SPECS.map(spec =>
  canonicalDigest("reasoner58-program-generator", spec)));
export const R58_INPUT_GENERATOR_DIGESTS = Object.freeze(
  INPUT_GENERATOR_SPECS.map(spec =>
    canonicalDigest("reasoner58-input-generator", spec)),
);

function episodeRecipe(lane, generatorIndex, stratumIndex, ordinal) {
  const recipe = {
    schema: "zero.reasoner5_replay_recipe.v1",
    generator_sha256: R58_GENERATOR_DIGESTS[generatorIndex],
    input_generator_sha256: R58_INPUT_GENERATOR_DIGESTS[generatorIndex],
    replay_function_sha256: replayFunctionDigest(replayR58Episode),
    seed_binding: {
      root_seed: LANE_ROOT[lane],
      derivation_path: ["reasoner58-episode-v1", LANE_CODE[lane],
        generatorIndex, stratumIndex, ordinal],
    },
  };
  return recipe;
}

function familyId(lane, generatorIndex, stratumIndex, ordinal) {
  const laneName = lane.replace("source-training", "source");
  return `r58-${laneName}-g${generatorIndex}-s${stratumIndex}-${String(ordinal)
    .padStart(2, "0")}`;
}

function registeredFamilies() {
  const families = [];
  let serial = 0;
  const add = (lane, generatorIndex, stratumIndex, ordinal) => {
    families.push({
      family_id: familyId(lane, generatorIndex, stratumIndex, ordinal),
      lane,
      generator_id: R58_GENERATORS[generatorIndex],
      shift_stratum: lane === "source-training"
        ? "short-source-composition"
        : R58_SHIFT_STRATA[stratumIndex],
      family_spec: {
        schema: "zero.reasoner58_family_spec.v1",
        field: "GF17",
        construction: R58_GENERATORS[generatorIndex],
        composition_pattern: lane === "source-training" ? "source-depth-two" :
          PATTERNS[stratumIndex],
        reserved_index: serial,
      },
      coordinates: { lane, generatorIndex, stratumIndex, ordinal },
    });
    serial += 1;
  };
  for (let generator = 0; generator < 2; generator += 1)
    for (let ordinal = 0; ordinal < 32; ordinal += 1)
      add("source-training", generator, ordinal % 4, ordinal);
  for (let generator = 0; generator < 2; generator += 1)
    for (let stratum = 0; stratum < 4; stratum += 1)
      add("calibration", generator, stratum, 0);
  for (let stratum = 0; stratum < 4; stratum += 1)
    for (let ordinal = 0; ordinal < 3; ordinal += 1)
      add("development", (ordinal + stratum) % 2, stratum, ordinal);
  for (let stratum = 0; stratum < 4; stratum += 1)
    for (let ordinal = 0; ordinal < 3; ordinal += 1)
      add("sealed", (ordinal + stratum + 1) % 2, stratum, ordinal);
  return families;
}

function selectedEpisodeFamilies(families) {
  return families.filter(family => {
    const { lane } = family.coordinates;
    if (lane === "source-training") return true;
    return lane === "calibration" || lane === "development";
  });
}

export function reconstructR58SourceCounts(episodes) {
  const sourceEpisodes = episodes.filter(episode =>
    episode.lane === "source-training");
  assert.equal(sourceEpisodes.length, 64,
    "R5.8 source count replay needs all 64 source episodes");
  const sourceCandidates = enumerateR58Universe().candidates.filter(candidate =>
    candidate.ast.operations.length <= 2);
  const counts = {
    positiveLabels: 0,
    negativeLabels: 0,
    featurePositive: Array(116).fill(0),
    featureNegative: Array(116).fill(0),
    transitionPositive: Array(72).fill(0),
    transitionNegative: Array(72).fill(0),
    rawTokenPositive: Array(24).fill(0),
    rawTokenNegative: Array(24).fill(0),
  };
  for (const episode of sourceEpisodes) {
    const target = episode.content.evaluator.episode_spec.operation_roles;
    for (const candidate of sourceCandidates) {
      const operations = candidate.ast.operations;
      const positive = operations.length <= target.length &&
        operations.every((operation, index) => operation === target[index]);
      counts[positive ? "positiveLabels" : "negativeLabels"] += 1;
      for (const feature of featureIndices(candidate))
        counts[positive ? "featurePositive" : "featureNegative"][feature] += 1;
      for (const transition of transitionIndices(candidate))
        counts[positive ? "transitionPositive" : "transitionNegative"]
          [transition] += 1;
      for (const token of rawTokenIndices(candidate))
        counts[positive ? "rawTokenPositive" : "rawTokenNegative"][token] += 1;
    }
  }
  return counts;
}

function episodeCandidates() {
  const universe = enumerateR58Universe();
  return deepFreeze(universe.candidates.map((candidate, index) => ({
    ...candidate,
    partial_expansions: index === 0 ? 0 : 1,
  })));
}

function parityValues(content, candidates) {
  return {
    candidates,
    grammar: content.public.grammar,
    initial_evidence: content.public.examples,
    allowed_actions: ["pop-partial", "extend-unary", "verify-complete",
      "canonical-fallback"],
    latent_episode: content.evaluator.episode_spec,
    potential_response: content.evaluator.behavior.map((value, input) =>
      ({ input, value })),
    verifier: { kind: "exhaustive-gf17-truth-table", points: 17 },
    caps: { partial_programs: 428, verifier_checks: 428 },
  };
}

function parityReceipts(content, candidates) {
  const first = armParityReceipt({
    arm: R58_ARMS[0],
    ...parityValues(content, candidates),
  });
  const { receipt_sha256: _digest, ...template } = first;
  return R58_ARMS.map(arm => {
    const body = { ...structuredClone(template), arm };
    return {
      ...body,
      receipt_sha256: canonicalDigest("arm-parity-receipt", body),
    };
  });
}

function analysisContract() {
  const comparison = (fullArm, comparatorArm, direction, seed) => ({
    full_arm: fullArm,
    comparator_arm: comparatorArm,
    design: "one-way",
    unit_fields: ["generator_id", "family_id"],
    direction,
    seed,
    replicates: R58_ANALYSIS_SETTINGS.bootstrap_replicates,
    alpha: direction === "lower" ? 0.01 : 0.05,
    environment_field: "generator_id",
  });
  return {
    schema: "zero.reasoner5_analysis_contract.v1",
    expected_arms: [...R58_ARMS],
    selected_lanes: ["development"],
    source_isolated_arms: [...R58_SOURCE_ISOLATED_ARMS],
    trace_schema: "zero.reasoner5_trace_row.v1",
    primary_cost_rule: "partial-expansions",
    analysis_settings_sha256: canonicalDigest("analysis-settings",
      R58_ANALYSIS_SETTINGS),
    analysis_function_sha256: analysisFunctionDigest(
      reconstructR58Development),
    primary_analysis: comparison("full", "source_free_jit", "lower",
      "58a1000000000001"),
    stratum_analyses: R58_SHIFT_STRATA.map((name, index) => ({
      name,
      ...comparison("full", "source_free_jit", "lower",
        `58b${String(index).padStart(13, "0")}`),
      alpha: 0.05,
      field: "shift_stratum",
      values: [name],
    })),
    mechanism_analyses: [{
      name: "behavior-features",
      ...comparison("behavior_off", "full", "higher",
        "58c0000000000001"),
    }],
    factorial_analysis: null,
    derangement_analysis: {
      observed_arm: "full",
      reference_arms: [...R58_DERANGEMENT_ARMS],
      unit_fields: ["generator_id", "family_id"],
    },
    source_ablation: {
      ablation_arm: "source_ablation",
      source_free_arm: "source_free_jit",
    },
    headroom: {
      comparator_arm: "source_free_jit",
      median_primary_cost_min: 16,
    },
    common_gate_registration: {
      primary_alpha: 0.01,
      primary_strata: [...R58_SHIFT_STRATA],
      formal_mechanisms: ["behavior-features"],
      crossed_design: false,
      marginal_axes: [],
      derangements: 31,
      mechanism_family_alpha: 0.05,
      factorial_interaction_required: false,
    },
  };
}

export function buildR58Manifest(artifact) {
  assert(artifact && artifact.schema === "R58A0001" &&
    artifact.sourceTasks === 64 && SHA256.test(artifact.sha256),
  "R5.8 manifest needs the parsed 64-task source artifact");
  const state = createSplitState({ experiment_id: R58_EXPERIMENT });
  const families = registeredFamilies();
  for (const family of families) {
    const { coordinates: _coordinates, ...registration } = family;
    registerFamily(state, registration);
  }
  freezeFamilySplits(state);
  const candidates = episodeCandidates();
  for (const family of selectedEpisodeFamilies(families)) {
    const { lane, generatorIndex, stratumIndex, ordinal } = family.coordinates;
    const recipe = episodeRecipe(lane, generatorIndex, stratumIndex, ordinal);
    const content = replayR58Episode(recipe);
    assertRankerView(content.public, {
      whitelist: R58_RANKER_POLICY.leaf_whitelist,
      leafContracts: R58_RANKER_POLICY.leaf_contracts,
    });
    const receipts = parityReceipts(content, candidates);
    const base = receipts[0];
    const episodeId = `${family.family_id}-repeat-0`;
    registerEpisode(state, {
      episode_id: episodeId,
      lane,
      family_id: family.family_id,
      cross_family_id: null,
      nested_repeat_id: "repeat-0",
      seed_ref: canonicalDigest("episode-seed-reference", recipe),
      replay_recipe: recipe,
      ranker_policy: R58_RANKER_POLICY,
      public: content.public,
      evaluator: content.evaluator,
      expected_arms: [...R58_ARMS],
      arm_parity_receipts: receipts,
      trace_binding: {
        candidate_universe_digest: canonicalDigest("candidate-universe",
          base.candidate_multiset),
        grammar_digest: base.grammar_sha256,
        initial_evidence_digest: base.initial_evidence_sha256,
        allowed_actions_digest: base.allowed_actions_sha256,
        latent_episode_digest: base.latent_episode_sha256,
        potential_response_digest: base.potential_response_sha256,
        verifier_digest: base.verifier_sha256,
        caps_digest: base.caps_sha256,
      },
    });
  }
  const splitDivergence = [];
  for (const [leftLane, rightLane] of [["source-training", "development"],
    ["calibration", "development"]]) {
    for (const field of ["atoms", "typed_subtrees"]) {
      const receipt = overlapReceipt(state.episodes, field, leftLane, rightLane);
      const union = receipt.left_distinct + receipt.right_distinct -
        receipt.overlap_count;
      splitDivergence.push({
        ...receipt,
        union_count: union,
        jaccard_divergence: union === 0 ? 0 :
          (union - receipt.overlap_count) / union,
      });
    }
  }
  const sourceCounts = reconstructR58SourceCounts(state.episodes);
  for (const field of ["positiveLabels", "negativeLabels", "featurePositive",
    "featureNegative", "transitionPositive", "transitionNegative",
    "rawTokenPositive", "rawTokenNegative"])
    assert.deepEqual(sourceCounts[field], artifact.guide[field],
      `source artifact ${field} differs from its registered source episodes`);
  return finalizeManifest(state, {
    status: "development-only",
    execution: {
      authorized: false,
      sealed_seeds_present: false,
      scientific_executions: 0,
    },
    domain: {
      field: "GF(17)",
      source_max_depth: 2,
      target_max_depth: 3,
      syntax_programs: 585,
      semantic_classes: 428,
      semantic_identity: "complete 17-value truth table",
    },
    generators: GENERATOR_SPECS,
    input_generators: INPUT_GENERATOR_SPECS,
    split_divergence: splitDivergence,
    source_artifact: {
      schema: artifact.schema,
      canonical_bytes: artifact.bytes.length,
      sha256: artifact.sha256,
      source_tasks: artifact.sourceTasks,
      training_family_ids: families.filter(family =>
        family.lane === "source-training").map(family => family.family_id),
      source_count_receipt_sha256: canonicalDigest(
        "reasoner58-source-training-counts", sourceCounts),
    },
    analysis_contract: analysisContract(),
  });
}

export function createR58ReplayRegistry() {
  const registry = createReplayRegistry();
  const digest = replayFunctionDigest(replayR58Episode);
  for (let index = 0; index < R58_GENERATORS.length; index += 1)
    registerReplayPipeline(registry, {
      generator_sha256: R58_GENERATOR_DIGESTS[index],
      input_generator_sha256: R58_INPUT_GENERATOR_DIGESTS[index],
      replay_function_sha256: digest,
      replay: replayR58Episode,
    });
  return registry;
}

function evidenceLoss(candidate, publicView) {
  return publicView.examples.reduce((loss, example) => loss +
    (candidate.semantic[example.input_symbol] !== example.observed_symbol), 0);
}

function extensionSupport(candidate, consistentPrograms) {
  const prefix = candidate.ast.operations;
  return consistentPrograms.reduce((count, complete) => count +
    prefix.every((operation, index) =>
      complete.ast.operations[index] === operation), 0);
}

function canonicalTie(candidate) {
  return canonicalDigest("reasoner58-ranker-tie", {
    semantic: candidate.semantic,
    ast: candidate.ast,
  });
}

export function r58SurfaceByOperation(publicView) {
  const mapping = Array(OPERATION_SPECS.length).fill(-1);
  for (const [surface, visible] of publicView.grammar.operations.entries()) {
    const operation = OPERATION_SPECS.findIndex(spec =>
      spec.algebraicForm === visible.algebraic_form &&
      spec.coefficient === visible.coefficient &&
      spec.constant === visible.constant);
    assert(operation >= 0 && mapping[operation] === -1,
      "public grammar must map every operation to one surface token");
    mapping[operation] = surface;
  }
  assert(mapping.every(value => value >= 0),
    "public grammar surface mapping must be complete");
  return mapping;
}

export function r58OperationBySurface(publicView) {
  const surface = r58SurfaceByOperation(publicView);
  const mapping = Array(OPERATION_SPECS.length);
  for (const [operation, symbol] of surface.entries())
    mapping[symbol] = operation;
  return mapping;
}

export function applyR58TokenBijection(publicView, oldToNew) {
  assertRankerView(publicView, {
    whitelist: R58_RANKER_POLICY.leaf_whitelist,
    leafContracts: R58_RANKER_POLICY.leaf_contracts,
  });
  assert(Array.isArray(oldToNew) &&
    oldToNew.length === OPERATION_SPECS.length &&
    oldToNew.every(value => Number.isInteger(value) && value >= 0 &&
      value < OPERATION_SPECS.length) &&
    new Set(oldToNew).size === OPERATION_SPECS.length,
  "R5.8 token bijection must be a complete permutation");
  const transformed = structuredClone(publicView);
  transformed.grammar.operations = Array(OPERATION_SPECS.length);
  for (let oldSymbol = 0; oldSymbol < oldToNew.length; oldSymbol += 1) {
    const newSymbol = oldToNew[oldSymbol];
    transformed.grammar.operations[newSymbol] = {
      ...structuredClone(publicView.grammar.operations[oldSymbol]),
      surface_symbol: `u${newSymbol}`,
    };
  }
  assertRankerView(transformed, {
    whitelist: R58_RANKER_POLICY.leaf_whitelist,
    leafContracts: R58_RANKER_POLICY.leaf_contracts,
  });
  return transformed;
}

function scoreModeForArm(arm) {
  if (arm === "transition_only") return ["transition-only", 0];
  if (arm === "raw_token") return ["raw-token", 0];
  if (arm === "behavior_off") return ["behavior-off", 0];
  if (arm === "shuffled_behavior") return ["shuffled", 13];
  if (arm.startsWith("shuffled_"))
    return ["shuffled", Number(arm.slice(-2)) + 1];
  return ["full", 0];
}

function bottomUpOrder(candidates, compare) {
  const bySemantic = new Map(candidates.map(candidate =>
    [candidate.semantic.join(","), candidate]));
  const children = new Map(candidates.map(candidate => [candidate.class_index, []]));
  const available = [];
  for (const candidate of candidates) {
    if (candidate.ast.operations.length === 0) {
      available.push(candidate);
      continue;
    }
    const parentSemantic = executeR58Program(candidate.ast.operations.slice(0, -1));
    const parent = bySemantic.get(parentSemantic.join(","));
    assert(parent, "canonical semantic partial needs a registered parent");
    children.get(parent.class_index).push(candidate);
  }
  const ordered = [];
  while (available.length > 0) {
    available.sort(compare);
    const candidate = available.shift();
    ordered.push(candidate);
    available.push(...children.get(candidate.class_index));
  }
  assert.equal(ordered.length, candidates.length,
    "bottom-up priority queue omitted a semantic partial");
  return ordered;
}

export function rankR58Candidates(publicView, candidates, artifact, arm) {
  assertRankerView(publicView, {
    whitelist: R58_RANKER_POLICY.leaf_whitelist,
    leafContracts: R58_RANKER_POLICY.leaf_contracts,
  });
  assert(R58_ARMS.includes(arm) && arm !== "oracle_truth_rank");
  const [mode, derangement] = scoreModeForArm(arm);
  const surface = r58SurfaceByOperation(publicView);
  const consistentPrograms = candidates.filter(candidate =>
    candidate.ast.operations.length === R58_MAX_DEPTH &&
    evidenceLoss(candidate, publicView) === 0);
  const support = new Map(candidates.map(candidate => [candidate.class_index,
    extensionSupport(candidate, consistentPrograms)]));
  const guideScores = new Map();
  if (!["target_only", "source_free_jit", "source_ablation"].includes(arm))
    for (const candidate of candidates)
      guideScores.set(candidate.class_index, scoreR58Candidate(candidate,
        artifact, mode, derangement, mode === "raw-token" ? surface : null));
  const ties = new Map(candidates.map(candidate =>
    [candidate.class_index, canonicalTie(candidate)]));
  const compare = (left, right) => {
    const depth = left.ast.operations.length - right.ast.operations.length;
    if (arm === "target_only" && depth !== 0) return depth;
    if (arm !== "source_only" && arm !== "target_only") {
      const supportDifference = support.get(right.class_index) -
        support.get(left.class_index);
      if (supportDifference !== 0) return supportDifference;
    }
    if (["target_only"].includes(arm)) {
      /* The depth key above defines target-only size enumeration. */
    } else if (["source_free_jit", "source_ablation"].includes(arm)) {
      if (depth !== 0) return -depth;
    } else {
      const guide = guideScores.get(right.class_index) -
        guideScores.get(left.class_index);
      if (guide !== 0) return guide;
    }
    if (depth !== 0) return depth;
    return ties.get(left.class_index).localeCompare(ties.get(right.class_index));
  };
  return bottomUpOrder(candidates, compare);
}

export function rankR58OracleCandidates(candidates, targetOperations) {
  const isTargetPrefix = candidate => candidate.ast.operations.every(
    (operation, index) => operation === targetOperations[index]);
  return bottomUpOrder(candidates, (left, right) => {
    const prefix = Number(isTargetPrefix(right)) - Number(isTargetPrefix(left));
    if (prefix !== 0) return prefix;
    const depth = left.ast.operations.length - right.ast.operations.length;
    if (depth !== 0) return depth;
    return canonicalTie(left).localeCompare(canonicalTie(right));
  });
}

function exactVerifier(expected) {
  return candidate => {
    const mismatch = candidate.semantic.findIndex((value, input) =>
      value !== expected[input]);
    if (mismatch === -1) return {
      accepted: true,
      certificate_valid: true,
      certificate: {
        schema: "zero.reasoner58_exact_certificate.v1",
        domain_points: 17,
        truth_table: [...candidate.semantic],
      },
      answer_ir: {
        schema: "zero.reasoner58_answer_ir.v1",
        type: "gf17-unary",
        operations: [...candidate.ast.operations],
      },
    };
    return {
      accepted: false,
      certificate_valid: false,
      counterexample: {
        input: mismatch,
        expected: expected[mismatch],
        actual: candidate.semantic[mismatch],
      },
    };
  };
}

function armUsesArtifact(arm) {
  return !R58_SOURCE_ISOLATED_ARMS.includes(arm);
}

export function executeR58Arm(episode, candidates, artifact, arm,
  frozenFallback = null) {
  assert(R58_ARMS.includes(arm), `unknown R5.8 arm ${arm}`);
  const publicView = episode.content.public;
  const expected = episode.content.evaluator.behavior;
  const invalid = candidates[0];
  assert.notDeepEqual(invalid.semantic, expected,
    "fixed injected-invalid candidate became exact");
  let ranking;
  if (arm === "oracle_truth_rank") {
    ranking = rankR58OracleCandidates(candidates,
      episode.content.evaluator.episode_spec.operation_roles);
  } else {
    const rankerView = arm === "token_permuted"
      ? applyR58TokenBijection(publicView,
        r58OperationBySurface(publicView))
      : publicView;
    ranking = rankR58Candidates(rankerView, candidates, artifact, arm);
  }
  const proposals = [invalid, ...ranking.filter(candidate => candidate !== invalid)];
  const search = runVerifiedSearch({
    proposals,
    fallback: frozenFallback ?? deepFreeze(canonicalCandidateOrder(candidates)),
    candidate_universe: candidates,
    verify: exactVerifier(expected),
    global_cap: candidates.length,
    injected_invalid_sha256: candidateSemanticDigest(invalid),
  });
  return { search, sourceArtifactReads: armUsesArtifact(arm) ? artifact.bytes.length : 0 };
}

export function makeR58RawRow(episode, arm, execution) {
  const { search, sourceArtifactReads } = execution;
  const row = {
    allowed_actions_digest: episode.trace_binding.allowed_actions_digest,
    answer_ir: search.answer_ir,
    answer_ir_sha256: search.answer_ir_sha256,
    arm,
    ast_sha256: episode.fingerprints.ast_sha256,
    behavior_sha256: episode.fingerprints.behavior_sha256,
    candidate_universe_digest: episode.trace_binding.candidate_universe_digest,
    caps_digest: episode.trace_binding.caps_digest,
    certificate_sha256: search.certificate_sha256,
    certificate_valid: search.solved && search.certificate_sha256 !== null,
    censoring_reason: search.censoring_reason,
    cross_family_id: episode.cross_family_id,
    episode_bytes_sha256: episode.episode_bytes_sha256,
    episode_id: episode.episode_id,
    episode_spec_sha256: episode.fingerprints.episode_spec_sha256,
    exact: search.solved,
    execution_trace_sha256: search.search_sha256,
    experiment: R58_EXPERIMENT,
    fallback_exhausted: search.fallback_exhausted,
    fallback_partial_expansions: search.fallback_partial_expansions,
    fallback_receipt: search.fallback_receipt,
    fallback_started: search.fallback_started,
    fallback_verifier_checks: search.fallback_verifier_checks,
    family_id: episode.family_id,
    generator_id: episode.generator_id,
    global_cap_hit: search.global_cap_hit,
    grammar_digest: episode.trace_binding.grammar_digest,
    initial_evidence_digest: episode.trace_binding.initial_evidence_digest,
    injected_invalid: search.injected_invalid !== null,
    injected_invalid_rejected: search.injected_invalid?.rejected === true,
    lane: episode.lane,
    latent_episode_digest: episode.trace_binding.latent_episode_digest,
    nested_repeat_id: episode.nested_repeat_id,
    observation_queries: episode.content.public.examples.length,
    parity_digest: episode.trace_binding.parity_digest,
    partial_expansions: search.partial_expansions,
    peak_bytes: null,
    potential_response_digest: episode.trace_binding.potential_response_digest,
    premature_commit: search.premature_commits > 0,
    primary_cost: search.partial_expansions,
    schema: "zero.reasoner5_trace_row.v1",
    shift_stratum: episode.shift_stratum,
    source_artifact_reads: sourceArtifactReads,
    verified_search: search,
    verifier_checks: search.verifier_checks,
    verifier_digest: episode.trace_binding.verifier_digest,
    wall_ns: null,
  };
  assert.deepEqual(Object.keys(row).sort(), [...REASONER5_TRACE_ROW_FIELDS].sort());
  return row;
}

export function reconstructR58Development(rawTraces) {
  const armMeasurements = R58_ARMS.map(arm => {
    const rows = rawTraces.filter(row => row.arm === arm);
    const costs = rows.map(row => row.primary_cost).sort((left, right) =>
      left - right);
    const middle = Math.floor(costs.length / 2);
    const median = costs.length % 2 ? costs[middle] :
      (costs[middle - 1] + costs[middle]) / 2;
    return {
      arm,
      episodes: rows.length,
      primary_cost_total: costs.reduce((sum, value) => sum + value, 0),
      primary_cost_median: median,
      verifier_checks_total: rows.reduce((sum, row) =>
        sum + row.verifier_checks, 0),
      fallback_episodes: rows.filter(row => row.fallback_started).length,
      source_artifact_reads: rows.reduce((sum, row) =>
        sum + row.source_artifact_reads, 0),
    };
  });
  const shiftMeasurements = R58_SHIFT_STRATA.map(shift => ({
    shift,
    families: new Set(rawTraces.filter(row => row.shift_stratum === shift)
      .map(row => row.family_id)).size,
    full_primary_cost: rawTraces.filter(row => row.shift_stratum === shift &&
      row.arm === "full").reduce((sum, row) => sum + row.primary_cost, 0),
    source_free_primary_cost: rawTraces.filter(row =>
      row.shift_stratum === shift && row.arm === "source_free_jit")
      .reduce((sum, row) => sum + row.primary_cost, 0),
  }));
  return {
    status: "development-only",
    execution_authorized: false,
    scientific_claim: "withheld pending a separately authorized sealed run",
    development_measurements: {
      episodes: new Set(rawTraces.map(row => row.episode_id)).size,
      rows: rawTraces.length,
      arms: armMeasurements,
      shifts: shiftMeasurements,
    },
  };
}

export function cloneSourceAblationRow(sourceFreeRow) {
  return { ...structuredClone(sourceFreeRow), arm: "source_ablation" };
}

export function generateR58RawRows(manifest, artifact) {
  const candidates = episodeCandidates();
  const fallback = deepFreeze(canonicalCandidateOrder(candidates));
  const rows = [];
  for (const episode of manifest.episodes.filter(item =>
    item.lane === "development")) {
    let sourceFreeRow = null;
    for (const arm of R58_ARMS) {
      if (arm === "source_ablation") {
        assert(sourceFreeRow, "source-free row must precede source ablation");
        rows.push(cloneSourceAblationRow(sourceFreeRow));
        continue;
      }
      const row = makeR58RawRow(episode, arm,
        executeR58Arm(episode, candidates, artifact, arm, fallback));
      rows.push(row);
      if (arm === "source_free_jit") sourceFreeRow = row;
    }
  }
  return rows;
}

export function r58ArtifactDigest(bytes) {
  return sha256(bytes);
}

export function assertR58Digest(value, label) {
  assert.match(value, SHA256, label);
}

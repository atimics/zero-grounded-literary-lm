import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  REASONER5_TRACE_ROW_FIELDS,
  analysisFunctionDigest,
  armParityReceipt,
  assertManifestReplay,
  assertRawTraceCoverage,
  assertResultReplay,
  buildResultFromRawTraces,
  candidateAstDigest,
  candidateMultisetReceipt,
  candidateSemanticDigest,
  canonicalCandidateOrder,
  canonicalDigest,
  createDeterministicRng,
  createReplayRegistry,
  createSplitState,
  finalizeManifest,
  freezeFamilySplits,
  registerEpisode,
  registerFamily,
  registerReplayPipeline,
  replayFunctionDigest,
  wilsonLowerBound,
} from "./reasoner5_harness.mjs";

export const R56_EXPERIMENT = "reasoner56-passive-noise-development-v1";
export const R56_ROOT_SEED = "56de000256de0003";
export const R56_ANALYSIS_SETTINGS = Object.freeze({
  schema: "zero.reasoner56_analysis_settings.v1",
  primary_cost: "verified complete semantic classes",
  family_weighting: "equal",
  crossed_resampling: "program-by-corruption",
  bootstrap_replicates: 256,
  primary_alpha: 0.01,
});

export const R56_DERANGEMENT_ARMS = Object.freeze(
  Array.from({ length: 31 }, (_, index) =>
    `derangement_${String(index).padStart(2, "0")}`),
);

export const R56_EXPECTED_ARMS = Object.freeze([
  "full",
  "robust_hamming",
  "target_only",
  "source_free",
  "source_ablation",
  "one_trim",
  "markov_off",
  "shuffled_sensor",
  "value_only",
  "mask_only",
  "channel_only",
  "program_prior_only",
  "oracle_channel",
  "clean_oracle",
  ...R56_DERANGEMENT_ARMS,
]);

const MASK64 = (1n << 64n) - 1n;
const MODULUS = 17;
const PRIMITIVES = 8;
const DEVELOPMENT_CLASSES = 8;
const MECHANISMS = 8;
const REPEATS = 2;
const OBSERVATIONS = 18;
const GLOBAL_CAP = 427;
const PROPOSAL_BUDGET = 24;
const Q20_ONE = 1048576;
const CHANNEL_STATES = 18;
const SUPPORT_MIN = 32;
const ARTIFACT_SERIALIZED_BYTES = 175224;
const CALIBRATION_COVERAGE_FAMILIES = 99;
const CALIBRATION_DRAWS = 8;
const DEVELOPMENT_CORRUPTION_SEED = 0x56de0002n;
const DEVELOPMENT_ORDER_SEED = 0x56de0003n;
const COVERAGE_CORRUPTION_SEED = 0x56cb1200n;
const COVERAGE_ORDER_SEED = 0x56cb1300n;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mod17(value) {
  return ((value % MODULUS) + MODULUS) % MODULUS;
}

function applyPrimitive(token, value) {
  if (token === 0) return mod17(value + 1);
  if (token === 1) return mod17(2 * value);
  if (token === 2) return mod17(-value);
  if (token === 3) return mod17(value * value);
  if (token === 4) return mod17(value * value * value);
  if (token === 5) return mod17(value + 5);
  if (token === 6) return mod17(value * value + value);
  return mod17(value * value * value + 1);
}

function programTable(tokens) {
  return Array.from({ length: MODULUS }, (_, input) =>
    tokens.reduce((value, token) => applyPrimitive(token, value), input));
}

function mix64(input) {
  let value = (BigInt(input) + 0x9e3779b97f4a7c15n) & MASK64;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (value ^ (value >> 31n)) & MASK64;
}

function eventKey(seed, a, b, c, d, e) {
  let value = BigInt(seed) & MASK64;
  value = mix64(value ^ mix64(BigInt(a) + 0x100000001b3n));
  value = mix64(value ^ mix64(BigInt(b) + 0x9e3779b9n));
  value = mix64(value ^ mix64(BigInt(c) + 0x85ebca6bn));
  value = mix64(value ^ mix64(BigInt(d) + 0xc2b2ae35n));
  return mix64(value ^ mix64(BigInt(e) + 0x27d4eb2fn));
}

function buildUniverse() {
  const semantic = [];
  const syntaxToSemantic = [];
  for (let first = 0; first < PRIMITIVES; ++first) {
    for (let second = 0; second < PRIMITIVES; ++second) {
      for (let third = 0; third < PRIMITIVES; ++third) {
        const tokens = [first, second, third];
        const truthTable = programTable(tokens);
        let semanticClass = semantic.findIndex(item =>
          item.truth_table.every((value, index) => value === truthTable[index]));
        if (semanticClass < 0) {
          semanticClass = semantic.length;
          semantic.push({ tokens, truth_table: truthTable, multiplicity: 0 });
        }
        semantic[semanticClass].multiplicity += 1;
        syntaxToSemantic.push(semanticClass);
      }
    }
  }
  assert.equal(syntaxToSemantic.length, 512);
  assert.equal(semantic.length, 427);
  return { semantic, syntax_to_semantic: syntaxToSemantic };
}

export const R56_UNIVERSE = Object.freeze(buildUniverse());

export const R56_CANDIDATES = Object.freeze(R56_UNIVERSE.semantic.map(
  (item, classIndex) => Object.freeze({
    class_index: classIndex,
    semantic: Object.freeze({
      field: "GF(17)",
      truth_table: Object.freeze([...item.truth_table]),
    }),
    ast: Object.freeze({ kind: "compose", tokens: Object.freeze([...item.tokens]) }),
    partial_expansions: 1,
  }),
));

export const R56_CANONICAL_FALLBACK = Object.freeze(
  canonicalCandidateOrder(R56_CANDIDATES),
);
const R56_CANDIDATE_MULTISET = Object.freeze(
  candidateMultisetReceipt(R56_CANDIDATES),
);
const R56_CANDIDATE_METADATA = Object.freeze(R56_CANDIDATES.map(candidate =>
  Object.freeze({
    semantic_sha256: candidateSemanticDigest(candidate),
    ast_sha256: candidateAstDigest(candidate),
    record_sha256: canonicalDigest("candidate-record", candidate),
  })),
);

function sourceProgram(index) {
  return Array.from({ length: 3 }, (_, position) => Number(eventKey(
    0x56010001n, BigInt(index), BigInt(position), 56n, 0n, 0n) % 8n));
}

function corruptionFamily(index, corruptionSeed = DEVELOPMENT_CORRUPTION_SEED) {
  const value = eventKey(corruptionSeed, BigInt(index), 0n, 0n, 0n, 0n);
  return {
    template_id: index % 8,
    severity: 1 + Number(value % 4n),
    direction: 1 + Number((value >> 8n) % 16n),
    location: Number((value >> 16n) % 51n),
    block_length: 1 + Number((value >> 24n) % 6n),
  };
}

function channelState(family, seed, sensor, input, clean, previous, position) {
  const random = eventKey(seed, BigInt(sensor), BigInt(input), BigInt(clean),
    BigInt(previous), BigInt(position));
  const draw = Number(random % 100n);
  const rate = 4 + 5 * family.severity + 2 * sensor;
  let delta = 0;
  if (family.template_id === 0) {
    if (draw < rate) delta = 1 + Number((random >> 9n) % 16n);
  } else if (family.template_id === 1) {
    if (draw < rate) delta = mod17(family.direction * (1 + clean % 3));
  } else if (family.template_id === 2) {
    if (draw < rate + (input % 4) * 3)
      delta = mod17(family.direction + input + sensor);
  } else if (family.template_id === 3) {
    if (previous < MODULUS && previous !== 0 && draw < 65) delta = previous;
    else if (draw < rate) delta = 1 + Number((random >> 13n) % 16n);
  } else if (family.template_id === 4) {
    if (draw < rate) return MODULUS;
  } else if (family.template_id === 5) {
    if (draw < rate + (input % 3) * 4) return MODULUS;
  } else if (family.template_id === 6) {
    if (draw < rate + (clean % 4) * 3) return MODULUS;
  } else {
    const distance = (position + 51 - family.location) % 51;
    if (distance < family.block_length ||
        (previous === MODULUS && draw < 60)) return MODULUS;
  }
  return delta;
}

function generatedObservations({ episodeNonce, orderSlot, truthClass,
  corruptionIndex, corruptionSeed = DEVELOPMENT_CORRUPTION_SEED,
  orderSeed = DEVELOPMENT_ORDER_SEED }) {
  const order = Array.from({ length: 51 }, (_, index) => index);
  for (let index = order.length - 1; index > 0; --index) {
    const selected = Number(eventKey(orderSeed, BigInt(orderSlot),
      BigInt(index), 2n, 0n, 0n) % BigInt(index + 1));
    [order[index], order[selected]] = [order[selected], order[index]];
  }
  const family = corruptionFamily(corruptionIndex, corruptionSeed);
  const table = R56_UNIVERSE.semantic[truthClass].truth_table;
  const observations = [];
  const cleanValues = [];
  let previous = 0;
  const channelSeed = corruptionSeed ^ mix64(BigInt(episodeNonce));
  for (let position = 0; position < OBSERVATIONS; ++position) {
    const cell = order[position];
    const sensor = Math.floor(cell / MODULUS);
    const input = cell % MODULUS;
    const clean = table[input];
    const state = channelState(family, channelSeed, sensor, input, clean,
      previous, position);
    observations.push({ input, sensor, observed: state === MODULUS ? 0 :
      mod17(clean + state), missing: state === MODULUS });
    cleanValues.push(clean);
    previous = state;
  }
  return { observations, cleanValues, family };
}

function generateEpisodeContent(program, mechanism, repeat, truthClass,
  corruptionIndex, episodeNonce, orderSlot, {
    lane = "development",
    corruptionSeed = DEVELOPMENT_CORRUPTION_SEED,
    orderSeed = DEVELOPMENT_ORDER_SEED,
  } = {}) {
  const generated = generatedObservations({ episodeNonce, orderSlot,
    truthClass, corruptionIndex, corruptionSeed, orderSeed });
  const semantic = R56_UNIVERSE.semantic[truthClass];
  return {
    public: { observations: generated.observations },
    evaluator: {
      ast: { kind: "compose", tokens: [...semantic.tokens] },
      behavior: { field: "GF(17)", truth_table: [...semantic.truth_table] },
      episode_spec: {
        lane,
        program_index: program,
        mechanism_index: mechanism,
        repeat_index: repeat,
        truth_class: truthClass,
        corruption_index: corruptionIndex,
        episode_nonce: episodeNonce,
        order_slot: orderSlot,
        corruption_family: generated.family,
        clean_values: generated.cleanValues,
      },
      atoms: semantic.tokens.map(token => `primitive-${token}`),
      typed_subtrees: ["GF(17)->GF(17)"],
    },
  };
}

export function replayR56Episode(recipe) {
  assert.equal(recipe.seed_binding.root_seed, R56_ROOT_SEED);
  const [lane, program, mechanism, repeat, truthClass, corruptionIndex,
    episodeNonce, orderSlot] = recipe.seed_binding.derivation_path;
  assert.equal(lane, "development");
  return generateEpisodeContent(program, mechanism, repeat, truthClass,
    corruptionIndex, episodeNonce, orderSlot);
}

export function replayR56CalibrationCoverage(recipe) {
  assert.equal(recipe.seed_binding.root_seed, "56cb120056cb1300");
  const [lane, family, draw, truthClass, corruptionIndex, episodeNonce,
    orderSlot] = recipe.seed_binding.derivation_path;
  assert.equal(lane, "calibration-coverage");
  assert.equal(episodeNonce, family * CALIBRATION_DRAWS + draw);
  assert.equal(corruptionIndex,
    draw + CALIBRATION_DRAWS * (family + 1000));
  assert.equal(orderSlot, (family + draw) % MECHANISMS);
  return generateEpisodeContent(family, draw, draw, truthClass,
    corruptionIndex, episodeNonce, orderSlot, {
      lane,
      corruptionSeed: COVERAGE_CORRUPTION_SEED,
      orderSeed: COVERAGE_ORDER_SEED,
    });
}

const PROGRAM_GENERATOR_SHA256 = canonicalDigest("generator-source", [
  mod17, applyPrimitive, programTable, buildUniverse, sourceProgram,
].map(replayFunctionDigest));
const INPUT_GENERATOR_SHA256 = canonicalDigest("input-generator-source", [
  mix64, eventKey, corruptionFamily, channelState, generatedObservations,
  generateEpisodeContent,
].map(replayFunctionDigest));
const REPLAY_FUNCTION_SHA256 = replayFunctionDigest(replayR56Episode);
const CALIBRATION_REPLAY_FUNCTION_SHA256 = replayFunctionDigest(
  replayR56CalibrationCoverage);

export function selectSemanticSplits() {
  const used = new Set();
  for (let index = 0; index < 256; ++index) {
    const tokens = sourceProgram(index);
    const syntax = (tokens[0] * 8 + tokens[1]) * 8 + tokens[2];
    used.add(R56_UNIVERSE.syntax_to_semantic[syntax]);
  }
  const source = [...used].sort((left, right) => left - right);
  let rejections = 0;
  const select = (seed, desired, lower, upper) => {
    const selected = [];
    for (let counter = 0; selected.length < desired; ++counter) {
      assert.ok(counter < 1_000_000);
      const width = BigInt(upper - lower + 1);
      const semantic = lower + Number(eventKey(seed, BigInt(counter), 56n,
        2n, 0n, 0n) % width);
      if (used.has(semantic)) {
        rejections += 1;
      } else {
        used.add(semantic);
        selected.push(semantic);
      }
    }
    return selected;
  };
  const fit = select(0x56ca1100n, 16, 64, 426);
  const coverage = select(0x56cb1100n, 99, 64, 426);
  const anchors = [165, 48, 107, 418, 127, 417, 391, 407];
  const development = anchors.map(anchor => {
    if (used.has(anchor)) {
      rejections += 1;
      throw new Error(`development class ${anchor} crosses an earlier split`);
    }
    used.add(anchor);
    return anchor;
  });
  const sealed = Array.from({ length: 427 }, (_, index) => index)
    .filter(index => !used.has(index));
  return { source, fit, coverage, development, sealed, rejections };
}

function calibrationCoverageRecipe(family, draw, truthClass) {
  const episodeNonce = family * CALIBRATION_DRAWS + draw;
  const corruptionIndex = draw + CALIBRATION_DRAWS * (family + 1000);
  const orderSlot = (family + draw) % MECHANISMS;
  return {
    schema: "zero.reasoner5_replay_recipe.v1",
    generator_sha256: PROGRAM_GENERATOR_SHA256,
    input_generator_sha256: INPUT_GENERATOR_SHA256,
    replay_function_sha256: CALIBRATION_REPLAY_FUNCTION_SHA256,
    seed_binding: {
      root_seed: "56cb120056cb1300",
      derivation_path: ["calibration-coverage", family, draw, truthClass,
        corruptionIndex, episodeNonce, orderSlot],
    },
  };
}

function updateFNV64(hash, bytes) {
  let value = hash;
  for (const byte of bytes) {
    value ^= BigInt(byte);
    value = (value * 1099511628211n) & MASK64;
  }
  return value;
}

function u64Hex(value) {
  return value.toString(16).padStart(16, "0");
}

function parseR56Artifact(artifactBytes, expected = {}) {
  const bytes = Buffer.from(artifactBytes);
  assert.equal(bytes.length, ARTIFACT_SERIALIZED_BYTES,
    "Reasoner 5.6 artifact length changed");
  if (expected.bytes !== undefined)
    assert.equal(bytes.length, expected.bytes,
      "Reasoner 5.6 manifest artifact length changed");
  if (expected.sha256 !== undefined)
    assert.equal(sha256(bytes), expected.sha256,
      "Reasoner 5.6 artifact SHA-256 changed");
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "R56ART1\0");
  if (expected.schema !== undefined)
    assert.equal(expected.schema, "R56ART1",
      "Reasoner 5.6 artifact schema changed");
  let cursor = 8;
  const readU32 = () => {
    const value = bytes.readUInt32LE(cursor);
    cursor += 4;
    return value;
  };
  const readI32 = () => {
    const value = bytes.readInt32LE(cursor);
    cursor += 4;
    return value;
  };
  const readU64 = () => {
    const value = bytes.readBigUInt64LE(cursor);
    cursor += 8;
    return value;
  };
  const readU32Array = count => Array.from({ length: count }, readU32);
  const readI32Array = count => Array.from({ length: count }, readI32);
  const skipU32 = count => { cursor += count * 4; };
  const version = readU32();
  assert.equal(version, 1);
  assert.deepEqual(Array.from({ length: 8 }, readU32),
    [17, 8, 3, 512, 427, 3, 18, 32]);
  const sourceSeed = readU64();
  const corruptionSeed = readU64();
  const sourceProgramDigest = readU64();
  const corruptionGeneratorDigest = readU64();
  const calibrationFitDigest = readU64();
  const calibrationCoverageDigest = readU64();
  const sourcePrograms = readU32();
  const sourceSamples = readU32();
  const calibrationFitEpisodes = readU32();
  const calibrationCoverageEpisodes = readU32();
  const temperatureIndex = readU32();
  const temperatureQ20 = readI32();
  const conformalMassQ20 = readI32();
  const classPrior = readU32Array(427);
  const classLogQ20 = readI32Array(427);

  const localExactSupport = readU32Array(3 * 17 * 17);
  skipU32(3 * 17 * 17 * CHANNEL_STATES);
  const localExactLogQ20 = readI32Array(3 * 17 * 17 * CHANNEL_STATES);
  const localValueSupport = readU32Array(3 * 17);
  skipU32(3 * 17 * CHANNEL_STATES);
  const localValueLogQ20 = readI32Array(3 * 17 * CHANNEL_STATES);
  const localSensorSupport = readU32Array(3);
  skipU32(3 * CHANNEL_STATES);
  const localSensorLogQ20 = readI32Array(3 * CHANNEL_STATES);
  const localGlobalSupport = readU32();
  skipU32(CHANNEL_STATES);
  const localGlobalLogQ20 = readI32Array(CHANNEL_STATES);

  const initialSupport = readU32Array(3);
  skipU32(3 * CHANNEL_STATES);
  const initialLogQ20 = readI32Array(3 * CHANNEL_STATES);

  const transitionExactSupport = readU32Array(3 * 3 * CHANNEL_STATES);
  skipU32(3 * 3 * CHANNEL_STATES * CHANNEL_STATES);
  const transitionExactLogQ20 = readI32Array(
    3 * 3 * CHANNEL_STATES * CHANNEL_STATES);
  const transitionCurrentSupport = readU32Array(3 * CHANNEL_STATES);
  skipU32(3 * CHANNEL_STATES * CHANNEL_STATES);
  const transitionCurrentLogQ20 = readI32Array(
    3 * CHANNEL_STATES * CHANNEL_STATES);
  const transitionPreviousSupport = readU32Array(CHANNEL_STATES);
  skipU32(CHANNEL_STATES * CHANNEL_STATES);
  const transitionPreviousLogQ20 = readI32Array(
    CHANNEL_STATES * CHANNEL_STATES);
  const transitionGlobalSupport = readU32();
  skipU32(CHANNEL_STATES);
  const transitionGlobalLogQ20 = readI32Array(CHANNEL_STATES);
  assert.equal(cursor, bytes.length - 8,
    "Reasoner 5.6 artifact parser did not consume the payload");
  const embeddedDigest = readU64();
  const computedDigest = updateFNV64(
    1469598103934665603n ^ 5604n, bytes.subarray(0, bytes.length - 8));
  assert.equal(embeddedDigest, computedDigest,
    "Reasoner 5.6 artifact checksum changed");
  const nativeDigest = u64Hex(embeddedDigest);
  if (expected.native_digest !== undefined)
    assert.equal(nativeDigest, expected.native_digest,
      "Reasoner 5.6 native artifact digest changed");
  assert.ok(temperatureIndex < 6 && temperatureQ20 > 0);
  assert.ok(conformalMassQ20 > 0 && conformalMassQ20 <= Q20_ONE);
  assert.ok(classPrior.every(value => Number.isInteger(value)));
  return {
    version, sourceSeed, corruptionSeed, sourceProgramDigest,
    corruptionGeneratorDigest, calibrationFitDigest,
    calibrationCoverageDigest, sourcePrograms, sourceSamples,
    calibrationFitEpisodes, calibrationCoverageEpisodes, temperatureIndex,
    temperatureQ20, conformalMassQ20, classLogQ20, localExactSupport,
    localExactLogQ20, localValueSupport, localValueLogQ20,
    localSensorSupport, localSensorLogQ20, localGlobalSupport,
    localGlobalLogQ20, initialSupport, initialLogQ20,
    transitionExactSupport, transitionExactLogQ20,
    transitionCurrentSupport, transitionCurrentLogQ20,
    transitionPreviousSupport, transitionPreviousLogQ20,
    transitionGlobalSupport, transitionGlobalLogQ20,
    nativeDigest,
  };
}

function independentR56FullScores(artifact, observations) {
  assert.ok(Array.isArray(observations));
  assert.ok(observations.length > 0 && observations.length <= 51);
  return R56_UNIVERSE.semantic.map((semantic, semanticClass) => {
    let score = BigInt(artifact.classLogQ20[semanticClass]);
    let previousState = 0;
    let previousSensor = 0;
    for (const [position, observation] of observations.entries()) {
      assert.deepEqual(Object.keys(observation).sort(),
        ["input", "missing", "observed", "sensor"]);
      assert.ok(Number.isInteger(observation.input) &&
        observation.input >= 0 && observation.input < MODULUS);
      assert.ok(Number.isInteger(observation.sensor) &&
        observation.sensor >= 0 && observation.sensor < 3);
      assert.ok(Number.isInteger(observation.observed) &&
        observation.observed >= 0 && observation.observed < MODULUS);
      assert.equal(typeof observation.missing, "boolean");
      assert.ok(!observation.missing || observation.observed === 0);
      const candidateValue = semantic.truth_table[observation.input];
      const state = observation.missing ? MODULUS :
        mod17(observation.observed - candidateValue);
      const exactLocal = (observation.sensor * MODULUS + observation.input) *
        MODULUS + candidateValue;
      const valueLocal = observation.sensor * MODULUS + candidateValue;
      let localLog;
      if (artifact.localExactSupport[exactLocal] >= SUPPORT_MIN) {
        localLog = artifact.localExactLogQ20[
          exactLocal * CHANNEL_STATES + state];
      } else if (artifact.localValueSupport[valueLocal] >= SUPPORT_MIN) {
        localLog = artifact.localValueLogQ20[
          valueLocal * CHANNEL_STATES + state];
      } else if (artifact.localSensorSupport[observation.sensor] >=
          SUPPORT_MIN) {
        localLog = artifact.localSensorLogQ20[
          observation.sensor * CHANNEL_STATES + state];
      } else {
        assert.ok(artifact.localGlobalSupport > 0);
        localLog = artifact.localGlobalLogQ20[state];
      }
      score += BigInt(localLog);
      if (position === 0) {
        assert.ok(artifact.initialSupport[observation.sensor] > 0);
        score += BigInt(artifact.initialLogQ20[
          observation.sensor * CHANNEL_STATES + state]);
      } else {
        const exactTransition = (previousSensor * 3 + observation.sensor) *
          CHANNEL_STATES + previousState;
        const currentTransition = observation.sensor * CHANNEL_STATES +
          previousState;
        let transitionLog;
        if (artifact.transitionExactSupport[exactTransition] >= SUPPORT_MIN) {
          transitionLog = artifact.transitionExactLogQ20[
            exactTransition * CHANNEL_STATES + state];
        } else if (artifact.transitionCurrentSupport[currentTransition] >=
            SUPPORT_MIN) {
          transitionLog = artifact.transitionCurrentLogQ20[
            currentTransition * CHANNEL_STATES + state];
        } else if (artifact.transitionPreviousSupport[previousState] >=
            SUPPORT_MIN) {
          transitionLog = artifact.transitionPreviousLogQ20[
            previousState * CHANNEL_STATES + state];
        } else {
          assert.ok(artifact.transitionGlobalSupport > 0);
          transitionLog = artifact.transitionGlobalLogQ20[state];
        }
        score += BigInt(transitionLog);
      }
      previousState = state;
      previousSensor = observation.sensor;
    }
    return score * BigInt(Q20_ONE) / BigInt(artifact.temperatureQ20);
  });
}

function stableLogLossFromQ20Scores(scores, truthClass) {
  assert.equal(scores.length, R56_UNIVERSE.semantic.length);
  assert.ok(Number.isInteger(truthClass) && truthClass >= 0 &&
    truthClass < scores.length);
  const maximum = scores.reduce((left, right) => left > right ? left : right);
  let maximumTies = 0;
  let lowerTail = 0;
  for (const score of scores) {
    if (score === maximum) maximumTies += 1;
    else lowerTail += Math.exp(Number(score - maximum) / Q20_ONE);
  }
  assert.ok(maximumTies > 0 && Number.isFinite(lowerTail));
  return Number(maximum - scores[truthClass]) / Q20_ONE +
    Math.log(maximumTies) + Math.log1p(lowerTail / maximumTies);
}

function independentCandidateSet(scores, thresholdQ20) {
  assert.equal(scores.length, R56_UNIVERSE.semantic.length);
  assert.ok(Number.isInteger(thresholdQ20) && thresholdQ20 > 0 &&
    thresholdQ20 <= Q20_ONE);
  if (thresholdQ20 === Q20_ONE) {
    return new Set(scores.map((_, semanticClass) => semanticClass));
  }
  const maximum = scores.reduce((left, right) => left > right ? left : right);
  const weights = scores.map(score => Math.exp(
    Number(score - maximum) / Q20_ONE));
  const normalizer = weights.reduce((sum, value) => sum + value, 0);
  assert.ok(Number.isFinite(normalizer) && normalizer > 0);
  const order = scores.map((_, semanticClass) => semanticClass).sort(
    (left, right) => scores[left] > scores[right] ? -1 :
      scores[left] < scores[right] ? 1 : left - right);
  let cumulative = 0;
  let boundary = null;
  const included = new Set();
  for (const semanticClass of order) {
    if (boundary !== null && scores[semanticClass] < boundary) break;
    included.add(semanticClass);
    cumulative += weights[semanticClass] / normalizer;
    if (boundary === null && cumulative >= thresholdQ20 / Q20_ONE)
      boundary = scores[semanticClass];
  }
  return included;
}

function independentCoverageDraw(artifact, content, truthClass) {
  assert.ok(Number.isInteger(truthClass) && truthClass >= 0 &&
    truthClass < R56_UNIVERSE.semantic.length);
  const scores = independentR56FullScores(artifact,
    content.public.observations);
  const candidateSet = independentCandidateSet(scores,
    artifact.conformalMassQ20);
  const maximum = scores.reduce((left, right) => left > right ? left : right);
  const weights = scores.map(score => Math.exp(
    Number(score - maximum) / Q20_ONE));
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  const truthScore = scores[truthClass];
  const numerator = weights.reduce((sum, weight, semanticClass) =>
    sum + (scores[semanticClass] >= truthScore ? weight : 0), 0);
  const truthCumulativeMassQ20 = Math.min(Q20_ONE, Math.max(1,
    Math.ceil(numerator / denominator * Q20_ONE)));
  return {
    candidate_set_size: candidateSet.size,
    candidate_set_contains_truth: candidateSet.has(truthClass),
    truth_cumulative_mass_q20: truthCumulativeMassQ20,
    score_sha256: canonicalDigest("r56-independent-full-score-q20",
      scores.map(score => score.toString())),
  };
}

function calibrationCoverageNativeDigest(drawContents) {
  let digest = 1469598103934665603n ^ 5609n;
  for (const { content, truthClass } of drawContents) {
    const observations = content.public.observations;
    digest = updateFNV64(digest, [observations.length & 255,
      (observations.length >>> 8) & 255,
      (observations.length >>> 16) & 255,
      (observations.length >>> 24) & 255]);
    for (const observation of observations) {
      digest = updateFNV64(digest, [observation.input, observation.sensor,
        observation.observed, observation.missing ? 1 : 0]);
    }
    digest = updateFNV64(digest, [truthClass & 255,
      (truthClass >>> 8) & 255]);
  }
  return digest.toString(16).padStart(16, "0");
}

function buildCalibrationCoverageReceipt(splits, nativeResult,
  artifactBytes) {
  const nativeRecords = nativeResult.calibration_coverage_records;
  assert.ok(Array.isArray(nativeRecords));
  assert.equal(nativeRecords.length, CALIBRATION_COVERAGE_FAMILIES);
  const artifactSha256 = sha256(artifactBytes);
  const artifact = parseR56Artifact(artifactBytes, {
    sha256: artifactSha256,
    native_digest: nativeResult.artifact_digest,
  });
  assert.equal(artifact.conformalMassQ20, nativeResult.conformal_mass_q20,
    "native conformal threshold differs from the frozen artifact");
  const drawContents = [];
  const families = splits.coverage.map((truthClass, family) => {
    const native = nativeRecords[family];
    assert.deepEqual(Object.keys(native).sort(), [
      "all_draws_covered", "draws", "family_index", "semantic_class",
      "worst_truth_cumulative_mass_q20",
    ]);
    assert.equal(native.family_index, family);
    assert.equal(native.semantic_class, truthClass);
    assert.equal(native.draws, CALIBRATION_DRAWS);
    assert.ok(Number.isInteger(native.worst_truth_cumulative_mass_q20) &&
      native.worst_truth_cumulative_mass_q20 >= 1 &&
      native.worst_truth_cumulative_mass_q20 <= 1048576);
    assert.equal(typeof native.all_draws_covered, "boolean");
    const draws = Array.from({ length: CALIBRATION_DRAWS }, (_, draw) => {
      const recipe = calibrationCoverageRecipe(family, draw, truthClass);
      const content = replayR56CalibrationCoverage(recipe);
      drawContents.push({ content, truthClass });
      const coverage = independentCoverageDraw(artifact, content, truthClass);
      return {
        draw_index: draw,
        episode_id: `coverage-${canonicalDigest("r56-calibration-episode", {
          family, draw, truthClass,
        }).slice(0, 24)}`,
        seed_ref: canonicalDigest("episode-seed-reference", recipe),
        replay_recipe: recipe,
        content_sha256: canonicalDigest(
          "r56-calibration-coverage-content", content),
        ...coverage,
      };
    });
    const worstTruthCumulativeMassQ20 = Math.max(...draws.map(draw =>
      draw.truth_cumulative_mass_q20));
    const allDrawsCovered = draws.every(draw =>
      draw.candidate_set_contains_truth);
    assert.equal(native.worst_truth_cumulative_mass_q20,
      worstTruthCumulativeMassQ20,
      "native calibration mass differs from independent replay");
    assert.equal(native.all_draws_covered, allDrawsCovered,
      "native calibration coverage differs from independent replay");
    return {
      family_id: `calibration-coverage-program-${String(truthClass)
        .padStart(3, "0")}`,
      family_index: family,
      semantic_class: truthClass,
      worst_truth_cumulative_mass_q20: worstTruthCumulativeMassQ20,
      all_draws_covered: allDrawsCovered,
      draws,
    };
  });
  const nativeDigest = calibrationCoverageNativeDigest(drawContents);
  assert.equal(nativeDigest, nativeResult.calibration_coverage_digest);
  assert.equal(nativeDigest, u64Hex(artifact.calibrationCoverageDigest),
    "calibration draws differ from the digest inside the artifact");
  const body = {
    schema: "zero.reasoner56_calibration_coverage_receipt.v2",
    lane: "calibration-coverage",
    family_count: CALIBRATION_COVERAGE_FAMILIES,
    draws_per_family: CALIBRATION_DRAWS,
    episode_count: CALIBRATION_COVERAGE_FAMILIES * CALIBRATION_DRAWS,
    generator_sha256: PROGRAM_GENERATOR_SHA256,
    input_generator_sha256: INPUT_GENERATOR_SHA256,
    replay_function_sha256: CALIBRATION_REPLAY_FUNCTION_SHA256,
    artifact_sha256: artifactSha256,
    artifact_native_digest: artifact.nativeDigest,
    conformal_mass_q20: artifact.conformalMassQ20,
    candidate_set_rule: artifact.conformalMassQ20 === Q20_ONE ?
      "exact-full-universe-at-threshold-one" :
      "stable-score-order-with-complete-boundary-ties",
    native_calibration_coverage_digest: nativeDigest,
    families,
  };
  return { ...body, receipt_sha256: canonicalDigest(
    "r56-calibration-coverage-receipt", body) };
}

export function assertR56CalibrationCoverageReplay(manifest, artifactBytes) {
  const receipt = manifest.calibration_coverage_receipt;
  assert.ok(receipt && typeof receipt === "object");
  assert.deepEqual(Object.keys(receipt).sort(), [
    "artifact_native_digest", "artifact_sha256", "candidate_set_rule",
    "conformal_mass_q20", "draws_per_family", "episode_count", "families",
    "family_count", "generator_sha256", "input_generator_sha256", "lane",
    "native_calibration_coverage_digest", "receipt_sha256",
    "replay_function_sha256", "schema",
  ]);
  const body = structuredClone(receipt);
  delete body.receipt_sha256;
  assert.equal(receipt.receipt_sha256, canonicalDigest(
    "r56-calibration-coverage-receipt", body));
  assert.equal(receipt.schema,
    "zero.reasoner56_calibration_coverage_receipt.v2");
  assert.equal(receipt.lane, "calibration-coverage");
  assert.equal(receipt.family_count, CALIBRATION_COVERAGE_FAMILIES);
  assert.equal(receipt.draws_per_family, CALIBRATION_DRAWS);
  assert.equal(receipt.episode_count,
    CALIBRATION_COVERAGE_FAMILIES * CALIBRATION_DRAWS);
  assert.equal(receipt.generator_sha256, PROGRAM_GENERATOR_SHA256);
  assert.equal(receipt.input_generator_sha256, INPUT_GENERATOR_SHA256);
  assert.equal(receipt.replay_function_sha256,
    CALIBRATION_REPLAY_FUNCTION_SHA256);
  assert.equal(receipt.artifact_sha256, manifest.source_artifact.sha256);
  assert.equal(receipt.artifact_native_digest,
    manifest.source_artifact.native_digest);
  const artifact = parseR56Artifact(artifactBytes, manifest.source_artifact);
  assert.equal(receipt.artifact_sha256, sha256(artifactBytes));
  assert.equal(receipt.artifact_native_digest, artifact.nativeDigest);
  assert.equal(receipt.conformal_mass_q20, artifact.conformalMassQ20);
  assert.equal(receipt.candidate_set_rule,
    artifact.conformalMassQ20 === Q20_ONE ?
      "exact-full-universe-at-threshold-one" :
      "stable-score-order-with-complete-boundary-ties");
  assert.equal(receipt.families.length, CALIBRATION_COVERAGE_FAMILIES);
  const expectedClasses = selectSemanticSplits().coverage;
  const knownFamilies = new Map(manifest.families.map(family =>
    [family.family_id, family]));
  const seenEpisodes = new Set();
  const drawContents = [];
  let covered = 0;
  for (const [familyIndex, family] of receipt.families.entries()) {
    assert.deepEqual(Object.keys(family).sort(), [
      "all_draws_covered", "draws", "family_id", "family_index",
      "semantic_class", "worst_truth_cumulative_mass_q20",
    ]);
    assert.equal(family.family_index, familyIndex);
    assert.equal(family.semantic_class, expectedClasses[familyIndex]);
    assert.equal(family.family_id,
      `calibration-coverage-program-${String(family.semantic_class)
        .padStart(3, "0")}`);
    assert.equal(knownFamilies.get(family.family_id)?.lane, "calibration");
    assert.equal(knownFamilies.get(family.family_id)?.family_spec
      ?.semantic_class, family.semantic_class);
    assert.ok(Number.isInteger(family.worst_truth_cumulative_mass_q20) &&
      family.worst_truth_cumulative_mass_q20 >= 1 &&
      family.worst_truth_cumulative_mass_q20 <= 1048576);
    assert.equal(typeof family.all_draws_covered, "boolean");
    assert.equal(family.draws.length, CALIBRATION_DRAWS);
    const replayedDraws = [];
    for (const [drawIndex, draw] of family.draws.entries()) {
      assert.deepEqual(Object.keys(draw).sort(), [
        "candidate_set_contains_truth", "candidate_set_size",
        "content_sha256", "draw_index", "episode_id", "replay_recipe",
        "score_sha256", "seed_ref", "truth_cumulative_mass_q20",
      ]);
      assert.equal(draw.draw_index, drawIndex);
      assert.ok(!seenEpisodes.has(draw.episode_id));
      seenEpisodes.add(draw.episode_id);
      const expectedRecipe = calibrationCoverageRecipe(familyIndex,
        drawIndex, family.semantic_class);
      assert.deepEqual(draw.replay_recipe, expectedRecipe);
      assert.equal(draw.seed_ref, canonicalDigest("episode-seed-reference",
        expectedRecipe));
      const content = replayR56CalibrationCoverage(expectedRecipe);
      assert.equal(draw.content_sha256, canonicalDigest(
        "r56-calibration-coverage-content", content),
      "calibration coverage content digest changed");
      const replayed = independentCoverageDraw(artifact, content,
        family.semantic_class);
      assert.deepEqual({
        candidate_set_size: draw.candidate_set_size,
        candidate_set_contains_truth: draw.candidate_set_contains_truth,
        truth_cumulative_mass_q20: draw.truth_cumulative_mass_q20,
        score_sha256: draw.score_sha256,
      }, replayed, "calibration coverage outcome changed");
      replayedDraws.push(replayed);
      drawContents.push({ content, truthClass: family.semantic_class });
    }
    const replayedWorst = Math.max(...replayedDraws.map(draw =>
      draw.truth_cumulative_mass_q20));
    const replayedCovered = replayedDraws.every(draw =>
      draw.candidate_set_contains_truth);
    assert.equal(family.worst_truth_cumulative_mass_q20, replayedWorst,
      "calibration family worst mass changed");
    assert.equal(family.all_draws_covered, replayedCovered,
      "calibration family coverage changed");
    covered += replayedCovered ? 1 : 0;
  }
  const nativeDigest = calibrationCoverageNativeDigest(drawContents);
  assert.equal(nativeDigest, receipt.native_calibration_coverage_digest);
  assert.equal(nativeDigest, u64Hex(artifact.calibrationCoverageDigest),
    "replayed calibration draws differ from the artifact digest");
  return {
    families: receipt.families.length,
    episodes: seenEpisodes.size,
    covered,
    native_calibration_coverage_digest: nativeDigest,
    receipt_sha256: receipt.receipt_sha256,
  };
}

function programFamilySpec(semanticClass) {
  return {
    axis: "program",
    domain: "GF(17)",
    semantic_class: semanticClass,
    behavior: [...R56_UNIVERSE.semantic[semanticClass].truth_table],
  };
}

function registerProgramFamilies(state, lane, classes, prefix, shiftStratum) {
  for (const [index, semanticClass] of classes.entries()) {
    registerFamily(state, {
      family_id: prefix === "program" ? `program-${index}` :
        `${prefix}-${String(semanticClass).padStart(3, "0")}`,
      lane,
      generator_id: "r56-gf17-v2",
      shift_stratum: shiftStratum,
      family_spec: programFamilySpec(semanticClass),
    });
  }
}

function parityBundle(publicView, evaluatorView, artifactSha256) {
  const common = {
    candidates: R56_CANDIDATES,
    grammar: {
      domain: "GF(17)", depth: 3, primitives: 8,
      syntax_programs: 512, semantic_classes: 427,
      source_artifact_sha256: artifactSha256,
    },
    initial_evidence: publicView.observations,
    allowed_actions: [],
    latent_episode: evaluatorView.episode_spec,
    potential_response: { mode: "passive-fixed-evidence", additional_reads: 0 },
    verifier: { algorithm: "exhaustive-GF17-truth-table-v1", points: 17 },
    caps: { proposal_budget: PROPOSAL_BUDGET, global_cap: GLOBAL_CAP,
      passive_observations: OBSERVATIONS },
  };
  const first = armParityReceipt({ arm: R56_EXPECTED_ARMS[0], ...common });
  const receipts = [first, ...R56_EXPECTED_ARMS.slice(1).map(arm => {
    const body = { ...first, arm };
    delete body.receipt_sha256;
    return { ...body, receipt_sha256: canonicalDigest("arm-parity-receipt", body) };
  })];
  return {
    expected_arms: [...R56_EXPECTED_ARMS],
    arm_parity_receipts: receipts,
    ranker_policy: {
      schema: "zero.reasoner5_ranker_policy.v1",
      leaf_whitelist: [
        "observations[].input", "observations[].sensor",
        "observations[].observed", "observations[].missing",
      ],
      leaf_contracts: {
        "observations[].input": { type: "integer", provenance: "generated-query" },
        "observations[].sensor": { type: "integer", provenance: "public-constant" },
        "observations[].observed": { type: "integer", provenance: "observed-response" },
        "observations[].missing": { type: "boolean", provenance: "public-mask" },
      },
    },
    trace_binding: {
      candidate_universe_digest: canonicalDigest("candidate-universe",
        first.candidate_multiset),
      grammar_digest: first.grammar_sha256,
      initial_evidence_digest: first.initial_evidence_sha256,
      allowed_actions_digest: first.allowed_actions_sha256,
      latent_episode_digest: first.latent_episode_sha256,
      potential_response_digest: first.potential_response_sha256,
      verifier_digest: first.verifier_sha256,
      caps_digest: first.caps_sha256,
    },
  };
}

export function reconstructR56Result(rows) {
  const arms = [...new Set(rows.map(row => row.arm))].sort();
  const armSummaries = Object.fromEntries(arms.map(arm => {
    const selected = rows.filter(row => row.arm === arm);
    return [arm, {
      rows: selected.length,
      mean_primary_cost: selected.reduce((sum, row) =>
        sum + row.primary_cost, 0) / selected.length,
      fallback_rate: selected.filter(row => row.fallback_started).length /
        selected.length,
      source_artifact_reads: selected.reduce((sum, row) =>
        sum + row.source_artifact_reads, 0),
    }];
  }));
  return {
    status: "development-only",
    scientific_decision: null,
    sealed_execution_authorized: false,
    development_gate_only: true,
    episodes: new Set(rows.map(row => row.episode_id)).size,
    trace_rows: rows.length,
    exact_rows: rows.filter(row => row.exact && row.certificate_valid).length,
    arm_summaries: armSummaries,
  };
}

function analysisContract() {
  const comparison = (fullArm, comparatorArm, direction, seed) => ({
    full_arm: fullArm,
    comparator_arm: comparatorArm,
    unit_fields: ["family_id", "cross_family_id"],
    design: "two-way",
    direction,
    seed,
    replicates: R56_ANALYSIS_SETTINGS.bootstrap_replicates,
    alpha: direction === "lower" ? 0.01 : 0.05,
    environment_field: null,
    row_field: "family_id",
    column_field: "cross_family_id",
  });
  return {
    schema: "zero.reasoner5_analysis_contract.v1",
    expected_arms: [...R56_EXPECTED_ARMS],
    selected_lanes: ["development"],
    source_isolated_arms: ["target_only", "source_free", "source_ablation"],
    primary_cost_rule: "verified-search",
    analysis_settings_sha256: canonicalDigest("analysis-settings",
      R56_ANALYSIS_SETTINGS),
    analysis_function_sha256: analysisFunctionDigest(reconstructR56Result),
    common_gate_registration: {
      primary_alpha: 0.01,
      primary_strata: ["primary-id"],
      formal_mechanisms: ["one-trim", "markov-off"],
      crossed_design: true,
      marginal_axes: ["program_family", "corruption_family"],
      derangements: 31,
      mechanism_family_alpha: 0.05,
      factorial_interaction_required: false,
    },
    trace_schema: "zero.reasoner5_trace_row.v1",
    primary_analysis: comparison("full", "robust_hamming", "lower",
      "5600000000005601"),
    stratum_analyses: [{
      name: "primary-id",
      field: "shift_stratum",
      values: ["primary-id-development"],
      ...comparison("full", "robust_hamming", "lower", "5600000000005602"),
      alpha: 0.05,
    }],
    mechanism_analyses: [{
      name: "one-trim",
      ...comparison("one_trim", "full", "higher", "5600000000005603"),
    }, {
      name: "markov-off",
      ...comparison("markov_off", "full", "higher", "5600000000005604"),
    }],
    factorial_analysis: null,
    derangement_analysis: {
      observed_arm: "full",
      reference_arms: [...R56_DERANGEMENT_ARMS],
      unit_fields: ["family_id", "cross_family_id"],
    },
    source_ablation: {
      ablation_arm: "source_ablation",
      source_free_arm: "source_free",
    },
    headroom: { comparator_arm: "target_only", median_primary_cost_min: 16 },
  };
}

function categoricalModel(training, feature, classCount) {
  const global = Array(classCount).fill(0);
  const cells = new Map();
  for (const item of training) {
    global[item.label] += 1;
    const key = feature(item);
    if (!cells.has(key)) cells.set(key, Array(classCount).fill(0));
    cells.get(key)[item.label] += 1;
  }
  return item => {
    const counts = cells.get(feature(item)) ?? global;
    let best = 0;
    for (let index = 1; index < counts.length; ++index)
      if (counts[index] > counts[best]) best = index;
    return best;
  };
}

function balancedAccuracy(items, predict, classCount) {
  const correct = Array(classCount).fill(0);
  const total = Array(classCount).fill(0);
  for (const item of items) {
    total[item.label] += 1;
    if (predict(item) === item.label) correct[item.label] += 1;
  }
  assert.ok(total.every(value => value > 0));
  return correct.reduce((sum, value, index) => sum + value / total[index], 0) /
    classCount;
}

function proxyClassification(items, labelName, classCount) {
  const labelled = items.map(item => ({ ...item, label: item[labelName] }));
  const training = labelled.filter(item => item.repeat === 0);
  const testing = labelled.filter(item => item.repeat === 1);
  const baseline = balancedAccuracy(testing,
    categoricalModel(training, item => item.sensor, classCount), classCount);
  const augmented = balancedAccuracy(testing, categoricalModel(training,
    item => `${item.order}|${item.episode_id}|${item.seed_ref}`, classCount),
  classCount);
  const cells = new Map();
  for (const item of labelled) {
    if (!cells.has(item.order)) cells.set(item.order,
      Array(classCount).fill(0));
    cells.get(item.order)[item.label] += 1;
  }
  return {
    training_episodes: training.length,
    evaluation_episodes: testing.length,
    sensor_only_balanced_accuracy: baseline,
    augmented_static_balanced_accuracy: augmented,
    accuracy_delta: augmented - baseline,
    nonopaque_static_cells: cells.size,
    maximum_hidden_label_fraction_per_nonopaque_cell: Math.max(
      ...[...cells.values()].map(counts => Math.max(...counts) /
        counts.reduce((sum, value) => sum + value, 0))),
  };
}

export function auditR56ProxyTaint(manifest, rawRows, nativeResult) {
  const items = manifest.episodes.map(episode => {
    const observations = episode.content.public.observations;
    const family = episode.content.evaluator.episode_spec.corruption_family;
    return {
      template_label: Number(episode.cross_family_id.split("-").at(-1)),
      severity_label: family.severity - 1,
      repeat: Number(episode.nested_repeat_id.split("-").at(-1)),
      sensor: observations.map(item => item.sensor).join(""),
      order: observations.map(item => `${item.input}:${item.sensor}`).join(","),
      episode_id: episode.episode_id,
      seed_ref: episode.seed_ref,
    };
  });
  assert.ok(items.every(item => Number.isInteger(item.template_label) &&
    item.template_label >= 0 && item.template_label < MECHANISMS &&
    Number.isInteger(item.severity_label) && item.severity_label >= 0 &&
    item.severity_label < 4 && [0, 1].includes(item.repeat)));
  const template = proxyClassification(items, "template_label", MECHANISMS);
  const severity = proxyClassification(items, "severity_label", 4);
  const sourceRows = rawRows.filter(row => ["source_free",
    "source_ablation"].includes(row.arm));
  const taintPassed = sourceRows.every(row => row.source_artifact_reads === 0) &&
    nativeResult.taint_audit_passed === true;
  const body = {
    schema: "zero.reasoner56_proxy_taint_audit.v1",
    classifier: "frozen categorical multinomial lookup with global fallback",
    split: "repeat-0 training and repeat-1 evaluation",
    hidden_labels: ["corruption-template", "severity"],
    training_episodes: template.training_episodes,
    evaluation_episodes: template.evaluation_episodes,
    sensor_only_balanced_accuracy: template.sensor_only_balanced_accuracy,
    augmented_static_balanced_accuracy:
      template.augmented_static_balanced_accuracy,
    accuracy_delta: template.accuracy_delta,
    template,
    severity,
    registered_maximum_delta: 0.02,
    nonopaque_static_cells: template.nonopaque_static_cells,
    maximum_template_fraction_per_nonopaque_cell:
      template.maximum_hidden_label_fraction_per_nonopaque_cell,
    maximum_severity_fraction_per_nonopaque_cell:
      severity.maximum_hidden_label_fraction_per_nonopaque_cell,
    source_isolated_rows: sourceRows.length,
    source_isolation_taint_passed: taintPassed,
    native_proxy_audit_passed: nativeResult.proxy_audit_passed === true,
  };
  const passed = template.accuracy_delta <=
      body.registered_maximum_delta + 1e-15 &&
    severity.accuracy_delta <= body.registered_maximum_delta + 1e-15 &&
    template.maximum_hidden_label_fraction_per_nonopaque_cell < 1 &&
    severity.maximum_hidden_label_fraction_per_nonopaque_cell < 1 &&
    taintPassed &&
    body.native_proxy_audit_passed;
  return { ...body, passed,
    audit_sha256: canonicalDigest("reasoner56-proxy-taint-audit", body) };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function programFamilyValues(rows, arm, value) {
  const grouped = new Map();
  for (const row of rows.filter(item => item.arm === arm)) {
    if (!grouped.has(row.program_family_id))
      grouped.set(row.program_family_id, []);
    grouped.get(row.program_family_id).push(value(row));
  }
  return new Map([...grouped].map(([family, values]) => [family, mean(values)]));
}

function pairedUpperInterval(left, right, seed) {
  const families = [...left.keys()].sort();
  assert.deepEqual(families, [...right.keys()].sort());
  const differences = families.map(family => left.get(family) - right.get(family));
  const rng = createDeterministicRng(seed, "r56-readiness-bootstrap");
  const samples = [];
  for (let replicate = 0; replicate < 4096; ++replicate) {
    let total = 0;
    for (let draw = 0; draw < differences.length; ++draw)
      total += differences[rng.index(differences.length)];
    samples.push(total / differences.length);
  }
  samples.sort((a, b) => a - b);
  return {
    family_mean_difference: mean(differences),
    one_sided_95_upper_difference: samples[Math.ceil(0.95 * samples.length) - 1],
    program_families: families.length,
    bootstrap_replicates: samples.length,
    bootstrap_sha256: canonicalDigest("r56-readiness-bootstrap", samples),
  };
}

export function assessR56ChannelReadiness(nativeRows, proxyTaintAudit,
  manifest, artifactBytes) {
  const full = nativeRows.filter(row => row.arm === "full");
  const prior = nativeRows.filter(row => row.arm === "program_prior_only");
  assert.equal(full.length, 128);
  assert.equal(prior.length, 128);
  const calibrationReplay = assertR56CalibrationCoverageReplay(manifest,
    artifactBytes);
  const calibrationCoverageReceipt = manifest.calibration_coverage_receipt;
  const sealedInterfaceAndProxyAuditPassed = false;
  assert.equal(calibrationCoverageReceipt?.schema,
    "zero.reasoner56_calibration_coverage_receipt.v2");
  assert.equal(calibrationCoverageReceipt.families.length,
    CALIBRATION_COVERAGE_FAMILIES);
  assert.equal(calibrationReplay.episodes,
    CALIBRATION_COVERAGE_FAMILIES * CALIBRATION_DRAWS);
  const logClassCount = Math.log(R56_UNIVERSE.semantic.length);
  const naturalLoss = row => {
    assert.ok(Number.isFinite(row.normalized_log_loss) &&
      row.normalized_log_loss >= 0);
    return row.normalized_log_loss * logClassCount;
  };
  const artifact = parseR56Artifact(artifactBytes, manifest.source_artifact);
  const episodes = new Map(manifest.episodes.map(episode => {
    const spec = episode.content.evaluator.episode_spec;
    return [`${spec.program_index}:${spec.mechanism_index}:${spec.repeat_index}`,
      episode];
  }));
  const fullReplay = full.map(row => {
    const program = Number(row.program_family_id.split("-").at(-1));
    const episode = episodes.get(
      `${program}:${row.mechanism_id}:${row.parameter_draw}`);
    assert.ok(episode, `missing full-arm episode ${row.episode_id}`);
    const truthClass = episode.content.evaluator.episode_spec.truth_class;
    assert.equal(row.truth_class, truthClass);
    const replayed = stableLogLossFromQ20Scores(
      independentR56FullScores(artifact, episode.content.public.observations),
      truthClass);
    const emitted = naturalLoss(row);
    assert.ok(replayed >= 0 && Number.isFinite(replayed));
    if (replayed > 0) assert.ok(emitted > 0,
      `rounded-zero full-arm log loss for ${row.episode_id}`);
    const scale = Math.max(replayed, emitted, Number.MIN_VALUE);
    assert.ok(Math.abs(replayed - emitted) / scale <= 1e-12,
      `full-arm log-loss replay differs for ${row.episode_id}`);
    return { episode_id: row.episode_id, emitted, replayed };
  }).sort((left, right) => left.episode_id.localeCompare(right.episode_id));
  const fullReplayByEpisode = new Map(fullReplay.map(item =>
    [item.episode_id, item.replayed]));
  const fullLoss = row => fullReplayByEpisode.get(row.episode_id);
  const fullFamilies = programFamilyValues(nativeRows, "full", fullLoss);
  const priorFamilies = programFamilyValues(nativeRows, "program_prior_only",
    naturalLoss);
  const uniformFamilies = new Map([...fullFamilies.keys()].map(family =>
    [family, Math.log(427)]));
  const derangementMeans = R56_DERANGEMENT_ARMS.map(arm => ({
    arm,
    mean: mean(nativeRows.filter(row => row.arm === arm).map(naturalLoss)),
  })).sort((left, right) => left.mean - right.mean ||
    left.arm.localeCompare(right.arm));
  const medianDerangement = derangementMeans[15];
  const medianDerangementFamilies = programFamilyValues(nativeRows,
    medianDerangement.arm, naturalLoss);
  const fullCandidateSizes = programFamilyValues(nativeRows, "full",
    row => row.candidate_set_size);
  const priorCandidateSizes = programFamilyValues(nativeRows,
    "program_prior_only", row => row.candidate_set_size);
  const fullCandidateMean = mean([...fullCandidateSizes.values()]);
  const priorCandidateMean = mean([...priorCandidateSizes.values()]);
  const covered = calibrationReplay.covered;
  const coverageFamilies = calibrationReplay.families;
  const reliabilityBins = Array.from({ length: 10 }, (_, bin) => {
    const selected = full.filter(row => Math.min(9,
      Math.floor(row.truth_probability * 10)) === bin);
    return {
      lower: bin / 10,
      upper: (bin + 1) / 10,
      count: selected.length,
      mean_truth_probability: selected.length ?
        mean(selected.map(row => row.truth_probability)) : null,
      top_one_rate: selected.length ?
        selected.filter(row => row.top_one_truth).length / selected.length : null,
    };
  });
  const backoff = {
    local: Array.from({ length: 4 }, (_, index) => full.reduce((sum, row) =>
      sum + row.local_backoff_counts[index], 0)),
    transition: Array.from({ length: 4 }, (_, index) => full.reduce((sum, row) =>
      sum + row.transition_backoff_counts[index], 0)),
  };
  const worstMechanism = Array.from({ length: 8 }, (_, mechanism) => {
    const selected = full.filter(row => row.mechanism_id === mechanism);
    return {
      mechanism,
      mean_primary_cost: mean(selected.map(row => row.primary_cost)),
      maximum_primary_cost: Math.max(...selected.map(row => row.primary_cost)),
    };
  }).sort((left, right) => right.mean_primary_cost - left.mean_primary_cost)[0];
  const comparisons = {
    uniform: pairedUpperInterval(fullFamilies, uniformFamilies,
      "5600000000005611"),
    program_prior_only: pairedUpperInterval(fullFamilies, priorFamilies,
      "5600000000005612"),
    derangement_median: {
      reference_arm: medianDerangement.arm,
      reference_mean_log_loss: medianDerangement.mean,
      ...pairedUpperInterval(fullFamilies, medianDerangementFamilies,
        "5600000000005613"),
    },
  };
  const checks = {
    normalized_every_candidate_set: nativeRows.every(row =>
      Math.abs(row.probability_sum - 1) <= 1e-12),
    log_loss_below_uniform: comparisons.uniform
      .one_sided_95_upper_difference < 0,
    log_loss_below_program_prior_only: comparisons.program_prior_only
      .one_sided_95_upper_difference < 0,
    log_loss_below_derangement_median: comparisons.derangement_median
      .one_sided_95_upper_difference < 0,
    candidate_set_size_ratio_at_matched_coverage:
      fullCandidateMean / priorCandidateMean <= 0.8,
    candidate_set_coverage_lower_bound:
      wilsonLowerBound(covered, coverageFamilies) >= 0.97,
    development_and_sealed_interface_and_proxy_audits_clean:
      proxyTaintAudit.passed === true &&
      sealedInterfaceAndProxyAuditPassed,
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed)
    .map(([name]) => name);
  const body = {
    schema: "zero.reasoner56_channel_readiness_development.v2",
    scope: "development-only",
    status: failures.length === 0 ? "development-ready" : "development-no-go",
    checks,
    failures,
    metrics: {
      full_mean_log_loss: mean(full.map(fullLoss)),
      full_log_loss_replay: {
        method: "stable-q20-score-logsumexp-minus-truth-score",
        tail_rule: "log(maximum-tie-count)+log1p(lower-tail/maximum-tie-count)",
        episodes: fullReplay.length,
        maximum_relative_error: Math.max(...fullReplay.map(item => {
          const scale = Math.max(item.replayed, item.emitted, Number.MIN_VALUE);
          return Math.abs(item.replayed - item.emitted) / scale;
        })),
        replay_sha256: canonicalDigest(
          "r56-development-full-log-loss-replay", fullReplay),
      },
      uniform_log_loss: Math.log(427),
      program_prior_only_mean_log_loss: mean(prior.map(naturalLoss)),
      comparisons,
      full_mean_brier: mean(full.map(row => row.brier)),
      reliability_bins: reliabilityBins,
      candidate_set: {
        full_mean_size: fullCandidateMean,
        program_prior_only_mean_size: priorCandidateMean,
        size_ratio: fullCandidateMean / priorCandidateMean,
        coverage_lane: "calibration-coverage",
        coverage_independent_unit: "program-family-worst-draw",
        coverage_families: coverageFamilies,
        covered_families: covered,
        coverage: covered / coverageFamilies,
        one_sided_95_wilson_lower: wilsonLowerBound(covered,
          coverageFamilies),
        coverage_receipt_sha256: calibrationCoverageReceipt.receipt_sha256,
        conservative_threshold: 1,
        comparator_threshold: 1,
        threshold_basis: "99 disjoint program families with worst-draw score",
      },
      interface_and_proxy_audits: {
        development: {
          status: proxyTaintAudit.passed ? "passed" : "failed",
          passed: proxyTaintAudit.passed === true,
          audit_sha256: proxyTaintAudit.audit_sha256,
        },
        sealed: {
          status: "pending-preregistration",
          passed: false,
          audit_sha256: null,
        },
      },
      full_fallback_rate: full.filter(row => row.fallback_started).length /
        full.length,
      full_backoff_counts: backoff,
      worst_corruption_family_cost: worstMechanism,
    },
  };
  return { ...body,
    assessment_sha256: canonicalDigest("r56-channel-readiness", body) };
}

function exactVerifier(candidate, truthClass) {
  const target = R56_UNIVERSE.semantic[truthClass].truth_table;
  const actual = candidate.semantic.truth_table;
  const mismatch = actual.findIndex((value, index) => value !== target[index]);
  if (mismatch >= 0) {
    return {
      accepted: false,
      certificate_valid: false,
      counterexample: { input: mismatch, expected: target[mismatch],
        actual: actual[mismatch] },
    };
  }
  return {
    accepted: true,
    certificate_valid: true,
    certificate: {
      algorithm: "exhaustive-GF17-truth-table-v1",
      checked_points: 17,
      semantic_class: candidate.class_index,
      truth_table_sha256: canonicalDigest("GF17-truth-table", actual),
    },
    answer_ir: {
      schema: "zero.reasoner56_answer_ir.v1",
      semantic_class: candidate.class_index,
      semantic: candidate.semantic,
    },
  };
}

/* This is the shared verified-search algorithm specialized to one immutable
 * R5.6 universe. The expensive universe receipts and order are computed once
 * above. Every returned receipt still passes the generic harness validator. */
function runR56VerifiedSearch(proposalIndexes, truthClass) {
  const fallbackIndexes = R56_CANONICAL_FALLBACK.map(item => item.class_index);
  const seen = new Set();
  const trace = [];
  const evaluatorTrace = [];
  const expansionTrace = [];
  let accepted = null;
  for (const [phase, indexes] of [["proposal", proposalIndexes],
    ["fallback", fallbackIndexes]]) {
    for (const classIndex of indexes) {
      if (trace.length >= GLOBAL_CAP) break;
      const candidate = R56_CANDIDATES[classIndex];
      const metadata = R56_CANDIDATE_METADATA[classIndex];
      const duplicateSemantic = seen.has(metadata.semantic_sha256);
      expansionTrace.push({
        ordinal: expansionTrace.length,
        phase,
        candidate_sha256: metadata.semantic_sha256,
        candidate_ast_sha256: metadata.ast_sha256,
        candidate_record_sha256: metadata.record_sha256,
        duplicate_semantic: duplicateSemantic,
        charged_partial_expansions: 1,
      });
      if (duplicateSemantic) continue;
      seen.add(metadata.semantic_sha256);
      const verdict = exactVerifier(candidate, truthClass);
      let certificateSha256 = null;
      let counterexampleSha256 = null;
      if (verdict.accepted) {
        certificateSha256 = canonicalDigest("exact-verifier-certificate",
          verdict.certificate);
        evaluatorTrace.push({
          ordinal: trace.length,
          candidate_sha256: metadata.semantic_sha256,
          accepted: true,
          certificate: verdict.certificate,
          certificate_sha256: certificateSha256,
          answer_ir: verdict.answer_ir,
          answer_ir_sha256: canonicalDigest("final-answer-ir", verdict.answer_ir),
        });
      } else {
        counterexampleSha256 = canonicalDigest("exact-verifier-counterexample",
          verdict.counterexample);
        evaluatorTrace.push({
          ordinal: trace.length,
          candidate_sha256: metadata.semantic_sha256,
          accepted: false,
          counterexample: verdict.counterexample,
          counterexample_sha256: counterexampleSha256,
        });
      }
      trace.push({
        ordinal: trace.length,
        phase,
        candidate_sha256: metadata.semantic_sha256,
        verifier_accepted: verdict.accepted,
        certificate_valid: verdict.certificate_valid,
        certificate_sha256: certificateSha256,
        counterexample_sha256: counterexampleSha256,
        accepted: verdict.accepted && verdict.certificate_valid,
        charged_verifier_check: 1,
        partial_expansions: 1,
      });
      if (verdict.accepted && verdict.certificate_valid) {
        accepted = evaluatorTrace.at(-1);
        break;
      }
    }
    if (accepted || trace.length >= GLOBAL_CAP) break;
  }
  const solved = accepted !== null;
  const globalCapHit = !solved && trace.length >= GLOBAL_CAP;
  const fallbackExhausted = !solved && !globalCapHit;
  const censoringReason = solved ? null :
    (globalCapHit ? "global-cap" : "fallback-exhausted");
  const fallbackExpansions = expansionTrace.filter(row =>
    row.phase === "fallback");
  const proposalChecks = trace.filter(row => row.phase === "proposal").length;
  const fallbackChecks = trace.length - proposalChecks;
  const injectedDigest = R56_CANDIDATE_METADATA[proposalIndexes[0]]
    .semantic_sha256;
  const body = {
    schema: "zero.reasoner5_verified_search.v1",
    global_cap: GLOBAL_CAP,
    solved,
    accepted_candidate_sha256: solved ? accepted.candidate_sha256 : null,
    answer_ir: solved ? accepted.answer_ir : null,
    answer_ir_sha256: solved ? accepted.answer_ir_sha256 : null,
    certificate_sha256: solved ? accepted.certificate_sha256 : null,
    premature_commits: 0,
    verifier_checks: trace.length,
    distinct_semantic_classes: seen.size,
    fallback_started: fallbackExpansions.length > 0,
    global_cap_hit: globalCapHit,
    fallback_exhausted: fallbackExhausted,
    censoring_reason: censoringReason,
    primary_cost: solved ? trace.length : GLOBAL_CAP + 1,
    proposal_verifier_checks: proposalChecks,
    fallback_verifier_checks: fallbackChecks,
    partial_expansions: expansionTrace.length,
    fallback_partial_expansions: fallbackExpansions.length,
    fallback_receipt: {
      complete: true,
      candidate_universe: R56_CANDIDATE_MULTISET,
      fallback: R56_CANDIDATE_MULTISET,
      canonical_order_sha256: R56_CANDIDATE_MULTISET.canonical_order_sha256,
      fallback_verifier_checks: fallbackChecks,
      fallback_candidate_occurrences: fallbackExpansions.length,
      fallback_partial_expansions: fallbackExpansions.length,
      charged_verifier_checks: trace.length,
      charged_partial_expansions: expansionTrace.length,
      censoring_charge: solved ? 0 : 1,
      censoring_reason: censoringReason,
      all_work_charged: true,
    },
    injected_invalid: {
      candidate_sha256: injectedDigest,
      checked_first: trace[0]?.candidate_sha256 === injectedDigest,
      rejected: trace[0]?.candidate_sha256 === injectedDigest &&
        trace[0]?.verifier_accepted === false,
    },
    trace,
    evaluator_trace: evaluatorTrace,
    expansion_trace: expansionTrace,
  };
  return { ...body,
    search_sha256: canonicalDigest("verified-search-receipt", body) };
}

function normalizeTraceRows(nativeRows, manifest) {
  const episodes = new Map(manifest.episodes.map(episode => {
    const spec = episode.content.evaluator.episode_spec;
    return [`${spec.program_index}:${spec.mechanism_index}:${spec.repeat_index}`,
      episode];
  }));
  const cache = new Map();
  return nativeRows.map(native => {
    const program = Number(native.program_family_id.split("-").at(-1));
    const episode = episodes.get(`${program}:${native.mechanism_id}:${native.parameter_draw}`);
    assert.ok(episode, `missing manifest episode for ${native.episode_id}`);
    assert.deepEqual(native.observations, episode.content.public.observations);
    assert.equal(native.truth_class,
      episode.content.evaluator.episode_spec.truth_class);
    const cacheKey = `${native.truth_class}:${native.proposal_classes.join(",")}`;
    let search = cache.get(cacheKey);
    if (!search) {
      search = runR56VerifiedSearch(native.proposal_classes,
        native.truth_class);
      cache.set(cacheKey, search);
    }
    assert.equal(search.primary_cost, native.primary_cost);
    assert.equal(search.verifier_checks, native.verifier_checks);
    assert.equal(search.proposal_verifier_checks,
      native.proposal_verifier_checks);
    assert.equal(search.fallback_verifier_checks,
      native.fallback_verifier_checks);
    assert.equal(search.partial_expansions, native.partial_expansions);
    assert.equal(search.fallback_partial_expansions,
      native.fallback_partial_expansions);
    assert.equal(search.fallback_started, native.fallback_started);
    assert.equal(search.global_cap_hit, native.global_cap_hit);
    assert.equal(search.answer_ir.semantic_class, native.accepted_class);
    const row = {
      schema: "zero.reasoner5_trace_row.v1",
      experiment: R56_EXPERIMENT,
      episode_id: episode.episode_id,
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
      arm: native.arm,
      verified_search: search,
      execution_trace_sha256: search.search_sha256,
      primary_cost: search.primary_cost,
      verifier_checks: search.verifier_checks,
      partial_expansions: search.partial_expansions,
      fallback_verifier_checks: search.fallback_verifier_checks,
      fallback_partial_expansions: search.fallback_partial_expansions,
      observation_queries: native.observation_queries,
      wall_ns: null,
      peak_bytes: null,
      source_artifact_reads: native.source_artifact_reads,
      exact: search.solved,
      certificate_valid: search.certificate_sha256 !== null,
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
    assert.deepEqual(Object.keys(row).sort(), [...REASONER5_TRACE_ROW_FIELDS].sort());
    return row;
  });
}

export function buildR56HarnessBundle({ nativeRows, nativeResult,
  artifactBytes }) {
  assert.equal(nativeResult.schema, "zero.reasoner56_development_result.v4");
  assert.equal(nativeRows.length, 128 * R56_EXPECTED_ARMS.length);
  const splits = selectSemanticSplits();
  assert.equal(splits.source.length, nativeResult.source_semantic_classes);
  assert.equal(splits.rejections, nativeResult.split_rejections);
  assert.deepEqual(splits.development, nativeResult.development_classes);
  const calibrationCoverageReceipt = buildCalibrationCoverageReceipt(splits,
    nativeResult, artifactBytes);
  const artifactSha256 = sha256(artifactBytes);
  const state = createSplitState({ experiment_id: R56_EXPERIMENT });
  registerProgramFamilies(state, "source-training", splits.source,
    "source-program", "source-training-id");
  registerProgramFamilies(state, "calibration", splits.fit,
    "calibration-fit-program", "calibration-fit-id");
  registerProgramFamilies(state, "calibration", splits.coverage,
    "calibration-coverage-program", "calibration-coverage-id");
  registerProgramFamilies(state, "development", splits.development,
    "program", "primary-id-development");
  for (let mechanism = 0; mechanism < MECHANISMS; ++mechanism) {
    registerFamily(state, {
      family_id: `mechanism-${mechanism}`,
      lane: "development",
      generator_id: "r56-channel-v2",
      shift_stratum: "primary-id-development",
      family_spec: {
        axis: "channel-template",
        template_index: mechanism,
        template_name: ["symmetric-replacement", "asymmetric-replacement",
          "input-dependent-error", "first-order-burst", "MCAR-missingness",
          "MAR-missingness", "value-dependent-missingness",
          "block-missingness"][mechanism],
      },
    });
  }
  registerProgramFamilies(state, "sealed", splits.sealed, "sealed-program",
    "primary-id-sealed");
  freezeFamilySplits(state);
  for (let program = 0; program < DEVELOPMENT_CLASSES; ++program) {
    for (let mechanism = 0; mechanism < MECHANISMS; ++mechanism) {
      for (let repeat = 0; repeat < REPEATS; ++repeat) {
        const episodeNonce = ((program * MECHANISMS) + mechanism) * REPEATS +
          repeat;
        const corruptionIndex = mechanism + 8 *
          (repeat + REPEATS * program + 2000);
        const orderSlot = (program + mechanism + repeat) % 8;
        const truthClass = splits.development[program];
        const content = generateEpisodeContent(program, mechanism, repeat,
          truthClass, corruptionIndex, episodeNonce, orderSlot);
        const recipe = {
          schema: "zero.reasoner5_replay_recipe.v1",
          generator_sha256: PROGRAM_GENERATOR_SHA256,
          input_generator_sha256: INPUT_GENERATOR_SHA256,
          replay_function_sha256: REPLAY_FUNCTION_SHA256,
          seed_binding: {
            root_seed: R56_ROOT_SEED,
            derivation_path: ["development", program, mechanism, repeat,
              truthClass, corruptionIndex, episodeNonce, orderSlot],
          },
        };
        const episodeId = `episode-${canonicalDigest("r56-opaque-episode-id", {
          program, mechanism, repeat, episodeNonce,
        }).slice(0, 24)}`;
        registerEpisode(state, {
          episode_id: episodeId,
          lane: "development",
          family_id: `program-${program}`,
          cross_family_id: `mechanism-${mechanism}`,
          nested_repeat_id: `draw-${repeat}`,
          seed_ref: canonicalDigest("episode-seed-reference", recipe),
          replay_recipe: recipe,
          ...parityBundle(content.public, content.evaluator, artifactSha256),
          ...content,
        });
      }
    }
  }
  const manifest = finalizeManifest(state, {
    generator_hashes: {
      program_generator_sha256: PROGRAM_GENERATOR_SHA256,
      input_generator_sha256: INPUT_GENERATOR_SHA256,
      replay_function_sha256: REPLAY_FUNCTION_SHA256,
    },
    source_artifact: {
      schema: "R56ART1",
      bytes: artifactBytes.length,
      sha256: artifactSha256,
      native_digest: nativeResult.artifact_digest,
    },
    semantic_split_receipt: {
      source_classes: splits.source.length,
      calibration_fit_classes: splits.fit.length,
      calibration_coverage_classes: splits.coverage.length,
      development_classes: [...splits.development],
      sealed_reserved_classes: splits.sealed.length,
      semantic_rejections: splits.rejections,
      split_sha256: canonicalDigest("r56-semantic-splits", splits),
    },
    calibration_registration: {
      fit_program_families: 16,
      coverage_program_families: 99,
      corruption_draws_per_family: 8,
      family_fit_statistic: "mean log loss",
      family_coverage_statistic: "worst-draw cumulative mass",
      coverage_target: 0.99,
      finite_sample_rank: 99,
      fallback_threshold_if_rank_unavailable: 1,
    },
    calibration_coverage_receipt: calibrationCoverageReceipt,
    analysis_contract: analysisContract(),
  });
  const registry = createReplayRegistry();
  registerReplayPipeline(registry, {
    generator_sha256: PROGRAM_GENERATOR_SHA256,
    input_generator_sha256: INPUT_GENERATOR_SHA256,
    replay_function_sha256: REPLAY_FUNCTION_SHA256,
    replay: replayR56Episode,
  });
  const replayReceipt = assertManifestReplay(manifest, registry);
  const calibrationReplayReceipt = assertR56CalibrationCoverageReplay(
    manifest, artifactBytes);
  const rawRows = normalizeTraceRows(nativeRows, manifest);
  const coverage = assertRawTraceCoverage({ manifest, rawTraces: rawRows });
  const result = buildResultFromRawTraces({
    experiment: R56_EXPERIMENT,
    manifest,
    rawTraces: rawRows,
    reconstruct: reconstructR56Result,
    analysisSettings: R56_ANALYSIS_SETTINGS,
  });
  assertResultReplay({
    experiment: R56_EXPERIMENT,
    manifest,
    rawTraces: rawRows,
    reconstruct: reconstructR56Result,
    analysisSettings: R56_ANALYSIS_SETTINGS,
    result,
  });
  const audit = auditR56ProxyTaint(manifest, rawRows, nativeResult);
  assert.equal(audit.passed, true);
  const readiness = assessR56ChannelReadiness(nativeRows, audit, manifest,
    artifactBytes);
  const assessmentBody = {
    schema: "zero.reasoner56_development_assessment.v2",
    status: "development-only",
    scientific_decision: null,
    harness_gate: {
      decision: result.decision,
      passed: result.gate.passed,
      failures: result.gate.failures,
      checks: result.gate.checks,
    },
    channel_readiness: readiness,
  };
  const assessment = { ...assessmentBody,
    assessment_sha256: canonicalDigest("r56-development-assessment",
      assessmentBody) };
  return { manifest, rawRows, result, audit, readiness, assessment,
    replayReceipt, calibrationReplayReceipt, coverage };
}

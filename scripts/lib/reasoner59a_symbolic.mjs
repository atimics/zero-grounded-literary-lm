import { createHash } from "node:crypto";
import assert from "node:assert/strict";

import {
  REASONER5_TRACE_ROW_FIELDS,
  analysisFunctionDigest,
  armParityReceipt,
  assertRankerView,
  canonicalBytes,
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

export const R59A_EXPERIMENT = "reasoner59a-symbolic-transfer-v1";
export const R59A_SOURCE_ROOT = "59a500ce00000001";
export const R59A_CALIBRATION_ROOT = "59aca11b00000001";
export const R59A_DEVELOPMENT_ROOT = "59ade7e100000001";
export const R59A_SCENE_COUNT = 25_344;
export const R59A_JOINT_CANDIDATE_CAP = 16_384;
export const R59A_AMBIGUITY_MINIMUM = 8;
export const R59A_HEADROOM_MINIMUM = 16;
export const R59A_HEADROOM_MAXIMUM = 64;

export const R59A_CONCEPT_GENERATORS = Object.freeze([
  "syntax-first",
  "behavior-constraint-first",
]);
export const R59A_SUPPORT_BUILDERS = Object.freeze([
  "greedy-version-space",
  "hard-negative-balanced",
]);
export const R59A_SHIFT_STRATA = Object.freeze([
  "color-shape-binding",
  "relation-attribute-binding",
  "operation-attribute-compound",
  "episode-local-legend",
]);
export const R59A_BASE_ARMS = Object.freeze([
  "full",
  "target_only",
  "source_free_jit",
  "source_ablation",
  "binding_off",
  "frequency_only",
  "source_only",
  "surface_bijection",
  "oracle_program_order",
]);
export const R59A_DERANGEMENT_ARMS = Object.freeze(
  Array.from({ length: 31 }, (_, index) =>
    `shuffled_${String(index).padStart(2, "0")}`),
);
export const R59A_ARMS = Object.freeze([
  ...R59A_BASE_ARMS,
  ...R59A_DERANGEMENT_ARMS,
]);
export const R59A_SOURCE_ISOLATED_ARMS = Object.freeze([
  "target_only",
  "source_free_jit",
  "source_ablation",
  "oracle_program_order",
]);

export const R59A_ATOMS = Object.freeze([
  "red", "green", "blue",
  "circle", "square", "triangle",
  "small", "large",
]);
export const R59A_RELATIONS = Object.freeze([
  "left", "right", "above", "below", "same-row", "same-column",
]);

const LANE_CODE = Object.freeze({
  "source-training": 0,
  calibration: 1,
  development: 2,
});
const LANE_ROOT = Object.freeze({
  "source-training": R59A_SOURCE_ROOT,
  calibration: R59A_CALIBRATION_ROOT,
  development: R59A_DEVELOPMENT_ROOT,
});
const SHA256 = /^[0-9a-f]{64}$/u;
export const R59A_TRANSFER_DIRECTIONS = Object.freeze(
  R59A_CONCEPT_GENERATORS.map((targetGenerator, targetIndex) => ({
    targetGenerator,
    targetIndex,
    sourceGenerator: R59A_CONCEPT_GENERATORS[1 - targetIndex],
    sourceIndex: 1 - targetIndex,
    id: `${R59A_CONCEPT_GENERATORS[1 - targetIndex]}=>${targetGenerator}`,
  })),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (ArrayBuffer.isView(value) || value instanceof Map) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function atomDomain(atom) {
  if (atom < 3) return "color";
  if (atom < 6) return "shape";
  return "size";
}

function objectFromCode(code, cell) {
  const color = code % 3;
  code = Math.floor(code / 3);
  const shape = code % 3;
  code = Math.floor(code / 3);
  const size = code % 2;
  return { cell, color, shape, size };
}

function combinations(values, count, start = 0, prefix = [], output = []) {
  if (prefix.length === count) {
    output.push([...prefix]);
    return output;
  }
  for (let index = start; index < values.length; index += 1) {
    prefix.push(values[index]);
    combinations(values, count, index + 1, prefix, output);
    prefix.pop();
  }
  return output;
}

let SCENE_CACHE = null;

export function enumerateR59Scenes() {
  if (SCENE_CACHE !== null) return SCENE_CACHE.scenes;
  const scenes = [];
  for (let objectCount = 1; objectCount <= 3; objectCount += 1) {
    for (const cells of combinations([0, 1, 2, 3], objectCount)) {
      const assignments = 18 ** objectCount;
      for (let assignment = 0; assignment < assignments; assignment += 1) {
        let code = assignment;
        const objects = [];
        for (const cell of cells) {
          objects.push(objectFromCode(code % 18, cell));
          code = Math.floor(code / 18);
        }
        scenes.push(deepFreeze({ objects }));
      }
    }
  }
  assert.equal(scenes.length, R59A_SCENE_COUNT,
    "R5.9a scene universe cardinality");
  const counts = Array.from({ length: 8 }, () =>
    new Uint8Array(R59A_SCENE_COUNT));
  const joint = Array.from({ length: 64 }, () =>
    new Uint8Array(R59A_SCENE_COUNT));
  const relations = Array.from({ length: 6 * 64 }, () =>
    new Uint8Array(R59A_SCENE_COUNT));
  const objectCounts = new Uint8Array(R59A_SCENE_COUNT);
  const objectMatches = object => [
    object.color === 0, object.color === 1, object.color === 2,
    object.shape === 0, object.shape === 1, object.shape === 2,
    object.size === 0, object.size === 1,
  ];
  const related = (relation, left, right) => {
    const leftRow = Math.floor(left / 2);
    const leftColumn = left % 2;
    const rightRow = Math.floor(right / 2);
    const rightColumn = right % 2;
    if (relation === 0) return leftColumn < rightColumn;
    if (relation === 1) return leftColumn > rightColumn;
    if (relation === 2) return leftRow < rightRow;
    if (relation === 3) return leftRow > rightRow;
    if (relation === 4) return leftRow === rightRow;
    return leftColumn === rightColumn;
  };
  for (const [sceneIndex, scene] of scenes.entries()) {
    objectCounts[sceneIndex] = scene.objects.length;
    const matches = scene.objects.map(objectMatches);
    for (let atom = 0; atom < 8; atom += 1)
      counts[atom][sceneIndex] = matches.reduce((sum, row) =>
        sum + Number(row[atom]), 0);
    for (let first = 0; first < 8; first += 1)
      for (let second = 0; second < 8; second += 1)
        joint[first * 8 + second][sceneIndex] = Number(matches.some(row =>
          row[first] && row[second]));
    for (let relation = 0; relation < 6; relation += 1)
      for (let first = 0; first < 8; first += 1)
        for (let second = 0; second < 8; second += 1) {
          let found = false;
          for (let left = 0; left < scene.objects.length && !found; left += 1)
            for (let right = 0; right < scene.objects.length; right += 1)
              if (left !== right && matches[left][first] &&
                  matches[right][second] && related(relation,
                    scene.objects[left].cell, scene.objects[right].cell)) {
                found = true;
                break;
              }
          relations[(relation * 64) + first * 8 + second][sceneIndex] =
            Number(found);
        }
  }
  const sceneDigestBody = scenes.map(scene => scene.objects.map(object => [
    object.cell, object.color, object.shape, object.size,
  ]));
  SCENE_CACHE = {
    scenes: deepFreeze(scenes),
    counts,
    joint,
    relations,
    objectCounts,
    sha256: canonicalDigest("reasoner59a-scene-universe", sceneDigestBody),
  };
  return SCENE_CACHE.scenes;
}

export function r59SceneUniverseSha256() {
  enumerateR59Scenes();
  return SCENE_CACHE.sha256;
}

function grammarForms() {
  const forms = [];
  for (const symbol of [0, 1]) {
    forms.push({ kind: "exists", symbol, node_count: 2 });
    forms.push({ kind: "all", symbol, node_count: 2 });
    for (const threshold of [1, 2, 3])
      forms.push({ kind: "count-eq", symbol, threshold, node_count: 3 });
    for (const threshold of [2, 3])
      forms.push({ kind: "count-ge", symbol, threshold, node_count: 3 });
  }
  forms.push({ kind: "exists-and", node_count: 4 });
  forms.push({ kind: "exists-xor", node_count: 5 });
  for (const comparison of ["equal", "greater", "less"])
    forms.push({ kind: "count-compare", comparison, node_count: 5 });
  for (const relation of R59A_RELATIONS)
    forms.push({ kind: "relation", relation, node_count: 7,
      binding_pattern: "exists-distinct-pair" });
  for (const kind of ["boolean-and", "boolean-or"])
    for (const orientation of [0, 1])
      for (const threshold of [2, 3])
        forms.push({ kind, orientation, threshold, node_count: 7 });
  return deepFreeze(forms);
}

const R59A_FORMS = grammarForms();

function formValue(form, legend, sceneIndex) {
  const firstSymbol = form.symbol ?? form.orientation ?? 0;
  const secondSymbol = firstSymbol === 0 ? 1 : 0;
  const firstAtom = legend[firstSymbol];
  const secondAtom = legend[secondSymbol];
  const first = SCENE_CACHE.counts[firstAtom][sceneIndex];
  const second = SCENE_CACHE.counts[secondAtom][sceneIndex];
  if (form.kind === "exists") return first > 0;
  if (form.kind === "all")
    return first === SCENE_CACHE.objectCounts[sceneIndex];
  if (form.kind === "count-eq") return first === form.threshold;
  if (form.kind === "count-ge") return first >= form.threshold;
  if (form.kind === "exists-and")
    return SCENE_CACHE.joint[legend[0] * 8 + legend[1]][sceneIndex] === 1;
  if (form.kind === "exists-xor")
    return (SCENE_CACHE.counts[legend[0]][sceneIndex] > 0) !==
      (SCENE_CACHE.counts[legend[1]][sceneIndex] > 0);
  if (form.kind === "count-compare") {
    const left = SCENE_CACHE.counts[legend[0]][sceneIndex];
    const right = SCENE_CACHE.counts[legend[1]][sceneIndex];
    if (form.comparison === "equal") return left === right;
    if (form.comparison === "greater") return left > right;
    return left < right;
  }
  if (form.kind === "relation") {
    const relation = R59A_RELATIONS.indexOf(form.relation);
    return SCENE_CACHE.relations[(relation * 64) +
      legend[0] * 8 + legend[1]][sceneIndex] === 1;
  }
  if (form.kind === "boolean-and") return first > 0 &&
    second >= form.threshold;
  if (form.kind === "boolean-or") return first > 0 ||
    second >= form.threshold;
  throw new Error(`unknown R5.9a form ${form.kind}`);
}

function behaviorFor(form, legend) {
  const bytes = Buffer.alloc(Math.ceil(R59A_SCENE_COUNT / 8));
  let positives = 0;
  for (let sceneIndex = 0; sceneIndex < R59A_SCENE_COUNT; sceneIndex += 1) {
    if (!formValue(form, legend, sceneIndex)) continue;
    bytes[sceneIndex >> 3] |= 1 << (sceneIndex & 7);
    positives += 1;
  }
  return { bytes, positives };
}

function formProduction(form) {
  return [form.kind, form.symbol ?? null, form.threshold ?? null,
    form.comparison ?? null, form.relation ?? null,
    form.orientation ?? null].join(":");
}

function candidateFeatures(form, legend) {
  const firstDomain = atomDomain(legend[0]);
  const secondDomain = atomDomain(legend[1]);
  return {
    production: [`production:${formProduction(form)}`,
      `nodes:${form.node_count}`],
    subtree: [`subtree:${form.kind}:${firstDomain}:${secondDomain}`,
      `role:${form.kind}:${firstDomain}`],
    binding: [`binding:${firstDomain}:${secondDomain}`,
      `legend:${R59A_ATOMS[legend[0]]}:${R59A_ATOMS[legend[1]]}`],
    atom: [`atom:${R59A_ATOMS[legend[0]]}`,
      `atom:${R59A_ATOMS[legend[1]]}`],
  };
}

function conceptAst(form, legend) {
  return {
    type: "reasoner59a-symbolic-concept",
    form: structuredClone(form),
    legend: {
      glyph_a: R59A_ATOMS[legend[0]],
      glyph_b: R59A_ATOMS[legend[1]],
    },
  };
}

function surfaceBijectionForm(form) {
  const transformed = structuredClone(form);
  if (Object.hasOwn(transformed, "symbol")) transformed.symbol = 1 - form.symbol;
  if (Object.hasOwn(transformed, "orientation"))
    transformed.orientation = 1 - form.orientation;
  if (form.kind === "count-compare") {
    if (form.comparison === "greater") transformed.comparison = "less";
    if (form.comparison === "less") transformed.comparison = "greater";
  }
  if (form.kind === "relation") {
    const reverse = {
      left: "right",
      right: "left",
      above: "below",
      below: "above",
      "same-row": "same-row",
      "same-column": "same-column",
    };
    transformed.relation = reverse[form.relation];
    assert(transformed.relation,
      `R5.9a surface transform lacks relation ${form.relation}`);
  }
  return transformed;
}

export function applyR59AstSurfaceBijection(ast) {
  assert.equal(ast?.type, "reasoner59a-symbolic-concept");
  const first = R59A_ATOMS.indexOf(ast.legend.glyph_a);
  const second = R59A_ATOMS.indexOf(ast.legend.glyph_b);
  assert(first >= 0 && second >= 0 && first !== second,
    "R5.9a surface transform needs an injective legend");
  return conceptAst(surfaceBijectionForm(ast.form), [second, first]);
}

function behaviorLabel(bytes, sceneIndex) {
  return (bytes[sceneIndex >> 3] >> (sceneIndex & 7)) & 1;
}

let UNIVERSE_CACHE = null;
let CANONICAL_ORDER_CACHE = null;

function r59AstSha256(ast) {
  return canonicalDigest("reasoner59a-raw-ast", ast);
}

export function enumerateR59Universe() {
  if (UNIVERSE_CACHE !== null) return UNIVERSE_CACHE;
  enumerateR59Scenes();
  const byBehavior = new Map();
  const rawPairs = [];
  let jointPairs = 0;
  for (const form of R59A_FORMS)
    for (let first = 0; first < 8; first += 1)
      for (let second = 0; second < 8; second += 1) {
        if (first === second) continue;
        jointPairs += 1;
        assert(jointPairs <= R59A_JOINT_CANDIDATE_CAP,
          "R5.9a complete joint candidate cap");
        const legend = [first, second];
        const behavior = behaviorFor(form, legend);
        const behaviorSha256 = sha256(behavior.bytes);
        const ast = conceptAst(form, legend);
        rawPairs.push({
          pair_index: jointPairs - 1,
          ast,
          ast_sha256: r59AstSha256(ast),
          behavior_sha256: behaviorSha256,
          positive_scenes: behavior.positives,
        });
        const existing = byBehavior.get(behaviorSha256);
        if (existing !== undefined) {
          assert(existing.behavior.equals(behavior.bytes),
            "R5.9a behavior digest collision");
          existing.multiplicity += 1;
          if (form.node_count < existing.nodeCount ||
              (form.node_count === existing.nodeCount &&
               canonicalBytes(ast).compare(canonicalBytes(existing.ast)) < 0)) {
            existing.ast = ast;
            existing.features = candidateFeatures(form, legend);
            existing.nodeCount = form.node_count;
          }
          continue;
        }
        byBehavior.set(behaviorSha256, {
          behavior: behavior.bytes,
          behaviorSha256,
          positives: behavior.positives,
          ast,
          features: candidateFeatures(form, legend),
          nodeCount: form.node_count,
          multiplicity: 1,
        });
      }
  const classes = [...byBehavior.values()].sort((left, right) =>
    left.behaviorSha256.localeCompare(right.behaviorSha256));
  const behaviorByDigest = new Map();
  const candidateByBehavior = new Map();
  const candidates = classes.map((item, classIndex) => {
    behaviorByDigest.set(item.behaviorSha256, item.behavior);
    const candidate = deepFreeze({
      class_index: classIndex,
      semantic: { behavior_sha256: item.behaviorSha256 },
      ast: item.ast,
      feature_groups: item.features,
      positive_scenes: item.positives,
      joint_pair_multiplicity: item.multiplicity,
      partial_expansions: item.multiplicity,
    });
    candidateByBehavior.set(item.behaviorSha256, candidate);
    return candidate;
  });
  const registeredRawPairs = rawPairs.map(pair => deepFreeze({
    ...pair,
    class_index: candidateByBehavior.get(pair.behavior_sha256).class_index,
  }));
  const candidateByAstSha256 = new Map(registeredRawPairs.map(pair =>
    [pair.ast_sha256, candidateByBehavior.get(pair.behavior_sha256)]));
  const words = Math.ceil(candidates.length / 32);
  const truthByScene = Array.from({ length: R59A_SCENE_COUNT }, () =>
    new Uint32Array(words));
  for (const candidate of candidates) {
    const behavior = behaviorByDigest.get(candidate.semantic.behavior_sha256);
    for (let sceneIndex = 0; sceneIndex < R59A_SCENE_COUNT; sceneIndex += 1)
      if (behaviorLabel(behavior, sceneIndex))
        truthByScene[sceneIndex][candidate.class_index >> 5] |=
          (1 << (candidate.class_index & 31)) >>> 0;
  }
  const body = {
    schema: "zero.reasoner59a_joint_universe.v1",
    scene_universe_sha256: r59SceneUniverseSha256(),
    grammar_forms: R59A_FORMS,
    representative_rule:
      "minimum AST node count, then canonical AST and legend bytes",
    joint_pairs: jointPairs,
    raw_pair_order_sha256: canonicalDigest("reasoner59a-raw-joint-pairs",
      registeredRawPairs.map(pair => ({
        pair_index: pair.pair_index,
        ast_sha256: pair.ast_sha256,
        behavior_sha256: pair.behavior_sha256,
      }))),
    semantic_classes: candidates.length,
    candidates: candidates.map(candidate => ({
      class_index: candidate.class_index,
      semantic: candidate.semantic,
      ast: candidate.ast,
      joint_pair_multiplicity: candidate.joint_pair_multiplicity,
    })),
  };
  UNIVERSE_CACHE = deepFreeze({
    schema: body.schema,
    representativeRule: body.representative_rule,
    forms: R59A_FORMS,
    jointPairs,
    semanticClasses: candidates.length,
    semanticCollisions: jointPairs - candidates.length,
    candidates: deepFreeze(candidates),
    rawPairs: deepFreeze(registeredRawPairs),
    rawPairOrderSha256: body.raw_pair_order_sha256,
    behaviorByDigest,
    candidateByAstSha256,
    truthByScene,
    sha256: canonicalDigest("reasoner59a-joint-universe", body),
  });
  return UNIVERSE_CACHE;
}

function r59CanonicalCandidates() {
  if (CANONICAL_ORDER_CACHE === null)
    CANONICAL_ORDER_CACHE = deepFreeze(canonicalCandidateOrder(
      enumerateR59Universe().candidates));
  return CANONICAL_ORDER_CACHE;
}

export function r59BehaviorForCandidate(candidate) {
  const behavior = enumerateR59Universe().behaviorByDigest.get(
    candidate.semantic.behavior_sha256);
  assert(Buffer.isBuffer(behavior), "unknown R5.9a semantic behavior");
  return behavior;
}

export function evaluateR59Candidate(candidate, sceneIndex) {
  assert(Number.isSafeInteger(sceneIndex) && sceneIndex >= 0 &&
    sceneIndex < R59A_SCENE_COUNT);
  return behaviorLabel(r59BehaviorForCandidate(candidate), sceneIndex);
}

export function r59BehaviorSha256ForAst(ast) {
  const candidate = enumerateR59Universe().candidateByAstSha256.get(
    r59AstSha256(ast));
  assert(candidate, "R5.9a AST is outside the complete joint universe");
  return candidate.semantic.behavior_sha256;
}

export function applyR59CandidateSurfaceBijection(candidate) {
  const ast = applyR59AstSurfaceBijection(candidate.ast);
  const legend = [R59A_ATOMS.indexOf(ast.legend.glyph_a),
    R59A_ATOMS.indexOf(ast.legend.glyph_b)];
  assert(legend.every(index => index >= 0));
  const transformed = {
    ...structuredClone(candidate),
    ast,
    feature_groups: candidateFeatures(ast.form, legend),
  };
  assert.equal(r59BehaviorSha256ForAst(transformed.ast),
    candidate.semantic.behavior_sha256,
  "R5.9a consistent surface bijection changed candidate behavior");
  return deepFreeze(transformed);
}

export function applyR59EvaluatorSurfaceBijection(evaluator) {
  const transformed = structuredClone(evaluator);
  const candidate = enumerateR59Universe().candidateByAstSha256.get(
    r59AstSha256(evaluator.ast));
  assert(candidate, "R5.9a evaluator AST is outside the complete universe");
  const surfaced = applyR59CandidateSurfaceBijection({
    ...candidate,
    ast: evaluator.ast,
    feature_groups: candidateFeatures(evaluator.ast.form, [
      R59A_ATOMS.indexOf(evaluator.ast.legend.glyph_a),
      R59A_ATOMS.indexOf(evaluator.ast.legend.glyph_b),
    ]),
  });
  transformed.ast = surfaced.ast;
  transformed.typed_subtrees = Object.values(surfaced.feature_groups)
    .flat().sort();
  assert.equal(r59BehaviorSha256ForAst(transformed.ast),
    evaluator.behavior.behavior_sha256,
  "R5.9a evaluator surface transform changed target behavior");
  return deepFreeze(transformed);
}

export function r59SmokeReceipts() {
  enumerateR59Scenes();
  const concepts = [
    [{ kind: "exists", symbol: 0 }, [0, 3]],
    [{ kind: "all", symbol: 0 }, [3, 0]],
    [{ kind: "count-eq", symbol: 0, threshold: 2 }, [6, 0]],
    [{ kind: "count-ge", symbol: 0, threshold: 2 }, [1, 0]],
    [{ kind: "exists-and" }, [0, 3]],
    [{ kind: "exists-xor" }, [2, 7]],
    [{ kind: "count-compare", comparison: "greater" }, [4, 6]],
    [{ kind: "relation", relation: "left" }, [0, 3]],
    [{ kind: "boolean-and", orientation: 0, threshold: 2 }, [0, 3]],
    [{ kind: "boolean-or", orientation: 0, threshold: 2 }, [5, 7]],
  ];
  return concepts.map(([form, legend], index) => {
    let positiveScenes = 0;
    let hash = 14695981039346656037n;
    for (let sceneIndex = 0; sceneIndex < R59A_SCENE_COUNT; sceneIndex += 1) {
      const value = Number(formValue(form, legend, sceneIndex));
      positiveScenes += value;
      hash = BigInt.asUintN(64, (hash ^ BigInt(value)) *
        1099511628211n);
    }
    return {
      index,
      positive_scenes: positiveScenes,
      fnv1a64: hash.toString(16).padStart(16, "0"),
    };
  });
}

function targetStratumForAst(ast) {
  const form = ast.form;
  const first = R59A_ATOMS.indexOf(ast.legend.glyph_a);
  const second = R59A_ATOMS.indexOf(ast.legend.glyph_b);
  const domains = [atomDomain(first), atomDomain(second)];
  if (["exists-and", "exists-xor", "count-compare"].includes(form.kind) &&
      new Set(domains).has("color") && new Set(domains).has("shape"))
    return R59A_SHIFT_STRATA[0];
  if (form.kind === "relation" && domains[0] !== domains[1])
    return R59A_SHIFT_STRATA[1];
  if (["boolean-and", "boolean-or"].includes(form.kind) &&
      domains[0] !== domains[1]) return R59A_SHIFT_STRATA[2];
  if (["exists-xor", "count-compare"].includes(form.kind) &&
      domains[0] === domains[1]) return R59A_SHIFT_STRATA[3];
  return null;
}

function targetStratum(candidate) {
  return targetStratumForAst(candidate.ast);
}

export function r59HeldOutCompoundSignature(candidate) {
  const stratum = targetStratum(candidate);
  if (stratum === null) return null;
  const form = candidate.ast.form;
  const first = candidate.ast.legend.glyph_a;
  const second = candidate.ast.legend.glyph_b;
  if (stratum === R59A_SHIFT_STRATA[0])
    return `color-shape:${form.kind}:${[first, second].sort().join(":")}`;
  if (stratum === R59A_SHIFT_STRATA[1])
    return `relation-attribute:${form.relation}:${first}:${second}`;
  if (stratum === R59A_SHIFT_STRATA[2])
    return `operation-attribute:${form.kind}:${form.orientation}:` +
      `${form.threshold}:${first}:${second}`;
  return `episode-legend:${form.kind}:${form.comparison ?? "none"}:` +
    `${first}:${second}`;
}

const POPCOUNT8 = Uint8Array.from({ length: 256 }, (_, value) => {
  let count = 0;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
});

function behaviorDistance(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1)
    distance += POPCOUNT8[left[index] ^ right[index]];
  return distance;
}

function popcount32(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function fullClassMask(count) {
  const words = Math.ceil(count / 32);
  const mask = new Uint32Array(words);
  mask.fill(0xffffffff);
  const remainder = count % 32;
  if (remainder !== 0) mask[words - 1] = (2 ** remainder) - 1;
  return mask;
}

function matchingMask(current, truth, label) {
  const next = new Uint32Array(current.length);
  let count = 0;
  for (let word = 0; word < current.length; word += 1) {
    const matching = label ? truth[word] : (~truth[word]) >>> 0;
    next[word] = (current[word] & matching) >>> 0;
    count += popcount32(next[word]);
  }
  return { mask: next, count };
}

function maskCount(mask) {
  return mask.reduce((sum, word) => sum + popcount32(word), 0);
}

function targetTie(candidate, tieSalt) {
  return canonicalDigest("reasoner59a-semantic-tie", {
    tie_salt: tieSalt,
    behavior_sha256: candidate.semantic.behavior_sha256,
  });
}

function rankingOrderKey(root, generatorIndex, supportIndex, stratumIndex,
  ordinal, repeat) {
  return canonicalDigest("reasoner59a-ranking-order-key", {
    root, generatorIndex, supportIndex, stratumIndex, ordinal, repeat,
  }).slice(0, 16);
}

function supportSeed(root, generatorIndex, supportIndex, stratumIndex,
  ordinal, attempt) {
  return canonicalDigest("reasoner59a-support-seed", {
    root, generatorIndex, supportIndex, stratumIndex, ordinal, attempt,
  }).slice(0, 16);
}

function numericTie(seed, index) {
  let value = (Number.parseInt(seed.slice(0, 8), 16) ^ index) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function ensureBothLabels(selected, current, targetBehavior) {
  const labels = selected.map(sceneIndex =>
    behaviorLabel(targetBehavior, sceneIndex));
  for (const desired of [0, 1]) {
    if (labels.includes(desired)) continue;
    let best = null;
    for (let sceneIndex = 0; sceneIndex < R59A_SCENE_COUNT; sceneIndex += 1) {
      if (selected.includes(sceneIndex) ||
          behaviorLabel(targetBehavior, sceneIndex) !== desired) continue;
      const matched = matchingMask(current,
        UNIVERSE_CACHE.truthByScene[sceneIndex], desired);
      if (matched.count < R59A_AMBIGUITY_MINIMUM) continue;
      if (best === null || matched.count > best.count)
        best = { sceneIndex, ...matched };
    }
    assert(best, "R5.9a support needs positive and negative examples");
    selected.push(best.sceneIndex);
    labels.push(desired);
    current = best.mask;
  }
  return { selected, current };
}

function buildGreedySupport(target, seed) {
  const universe = enumerateR59Universe();
  const targetBehavior = r59BehaviorForCandidate(target);
  let current = fullClassMask(universe.semanticClasses);
  const selected = [];
  const selectedSet = new Set();
  while ((maskCount(current) > 48 || selected.length < 4) &&
         selected.length < 10) {
    let best = null;
    const before = maskCount(current);
    for (let sceneIndex = 0; sceneIndex < R59A_SCENE_COUNT; sceneIndex += 1) {
      if (selectedSet.has(sceneIndex)) continue;
      const label = behaviorLabel(targetBehavior, sceneIndex);
      const matched = matchingMask(current,
        universe.truthByScene[sceneIndex], label);
      if (matched.count >= before ||
          matched.count < R59A_AMBIGUITY_MINIMUM) continue;
      const distance = Math.abs(matched.count - 36);
      const tie = numericTie(seed, sceneIndex);
      if (best === null || distance < best.distance ||
          (distance === best.distance && tie < best.tie))
        best = { sceneIndex, label, distance, tie, ...matched };
    }
    if (best === null) break;
    selected.push(best.sceneIndex);
    selectedSet.add(best.sceneIndex);
    current = best.mask;
  }
  const balanced = ensureBothLabels(selected, current, targetBehavior);
  current = balanced.current;
  assert(maskCount(current) >= R59A_AMBIGUITY_MINIMUM,
    "R5.9a greedy support retained too few classes");
  return {
    sceneIndices: balanced.selected,
    labels: balanced.selected.map(index => behaviorLabel(targetBehavior, index)),
    consistentClasses: maskCount(current),
  };
}

function buildHardNegativeSupport(target, seed) {
  const universe = enumerateR59Universe();
  const targetBehavior = r59BehaviorForCandidate(target);
  const hard = universe.candidates.filter(candidate => candidate !== target)
    .map(candidate => ({ candidate, distance: behaviorDistance(
      targetBehavior, r59BehaviorForCandidate(candidate)) }))
    .sort((left, right) => left.distance - right.distance ||
      left.candidate.semantic.behavior_sha256.localeCompare(
        right.candidate.semantic.behavior_sha256)).slice(0, 24);
  let current = fullClassMask(universe.semanticClasses);
  const selected = [];
  const selectedSet = new Set();
  while ((maskCount(current) > 48 || selected.length < 4) &&
         selected.length < 10) {
    let best = null;
    const before = maskCount(current);
    for (let sceneIndex = 0; sceneIndex < R59A_SCENE_COUNT; sceneIndex += 1) {
      if (selectedSet.has(sceneIndex)) continue;
      const label = behaviorLabel(targetBehavior, sceneIndex);
      const matched = matchingMask(current,
        universe.truthByScene[sceneIndex], label);
      if (matched.count >= before ||
          matched.count < R59A_AMBIGUITY_MINIMUM) continue;
      const disagreements = hard.reduce((count, item) => count + Number(
        evaluateR59Candidate(item.candidate, sceneIndex) !== label), 0);
      const balance = selected.filter(index =>
        behaviorLabel(targetBehavior, index) === label).length;
      const utility = disagreements * 100_000 -
        Math.abs(matched.count - 36) * 100 - balance;
      const tie = numericTie(seed, sceneIndex);
      if (best === null || utility > best.utility ||
          (utility === best.utility && tie < best.tie))
        best = { sceneIndex, label, utility, tie, ...matched };
    }
    if (best === null) break;
    selected.push(best.sceneIndex);
    selectedSet.add(best.sceneIndex);
    current = best.mask;
  }
  const balanced = ensureBothLabels(selected, current, targetBehavior);
  current = balanced.current;
  assert(maskCount(current) >= R59A_AMBIGUITY_MINIMUM,
    "R5.9a hard-negative support retained too few classes");
  return {
    sceneIndices: balanced.selected,
    labels: balanced.selected.map(index => behaviorLabel(targetBehavior, index)),
    consistentClasses: maskCount(current),
  };
}

function buildSupport(target, root, generatorIndex, supportIndex,
  stratumIndex, ordinal, attempt) {
  const seed = supportSeed(root, generatorIndex, supportIndex, stratumIndex,
    ordinal, attempt);
  return supportIndex === 0 ? buildGreedySupport(target, seed) :
    buildHardNegativeSupport(target, seed);
}

const R59A_DEVELOPMENT_SIGNATURES_PER_STRATUM = 8;
const R59A_CALIBRATION_SIGNATURES_PER_STRATUM = 4;
const R59A_BEHAVIOR_CONSTRAINT_SCENES = Object.freeze(
  Array.from({ length: 12 }, (_, index) =>
    Math.floor(((index * 2) + 1) * R59A_SCENE_COUNT / 24)),
);
let SPLIT_SIGNATURE_CACHE = null;

function laneFromRoot(root) {
  const lane = Object.entries(LANE_ROOT).find(([, value]) => value === root)?.[0];
  assert(lane, "R5.9a target selection used an unregistered lane root");
  return lane;
}

export function r59GeneratorSplitPlan() {
  if (SPLIT_SIGNATURE_CACHE !== null) return SPLIT_SIGNATURE_CACHE;
  const strata = R59A_SHIFT_STRATA.map(stratum => {
    const signatures = [...new Set(enumerateR59Universe().candidates
      .filter(candidate => targetStratum(candidate) === stratum)
      .map(r59HeldOutCompoundSignature))].sort((left, right) =>
      canonicalDigest("reasoner59a-compound-partition-key", {
        stratum, signature: left,
      }).localeCompare(canonicalDigest("reasoner59a-compound-partition-key", {
        stratum, signature: right,
      })) || left.localeCompare(right));
    const development = signatures.slice(0,
      R59A_DEVELOPMENT_SIGNATURES_PER_STRATUM);
    const calibration = signatures.slice(
      R59A_DEVELOPMENT_SIGNATURES_PER_STRATUM,
      R59A_DEVELOPMENT_SIGNATURES_PER_STRATUM +
        R59A_CALIBRATION_SIGNATURES_PER_STRATUM);
    const source = signatures.slice(
      R59A_DEVELOPMENT_SIGNATURES_PER_STRATUM +
        R59A_CALIBRATION_SIGNATURES_PER_STRATUM);
    assert.equal(development.length,
      R59A_DEVELOPMENT_SIGNATURES_PER_STRATUM);
    assert.equal(calibration.length,
      R59A_CALIBRATION_SIGNATURES_PER_STRATUM);
    const sourceCandidates = enumerateR59Universe().candidates.filter(
      candidate => targetStratum(candidate) === stratum &&
        source.includes(r59HeldOutCompoundSignature(candidate)));
    assert(sourceCandidates.length >= 16,
      `R5.9a source split has too few ${stratum} candidates`);
    return {
      stratum,
      signatures_by_lane: {
        "source-training": source,
        calibration,
        development,
      },
    };
  });
  const body = {
    schema: "zero.reasoner59a_compound_split.v1",
    allocation_rule:
      "digest order, eight development, four calibration, remainder source",
    partition_key: "complete registered stratum compound signature",
    strata,
  };
  SPLIT_SIGNATURE_CACHE = deepFreeze({
    ...body,
    split_sha256: canonicalDigest("reasoner59a-compound-split", body),
  });
  return SPLIT_SIGNATURE_CACHE;
}

function stratumPool(lane, stratumIndex) {
  const stratum = R59A_SHIFT_STRATA[stratumIndex];
  const registered = r59GeneratorSplitPlan().strata[stratumIndex]
    .signatures_by_lane[lane];
  const candidates = enumerateR59Universe().candidates.filter(candidate =>
    targetStratum(candidate) === stratum &&
    registered.includes(r59HeldOutCompoundSignature(candidate)));
  assert(candidates.length >= (lane === "source-training" ? 16 : 2),
    `R5.9a ${lane} ${stratum} pool is too small`);
  return [...candidates].sort((left, right) =>
    left.semantic.behavior_sha256.localeCompare(
      right.semantic.behavior_sha256));
}

function targetSelectionRng(root, generatorIndex, supportIndex, stratumIndex,
  ordinal, attempt, namespace) {
  return createDeterministicRng(canonicalDigest(
    "reasoner59a-target-selection-seed", {
      root, generatorIndex, supportIndex, stratumIndex, ordinal, attempt,
    }).slice(0, 16), namespace);
}

function syntaxFirstDraw(lane, root, generatorIndex, supportIndex,
  stratumIndex, ordinal, attempt) {
  const classPool = new Set(stratumPool(lane, stratumIndex).map(candidate =>
    candidate.class_index));
  const stratum = R59A_SHIFT_STRATA[stratumIndex];
  const rawPool = enumerateR59Universe().rawPairs.filter(pair =>
    classPool.has(pair.class_index) &&
    targetStratumForAst(pair.ast) === stratum);
  assert(rawPool.length > 0, `R5.9a ${lane} syntax pool is empty`);
  const rng = targetSelectionRng(root, generatorIndex, supportIndex,
    stratumIndex, ordinal, attempt, "reasoner59a-syntax-first-raw-ast");
  const raw = rawPool[rng.index(rawPool.length)];
  const candidate = enumerateR59Universe().candidates[raw.class_index];
  const receipt = {
    schema: "zero.reasoner59a_generator_draw.v1",
    mechanism: "syntax-first",
    sampled_object: "uniform registered raw typed AST and legend pair",
    raw_pool_size: rawPool.length,
    raw_pair_index: raw.pair_index,
    raw_ast_sha256: raw.ast_sha256,
    selected_behavior_sha256: raw.behavior_sha256,
    selected_class_index: raw.class_index,
  };
  return { candidate, receipt: deepFreeze({
    ...receipt,
    receipt_sha256: canonicalDigest("reasoner59a-generator-draw", receipt),
  }) };
}

function behaviorConstraint(candidate) {
  const labels = R59A_BEHAVIOR_CONSTRAINT_SCENES.map(sceneIndex =>
    evaluateR59Candidate(candidate, sceneIndex));
  return {
    exact_positive_scenes: candidate.positive_scenes,
    probe_scene_indices: [...R59A_BEHAVIOR_CONSTRAINT_SCENES],
    probe_labels: labels,
  };
}

function behaviorConstraintDraw(lane, root, generatorIndex, supportIndex,
  stratumIndex, ordinal, attempt) {
  const candidates = stratumPool(lane, stratumIndex).filter(candidate => {
    const density = candidate.positive_scenes / R59A_SCENE_COUNT;
    const labels = behaviorConstraint(candidate).probe_labels;
    return density >= 0.1 && density <= 0.9 &&
      labels.includes(0) && labels.includes(1);
  });
  const groups = new Map();
  for (const candidate of candidates) {
    const constraint = behaviorConstraint(candidate);
    const key = canonicalDigest("reasoner59a-behavior-constraint", constraint);
    if (!groups.has(key)) groups.set(key, { constraint, candidates: [] });
    groups.get(key).candidates.push(candidate);
  }
  const constraints = [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right));
  const minimum = lane === "source-training" ? 8 :
    lane === "development" ? 2 : 1;
  assert(constraints.length >= minimum,
    `R5.9a ${lane} behavior constraint pool is too small`);
  const rng = createDeterministicRng(canonicalDigest(
    "reasoner59a-target-selection-seed", {
      root, generatorIndex, supportIndex, stratumIndex, ordinal, attempt,
    }).slice(0, 16), "reasoner59a-behavior-constraint-first");
  const [constraintSha256, selected] = constraints[rng.index(
    constraints.length)];
  const legal = [...selected.candidates].sort((left, right) =>
    left.ast.form.node_count - right.ast.form.node_count ||
    canonicalBytes(left.ast).compare(canonicalBytes(right.ast)));
  const candidate = legal[0];
  const receipt = {
    schema: "zero.reasoner59a_generator_draw.v1",
    mechanism: "behavior-constraint-first",
    sampled_object: "balanced exact behavior constraint",
    constraint_sha256: constraintSha256,
    constraint: selected.constraint,
    constraint_pool_size: constraints.length,
    legal_classes: legal.length,
    shortest_node_count: candidate.ast.form.node_count,
    selected_behavior_sha256: candidate.semantic.behavior_sha256,
    selected_class_index: candidate.class_index,
  };
  return { candidate, receipt: deepFreeze({
    ...receipt,
    receipt_sha256: canonicalDigest("reasoner59a-generator-draw", receipt),
  }) };
}

export function drawR59GeneratorTarget(root, generatorIndex, supportIndex,
  stratumIndex, ordinal, attempt) {
  const lane = laneFromRoot(root);
  assert([0, 1].includes(generatorIndex));
  return generatorIndex === 0 ? syntaxFirstDraw(lane, root, generatorIndex,
    supportIndex, stratumIndex, ordinal, attempt) :
    behaviorConstraintDraw(lane, root, generatorIndex, supportIndex,
      stratumIndex, ordinal, attempt);
}

function selectTarget(root, generatorIndex, supportIndex, stratumIndex,
  ordinal, attempt) {
  return drawR59GeneratorTarget(root, generatorIndex, supportIndex,
    stratumIndex, ordinal, attempt).candidate;
}

function evidenceLoss(candidate, publicView) {
  return publicView.support.reduce((loss, example) => loss + Number(
    evaluateR59Candidate(candidate, example.scene.scene_index) !==
      Number(example.label)), 0);
}

function sourceFreeScore(candidate, publicView) {
  const supportRate = publicView.support.reduce((sum, example) =>
    sum + Number(example.label), 0) / publicView.support.length;
  const candidateRate = candidate.positive_scenes / R59A_SCENE_COUNT;
  return -Math.round(Math.abs(candidateRate - supportRate) * 10_000) -
    candidate.ast.form.node_count * 4;
}

function targetOnlyCost(target, support, root, generatorIndex, supportIndex,
  stratumIndex, ordinal, attempt, repeat) {
  const tieSalt = rankingOrderKey(root, generatorIndex, supportIndex,
    stratumIndex, ordinal, repeat);
  const publicView = publicEpisode(support, tieSalt);
  const ranked = [...enumerateR59Universe().candidates].sort((left, right) => {
    const loss = evidenceLoss(left, publicView) - evidenceLoss(right, publicView);
    return loss || targetTie(left, tieSalt).localeCompare(
      targetTie(right, tieSalt));
  });
  const invalid = enumerateR59Universe().candidates.find(candidate =>
    candidate !== target &&
    candidate.semantic.behavior_sha256 !== target.semantic.behavior_sha256);
  const proposals = [invalid, ...ranked.filter(candidate =>
    candidate !== invalid)].slice(0, 64);
  const proposalPosition = proposals.findIndex(candidate =>
    candidate.semantic.behavior_sha256 === target.semantic.behavior_sha256);
  if (proposalPosition >= 0) return proposalPosition + 1;
  const seen = new Set(proposals.map(candidate =>
    candidate.semantic.behavior_sha256));
  let checks = seen.size;
  for (const candidate of r59CanonicalCandidates()) {
    if (seen.has(candidate.semantic.behavior_sha256)) continue;
    seen.add(candidate.semantic.behavior_sha256);
    checks += 1;
    if (candidate.semantic.behavior_sha256 ===
        target.semantic.behavior_sha256) return checks;
  }
  throw new Error("R5.9a target-only fallback omitted the target class");
}

let FAMILY_PLAN_CACHE = null;

function familyName(lane, generatorIndex, supportIndex, stratumIndex, ordinal) {
  const shortLane = lane === "source-training" ? "source" : lane;
  return `r59a-${shortLane}-g${generatorIndex}-b${supportIndex}-s${stratumIndex}` +
    `-${String(ordinal).padStart(2, "0")}`;
}

function registeredFamilyPlan() {
  if (FAMILY_PLAN_CACHE !== null) return FAMILY_PLAN_CACHE;
  const families = [];
  const usedBehaviors = new Set();
  const rejections = { duplicate_behavior: 0, headroom: 0, ambiguity: 0 };
  const addGenerated = (lane, generatorIndex, supportIndex, stratumIndex,
    ordinal) => {
    const root = LANE_ROOT[lane];
    let attempt = 0;
    for (; attempt < 4096; attempt += 1) {
      const draw = drawR59GeneratorTarget(root, generatorIndex, supportIndex,
        stratumIndex, ordinal, attempt);
      const target = draw.candidate;
      if (usedBehaviors.has(target.semantic.behavior_sha256)) {
        rejections.duplicate_behavior += 1;
        continue;
      }
      const support = buildSupport(target, root, generatorIndex, supportIndex,
        stratumIndex, ordinal, attempt);
      if (support.consistentClasses < R59A_AMBIGUITY_MINIMUM) {
        rejections.ambiguity += 1;
        continue;
      }
      if (lane === "development") {
        const costs = [0, 1].map(repeat => targetOnlyCost(target, support,
          root, generatorIndex, supportIndex, stratumIndex, ordinal, attempt,
          repeat)).sort((left, right) => left - right);
        const median = (costs[0] + costs[1]) / 2;
        if (median < R59A_HEADROOM_MINIMUM ||
            median > R59A_HEADROOM_MAXIMUM) {
          rejections.headroom += 1;
          continue;
        }
      }
      usedBehaviors.add(target.semantic.behavior_sha256);
      families.push({
        family_id: familyName(lane, generatorIndex, supportIndex,
          stratumIndex, ordinal),
        lane,
        generator_id: lane === "source-training" ?
          `source:${R59A_CONCEPT_GENERATORS[generatorIndex]}` :
          R59A_TRANSFER_DIRECTIONS[generatorIndex].id,
        shift_stratum: lane === "source-training" ?
          "source-symbolic-concepts" : R59A_SHIFT_STRATA[stratumIndex],
        family_spec: {
          schema: "zero.reasoner59a_family_spec.v1",
          concept_mechanism: R59A_CONCEPT_GENERATORS[generatorIndex],
          source_concept_mechanism: lane === "source-training" ?
            R59A_CONCEPT_GENERATORS[generatorIndex] :
            R59A_TRANSFER_DIRECTIONS[generatorIndex].sourceGenerator,
          target_concept_mechanism: R59A_CONCEPT_GENERATORS[generatorIndex],
          support_mechanism: R59A_SUPPORT_BUILDERS[supportIndex],
          semantic_stratum: lane === "source-training" ?
            `source-${R59A_SHIFT_STRATA[stratumIndex]}` :
            R59A_SHIFT_STRATA[stratumIndex],
          held_out_compound_signature: r59HeldOutCompoundSignature(target),
          generator_draw_sha256: draw.receipt.receipt_sha256,
          target_class_commitment: target.semantic.behavior_sha256,
        },
        coordinates: { lane, generatorIndex, supportIndex, stratumIndex,
          ordinal, attempt, targetClassIndex: target.class_index,
          generatorDrawSha256: draw.receipt.receipt_sha256 },
      });
      return;
    }
    throw new Error(`R5.9a family selection exhausted for ${lane}`);
  };
  for (let generator = 0; generator < 2; generator += 1)
    for (let ordinal = 0; ordinal < 32; ordinal += 1)
      addGenerated("source-training", generator, ordinal % 2,
        ordinal % R59A_SHIFT_STRATA.length, ordinal);
  for (let generator = 0; generator < 2; generator += 1)
    for (let stratum = 0; stratum < R59A_SHIFT_STRATA.length; stratum += 1)
      addGenerated("calibration", generator, (generator + stratum) % 2,
        stratum, 0);
  for (let stratum = 0; stratum < R59A_SHIFT_STRATA.length; stratum += 1)
    for (let generator = 0; generator < 2; generator += 1)
      for (let support = 0; support < 2; support += 1)
        addGenerated("development", generator, support, stratum, 0);
  for (let stratum = 0; stratum < R59A_SHIFT_STRATA.length; stratum += 1)
    for (let generator = 0; generator < 2; generator += 1)
      for (let support = 0; support < 2; support += 1)
        families.push({
          family_id: familyName("sealed", generator, support, stratum, 0),
          lane: "sealed",
          generator_id: R59A_TRANSFER_DIRECTIONS[generator].id,
          shift_stratum: R59A_SHIFT_STRATA[stratum],
          family_spec: {
            schema: "zero.reasoner59a_sealed_family_slot.v1",
            concept_mechanism: R59A_CONCEPT_GENERATORS[generator],
            source_concept_mechanism:
              R59A_TRANSFER_DIRECTIONS[generator].sourceGenerator,
            target_concept_mechanism: R59A_CONCEPT_GENERATORS[generator],
            support_mechanism: R59A_SUPPORT_BUILDERS[support],
            semantic_stratum: R59A_SHIFT_STRATA[stratum],
            prospective_commitment: canonicalDigest(
              "reasoner59a-prospective-family-slot",
              { generator, support, stratum }),
          },
          coordinates: { lane: "sealed", generatorIndex: generator,
            supportIndex: support, stratumIndex: stratum, ordinal: 0,
            attempt: null, targetClassIndex: null },
        });
  FAMILY_PLAN_CACHE = deepFreeze({ families, rejections });
  return FAMILY_PLAN_CACHE;
}

export const R59A_DERANGEMENT_SEED = "59ad3a6e00000001";
let DERANGEMENT_CACHE = null;

function featureEventSubtype(key) {
  const subtype = key.split(":", 1)[0];
  assert(subtype.length > 0, "R5.9a feature event subtype is empty");
  return subtype;
}

function featureVocabulary() {
  const vocabulary = { production: new Set(), subtree: new Set(),
    binding: new Set(), atom: new Set() };
  for (const candidate of enumerateR59Universe().candidates)
    for (const group of Object.keys(vocabulary))
      for (const key of candidate.feature_groups[group])
        vocabulary[group].add(key);
  return Object.fromEntries(Object.entries(vocabulary).map(([group, keys]) =>
    [group, [...keys].sort()]));
}

export function buildR59Derangements() {
  if (DERANGEMENT_CACHE !== null) return DERANGEMENT_CACHE;
  const vocabulary = featureVocabulary();
  const rng = createDeterministicRng(R59A_DERANGEMENT_SEED,
    "reasoner59a-prior-derangements-v1");
  const subtypePartitions = Object.fromEntries(Object.entries(vocabulary).map(
    ([group, keys]) => {
      const partitions = {};
      for (const [index, key] of keys.entries()) {
        const subtype = featureEventSubtype(key);
        if (!Object.hasOwn(partitions, subtype)) partitions[subtype] = [];
        partitions[subtype].push(index);
      }
      return [group, partitions];
    }));
  const permutations = [];
  const seen = new Set();
  while (permutations.length < 31) {
    const byGroup = {};
    for (const [group, keys] of Object.entries(vocabulary)) {
      const permutation = Array.from({ length: keys.length }, (_, index) => index);
      for (const indices of Object.values(subtypePartitions[group])) {
        if (indices.length === 1) continue;
        let shuffled;
        do {
          shuffled = [...indices];
          for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const other = rng.index(index + 1);
            [shuffled[index], shuffled[other]] =
              [shuffled[other], shuffled[index]];
          }
        } while (shuffled.some((value, index) => value === indices[index]));
        for (let index = 0; index < indices.length; index += 1)
          permutation[indices[index]] = shuffled[index];
      }
      byGroup[group] = permutation;
    }
    const key = JSON.stringify(byGroup);
    if (seen.has(key)) continue;
    seen.add(key);
    permutations.push(deepFreeze(byGroup));
  }
  DERANGEMENT_CACHE = deepFreeze({
    seed: R59A_DERANGEMENT_SEED,
    namespace: "reasoner59a-prior-derangements-v1",
    event_subtype_rule: "feature token prefix before the first colon",
    subtype_partitions: subtypePartitions,
    permutations,
    sha256: canonicalDigest("reasoner59a-prior-derangements", {
      subtype_partitions: subtypePartitions,
      permutations,
    }),
  });
  return DERANGEMENT_CACHE;
}

let ARTIFACT_CACHE = null;
const R59A_LOG_Q = 1 << 20;

function normalizedFeatureGroups(vocabulary, counts) {
  return Object.fromEntries(Object.keys(vocabulary).map(group => {
    const total = counts[group].reduce((sum, value) => sum + value, 0);
    return [group, {
      keys: vocabulary[group],
      counts: counts[group],
      total,
      log_prob_q20: counts[group].map(count =>
        Math.round(Math.log(count / total) * R59A_LOG_Q)),
    }];
  }));
}

function artifactBodyFromPlan() {
  const plan = registeredFamilyPlan();
  const vocabulary = featureVocabulary();
  const indexes = Object.fromEntries(Object.entries(vocabulary).map(
    ([group, keys]) => [group, new Map(keys.map((key, index) => [key, index]))]));
  const sourceFamilies = plan.families.filter(family =>
    family.lane === "source-training").sort((left, right) =>
    left.family_id.localeCompare(right.family_id));
  const components = R59A_CONCEPT_GENERATORS.map(sourceGenerator => {
    const families = sourceFamilies.filter(family =>
      family.family_spec.concept_mechanism === sourceGenerator);
    const counts = Object.fromEntries(Object.entries(vocabulary).map(
      ([group, keys]) => [group, Array(keys.length).fill(1)]));
    for (const family of families) {
      const candidate = enumerateR59Universe().candidates[
        family.coordinates.targetClassIndex];
      for (const group of Object.keys(vocabulary))
        for (const key of candidate.feature_groups[group])
          counts[group][indexes[group].get(key)] += 1;
    }
    return {
      source_generator: sourceGenerator,
      target_generator: R59A_CONCEPT_GENERATORS.find(value =>
        value !== sourceGenerator),
      feature_groups: normalizedFeatureGroups(vocabulary, counts),
      source_family_ids: families.map(family => family.family_id),
      source_target_classes: families.map(family =>
        family.family_spec.target_class_commitment),
      training_cost: {
        source_families: families.length,
        labeled_concepts: families.length,
        feature_updates: families.reduce((sum, family) => sum +
          Object.values(enumerateR59Universe().candidates[
            family.coordinates.targetClassIndex].feature_groups)
            .reduce((inner, values) => inner + values.length, 0), 0),
      },
    };
  });
  return {
    schema: "zero.reasoner59a_concept_prior.v1",
    smoothing: 1,
    event_weight: 1,
    probability_rule: "groupwise categorical count divided by group total",
    log_encoding: { base: "natural", scale: R59A_LOG_Q,
      rounding: "nearest-integer" },
    document_length_rule:
      "sum Q20 log probabilities over exactly two events in each enabled group",
    transfer_rule: "use only the component trained by the opposite concept generator",
    components,
    source_family_ids: sourceFamilies.map(family => family.family_id),
    source_target_classes: sourceFamilies.map(family =>
      family.family_spec.target_class_commitment),
    training_cost: {
      source_families: sourceFamilies.length,
      labeled_concepts: sourceFamilies.length,
      feature_updates: sourceFamilies.reduce((sum, family) => sum +
        Object.values(enumerateR59Universe().candidates[
          family.coordinates.targetClassIndex].feature_groups)
          .reduce((inner, values) => inner + values.length, 0), 0),
    },
  };
}

export function buildR59SourceArtifact() {
  if (ARTIFACT_CACHE !== null) return ARTIFACT_CACHE;
  const body = artifactBodyFromPlan();
  const canonical = canonicalBytes(body);
  ARTIFACT_CACHE = deepFreeze({
    ...body,
    canonical_bytes: canonical.length,
    artifact_sha256: canonicalDigest("reasoner59a-source-artifact", body),
  });
  return ARTIFACT_CACHE;
}

export function parseR59SourceArtifact(value) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  const artifact = structuredClone(value);
  const digest = artifact.artifact_sha256;
  const canonicalBytesClaim = artifact.canonical_bytes;
  delete artifact.artifact_sha256;
  delete artifact.canonical_bytes;
  assert.match(digest, SHA256);
  assert.equal(canonicalDigest("reasoner59a-source-artifact", artifact), digest,
    "R5.9a source artifact digest");
  assert.equal(canonicalBytes(artifact).length, canonicalBytesClaim,
    "R5.9a source artifact byte count");
  assert.equal(artifact.schema, "zero.reasoner59a_concept_prior.v1");
  assert.equal(artifact.smoothing, 1);
  assert.equal(artifact.event_weight, 1);
  assert.deepEqual(artifact.log_encoding, { base: "natural",
    scale: R59A_LOG_Q, rounding: "nearest-integer" });
  assert.equal(artifact.source_family_ids.length, 64);
  assert.equal(artifact.components.length, 2);
  assert.deepEqual(artifact.components.map(component =>
    component.source_generator).sort(), [...R59A_CONCEPT_GENERATORS].sort());
  for (const component of artifact.components) {
    assert.equal(component.source_family_ids.length, 32);
    assert.notEqual(component.source_generator, component.target_generator);
    for (const group of ["production", "subtree", "binding", "atom"]) {
      const table = component.feature_groups[group];
      assert(table && Array.isArray(table.keys) && Array.isArray(table.counts));
      assert.equal(table.keys.length, table.counts.length);
      assert.equal(table.keys.length, table.log_prob_q20.length);
      assert(table.counts.every(count => Number.isSafeInteger(count) && count > 0));
      assert.equal(table.total, table.counts.reduce((sum, count) =>
        sum + count, 0));
      assert.deepEqual(table.log_prob_q20, table.counts.map(count =>
        Math.round(Math.log(count / table.total) * R59A_LOG_Q)));
    }
  }
  return deepFreeze({ ...artifact, canonical_bytes: canonicalBytesClaim,
    artifact_sha256: digest });
}

const ARTIFACT_INDEX_CACHE = new WeakMap();

function artifactIndexes(component) {
  if (ARTIFACT_INDEX_CACHE.has(component)) return ARTIFACT_INDEX_CACHE.get(component);
  const indexes = Object.fromEntries(Object.entries(component.feature_groups)
    .map(([group, table]) => [group,
      new Map(table.keys.map((key, index) => [key, index]))]));
  ARTIFACT_INDEX_CACHE.set(component, indexes);
  return indexes;
}

export function scoreR59Candidate(candidate, artifact, mode = "full",
  derangementIndex = null, sourceGenerator = null) {
  assert(R59A_CONCEPT_GENERATORS.includes(sourceGenerator),
    "R5.9a score needs a registered source generator");
  const component = artifact.components.find(item =>
    item.source_generator === sourceGenerator);
  const indexes = component === undefined ? null : artifactIndexes(component);
  const derangement = derangementIndex === null ? null :
    buildR59Derangements().permutations[derangementIndex];
  const groups = mode === "frequency-only" ? ["atom"] :
    mode === "binding-off" ? ["production", "subtree", "atom"] :
      ["production", "subtree", "binding", "atom"];
  let score = 0;
  if (component === undefined) return score;
  for (const group of groups) {
    const table = component.feature_groups[group];
    for (const key of candidate.feature_groups[group]) {
      const index = indexes[group].get(key);
      assert(index !== undefined, `unknown R5.9a artifact feature ${key}`);
      const selected = derangement === null ? index :
        derangement[group][index];
      score += table.log_prob_q20[selected];
    }
  }
  return score;
}

function publicScene(scene, sceneIndex) {
  const cellNames = ["r0c0", "r0c1", "r1c0", "r1c1"];
  const colorNames = ["red", "green", "blue"];
  const shapeNames = ["circle", "square", "triangle"];
  const sizeNames = ["small", "large"];
  return {
    scene_index: sceneIndex,
    objects: scene.objects.map(object => ({
      cell: cellNames[object.cell],
      color: colorNames[object.color],
      shape: shapeNames[object.shape],
      size: sizeNames[object.size],
    })),
  };
}

function publicEpisode(support, rankingOrderKeyValue) {
  const scenes = enumerateR59Scenes();
  return {
    protocol: "reasoner59a-exact-symbolic-v1",
    ranking_order_key: rankingOrderKeyValue,
    legend_symbols: ["glyph-a", "glyph-b"],
    support: support.sceneIndices.map((sceneIndex, index) => ({
      scene: publicScene(scenes[sceneIndex], sceneIndex),
      label: Boolean(support.labels[index]),
    })),
    grammar: {
      max_ast_nodes: 7,
      forms: R59A_FORMS.map(formProduction),
      joint_candidate_cap: R59A_JOINT_CANDIDATE_CAP,
    },
    allowed_actions: [
      { kind: "propose-canonical-ast-and-legend" },
      { kind: "request-exact-verification" },
      { kind: "canonical-exhaustive-fallback" },
    ],
  };
}

export const R59A_RANKER_POLICY = deepFreeze({
  schema: "zero.reasoner5_ranker_policy.v1",
  leaf_whitelist: [
    "protocol",
    "ranking_order_key",
    "legend_symbols[]",
    "support[].scene.scene_index",
    "support[].scene.objects[].cell",
    "support[].scene.objects[].color",
    "support[].scene.objects[].shape",
    "support[].scene.objects[].size",
    "support[].label",
    "grammar.max_ast_nodes",
    "grammar.forms[]",
    "grammar.joint_candidate_cap",
    "allowed_actions[].kind",
  ],
  leaf_contracts: {
    protocol: { type: "string", provenance: "public-constant" },
    ranking_order_key: { type: "string", provenance: "public-constant" },
    "legend_symbols[]": { type: "string", provenance: "public-constant" },
    "support[].scene.scene_index": { type: "integer",
      provenance: "generated-query" },
    "support[].scene.objects[].cell": { type: "string",
      provenance: "observed-response" },
    "support[].scene.objects[].color": { type: "string",
      provenance: "observed-response" },
    "support[].scene.objects[].shape": { type: "string",
      provenance: "observed-response" },
    "support[].scene.objects[].size": { type: "string",
      provenance: "observed-response" },
    "support[].label": { type: "boolean", provenance: "observed-response" },
    "grammar.max_ast_nodes": { type: "integer",
      provenance: "public-constant" },
    "grammar.forms[]": { type: "string", provenance: "public-constant" },
    "grammar.joint_candidate_cap": { type: "integer",
      provenance: "public-constant" },
    "allowed_actions[].kind": { type: "string",
      provenance: "allowed-action" },
  },
});

const CONCEPT_GENERATOR_SPECS = R59A_CONCEPT_GENERATORS.map(
  (generator, index) => ({
    schema: "zero.reasoner59a_concept_generator.v1",
    generator,
    rule: index === 0 ?
      "sample a registered raw typed AST and legend pair uniformly, then take its exact canonical behavior class" :
      "sample a balanced exact-density and 12-probe behavior constraint uniformly, then take its shortest legal AST",
    sampled_object: index === 0 ? "raw-typed-ast-and-legend" :
      "behavior-constraint",
    raw_pair_order_sha256: enumerateR59Universe().rawPairOrderSha256,
    compound_split_sha256: r59GeneratorSplitPlan().split_sha256,
    implementation_sha256: replayFunctionDigest(index === 0 ?
      syntaxFirstDraw : behaviorConstraintDraw),
    ...(index === 0 ? {} : {
      behavior_constraint_probe_scenes:
        [...R59A_BEHAVIOR_CONSTRAINT_SCENES],
      positive_density_range: [0.1, 0.9],
      shortest_tie_rule: "node count then canonical AST bytes",
    }),
  }));
const SUPPORT_BUILDER_SPECS = R59A_SUPPORT_BUILDERS.map((builder, index) => ({
  schema: "zero.reasoner59a_support_builder.v1",
  builder,
  rule: index === 0 ?
    "greedy version-space split while retaining registered ambiguity" :
    "nearby hard-negative split with balanced labels and retained ambiguity",
}));
export const R59A_GENERATOR_DIGESTS = deepFreeze(
  CONCEPT_GENERATOR_SPECS.map(spec =>
    canonicalDigest("reasoner59a-concept-generator", spec)));
export const R59A_SUPPORT_DIGESTS = deepFreeze(SUPPORT_BUILDER_SPECS.map(spec =>
  canonicalDigest("reasoner59a-support-builder", spec)));

function episodeRecipe(family, repeat) {
  const coordinates = family.coordinates;
  return {
    schema: "zero.reasoner5_replay_recipe.v1",
    generator_sha256: R59A_GENERATOR_DIGESTS[coordinates.generatorIndex],
    input_generator_sha256: R59A_SUPPORT_DIGESTS[coordinates.supportIndex],
    replay_function_sha256: replayFunctionDigest(replayR59Episode),
    seed_binding: {
      root_seed: LANE_ROOT[coordinates.lane],
      derivation_path: ["reasoner59a-symbolic-episode-v1",
        LANE_CODE[coordinates.lane], coordinates.generatorIndex,
        coordinates.supportIndex, coordinates.stratumIndex,
        coordinates.ordinal, coordinates.attempt, repeat],
    },
  };
}

export function replayR59Episode(recipe) {
  assert.equal(recipe.schema, "zero.reasoner5_replay_recipe.v1");
  const [tag, laneCode, generatorIndex, supportIndex, stratumIndex,
    ordinal, attempt, repeat] = recipe.seed_binding.derivation_path;
  assert.equal(tag, "reasoner59a-symbolic-episode-v1");
  const lane = Object.keys(LANE_CODE).find(key => LANE_CODE[key] === laneCode);
  assert(lane && LANE_ROOT[lane] === recipe.seed_binding.root_seed);
  assert.equal(recipe.generator_sha256, R59A_GENERATOR_DIGESTS[generatorIndex]);
  assert.equal(recipe.input_generator_sha256, R59A_SUPPORT_DIGESTS[supportIndex]);
  const draw = drawR59GeneratorTarget(recipe.seed_binding.root_seed,
    generatorIndex, supportIndex, stratumIndex, ordinal, attempt);
  const target = draw.candidate;
  const support = buildSupport(target, recipe.seed_binding.root_seed,
    generatorIndex, supportIndex, stratumIndex, ordinal, attempt);
  const tieSalt = rankingOrderKey(recipe.seed_binding.root_seed,
    generatorIndex, supportIndex, stratumIndex, ordinal, repeat);
  return {
    public: publicEpisode(support, tieSalt),
    evaluator: {
      ast: target.ast,
      behavior: target.semantic,
      episode_spec: {
        protocol: "zero.reasoner59a_episode_spec.v1",
        concept_generator: R59A_CONCEPT_GENERATORS[generatorIndex],
        source_concept_generator: lane === "source-training" ?
          R59A_CONCEPT_GENERATORS[generatorIndex] :
          R59A_TRANSFER_DIRECTIONS[generatorIndex].sourceGenerator,
        target_concept_generator: R59A_CONCEPT_GENERATORS[generatorIndex],
        support_builder: R59A_SUPPORT_BUILDERS[supportIndex],
        semantic_stratum: lane === "source-training" ?
          `source-${R59A_SHIFT_STRATA[stratumIndex]}` :
          R59A_SHIFT_STRATA[stratumIndex],
        target_class_index: target.class_index,
        support_scene_indices: support.sceneIndices,
        consistent_semantic_classes: support.consistentClasses,
        selection_attempt: attempt,
        generator_draw: draw.receipt,
      },
      target: target.semantic,
      tie_salt: tieSalt,
      atoms: [target.ast.legend.glyph_a, target.ast.legend.glyph_b].sort(),
      typed_subtrees: Object.values(target.feature_groups).flat().sort(),
      held_out_compounds: [r59HeldOutCompoundSignature(target)],
      exact_test_domain: {
        scenes: R59A_SCENE_COUNT,
        scene_universe_sha256: r59SceneUniverseSha256(),
      },
    },
  };
}

function episodeCandidates() {
  return enumerateR59Universe().candidates;
}

function parityValues(content, candidates) {
  return {
    candidates,
    grammar: content.public.grammar,
    initial_evidence: content.public.support,
    allowed_actions: content.public.allowed_actions,
    latent_episode: {
      ast: content.evaluator.ast,
      behavior: content.evaluator.behavior,
    },
    potential_response: {
      type: "complete-symbolic-scene-behavior",
      scene_universe_sha256:
        content.evaluator.exact_test_domain.scene_universe_sha256,
      target_behavior_sha256:
        content.evaluator.behavior.behavior_sha256,
    },
    verifier: {
      type: "exhaustive-symbolic-scene-equivalence",
      scenes: R59A_SCENE_COUNT,
      feedback: "accept-reject-only",
    },
    caps: {
      proposal_semantic_classes: 64,
      global_verifier_checks: candidates.length,
      unsolved_cost: candidates.length + 1,
      fallback_order: "shared-canonical-candidate-order-v1",
    },
  };
}

function parityReceipts(content, candidates) {
  const first = armParityReceipt({
    arm: R59A_ARMS[0],
    ...parityValues(content, candidates),
  });
  const { receipt_sha256: _digest, ...template } = first;
  return R59A_ARMS.map(arm => {
    const body = { ...structuredClone(template), arm };
    return {
      ...body,
      receipt_sha256: canonicalDigest("arm-parity-receipt", body),
    };
  });
}

export const R59A_ANALYSIS_SETTINGS = deepFreeze({
  schema: "zero.reasoner59a_symbolic_analysis_settings.v1",
  primary_cost: "distinct semantic classes submitted to exact verifier",
  primary_contrast: "full versus target_only",
  family_unit: ["generator_id", "family_id"],
  nested_repeat: "nested_repeat_id",
  bootstrap_replicates: 2_000,
  primary_alpha: 0.005,
  stratum_alpha: 0.05,
  required_primary_strata: [
    "four semantic shifts",
    "two transfer directions",
    "two support builders",
  ],
  mechanism_family_alpha: 0.05,
  derangements: 31,
});

function comparison(fullArm, comparatorArm, direction, seed, alpha) {
  return {
    full_arm: fullArm,
    comparator_arm: comparatorArm,
    design: "one-way",
    unit_fields: ["generator_id", "family_id"],
    direction,
    seed,
    replicates: R59A_ANALYSIS_SETTINGS.bootstrap_replicates,
    alpha,
    environment_field: "generator_id",
  };
}

function analysisContract() {
  const developmentFamilies = registeredFamilyPlan().families.filter(family =>
    family.lane === "development");
  const shiftAnalyses = R59A_SHIFT_STRATA.map((name, index) => ({
    name: `shift:${name}`,
    ...comparison("full", "target_only", "lower",
      `59a2${String(index).padStart(12, "0")}`, 0.05),
    field: "shift_stratum",
    values: [name],
  }));
  const directionAnalyses = R59A_TRANSFER_DIRECTIONS.map((direction, index) => ({
    name: `direction:${direction.id}`,
    ...comparison("full", "target_only", "lower",
      `59a4${String(index).padStart(12, "0")}`, 0.05),
    field: "generator_id",
    values: [direction.id],
  }));
  const supportAnalyses = R59A_SUPPORT_BUILDERS.map((builder, index) => ({
    name: `support:${builder}`,
    ...comparison("full", "target_only", "lower",
      `59a5${String(index).padStart(12, "0")}`, 0.05),
    field: "family_id",
    values: developmentFamilies.filter(family =>
      family.family_spec.support_mechanism === builder).map(family =>
      family.family_id).sort(),
  }));
  const stratumAnalyses = [
    ...shiftAnalyses,
    ...directionAnalyses,
    ...supportAnalyses,
  ];
  return {
    schema: "zero.reasoner5_analysis_contract.v1",
    expected_arms: [...R59A_ARMS],
    selected_lanes: ["development"],
    source_isolated_arms: [...R59A_SOURCE_ISOLATED_ARMS],
    trace_schema: "zero.reasoner5_trace_row.v1",
    primary_cost_rule: "verified-search",
    analysis_settings_sha256: canonicalDigest("analysis-settings",
      R59A_ANALYSIS_SETTINGS),
    analysis_function_sha256: analysisFunctionDigest(
      reconstructR59Development),
    primary_analysis: comparison("full", "target_only", "lower",
      "59a1000000000001", 0.005),
    stratum_analyses: stratumAnalyses,
    mechanism_analyses: [{
      name: "legend-binding-features",
      ...comparison("binding_off", "full", "higher",
        "59a3000000000001", 0.05),
    }],
    factorial_analysis: null,
    derangement_analysis: {
      observed_arm: "full",
      reference_arms: [...R59A_DERANGEMENT_ARMS],
      unit_fields: ["generator_id", "family_id"],
    },
    source_ablation: {
      ablation_arm: "source_ablation",
      source_free_arm: "source_free_jit",
    },
    headroom: {
      comparator_arm: "target_only",
      median_primary_cost_min: R59A_HEADROOM_MINIMUM,
    },
    common_gate_registration: {
      primary_alpha: 0.005,
      primary_strata: stratumAnalyses.map(analysis => analysis.name),
      formal_mechanisms: ["legend-binding-features"],
      crossed_design: false,
      marginal_axes: [],
      derangements: 31,
      mechanism_family_alpha: 0.05,
      factorial_interaction_required: false,
    },
  };
}

export function reconstructR59SourceArtifact(episodes) {
  const source = episodes.filter(episode => episode.lane === "source-training")
    .sort((left, right) => left.family_id.localeCompare(right.family_id));
  assert.equal(source.length, 64,
    "R5.9a source artifact needs every source family episode");
  const vocabulary = featureVocabulary();
  const indexes = Object.fromEntries(Object.entries(vocabulary).map(
    ([group, keys]) => [group, new Map(keys.map((key, index) => [key, index]))]));
  const components = R59A_CONCEPT_GENERATORS.map(sourceGenerator => {
    const selected = source.filter(episode =>
      episode.content.evaluator.episode_spec.concept_generator ===
        sourceGenerator);
    assert.equal(selected.length, 32,
      `R5.9a needs 32 ${sourceGenerator} source families`);
    const counts = Object.fromEntries(Object.entries(vocabulary).map(
      ([group, keys]) => [group, Array(keys.length).fill(1)]));
    for (const episode of selected) {
      const behaviorSha256 = episode.content.evaluator.behavior.behavior_sha256;
      const candidate = enumerateR59Universe().candidates.find(item =>
        item.semantic.behavior_sha256 === behaviorSha256);
      assert(candidate, `unknown R5.9a source class ${behaviorSha256}`);
      for (const group of Object.keys(vocabulary))
        for (const key of candidate.feature_groups[group])
          counts[group][indexes[group].get(key)] += 1;
    }
    return {
      source_generator: sourceGenerator,
      target_generator: R59A_CONCEPT_GENERATORS.find(value =>
        value !== sourceGenerator),
      feature_groups: normalizedFeatureGroups(vocabulary, counts),
      source_family_ids: selected.map(episode => episode.family_id),
      source_target_classes: selected.map(episode =>
        episode.content.evaluator.behavior.behavior_sha256),
      training_cost: {
        source_families: selected.length,
        labeled_concepts: selected.length,
        feature_updates: selected.reduce((sum, episode) => {
          const candidate = enumerateR59Universe().candidates.find(item =>
            item.semantic.behavior_sha256 ===
              episode.content.evaluator.behavior.behavior_sha256);
          return sum + Object.values(candidate.feature_groups).reduce(
            (inner, values) => inner + values.length, 0);
        }, 0),
      },
    };
  });
  return {
    schema: "zero.reasoner59a_concept_prior.v1",
    smoothing: 1,
    event_weight: 1,
    probability_rule: "groupwise categorical count divided by group total",
    log_encoding: { base: "natural", scale: R59A_LOG_Q,
      rounding: "nearest-integer" },
    document_length_rule:
      "sum Q20 log probabilities over exactly two events in each enabled group",
    transfer_rule: "use only the component trained by the opposite concept generator",
    components,
    source_family_ids: source.map(episode => episode.family_id),
    source_target_classes: source.map(episode =>
      episode.content.evaluator.behavior.behavior_sha256),
    training_cost: {
      source_families: source.length,
      labeled_concepts: source.length,
      feature_updates: source.reduce((sum, episode) => {
        const candidate = enumerateR59Universe().candidates.find(item =>
          item.semantic.behavior_sha256 ===
            episode.content.evaluator.behavior.behavior_sha256);
        return sum + Object.values(candidate.feature_groups).reduce(
          (inner, values) => inner + values.length, 0);
      }, 0),
    },
  };
}

function compoundOverlapReceipt(episodes, leftLane, rightLane) {
  const values = lane => new Set(episodes.filter(episode =>
    episode.lane === lane).flatMap(episode =>
    episode.content.evaluator.held_out_compounds));
  const left = values(leftLane);
  const right = values(rightLane);
  const overlap = [...left].filter(value => right.has(value)).sort();
  return {
    schema: "zero.reasoner59a_compound_overlap.v1",
    field: "held_out_compounds",
    left_lane: leftLane,
    right_lane: rightLane,
    left_distinct: left.size,
    right_distinct: right.size,
    overlap_count: overlap.length,
    overlap_sha256: canonicalDigest("reasoner59a-compound-overlap", overlap),
  };
}

export function buildR59Manifest(artifact = buildR59SourceArtifact()) {
  const parsedArtifact = parseR59SourceArtifact(artifact);
  const state = createSplitState({ experiment_id: R59A_EXPERIMENT });
  const plan = registeredFamilyPlan();
  for (const family of plan.families) {
    const { coordinates: _coordinates, ...registration } = family;
    registerFamily(state, registration);
  }
  freezeFamilySplits(state);
  const candidates = episodeCandidates();
  for (const family of plan.families.filter(item => item.lane !== "sealed")) {
    const repeats = family.lane === "development" ? 2 : 1;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const recipe = episodeRecipe(family, repeat);
      const content = replayR59Episode(recipe);
      assert.equal(content.evaluator.episode_spec.target_class_index,
        family.coordinates.targetClassIndex,
      "R5.9a family plan and replay target differ");
      assert.equal(content.evaluator.episode_spec.generator_draw.receipt_sha256,
        family.coordinates.generatorDrawSha256,
      "R5.9a family plan and replay generator draw differ");
      assertRankerView(content.public, {
        whitelist: R59A_RANKER_POLICY.leaf_whitelist,
        leafContracts: R59A_RANKER_POLICY.leaf_contracts,
      });
      const receipts = parityReceipts(content, candidates);
      const base = receipts[0];
      registerEpisode(state, {
        episode_id: `${family.family_id}-repeat-${repeat}`,
        lane: family.lane,
        family_id: family.family_id,
        cross_family_id: null,
        nested_repeat_id: `repeat-${repeat}`,
        seed_ref: canonicalDigest("episode-seed-reference", recipe),
        replay_recipe: recipe,
        ranker_policy: R59A_RANKER_POLICY,
        public: content.public,
        evaluator: content.evaluator,
        expected_arms: [...R59A_ARMS],
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
  }
  const reconstructed = reconstructR59SourceArtifact(state.episodes);
  assert.equal(canonicalDigest("reasoner59a-source-artifact", reconstructed),
    parsedArtifact.artifact_sha256,
  "R5.9a source artifact differs from source episodes");
  const overlap = [];
  for (const [leftLane, rightLane] of [["source-training", "development"],
    ["calibration", "development"]])
    for (const field of ["atoms", "typed_subtrees"])
      overlap.push(overlapReceipt(state.episodes, field, leftLane, rightLane));
  const compoundOverlap = [
    compoundOverlapReceipt(state.episodes, "source-training", "development"),
    compoundOverlapReceipt(state.episodes, "calibration", "development"),
  ];
  assert(compoundOverlap.every(receipt => receipt.overlap_count === 0),
    "R5.9a held-out compound partition leaked across lanes");
  const universe = enumerateR59Universe();
  const derangements = buildR59Derangements();
  return finalizeManifest(state, {
    status: "development-only",
    execution: {
      authorized: false,
      sealed_seeds_present: false,
      scientific_executions: 0,
    },
    ordered_stage_contract: {
      reasoner59a: "symbolic-prerequisite",
      reasoner59b: "pixel-stage-closed",
      reasoner59b_execution_authorized: false,
      reasoner59b_requires_reasoner59a_pass: true,
      full_reasoner59b_freeze_required_before_sealed_reasoner59a: true,
      required_reasoner59b_commitments: {
        parser_bytes_sha256: null,
        renderer_code_sha256: null,
        renderer_settings_sha256: null,
        paired_pixel_manifest_sha256: null,
        controls_sha256: null,
        analysis_sha256: null,
      },
    },
    domain: {
      scene_count: R59A_SCENE_COUNT,
      scene_universe_sha256: r59SceneUniverseSha256(),
      max_ast_nodes: 7,
      joint_ast_legend_pairs: universe.jointPairs,
      joint_candidate_cap: R59A_JOINT_CANDIDATE_CAP,
      enumerator_truncates: false,
      semantic_classes: universe.semanticClasses,
      semantic_collisions: universe.semanticCollisions,
      candidate_universe_sha256: universe.sha256,
      semantic_identity: "complete Boolean behavior over all 25344 scenes",
      canonical_representative_rule: universe.representativeRule,
    },
    concept_generators: CONCEPT_GENERATOR_SPECS,
    support_builders: SUPPORT_BUILDER_SPECS,
    family_selection: {
      ambiguity_minimum: R59A_AMBIGUITY_MINIMUM,
      target_only_median_minimum: R59A_HEADROOM_MINIMUM,
      target_only_median_maximum: R59A_HEADROOM_MAXIMUM,
      timing: "before-family-split-freeze",
      compound_split: r59GeneratorSplitPlan(),
      rejection_counts: plan.rejections,
    },
    split_overlap: overlap,
    compound_split_overlap: compoundOverlap,
    source_artifact: {
      schema: parsedArtifact.schema,
      sha256: parsedArtifact.artifact_sha256,
      canonical_bytes: parsedArtifact.canonical_bytes,
      source_families: parsedArtifact.source_family_ids.length,
      source_family_ids: parsedArtifact.source_family_ids,
      transfer_components: parsedArtifact.components.map(component => ({
        source_generator: component.source_generator,
        target_generator: component.target_generator,
        source_families: component.source_family_ids.length,
        source_family_ids: component.source_family_ids,
        component_sha256: canonicalDigest("reasoner59a-prior-component",
          component),
      })),
    },
    transfer_directions: R59A_TRANSFER_DIRECTIONS.map(direction => ({
      source_generator: direction.sourceGenerator,
      target_generator: direction.targetGenerator,
      generator_id: direction.id,
      support_builders: [...R59A_SUPPORT_BUILDERS],
    })),
    controls: {
      source_ablation: "byte-identical source-free path except arm identity",
      source_only: "source prior with public support labels ignored",
      surface_bijection: surfaceBijectionRegistration(parsedArtifact),
      exact_scene_graph_oracle: "oracle_program_order",
      prior_derangements: 31,
    },
    derangement_registration: {
      seed: derangements.seed,
      namespace: derangements.namespace,
      count: derangements.permutations.length,
      sha256: derangements.sha256,
      event_subtype_rule: derangements.event_subtype_rule,
      subtype_partitions: derangements.subtype_partitions,
      rule: "uniform Fisher-Yates inside each registered event subtype with fixed-point and duplicate rejection",
    },
    analysis_contract: analysisContract(),
  });
}

export function createR59ReplayRegistry() {
  const registry = createReplayRegistry();
  const digest = replayFunctionDigest(replayR59Episode);
  for (let generator = 0; generator < 2; generator += 1)
    for (let support = 0; support < 2; support += 1)
      registerReplayPipeline(registry, {
        generator_sha256: R59A_GENERATOR_DIGESTS[generator],
        input_generator_sha256: R59A_SUPPORT_DIGESTS[support],
        replay_function_sha256: digest,
        replay: replayR59Episode,
      });
  return registry;
}

function scoreModeForArm(arm) {
  if (arm === "binding_off") return ["binding-off", null];
  if (arm === "frequency_only") return ["frequency-only", null];
  if (arm.startsWith("shuffled_"))
    return ["full", Number(arm.slice(-2))];
  return ["full", null];
}

function sourceGeneratorFromDirection(direction) {
  const registered = R59A_TRANSFER_DIRECTIONS.find(item =>
    item.id === direction);
  assert(registered, `unknown R5.9a transfer direction ${direction}`);
  return registered.sourceGenerator;
}

function candidateTie(candidate, publicView) {
  return targetTie(candidate, publicView.ranking_order_key);
}

export function applyR59SurfaceBijection(publicView) {
  assertRankerView(publicView, {
    whitelist: R59A_RANKER_POLICY.leaf_whitelist,
    leafContracts: R59A_RANKER_POLICY.leaf_contracts,
  });
  const transformed = structuredClone(publicView);
  const symbolMap = { "glyph-a": "glyph-b", "glyph-b": "glyph-a" };
  transformed.legend_symbols = publicView.legend_symbols.map(symbol => {
    assert(symbolMap[symbol], `R5.9a surface transform lacks symbol ${symbol}`);
    return symbolMap[symbol];
  });
  const grammarMap = new Map(R59A_FORMS.map(form => [formProduction(form),
    formProduction(surfaceBijectionForm(form))]));
  transformed.grammar.forms = publicView.grammar.forms.map(form => {
    const mapped = grammarMap.get(form);
    assert(mapped, `R5.9a surface transform lacks grammar form ${form}`);
    return mapped;
  });
  assertRankerView(transformed, {
    whitelist: R59A_RANKER_POLICY.leaf_whitelist,
    leafContracts: R59A_RANKER_POLICY.leaf_contracts,
  });
  return transformed;
}

function surfaceBijectionRegistration(artifact) {
  const universe = enumerateR59Universe();
  const originalSequence = universe.rawPairs.map(pair => pair.ast_sha256);
  const surfacedSequence = universe.rawPairs.map(pair =>
    r59AstSha256(applyR59AstSurfaceBijection(pair.ast)));
  const body = {
    schema: "zero.reasoner59a_surface_bijection.v1",
    mapping: { "glyph-a": "glyph-b", "glyph-b": "glyph-a" },
    public_transform_sha256: replayFunctionDigest(applyR59SurfaceBijection),
    ast_transform_sha256: replayFunctionDigest(applyR59AstSurfaceBijection),
    evaluator_transform_sha256:
      replayFunctionDigest(applyR59EvaluatorSurfaceBijection),
    candidate_transform_sha256:
      replayFunctionDigest(applyR59CandidateSurfaceBijection),
    original_ast_sequence_sha256: canonicalDigest(
      "reasoner59a-original-ast-sequence", originalSequence),
    surfaced_ast_sequence_sha256: canonicalDigest(
      "reasoner59a-surfaced-ast-sequence", surfacedSequence),
    artifact_sha256: artifact.artifact_sha256,
    artifact_action:
      "apply the same involution again before canonical feature lookup",
  };
  assert.notEqual(body.original_ast_sequence_sha256,
    body.surfaced_ast_sequence_sha256,
  "R5.9a surface bijection did not change the ordered AST surface");
  return {
    ...body,
    receipt_sha256: canonicalDigest("reasoner59a-surface-bijection", body),
  };
}

export function rankR59Candidates(publicView, candidates, artifact, arm,
  sourceGenerator) {
  assertRankerView(publicView, {
    whitelist: R59A_RANKER_POLICY.leaf_whitelist,
    leafContracts: R59A_RANKER_POLICY.leaf_contracts,
  });
  assert(R59A_ARMS.includes(arm) && arm !== "oracle_program_order",
    `unknown R5.9a ranker arm ${arm}`);
  const [mode, derangementIndex] = scoreModeForArm(arm);
  const usesPrior = !R59A_SOURCE_ISOLATED_ARMS.includes(arm);
  if (usesPrior)
    assert(R59A_CONCEPT_GENERATORS.includes(sourceGenerator),
      "prior arm needs its registered source generator");
  const losses = new Map();
  const guide = new Map();
  const free = new Map();
  const ties = new Map();
  for (const candidate of candidates) {
    const rankerCandidate = arm === "surface_bijection" ?
      applyR59CandidateSurfaceBijection(candidate) : candidate;
    losses.set(candidate.class_index, evidenceLoss(rankerCandidate, publicView));
    free.set(candidate.class_index, sourceFreeScore(rankerCandidate, publicView));
    ties.set(candidate.class_index, candidateTie(rankerCandidate, publicView));
    if (usesPrior) {
      const artifactView = arm === "surface_bijection" ?
        applyR59CandidateSurfaceBijection(rankerCandidate) : rankerCandidate;
      guide.set(candidate.class_index, scoreR59Candidate(artifactView, artifact,
        mode, derangementIndex, sourceGenerator));
    }
  }
  return [...candidates].sort((left, right) => {
    if (arm !== "source_only") {
      const loss = losses.get(left.class_index) - losses.get(right.class_index);
      if (loss !== 0) return loss;
    }
    if (["target_only"].includes(arm)) {
      /* Target-only uses evidence and the registered public tie order. */
    } else if (["source_free_jit", "source_ablation"].includes(arm)) {
      const difference = free.get(right.class_index) -
        free.get(left.class_index);
      if (difference !== 0) return difference;
    } else {
      const difference = guide.get(right.class_index) -
        guide.get(left.class_index);
      if (difference !== 0) return difference;
    }
    return ties.get(left.class_index).localeCompare(
      ties.get(right.class_index));
  });
}

export function rankR59OracleCandidates(publicView, candidates,
  targetBehaviorSha256) {
  assertRankerView(publicView, {
    whitelist: R59A_RANKER_POLICY.leaf_whitelist,
    leafContracts: R59A_RANKER_POLICY.leaf_contracts,
  });
  assert.match(targetBehaviorSha256, SHA256);
  return [...candidates].sort((left, right) => {
    const exact = Number(right.semantic.behavior_sha256 ===
      targetBehaviorSha256) - Number(left.semantic.behavior_sha256 ===
        targetBehaviorSha256);
    return exact || candidateTie(left, publicView).localeCompare(
      candidateTie(right, publicView));
  });
}

function firstBehaviorMismatch(left, right) {
  for (let byte = 0; byte < left.length; byte += 1) {
    const difference = left[byte] ^ right[byte];
    if (difference === 0) continue;
    for (let bit = 0; bit < 8; bit += 1)
      if ((difference & (1 << bit)) !== 0) {
        const sceneIndex = byte * 8 + bit;
        if (sceneIndex < R59A_SCENE_COUNT) return sceneIndex;
      }
  }
  return -1;
}

function exactVerifier(targetCandidate) {
  const expected = r59BehaviorForCandidate(targetCandidate);
  return candidate => {
    const actual = r59BehaviorForCandidate(candidate);
    const mismatch = firstBehaviorMismatch(actual, expected);
    if (mismatch === -1) return {
      accepted: true,
      certificate_valid: true,
      certificate: {
        schema: "zero.reasoner59a_exact_behavior_certificate.v1",
        scene_count: R59A_SCENE_COUNT,
        scene_universe_sha256: r59SceneUniverseSha256(),
        behavior_sha256: candidate.semantic.behavior_sha256,
      },
      answer_ir: structuredClone(candidate.ast),
    };
    return {
      accepted: false,
      certificate_valid: false,
      counterexample: {
        scene_index: mismatch,
        expected: behaviorLabel(expected, mismatch),
        actual: behaviorLabel(actual, mismatch),
      },
    };
  };
}

function armUsesArtifact(arm) {
  return !R59A_SOURCE_ISOLATED_ARMS.includes(arm);
}

export function executeR59Arm(episode, candidates, artifact, arm,
  frozenFallback = null) {
  assert(R59A_ARMS.includes(arm), `unknown R5.9a arm ${arm}`);
  const usesSurfaceBijection = arm === "surface_bijection";
  const publicView = usesSurfaceBijection ?
    applyR59SurfaceBijection(episode.content.public) : episode.content.public;
  const evaluatorView = usesSurfaceBijection ?
    applyR59EvaluatorSurfaceBijection(episode.content.evaluator) :
    episode.content.evaluator;
  const targetDigest = evaluatorView.behavior.behavior_sha256;
  const target = candidates.find(candidate =>
    candidate.semantic.behavior_sha256 === targetDigest);
  assert(target, "R5.9a episode target is outside the complete universe");
  const invalid = candidates.find(candidate =>
    candidate.semantic.behavior_sha256 !== targetDigest);
  assert(invalid, "R5.9a injected invalid candidate is missing");
  const sourceGenerator = sourceGeneratorFromDirection(episode.generator_id);
  const ranking = arm === "oracle_program_order" ?
    rankR59OracleCandidates(publicView, candidates, targetDigest) :
    rankR59Candidates(publicView, candidates, artifact, arm, sourceGenerator);
  const verifierTarget = usesSurfaceBijection ?
    applyR59CandidateSurfaceBijection(target) : target;
  if (usesSurfaceBijection)
    assert.deepEqual(verifierTarget.ast, evaluatorView.ast,
      "R5.9a surface evaluator and verifier target differ");
  const verify = exactVerifier(verifierTarget);
  const proposals = [invalid, ...ranking.filter(candidate =>
    candidate !== invalid)].slice(0, 64);
  const search = runVerifiedSearch({
    proposals,
    fallback: frozenFallback ?? r59CanonicalCandidates(),
    candidate_universe: candidates,
    verify: candidate => verify(usesSurfaceBijection ?
      applyR59CandidateSurfaceBijection(candidate) : candidate),
    global_cap: candidates.length,
    injected_invalid_sha256: candidateSemanticDigest(invalid),
  });
  return {
    search,
    sourceArtifactReads: armUsesArtifact(arm) ? artifact.canonical_bytes : 0,
  };
}

export function makeR59RawRow(episode, arm, execution) {
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
    experiment: R59A_EXPERIMENT,
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
    observation_queries: episode.content.public.support.length,
    parity_digest: episode.trace_binding.parity_digest,
    partial_expansions: search.partial_expansions,
    peak_bytes: null,
    potential_response_digest: episode.trace_binding.potential_response_digest,
    premature_commit: search.premature_commits > 0,
    primary_cost: search.primary_cost,
    schema: "zero.reasoner5_trace_row.v1",
    shift_stratum: episode.shift_stratum,
    source_artifact_reads: sourceArtifactReads,
    verified_search: search,
    verifier_checks: search.verifier_checks,
    verifier_digest: episode.trace_binding.verifier_digest,
    wall_ns: null,
  };
  assert.deepEqual(Object.keys(row).sort(),
    [...REASONER5_TRACE_ROW_FIELDS].sort());
  return row;
}

export function cloneR59SourceAblationRow(sourceFreeRow) {
  return { ...structuredClone(sourceFreeRow), arm: "source_ablation" };
}

export function reconstructR59Development(rawTraces) {
  const armMeasurements = R59A_ARMS.map(arm => {
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
  const directionMeasurements = R59A_TRANSFER_DIRECTIONS.map(direction => ({
    source_generator: direction.sourceGenerator,
    target_generator: direction.targetGenerator,
    generator_id: direction.id,
    families: new Set(rawTraces.filter(row =>
      row.generator_id === direction.id).map(row => row.family_id)).size,
    full_primary_cost: rawTraces.filter(row =>
      row.generator_id === direction.id && row.arm === "full")
      .reduce((sum, row) => sum + row.primary_cost, 0),
    target_only_primary_cost: rawTraces.filter(row =>
      row.generator_id === direction.id && row.arm === "target_only")
      .reduce((sum, row) => sum + row.primary_cost, 0),
  }));
  return {
    status: "development-only",
    execution_authorized: false,
    scientific_claim: "reserved for a separately authorized sealed run",
    development_measurements: {
      episodes: new Set(rawTraces.map(row => row.episode_id)).size,
      rows: rawTraces.length,
      arms: armMeasurements,
      transfer_directions: directionMeasurements,
    },
  };
}

export function generateR59RawRows(manifest, artifact) {
  const candidates = episodeCandidates();
  const fallback = r59CanonicalCandidates();
  const rows = [];
  for (const episode of manifest.episodes.filter(item =>
    item.lane === "development")) {
    let sourceFreeRow = null;
    for (const arm of R59A_ARMS) {
      if (arm === "source_ablation") {
        assert(sourceFreeRow,
          "R5.9a source-free row must precede source ablation");
        rows.push(cloneR59SourceAblationRow(sourceFreeRow));
        continue;
      }
      const row = makeR59RawRow(episode, arm,
        executeR59Arm(episode, candidates, artifact, arm, fallback));
      rows.push(row);
      if (arm === "source_free_jit") sourceFreeRow = row;
    }
  }
  return rows;
}

export function withoutR59SourceComponent(artifact, sourceGenerator) {
  assert(R59A_CONCEPT_GENERATORS.includes(sourceGenerator));
  const copy = structuredClone(artifact);
  copy.components = copy.components.filter(component =>
    component.source_generator !== sourceGenerator);
  return deepFreeze(copy);
}

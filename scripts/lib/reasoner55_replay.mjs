import { createHash } from "node:crypto";
import assert from "node:assert/strict";

import {
  canonicalCandidateOrder,
  candidateSemanticDigest,
  runVerifiedSearch,
} from "./reasoner5_harness.mjs";

export const R55_DERANGEMENT_SEED = "55d3a6e77a11c0de";
export const R55_DERANGEMENT_NAMESPACE = "reasoner55-role-derangements-v1";
export const R55_DERANGEMENT_DIGEST =
  "4b29c6f5236276a53adc0fbabacb758b44078146a70fbc3213cac29d55d0e588";

export const R55_DERANGEMENTS = Object.freeze([
  [6,3,5,0,2,7,4,1], [2,7,4,5,0,6,3,1], [2,6,1,5,3,7,0,4],
  [1,6,4,7,5,0,3,2], [7,3,1,6,0,4,2,5], [3,4,5,0,7,6,2,1],
  [2,0,5,4,3,6,7,1], [1,0,4,7,3,2,5,6], [5,0,6,4,1,7,2,3],
  [5,3,4,1,0,7,2,6], [4,3,5,6,2,0,7,1], [1,0,5,6,7,3,2,4],
  [4,3,5,7,0,6,1,2], [5,3,6,7,2,0,4,1], [3,5,4,6,7,0,1,2],
  [3,5,7,0,2,4,1,6], [7,5,6,1,0,3,4,2], [7,4,6,1,0,3,2,5],
  [7,2,0,6,5,1,3,4], [3,2,1,6,7,0,5,4], [5,3,1,4,2,0,7,6],
  [6,4,3,1,5,7,2,0], [5,6,3,0,7,1,2,4], [7,4,0,6,1,3,5,2],
  [1,3,6,7,5,2,0,4], [2,6,4,0,5,1,7,3], [2,4,3,5,6,7,0,1],
  [2,5,1,6,7,3,0,4], [3,0,7,1,5,2,4,6], [2,0,6,7,3,1,5,4],
  [4,6,7,0,2,1,5,3],
].map(row => Object.freeze(row)));

export const R55_BASE_ARMS = Object.freeze([
  "target_only", "adapter_only", "raw_lexical", "full",
  "oracle_adapter", "frequency_lexical", "source_free_jit",
  "source_ablation", "source_only",
]);

export const R55_ARMS = Object.freeze([
  ...R55_BASE_ARMS,
  ...R55_DERANGEMENTS.map((_, index) =>
    `shuffled_${String(index).padStart(2, "0")}`),
]);

const MASK64 = (1n << 64n) - 1n;
const MIX_CONSTANT = 0x9e3779b97f4a7c15n;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function taggedDigest(kind, bytes) {
  return createHash("sha256").update(kind).update(Buffer.from([0]))
    .update(bytes).digest("hex");
}

function affineBytes(affine) {
  return Buffer.from([...affine.matrix, ...affine.bias]);
}

function mix64(input) {
  let value = (input + MIX_CONSTANT) & MASK64;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (value ^ (value >> 31n)) & MASK64;
}

export function deriveR55TieSalt(familySeed, sourceGenerator, tie,
  namespace) {
  return mix64(familySeed ^ (BigInt(sourceGenerator) << 48n) ^ BigInt(tie) ^
    namespace);
}

function readAffine(bytes, offset) {
  return {
    value: {
      matrix: [...bytes.subarray(offset, offset + 9)],
      bias: [...bytes.subarray(offset + 9, offset + 12)],
    },
    offset: offset + 12,
  };
}

export function decodeR55Replay(row) {
  assert.match(row.family_replay_hex, /^[0-9a-f]+$/u);
  const bytes = Buffer.from(row.family_replay_hex, "hex");
  assert.equal(bytes.length, 190, "R5.5 replay byte length");
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "R55R0001");
  assert.equal(sha256(bytes), row.family_replay_sha256,
    "R5.5 replay digest");
  let offset = 8;
  const primitiveByRole = [];
  for (let role = 0; role < 8; role += 1) {
    const decoded = readAffine(bytes, offset);
    primitiveByRole.push(decoded.value);
    offset = decoded.offset;
  }
  const surfaceToRole = [...bytes.subarray(offset, offset + 8)];
  offset += 8;
  const surfaceIds = [];
  for (let slot = 0; slot < 8; slot += 1) {
    surfaceIds.push(bytes.readUInt32LE(offset));
    offset += 4;
  }
  const targetRoles = [...bytes.subarray(offset, offset + 4)];
  offset += 4;
  const targetDecoded = readAffine(bytes, offset);
  const target = targetDecoded.value;
  offset = targetDecoded.offset;
  const exampleInput = [...bytes.subarray(offset, offset + 3)];
  offset += 3;
  const exampleOutput = [...bytes.subarray(offset, offset + 3)];
  offset += 3;
  const generator = bytes[offset++];
  const ordinal = bytes.readUInt32LE(offset);
  offset += 4;
  const familySeed = bytes.readBigUInt64LE(offset);
  offset += 8;
  const tieSalt = bytes.readBigUInt64LE(offset);
  offset += 8;
  const sourceGenerator = bytes[offset++];
  const tie = bytes[offset++];
  const arm = bytes[offset++];
  assert.equal(offset, bytes.length);
  assert.equal(generator, row.generator_id === "syntax-first" ? 0 : 1);
  assert.equal(sourceGenerator,
    row.source_generator_id === "syntax-first" ? 0 : 1);
  assert.equal(ordinal,
    Number(row.family_id.match(/-(\d+)$/u)?.[1]), "R5.5 family ordinal");
  assert.equal(tie, Number(row.nested_repeat_id.slice(4)), "R5.5 tie index");
  assert.equal(R55_ARMS[arm], row.arm, "R5.5 arm index");
  assert.equal(taggedDigest("reasoner55-target-ast", Buffer.from(targetRoles)),
    row.ast_sha256, "R5.5 target AST digest");
  assert.equal(taggedDigest("reasoner55-affine", affineBytes(target)),
    row.behavior_sha256, "R5.5 target behavior digest");
  assert.equal(taggedDigest("reasoner55-affine", affineBytes(target)),
    row.accepted_semantic_sha256, "R5.5 accepted behavior digest");
  return {
    primitiveByRole, surfaceToRole, surfaceIds, targetRoles, target,
    exampleInput, exampleOutput, generator, ordinal, familySeed, tieSalt,
    sourceGenerator, tie, arm,
  };
}

export function parseR55Artifact(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "R55A0001");
  assert.deepEqual([...bytes.subarray(8, 13)], [5, 3, 8, 4, 2]);
  let offset = 13;
  const guides = [];
  for (let generator = 0; generator < 2; generator += 1) {
    assert.equal(bytes[offset++], generator);
    const sourceFamilies = bytes.readUInt32LE(offset); offset += 4;
    const sourceSolutions = bytes.readUInt32LE(offset); offset += 4;
    const positions = Array.from({ length: 4 }, () => Array(8).fill(0));
    const transitions = Array.from({ length: 3 }, () =>
      Array.from({ length: 8 }, () => Array(8).fill(0)));
    for (let position = 0; position < 4; position += 1)
      for (let role = 0; role < 8; role += 1) {
        positions[position][role] = bytes.readUInt32LE(offset);
        offset += 4;
      }
    for (let position = 0; position < 3; position += 1)
      for (let role = 0; role < 8; role += 1)
        for (let next = 0; next < 8; next += 1) {
          transitions[position][role][next] = bytes.readUInt32LE(offset);
          offset += 4;
        }
    guides.push({ generator, sourceFamilies, sourceSolutions,
      positions, transitions });
  }
  assert.equal(offset, bytes.length, "R5.5 artifact trailing bytes");
  return guides;
}

function compose(after, before) {
  const matrix = Array(9).fill(0);
  const bias = Array(3).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let value = 0;
      for (let inner = 0; inner < 3; inner += 1)
        value += after.matrix[row * 3 + inner] *
          before.matrix[inner * 3 + column];
      matrix[row * 3 + column] = value % 5;
    }
    let value = after.bias[row];
    for (let inner = 0; inner < 3; inner += 1)
      value += after.matrix[row * 3 + inner] * before.bias[inner];
    bias[row] = value % 5;
  }
  return { matrix, bias };
}

function apply(affine, input) {
  return Array.from({ length: 3 }, (_, row) => {
    let value = affine.bias[row];
    for (let column = 0; column < 3; column += 1)
      value += affine.matrix[row * 3 + column] * input[column];
    return value % 5;
  });
}

function tokensFor(index) {
  const tokens = Array(4);
  for (let position = 3; position >= 0; position -= 1) {
    tokens[position] = index & 7;
    index >>= 3;
  }
  return tokens;
}

function programSemantic(family, tokens) {
  let result = { matrix: [1,0,0,0,1,0,0,0,1], bias: [0,0,0] };
  for (const token of tokens) {
    const primitive = family.primitiveByRole[family.surfaceToRole[token]];
    result = compose(primitive, result);
  }
  return result;
}

function semanticKey(semantic) {
  let result = 0;
  let power = 1;
  for (const value of [...semantic.matrix, ...semantic.bias]) {
    result += value * power;
    power *= 5;
  }
  return result;
}

function sameAffine(left, right) {
  return left.matrix.every((value, index) => value === right.matrix[index]) &&
    left.bias.every((value, index) => value === right.bias[index]);
}

function makeBaseCandidates(family) {
  return Array.from({ length: 4096 }, (_, syntaxIndex) => {
    const tokens = tokensFor(syntaxIndex);
    return {
      syntaxIndex,
      tokens,
      semantic: programSemantic(family, tokens),
      ast: { surface_ids: tokens.map(token => family.surfaceIds[token]) },
    };
  });
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function createR55ReplayCache() {
  return new Map();
}

function addGuide(guide, roles) {
  for (let position = 0; position < 4; position += 1)
    guide.positions[position][roles[position]] += 1;
  for (let position = 0; position < 3; position += 1)
    guide.transitions[position][roles[position]][roles[position + 1]] += 1;
  guide.sourceSolutions += 1;
}

function makeJitGuide(family, baseCandidates) {
  const guide = {
    sourceSolutions: 0,
    positions: Array.from({ length: 4 }, () => Array(8).fill(0)),
    transitions: Array.from({ length: 3 }, () =>
      Array.from({ length: 8 }, () => Array(8).fill(0))),
  };
  for (const candidate of baseCandidates) {
    if (apply(candidate.semantic, family.exampleInput)
        .every((value, index) => value === family.exampleOutput[index]))
      addGuide(guide, candidate.tokens.map(token => family.surfaceToRole[token]));
  }
  assert.ok(guide.sourceSolutions > 0);
  return guide;
}

function guideScore(guide, roles, frequencyOnly) {
  let score = 1;
  const scale = guide.sourceSolutions > 512 ?
    Math.ceil(guide.sourceSolutions / 512) : 1;
  for (let position = 0; position < 4; position += 1)
    score *= 1 + Math.floor(guide.positions[position][roles[position]] / scale);
  if (!frequencyOnly)
    for (let position = 0; position < 3; position += 1)
      score *= 1 + Math.floor(
        guide.transitions[position][roles[position]][roles[position + 1]] /
        scale);
  assert.ok(Number.isSafeInteger(score));
  return score;
}

function mappedRolesFor(family, arm) {
  if (["raw_lexical", "frequency_lexical", "source_only"].includes(arm))
    return family.surfaceIds.map(value => value % 8);
  if (arm.startsWith("shuffled_")) {
    const shuffle = Number(arm.slice(-2));
    return family.surfaceToRole.map(role => R55_DERANGEMENTS[shuffle][role]);
  }
  return [...family.surfaceToRole];
}

function rankCandidates(family, baseCandidates, sourceGuide, arm) {
  const mapped = mappedRolesFor(family, arm);
  const jit = ["source_free_jit", "source_ablation"].includes(arm) ?
    makeJitGuide(family, baseCandidates) : null;
  const sourceArms = new Set(["raw_lexical", "full", "oracle_adapter",
    "frequency_lexical", "source_only"]);
  const guide = jit ?? (sourceArms.has(arm) || arm.startsWith("shuffled_") ?
    sourceGuide : null);
  const frequencyOnly = arm === "frequency_lexical";
  const ignoreEvidence = arm === "source_only";
  return baseCandidates.map(candidate => {
    const roles = candidate.tokens.map(token => mapped[token]);
    const observed = apply(candidate.semantic, family.exampleInput);
    const evidenceLoss = ignoreEvidence ? 0 : Number(!observed.every(
      (value, index) => value === family.exampleOutput[index]));
    const prior = guide ? guideScore(guide, roles, frequencyOnly) : 0;
    const product = (BigInt(candidate.syntaxIndex) * MIX_CONSTANT) & MASK64;
    const tie = mix64(family.tieSalt ^ product);
    return { ...candidate, evidenceLoss, prior, tie };
  }).sort((left, right) => left.evidenceLoss - right.evidenceLoss ||
    right.prior - left.prior ||
    (left.tie < right.tie ? -1 : left.tie > right.tie ? 1 : 0) ||
    left.syntaxIndex - right.syntaxIndex);
}

export function targetOnlyReplayCost(family, tieSalt) {
  const adjusted = { ...family, tieSalt };
  const candidates = makeBaseCandidates(adjusted);
  const ranked = rankCandidates(adjusted, candidates, null, "target_only");
  const injection = ranked.find(candidate =>
    !sameAffine(candidate.semantic, adjusted.target));
  const stream = [injection, ...ranked.slice(0, 64), ...candidates];
  const seen = new Set();
  let checks = 0;
  for (const candidate of stream) {
    const key = semanticKey(candidate.semantic);
    if (seen.has(key)) continue;
    seen.add(key);
    checks += 1;
    if (sameAffine(candidate.semantic, adjusted.target)) return checks;
  }
  return 4097;
}

function exactVerdict(candidate, target) {
  let ordinal = 0;
  for (let x0 = 0; x0 < 5; x0 += 1)
    for (let x1 = 0; x1 < 5; x1 += 1)
      for (let x2 = 0; x2 < 5; x2 += 1, ordinal += 1) {
        const input = [x0, x1, x2];
        const actual = apply(candidate.semantic, input);
        const expected = apply(target, input);
        if (!actual.every((value, index) => value === expected[index]))
          return { accepted: false, certificate_valid: false,
            counterexample: { ordinal, input, actual, expected } };
      }
  return {
    accepted: true,
    certificate_valid: true,
    certificate: { method: "exhaustive-gf5-v3", points: 125,
      semantic: candidate.semantic },
    answer_ir: { kind: "affine-gf5-v3", semantic: candidate.semantic },
  };
}

function rankedSemanticOrderDigest(ranked) {
  const bytes = Buffer.alloc(ranked.length * 4);
  ranked.forEach((candidate, index) =>
    bytes.writeUInt32LE(semanticKey(candidate.semantic), index * 4));
  return sha256(bytes);
}

export function replayR55Search(row, family, sourceGuide, cache = null) {
  let cached = cache?.get(row.family_id);
  if (cached === undefined) {
    const baseCandidates = makeBaseCandidates(family);
    const universe = deepFreeze(baseCandidates.map(candidate => ({
      semantic: semanticKey(candidate.semantic),
      ast: candidate.syntaxIndex,
      partial_expansions: 1,
    })));
    const fallback = deepFreeze(canonicalCandidateOrder(universe));
    cached = { baseCandidates, universe, fallback };
    cache?.set(row.family_id, cached);
  }
  const { baseCandidates, universe, fallback } = cached;
  const ranked = rankCandidates(family, baseCandidates, sourceGuide, row.arm);
  assert.equal(rankedSemanticOrderDigest(ranked), row.proposal_order_sha256,
    `${row.episode_id} ${row.arm}: ranked proposal order`);
  const injection = ranked.find(candidate =>
    !sameAffine(candidate.semantic, family.target));
  assert.ok(injection, "R5.5 injected invalid candidate");
  const buildCost = 4096 +
    (["source_free_jit", "source_ablation"].includes(row.arm) ? 4096 : 0);
  const harnessCandidate = (candidate, partialExpansions = 1) => ({
    semantic: semanticKey(candidate.semantic),
    ast: candidate.syntaxIndex,
    partial_expansions: partialExpansions,
  });
  const proposals = [harnessCandidate(injection, buildCost + 1),
    ...ranked.slice(0, 64).map(candidate => harnessCandidate(candidate))];
  const search = runVerifiedSearch({
    proposals,
    fallback,
    candidate_universe: universe,
    verify: candidate => exactVerdict(baseCandidates[candidate.ast],
      family.target),
    global_cap: 4096,
    injected_invalid_sha256: candidateSemanticDigest(proposals[0]),
  });
  assert.equal(search.primary_cost, row.primary_cost,
    `${row.episode_id} ${row.arm}: primary cost replay`);
  assert.equal(search.verifier_checks, row.verifier_checks,
    `${row.episode_id} ${row.arm}: verifier count replay`);
  assert.equal(search.partial_expansions, row.partial_expansions,
    `${row.episode_id} ${row.arm}: expansion count replay`);
  assert.equal(search.fallback_started, row.fallback_started,
    `${row.episode_id} ${row.arm}: fallback replay`);
  assert.equal(search.global_cap_hit, row.global_cap_hit,
    `${row.episode_id} ${row.arm}: censoring replay`);
  assert.equal(search.solved, row.exact,
    `${row.episode_id} ${row.arm}: exactness replay`);
  assert.equal(search.injected_invalid?.rejected,
    row.injected_invalid_rejected,
    `${row.episode_id} ${row.arm}: invalid injection replay`);
  assert.equal(search.evaluator_trace[0]?.counterexample?.ordinal,
    row.injected_counterexample_index,
    `${row.episode_id} ${row.arm}: counterexample replay`);
  return { search, baseCandidates, universe };
}

export function publicR55Episode(family) {
  const primitiveLabels = family.surfaceIds.map(value => String(value));
  return {
    public: {
      primitive_labels: primitiveLabels,
      observations: [{ input: family.exampleInput,
        observed: family.exampleOutput }],
      allowed_actions: [{ kind: "propose-four-symbol-program" }],
    },
    evaluator: {
      ast: { surface_program: family.targetRoles.map(role =>
        primitiveLabels[family.surfaceToRole.indexOf(role)]) },
      behavior: { affine: family.target },
      episode_spec: {
        primitive_labels: primitiveLabels,
        demonstration: { input: family.exampleInput,
          observed: family.exampleOutput },
      },
      target: family.target,
      surface_to_role: family.surfaceToRole,
      family_seed_commitment: sha256(Buffer.from(
        family.familySeed.toString(16).padStart(16, "0"))),
      atoms: family.primitiveByRole,
      typed_subtrees: family.targetRoles.map(role => `role-${role}`),
    },
  };
}

export function expectedObservationQueries(arm) {
  return ["adapter_only", "full", "source_free_jit", "source_ablation"]
      .includes(arm) || arm.startsWith("shuffled_") ? 32 : 0;
}

export function sourceArtifactBytesRead(arm) {
  return ["raw_lexical", "full", "oracle_adapter", "frequency_lexical",
    "source_only"].includes(arm) || arm.startsWith("shuffled_") ? 905 : 0;
}

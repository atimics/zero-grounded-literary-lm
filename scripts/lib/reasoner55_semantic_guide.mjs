import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildR55AdapterProbes, decodeR55Replay, generateR55FamilyFromSeed,
  parseR55Artifact, reconstructR55Adapter, R55_DERANGEMENTS,
} from "./reasoner55_replay.mjs";
import { canonicalCandidateOrder, candidateSemanticDigest, runVerifiedSearch,
} from "./reasoner5_harness.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURE = "benchmarks/reasoner55-semantic-guide-v1";
export const ORIGINAL = "benchmarks/reasoner55-generated-primitive-transfer-v1";
export const DIAGNOSTICS = "benchmarks/reasoner55-transfer-diagnostics-v1";
export const BINARY = resolve(ROOT, "build/reasoner55_semantic_guide");
export const ARMS = ["semantic_uniform", "semantic_frequency", "source_mass", "task_guide",
  "source_ablation", "raw_lexical_task_guide", "oracle_task_guide", "task_without_prior_feature",
  ...Array.from({ length: 31 }, (_, i) => `task_shuffled_${String(i).padStart(2, "0")}`)];
export const TIMERS = ["adapter_ns", "enumerate_ns", "group_ns", "score_ns", "sort_ns",
  "receipt_ns", "search_ns", "wall_ns", "cpu_ns"];
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const readJSON = path => JSON.parse(readFileSync(resolve(ROOT, path)));
export const episodeKey = row => [row.target_generator, row.ordinal, row.source_generator, row.tie].join(":");
const SCALE = 1000000, MASK = (1n << 64n) - 1n, STEP = 0x9e3779b97f4a7c15n;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const rounded = value => Number(value.toFixed(9));
const roundSigned = value => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
const tagged = (tag, bytes) => sha256(Buffer.concat([Buffer.from(`${tag}\0`), Buffer.from(bytes)]));
const identity = () => ({ matrix: [1,0,0,0,1,0,0,0,1], bias: [0,0,0] });
function apply(map, input) {
  return map.bias.map((bias, row) => (bias + input.reduce((sum, value, col) =>
    sum + map.matrix[row * 3 + col] * value, 0)) % 5);
}
function compose(after, before) {
  const matrix = [], bias = [];
  for (let row = 0; row < 3; ++row) {
    for (let col = 0; col < 3; ++col)
      matrix.push([0,1,2].reduce((sum, k) => sum + after.matrix[row * 3 + k] * before.matrix[k * 3 + col], 0) % 5);
    bias.push((after.bias[row] + [0,1,2].reduce((sum, k) =>
      sum + after.matrix[row * 3 + k] * before.bias[k], 0)) % 5);
  }
  return { matrix, bias };
}
function semanticKey(map) {
  return [...map.matrix, ...map.bias].reduce((sum, value, i) => sum + value * 5 ** i, 0);
}
function mix(value) {
  value = (value + STEP) & MASK;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return (value ^ (value >> 31n)) & MASK;
}
function guideScore(guide, roles) {
  let score = 1;
  for (let i = 0; i < 4; ++i) score *= 1 + guide.positions[i][roles[i]];
  for (let i = 0; i < 3; ++i) score *= 1 + guide.transitions[i][roles[i]][roles[i + 1]];
  assert.ok(Number.isSafeInteger(score));
  return score;
}

export function publicTask(family) {
  const probes = buildR55AdapterProbes(family);
  assert.equal(reconstructR55Adapter(family, probes).exact, true);
  const primitives = probes.map(block => {
    const bias = [...block.queries[0].observed];
    const matrix = [];
    for (let row = 0; row < 3; ++row)
      for (let col = 0; col < 3; ++col)
        matrix.push((block.queries[col + 1].observed[row] - bias[row] + 5) % 5);
    return { matrix, bias };
  });
  // The independent adapter check above proves these expected role assignments.
  return { primitives, roles: [...family.surfaceToRole], ids: [...family.surfaceIds],
    input: [...family.exampleInput], output: [...family.exampleOutput] };
}

export function buildUniverse(task) {
  const programs = [], groups = [], byKey = new Map();
  for (let ast = 0; ast < 4096; ++ast) {
    const tokens = [9,6,3,0].map(shift => (ast >> shift) & 7);
    let semantic = identity(), value = task.input, prefixMatches = 0;
    for (let pos = 0; pos < 4; ++pos) {
      semantic = compose(task.primitives[tokens[pos]], semantic);
      value = apply(task.primitives[tokens[pos]], value);
      if (pos < 3) prefixMatches += value.filter((v, lane) => v === task.output[lane]).length;
    }
    const key = semanticKey(semantic), loss = Number(value.some((v, i) => v !== task.output[i]));
    let group = byKey.get(key);
    if (!group) {
      group = { key, representative: ast, loss, members: [] };
      groups.push(group); byKey.set(key, group);
    }
    assert.equal(group.loss, loss);
    group.members.push(ast);
    programs.push({ ast, tokens, semantic, key, prefixMatches });
  }
  return { task, programs, groups };
}

export function featureGroups(base, guide, armIndex = 3) {
  const rich = armIndex === 3 || armIndex >= 5;
  const source = (armIndex === 2 || rich) && armIndex !== 7 ? guide : null;
  let roles = base.task.roles;
  if (armIndex === 5) roles = base.task.ids.map(id => base.task.ids.filter(other => other < id).length);
  if (armIndex >= 8) roles = roles.map(role => R55_DERANGEMENTS[armIndex - 8][role]);
  return base.groups.map(group => {
    let mass = 0, distinct = 0, matches = 0;
    for (const ast of group.members) {
      const program = base.programs[ast], mapped = program.tokens.map(token => roles[token]);
      if (source) mass += guideScore(source, mapped);
      if (rich) {
        distinct += new Set(mapped).size === 4;
        matches += program.prefixMatches;
      }
    }
    assert.ok(Number.isSafeInteger(mass));
    const count = group.members.length;
    // Keep the integer numerator before division for exact half-unit rounding.
    const features = rich ? [SCALE * Math.log(count) / Math.log(4096),
      SCALE * distinct / count, SCALE * Math.log1p(mass / count) / (7 * Math.log(65)),
      SCALE * matches / (9 * count)].map(Math.round) : [0,0,0,0];
    assert.ok(features.every(value => Number.isSafeInteger(value) && value >= 0 && value <= SCALE));
    return { key: group.key, representative: group.representative, loss: group.loss, count, mass, features };
  });
}

export function featureDigest(groups) {
  const bytes = Buffer.alloc(groups.length * 32);
  groups.forEach((group, index) => {
    const offset = index * 32;
    bytes.writeUInt32LE(group.key, offset); bytes.writeUInt32LE(group.count, offset + 4);
    group.features.forEach((value, f) => bytes.writeUInt32LE(value, offset + 8 + f * 4));
    bytes.writeBigUInt64LE(BigInt(group.mass), offset + 24);
  });
  return sha256(bytes);
}

export function lossGradient(families, weights) {
  let loss = 0;
  const gradient = [0,0,0,0];
  for (const family of families) {
    const scores = family.features.map(features => features.reduce((score, value, f) =>
      score + weights[f] * value / SCALE, 0));
    const maximum = Math.max(...scores);
    const total = scores.reduce((sum, score) => sum + Math.exp(score - maximum), 0);
    loss += Math.log(total) + maximum - scores[family.label];
    scores.forEach((score, row) => {
      const error = Math.exp(score - maximum) / total - Number(row === family.label);
      for (let f = 0; f < 4; ++f) gradient[f] += error * family.features[row][f] / SCALE;
    });
  }
  return { loss: loss / families.length, gradient: gradient.map(value => value / families.length) };
}

export function trainModel() {
  const sourceBytes = Buffer.from(readFileSync(resolve(ROOT, ORIGINAL, "SOURCE_ARTIFACT.hex"), "utf8").trim(), "hex");
  const guides = parseR55Artifact(sourceBytes);
  guides.forEach(guide => {
    assert.equal(guide.sourceFamilies, 64); assert.equal(guide.sourceSolutions, 64);
  });
  const seeds = readJSON(`${DIAGNOSTICS}/DIAGNOSTICS.json`).arms[0].sources;
  assert.equal(seeds.length, 128);
  const training = createHash("sha256"), weights = [], initialLoss = [], finalLoss = [];
  for (let generator = 0; generator < 2; ++generator) {
    const families = [];
    for (let ordinal = 0; ordinal < 64; ++ordinal) {
      const seed = seeds[generator * 64 + ordinal];
      assert.equal(seed.generator, generator); assert.equal(seed.ordinal, ordinal);
      const family = generateR55FamilyFromSeed({ familySeed: seed.family_seed, generator, ordinal });
      const groups = featureGroups(buildUniverse(publicTask(family)), guides[generator]);
      training.update(Buffer.from(featureDigest(groups), "hex"));
      const matching = groups.filter(group => group.loss === 0);
      const label = matching.findIndex(group => group.key === semanticKey(family.target));
      assert.ok(label >= 0);
      const bytes = Buffer.alloc(8);
      bytes.writeUInt32LE(matching.length); bytes.writeUInt32LE(label, 4); training.update(bytes);
      families.push({ features: matching.map(group => group.features), label });
    }
    const initial = [Math.log(4096), 0, 0, 0], fitted = [...initial];
    initialLoss.push(lossGradient(families, fitted).loss);
    for (let step = 0; step < 256; ++step) {
      const { gradient } = lossGradient(families, fitted);
      for (let f = 0; f < 4; ++f) fitted[f] -= 0.5 * (gradient[f] + 0.01 * (fitted[f] - initial[f]));
    }
    const quantized = fitted.map(value => roundSigned(value * SCALE));
    weights.push(quantized);
    finalLoss.push(lossGradient(families, quantized.map(value => value / SCALE)).loss);
  }
  const weightBytes = Buffer.alloc(32);
  weights.flat().forEach((weight, index) => weightBytes.writeInt32LE(weight, index * 4));
  const artifact = Buffer.concat([Buffer.from("R55T0001"), sourceBytes, weightBytes]);
  return { guides, weights, artifact_hex: artifact.toString("hex"), artifact_bytes: artifact.length,
    artifact_sha256: sha256(artifact), source_artifact_sha256: sha256(sourceBytes),
    training_sha256: training.digest("hex"), initial_loss: initialLoss.map(rounded), final_loss: finalLoss.map(rounded) };
}

export function rankGroups(groups, weights, armIndex, tieSalt) {
  const rich = armIndex === 3 || armIndex >= 5;
  return groups.map(group => {
    const score = armIndex === 1 || armIndex === 4 ? group.count :
      armIndex === 2 ? group.mass : rich ?
        group.features.reduce((sum, value, f) => sum + weights[f] * value, 0) : 0;
    assert.ok(Number.isSafeInteger(score));
    return { ...group, score, tie: mix(tieSalt ^ ((BigInt(group.key) * STEP) & MASK)) };
  }).sort((a, b) => a.loss - b.loss || (a.score > b.score ? -1 : a.score < b.score ? 1 : 0) ||
    (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0) || a.key - b.key);
}

function exactVerdict(map, target) {
  for (let x = 0; x < 125; ++x) {
    const input = [Math.floor(x / 25), Math.floor(x / 5) % 5, x % 5];
    const actual = apply(map, input), expected = apply(target, input);
    if (actual.some((value, lane) => value !== expected[lane]))
      return { accepted: false, certificate_valid: false, counterexample: { ordinal: x, input, actual, expected } };
  }
  return { accepted: true, certificate_valid: true,
    certificate: { method: "exhaustive-gf5-v3", points: 125, semantic: map },
    answer_ir: { kind: "affine-gf5-v3", semantic: map } };
}
const freezeCandidates = values => Object.freeze(values.map(Object.freeze));
export function replayContext() {
  const frozen = readFileSync(resolve(ROOT, ORIGINAL, "DEVELOPMENT-TRACE.jsonl"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));
  const references = new Map();
  for (const row of frozen) {
    if (row.arm !== "target_only") continue;
    const family = decodeR55Replay(row);
    const key = [family.generator, family.ordinal, family.sourceGenerator, family.tie].join(":");
    references.set(key, { row, family });
  }
  return { references, bases: new Map(), original: frozen };
}

export function replayRow(row, armIndex, model, context) {
  const reference = context.references.get(episodeKey(row));
  assert.ok(reference, "complete development episode identity");
  const { family } = reference, taskKey = `${family.generator}:${family.ordinal}`;
  assert.equal(row.family_seed, family.familySeed.toString(16).padStart(16, "0"));
  let base = context.bases.get(taskKey);
  if (!base) {
    base = buildUniverse(publicTask(family));
    base.universe = freezeCandidates(base.programs.map(p => ({ semantic: p.key, ast: p.ast, partial_expansions: 1 })));
    base.fallback = freezeCandidates(canonicalCandidateOrder(base.universe));
    base.verdicts = new Map();
    context.bases.set(taskKey, base);
  }
  const groups = featureGroups(base, model.guides[family.sourceGenerator], armIndex);
  assert.equal(row.groups, groups.length);
  assert.equal(row.features_sha256, featureDigest(groups), "native feature replay");
  const ranked = rankGroups(groups, model.weights[family.sourceGenerator], armIndex, family.tieSalt);
  const order = Buffer.alloc(ranked.length * 4);
  ranked.forEach((group, i) => order.writeUInt32LE(group.key, i * 4));
  assert.equal(row.proposal_order_sha256, sha256(order), "native rank replay");
  const targetKey = semanticKey(family.target);
  const injection = ranked.find(group => group.key !== targetKey);
  assert.ok(injection);
  const proposal = (group, partial_expansions = 1) => ({
    semantic: group.key, ast: group.representative, partial_expansions });
  const first = proposal(injection, 4096 + groups.length + 1);
  const search = runVerifiedSearch({
    proposals: [first, ...ranked.slice(0, 64).map(group => proposal(group))],
    candidate_universe: base.universe, fallback: base.fallback, global_cap: 4096,
    injected_invalid_sha256: candidateSemanticDigest(first),
    verify: candidate => {
      if (!base.verdicts.has(candidate.semantic)) base.verdicts.set(candidate.semantic,
        exactVerdict(base.programs[candidate.ast].semantic, family.target));
      return base.verdicts.get(candidate.semantic);
    },
  });
  for (const field of ["primary_cost", "verifier_checks", "partial_expansions",
    "fallback_started", "global_cap_hit", "fallback_exhausted"])
    assert.equal(row[field], search[field], `native ${field} replay`);
  assert.equal(row.exact, search.solved);
  assert.equal(row.certificate_valid, true);
  assert.equal(row.injected_invalid_rejected, search.injected_invalid.rejected);
  assert.equal(row.injected_counterexample_index, search.evaluator_trace[0].counterexample.ordinal);
  assert.equal(row.accepted_semantic_sha256, reference.row.accepted_semantic_sha256);
  assert.equal(row.accepted_semantic_sha256, tagged("reasoner55-affine", [...family.target.matrix, ...family.target.bias]));
  assert.equal(row.observation_queries, 32);
  const rich = armIndex === 3 || armIndex >= 5;
  assert.equal(row.source_artifact_reads, ((armIndex === 2 || rich) && armIndex !== 7 ? 905 : 0) + (rich ? 16 : 0));
  return search;
}

export function sourceBindings() {
  return Object.fromEntries(["reasoner55_semantic_guide.c", "reasoner55_diagnostics.c", "reasoner55.c", "reasoner55.h",
    "scripts/lib/reasoner55_semantic_guide.mjs", "scripts/lib/reasoner55_replay.mjs", "scripts/lib/reasoner5_harness.mjs",
    "scripts/run_reasoner55_semantic_guide.mjs", `${FIXTURE}/SPEC.md`, `${DIAGNOSTICS}/DIAGNOSTICS.json`,
    `${ORIGINAL}/DEVELOPMENT-TRACE.jsonl`, `${ORIGINAL}/SOURCE_ARTIFACT.hex`]
    .map(path => [path, sha256(readFileSync(resolve(ROOT, path)))]));
}

export function collectNative(repeats = 3) {
  const arms = [], timing = []; let metadata = null;
  assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 31);
  for (const arm of ARMS) {
    const rows = execFileSync(BINARY, ["development", arm, String(repeats)],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(rows.length, 2 + 32 * repeats);
    const meta = rows[0], process = rows.at(-1);
    assert.equal(meta.kind, "metadata"); assert.equal(meta.schema, "zero.reasoner55_semantic_guide.v1");
    assert.equal(meta.lane, "development"); assert.equal(meta.arm, arm);
    assert.equal(meta.repeats, repeats); assert.equal(meta.warmup_passes, 1);
    assert.equal(process.kind, "process"); assert.ok(process.peak_rss_bytes > 0);
    const stableMeta = Object.fromEntries(Object.entries(meta).filter(([k]) =>
      !["kind", "arm", "repeats", "warmup_passes", "corpus_ns", "training_ns"].includes(k)));
    stableMeta.initial_loss = stableMeta.initial_loss.map(rounded);
    stableMeta.final_loss = stableMeta.final_loss.map(rounded);
    if (metadata === null) metadata = stableMeta; else assert.deepEqual(stableMeta, metadata);
    const grouped = new Map();
    for (const row of rows.slice(1, -1)) {
      assert.equal(row.kind, "measurement");
      for (const timer of TIMERS) assert.ok(Number.isSafeInteger(row[timer]) && row[timer] >= 0);
      assert.ok(row.wall_ns >= TIMERS.slice(0, -2).reduce((sum, timer) => sum + row[timer], 0));
      assert.ok(row.cpu_ns > 0 && row.enumerate_ns > 0 && row.search_ns > 0);
      const key = episodeKey(row);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    assert.equal(grouped.size, 32);
    const stable = row => Object.fromEntries(Object.entries(row).filter(([k]) => !["kind", "repeat", ...TIMERS].includes(k)));
    const stableRows = [], episodes = [];
    for (const [episode, values] of grouped) {
      assert.deepEqual(values.map(row => row.repeat), Array.from({ length: repeats }, (_, i) => i));
      values.forEach(row => assert.deepEqual(stable(row), stable(values[0])));
      stableRows.push(stable(values[0]));
      episodes.push({ episode, samples: values.map(row => Object.fromEntries(TIMERS.map(timer => [timer, row[timer]]))) });
    }
    arms.push({ arm, rows: stableRows });
    timing.push({ arm, corpus_ns: meta.corpus_ns, training_ns: meta.training_ns,
      process_peak_rss_bytes: process.peak_rss_bytes, episodes });
  }
  return { metadata, arms, timing };
}

export function validateRun(run, model = trainModel()) {
  assert.deepEqual(run.arms.map(item => item.arm), ARMS);
  for (const field of ["weights", "artifact_bytes", "artifact_sha256", "training_sha256",
    "source_artifact_sha256", "initial_loss", "final_loss"])
    assert.deepEqual(run.metadata[field], model[field], `independent source training: ${field}`);
  const context = replayContext();
  for (const [armIndex, arm] of run.arms.entries()) {
    assert.equal(arm.rows.length, 32);
    assert.equal(new Set(arm.rows.map(episodeKey)).size, 32);
    arm.rows.forEach(row => replayRow(row, armIndex, model, context));
  }
  assert.deepEqual(run.arms[1].rows, run.arms[4].rows, "complete source removal path");
  assert.deepEqual(run.arms[3].rows, run.arms[6].rows, "oracle and recovered role paths");
  return { source_families: 128, target_families: 8, source_views_per_target: 2,
    tie_repeats_per_view: 2, replayed_rows: ARMS.length * 32, exact_answers: ARMS.length * 32 };
}

export function summarizeRun(arms) {
  const baseline = new Map(arms[1].rows.map(row => [episodeKey(row), row.primary_cost]));
  const jit = new Map(replayContext().original.filter(row => row.arm === "source_free_jit").map(row => {
    const f = decodeR55Replay(row);
    return [[f.generator, f.ordinal, f.sourceGenerator, f.tie].join(":"), row.primary_cost];
  }));
  return arms.map(item => {
    const families = new Map(), jitFamilies = new Map();
    for (const row of item.rows) {
      const key = `${row.target_generator}:${row.ordinal}`;
      if (!families.has(key)) families.set(key, []);
      if (!jitFamilies.has(key)) jitFamilies.set(key, []);
      families.get(key).push(Math.log((row.primary_cost + 1) / (baseline.get(episodeKey(row)) + 1)));
      jitFamilies.get(key).push(Math.log((row.primary_cost + 1) / (jit.get(episodeKey(row)) + 1)));
    }
    const logs = [...families.values()].map(mean);
    return { arm: item.arm, verifier_checks: item.rows.reduce((sum, row) => sum + row.verifier_checks, 0),
      partial_expansions: item.rows.reduce((sum, row) => sum + row.partial_expansions, 0),
      exact_answers: item.rows.filter(row => row.exact).length,
      cost_ratio_to_semantic_frequency: rounded(Math.exp(mean(logs))),
      cost_ratio_to_source_free_jit: rounded(Math.exp(mean([...jitFamilies.values()].map(mean)))),
      family_ratios: [...families].map(([family, values]) => ({ family,
        ratio_to_semantic_frequency: rounded(Math.exp(mean(values))),
        ratio_to_source_free_jit: rounded(Math.exp(mean(jitFamilies.get(family)))) })) };
  });
}

export function summarizeTiming(arms) {
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  };
  return arms.map(item => ({ arm: item.arm, training_ns: item.training_ns,
    process_peak_rss_bytes: item.process_peak_rss_bytes,
    ...Object.fromEntries(TIMERS.map(timer => [timer,
      item.episodes.reduce((sum, episode) => sum + median(episode.samples.map(sample => sample[timer])), 0)])) }));
}

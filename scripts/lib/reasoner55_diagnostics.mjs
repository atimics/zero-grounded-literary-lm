import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createR55ReplayCache, decodeR55Replay, generateR55FamilyFromSeed,
  parseR55Artifact, replayR55Search,
} from "./reasoner55_replay.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BASE = "benchmarks/reasoner55-generated-primitive-transfer-v1";
export const FIXTURE = "benchmarks/reasoner55-transfer-diagnostics-v1";
export const BINARY = resolve(ROOT, "build/reasoner55_diagnostics");
export const ARMS = ["target_only", "adapter_only", "raw_lexical", "full",
  "frequency_lexical", "source_free_jit",
  ...Array.from({ length: 8 }, (_, i) => `uniform_exact_0${i}`), "last_exact"];
const TIMERS = ["adapter_ns", "jit_ns", "search_ns", "wall_ns", "cpu_ns"];
const FIELDS = ["primary_cost", "verifier_checks", "partial_expansions",
  "observation_queries", "source_artifact_reads", "exact", "certificate_valid",
  "fallback_started", "global_cap_hit", "fallback_exhausted",
  "injected_invalid_rejected", "injected_counterexample_index",
  "proposal_order_sha256", "accepted_semantic_sha256"];
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const readJSON = path => JSON.parse(readFileSync(resolve(ROOT, path)));
const tagged = (tag, bytes) => sha256(Buffer.concat([
  Buffer.from(`${tag}\0`), Buffer.from(bytes)]));
const key = row => [row.target_generator, row.ordinal,
  row.source_generator, row.tie].join(":");
const familyKey = row => `${row.target_generator}:${row.ordinal}`;
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const rounded = n => Number(n.toFixed(9));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] +
    sorted[Math.floor(sorted.length / 2)]) / 2;
};

export function sourceBindings() {
  return Object.fromEntries(["reasoner55.c", "reasoner55.h",
    "reasoner55_diagnostics.c", "scripts/lib/reasoner55_replay.mjs",
    "scripts/lib/reasoner55_diagnostics.mjs",
    "scripts/run_reasoner55_diagnostics.mjs",
    `${BASE}/DEVELOPMENT.json`, `${BASE}/DEVELOPMENT-TRACE.jsonl`,
    `${BASE}/SOURCE_ARTIFACT.hex`].map(path =>
    [path, sha256(readFileSync(resolve(ROOT, path)))]));
}

export function collectDiagnostics(repeats = 3) {
  assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 31);
  const deterministic = [], timings = [];
  for (const arm of ARMS) {
    const records = execFileSync(BINARY, ["development", arm, String(repeats)],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim()
      .split("\n").map(line => JSON.parse(line));
    const metadata = records.filter(row => row.kind === "metadata");
    const processes = records.filter(row => row.kind === "process");
    assert.equal(metadata.length, 1);
    assert.equal(processes.length, 1);
    const meta = metadata[0];
    assert.equal(meta.schema, "zero.reasoner55_diagnostics.v1");
    assert.equal(meta.lane, "development");
    assert.equal(meta.arm, arm);
    assert.equal(meta.repeats, repeats);
    assert.equal(meta.warmup_passes, 1);
    assert.ok(meta.training_ns > 0 && meta.corpus_ns > 0);
    assert.ok(processes[0].peak_rss_bytes > 0);
    const sources = records.filter(row => row.kind === "source");
    const measured = records.filter(row => row.kind === "measurement");
    assert.equal(records.length, 2 + 128 + 32 * repeats);
    assert.equal(measured.length, 32 * repeats);
    const groups = new Map();
    for (const row of measured) {
      if (!groups.has(key(row))) groups.set(key(row), []);
      groups.get(key(row)).push(row);
      for (const timer of TIMERS)
        assert.ok(Number.isSafeInteger(row[timer]) && row[timer] >= 0, timer);
      assert.ok(row.wall_ns >= row.adapter_ns + row.jit_ns + row.search_ns);
      assert.ok(row.cpu_ns > 0 && row.search_ns > 0);
      assert.equal(row.jit_ns > 0, arm === "source_free_jit");
      assert.equal(row.adapter_ns > 0, arm === "adapter_only" ||
        arm === "source_free_jit" || arm === "full" || ARMS.indexOf(arm) >= 6);
    }
    const rows = [], samples = [];
    for (const [episode, values] of groups) {
      assert.deepEqual(values.map(row => row.repeat),
        Array.from({ length: repeats }, (_, i) => i));
      const stable = row => Object.fromEntries(Object.entries(row)
        .filter(([field]) => !["kind", "repeat", ...TIMERS].includes(field)));
      for (const value of values) assert.deepEqual(stable(value), stable(values[0]));
      rows.push(stable(values[0]));
      samples.push({ episode, samples: values.map(row =>
        Object.fromEntries(TIMERS.map(timer => [timer, row[timer]]))) });
    }
    deterministic.push({ arm, variant: meta.variant, sources,
      artifact_hex: meta.artifact_hex, artifact_sha256: meta.artifact_sha256, rows });
    timings.push({ arm, corpus_ns: meta.corpus_ns, training_ns: meta.training_ns,
      process_peak_rss_bytes: processes[0].peak_rss_bytes, episodes: samples });
  }
  return { deterministic, timings };
}

// Source solutions are checked by executing the program at zero and the three
// basis vectors. Those four values determine every affine map in this domain.
function apply(affine, input) {
  return affine.bias.map((bias, row) => (bias + input.reduce((sum, value, col) =>
    sum + affine.matrix[row * 3 + col] * value, 0)) % 5);
}
function tokens(index) { return [9, 6, 3, 0].map(shift => (index >> shift) & 7); }
function exactSolutions(family) {
  const inputs = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const wanted = inputs.map(input => apply(family.target, input));
  const solutions = [];
  for (let index = 0; index < 4096; ++index) {
    const roles = tokens(index);
    if (inputs.every((input, point) => {
      let value = input;
      for (const role of roles) value = apply(family.primitiveByRole[role], value);
      return value.every((v, lane) => v === wanted[point][lane]);
    })) solutions.push(index);
  }
  return solutions;
}
const MASK = (1n << 64n) - 1n, STEP = 0x9e3779b97f4a7c15n;
function mix(value) {
  value = (value + STEP) & MASK;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return (value ^ (value >> 31n)) & MASK;
}
function selectedIndex(seed, variant, count) {
  if (variant === 0) return 0;
  if (variant === 9) return count - 1;
  let state = mix(seed ^ mix(0x65717569762d7231n + BigInt(variant - 1)));
  let value;
  do { state = (state + STEP) & MASK; value = mix(state); }
  while (value < (1n << 64n) % BigInt(count));
  return Number(value % BigInt(count));
}

export function validateDiagnostics(arms) {
  assert.deepEqual(arms.map(item => item.arm), ARMS);
  const frozen = readFileSync(resolve(ROOT, BASE, "DEVELOPMENT-TRACE.jsonl"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));
  const reference = new Map(frozen.map(row => [`${row.episode_id}/${row.arm}`, row]));
  const manifest = readJSON(`${BASE}/DEVELOPMENT.json`).split_families;
  const sourceCache = new Map(), searchCache = createR55ReplayCache();
  for (const [armIndex, item] of arms.entries()) {
    assert.equal(item.variant, armIndex < 6 ? 0 : armIndex - 5);
    assert.match(item.artifact_hex, /^[0-9a-f]{3646}$/u);
    const bytes = Buffer.from(item.artifact_hex, "hex");
    assert.equal(sha256(bytes), item.artifact_sha256);
    const guides = parseR55Artifact(bytes);
    const expectedGuides = structuredClone(guides);
    for (const guide of expectedGuides) {
      assert.equal(guide.sourceFamilies, 64);
      assert.equal(guide.sourceSolutions, 64);
      guide.positions.forEach(row => row.fill(0));
      guide.transitions.forEach(table => table.forEach(row => row.fill(0)));
    }
    assert.equal(item.sources.length, 128);
    for (const [index, source] of item.sources.entries()) {
      assert.equal(source.kind, "source");
      assert.equal(source.generator, Math.floor(index / 64));
      assert.equal(source.ordinal, index % 64);
      assert.match(source.family_seed, /^[0-9a-f]{16}$/u);
      const sourceKey = `${source.generator}:${source.ordinal}:${source.family_seed}`;
      let cached = sourceCache.get(sourceKey);
      if (!cached) {
        const family = generateR55FamilyFromSeed({ familySeed: source.family_seed,
          generator: source.generator, ordinal: source.ordinal });
        const receipt = manifest[index];
        assert.equal(receipt.lane, "source-training");
        assert.equal(tagged("reasoner55-target-ast", family.targetRoles), receipt.ast_sha256);
        assert.equal(tagged("reasoner55-affine",
          [...family.target.matrix, ...family.target.bias]), receipt.behavior_sha256);
        cached = { family, solutions: exactSolutions(family) };
        sourceCache.set(sourceKey, cached);
      }
      assert.equal(source.exact_count, cached.solutions.length);
      assert.ok(source.exact_count > 0);
      assert.equal(source.selected_syntax, cached.solutions[selectedIndex(
        cached.family.familySeed, item.variant, source.exact_count)]);
      const guide = expectedGuides[source.generator], roles = tokens(source.selected_syntax);
      roles.forEach((role, position) => guide.positions[position][role]++);
      for (let i = 0; i < 3; ++i) guide.transitions[i][roles[i]][roles[i + 1]]++;
    }
    assert.deepEqual(guides, expectedGuides, `${item.arm}: source guide replay`);
    if (item.variant === 0) assert.equal(item.artifact_hex,
      readFileSync(resolve(ROOT, BASE, "SOURCE_ARTIFACT.hex"), "utf8").trim());
    assert.equal(item.rows.length, 32);
    assert.equal(new Set(item.rows.map(key)).size, 32);
    for (const row of item.rows) {
      for (const [field, limit] of [["target_generator", 2], ["source_generator", 2],
        ["ordinal", 4], ["tie", 2]])
        assert.ok(Number.isSafeInteger(row[field]) && row[field] >= 0 && row[field] < limit);
      const source = row.source_generator ? "skeleton-first" : "syntax-first";
      const target = row.target_generator ? "skeleton-first" : "syntax-first";
      const episode = `${source}-to-${target}-${String(row.ordinal).padStart(3, "0")}-tie-${row.tie}`;
      const arm = armIndex < 6 ? item.arm : "full";
      const base = reference.get(`${episode}/${arm}`);
      assert.ok(base, episode);
      const family = decodeR55Replay(base);
      assert.equal(row.family_seed, family.familySeed.toString(16).padStart(16, "0"));
      if (armIndex < 6)
        for (const field of FIELDS) assert.deepEqual(row[field], base[field], `${arm}: ${field}`);
      assert.equal(row.exact, true);
      assert.equal(row.certificate_valid, true);
      assert.equal(row.accepted_semantic_sha256, base.accepted_semantic_sha256);
      assert.equal(row.observation_queries, base.observation_queries);
      assert.equal(row.source_artifact_reads, base.source_artifact_reads);
      // The existing replay reconstructs the complete ordering and exact search.
      replayR55Search({ ...base, ...row }, family, guides[row.source_generator], searchCache);
    }
  }
  return { source_families: sourceCache.size, target_families: 8,
    source_generator_views_per_target: 2, tie_repeats_per_view: 2,
    replayed_rows: 32 * ARMS.length };
}

export function summarizeDiagnostics(arms) {
  const jit = new Map(arms.find(item => item.arm === "source_free_jit").rows.map(row => [key(row), row]));
  const full = new Map(arms.find(item => item.arm === "full").rows.map(row => [key(row), row]));
  return arms.map(item => {
    const families = new Map();
    for (const row of item.rows) {
      if (!families.has(familyKey(row))) families.set(familyKey(row), []);
      families.get(familyKey(row)).push(Math.log((row.primary_cost + 1) /
        (jit.get(key(row)).primary_cost + 1)));
    }
    const familyValues = [...families].map(([family, logs]) => ({ family,
      cost_ratio_to_jit: rounded(Math.exp(mean(logs))) }));
    return { arm: item.arm, verifier_checks: item.rows.reduce((n, r) => n + r.verifier_checks, 0),
      partial_expansions: item.rows.reduce((n, r) => n + r.partial_expansions, 0),
      exact_answers: item.rows.filter(row => row.exact).length,
      changed_orders_from_full: item.rows.filter(row =>
        row.proposal_order_sha256 !== full.get(key(row)).proposal_order_sha256).length,
      cost_ratio_to_jit: rounded(Math.exp(mean([...families.values()].map(mean)))),
      family_values: familyValues };
  });
}

export function summarizeTimings(timings) {
  return timings.map(item => ({ arm: item.arm,
    training_ns: item.training_ns, process_peak_rss_bytes: item.process_peak_rss_bytes,
    ...Object.fromEntries(TIMERS.map(timer => [timer,
      item.episodes.reduce((sum, episode) => sum + median(episode.samples.map(row => row[timer])), 0)])) }));
}

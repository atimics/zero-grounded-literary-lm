import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { ARMS, TIMERS, MODEL, MODEL_SHA, ROOT, median, armOrder, loadModel } from "./reasoner55_fixed_transfer.mjs";
import { generateR55FamilyFromSeed, deriveR55TieSalt, decodeR55Replay, replayR55Search } from "./reasoner55_replay.mjs";
import { replayRow, DIAGNOSTICS, ORIGINAL } from "./reasoner55_semantic_guide.mjs";

export { ARMS, TIMERS, MODEL, MODEL_SHA, ROOT, median, armOrder };
export const SMOKE_SEED = "55356d736d6f6b31";
export const STUDY_SEED = "55356d6174636831";
export const PLAN = "benchmarks/reasoner55-matched-controls-v1/PLAN.md";
export const FAST = resolve(ROOT, "build/reasoner55_matched_fast");
export const PLAIN = resolve(ROOT, "build/reasoner55_matched_plain");
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const files = ["reasoner55_matched_transfer.c", "reasoner55_fast_search.c", "reasoner55_fast_hash.h",
  "reasoner55_fast_sort.h", "reasoner55.c", "reasoner55.h", "reasoner55_diagnostics.c",
  "reasoner55_semantic_guide.c", "reasoner55_fixed_transfer.c", "scripts/embed_reasoner55_fast.mjs",
  "scripts/lib/reasoner55_matched.mjs", "scripts/run_reasoner55_matched.mjs", "scripts/check_reasoner55_matched.mjs", "Makefile.reasoner55-matched",
  "scripts/lib/reasoner55_fixed_transfer.mjs", "scripts/lib/reasoner55_semantic_guide.mjs",
  "scripts/lib/reasoner55_replay.mjs", "scripts/lib/reasoner5_harness.mjs",
  `${DIAGNOSTICS}/DIAGNOSTICS.json`, `${ORIGINAL}/DEVELOPMENT-TRACE.jsonl`,
  "benchmarks/reasoner55-fixed-transfer-v1/RESULTS.json", PLAN, MODEL];
export const sourceBindings = () => Object.fromEntries(files.map(path => [path, sha(readFileSync(resolve(ROOT, path)))]));
export const episodes = perCell => Array.from({ length: 4 }, (_, cell) =>
  Array.from({ length: perCell }, (_, family) => Array.from({ length: 4 }, (_, view) => (cell * 32 + family) * 4 + view))).flat(2);
export const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !TIMERS.includes(key) && key !== "phase"));
export const nativeRows = bytes => String(bytes).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));

export function validateProcess(rows, { arm, pass, seed, perCell, fast = true }) {
  const meta = rows[0], tail = rows.at(-1), expected = episodes(perCell);
  assert.equal(meta.kind, "metadata");
  assert.deepEqual([meta.arm, meta.pass, meta.seed, meta.families_per_cell], [arm, pass, seed, perCell]);
  assert.equal(meta.typed_sort, fast);
  assert.ok(fast ? ["CommonCrypto SHA-256", "OpenSSL EVP SHA-256"].includes(meta.hash) : meta.hash === "original portable SHA-256");
  assert.equal(meta.model_bytes, ARMS.indexOf(arm) >= 3 ? 1863 : 0);
  assert.equal(tail.kind, "process");
  assert.equal(tail.failed, false);
  assert.equal(tail.completed_episodes, expected.length * 2);
  for (const name of ["corpus_ns", "corpus_cpu_ns", "model_load_ns", "model_load_cpu_ns"])
    assert.ok(Number.isSafeInteger(meta[name]) && meta[name] >= 0, name);
  for (const name of ["peak_rss_bytes", "process_wall_ns", "process_cpu_ns"])
    assert.ok(Number.isSafeInteger(tail[name]) && tail[name] > 0, name);
  const byPhase = {};
  for (const phase of ["warmup", "measured"]) {
    const selected = rows.slice(1, -1).filter(row => row.phase === phase);
    assert.deepEqual(selected.map(row => row.episode).sort((a, b) => a - b), expected);
    for (const row of selected) {
      assert.equal(row.kind, "row");
      assert.deepEqual([row.failed, row.exact, row.certificate_valid, row.injected_invalid_rejected], [false, true, true, true]);
      for (const name of TIMERS) assert.ok(Number.isSafeInteger(row[name]) && row[name] >= 0, name);
      assert.ok(row.cpu_ns > 0 && row.wall_ns > 0);
      assert.ok(row.wall_ns >= TIMERS.slice(0, -2).reduce((sum, name) => sum + row[name], 0));
      for (const name of ["groups", "primary_cost", "verifier_checks", "partial_expansions", "observation_queries", "source_artifact_reads"])
        assert.ok(Number.isSafeInteger(row[name]) && row[name] >= 0, name);
      for (const name of ["features_sha256", "proposal_order_sha256", "accepted_semantic_sha256"])
        assert.match(row[name], /^[a-f0-9]{64}$/u);
    }
    byPhase[phase] = selected;
  }
  assert.equal(rows.length, expected.length * 2 + 2);
  assert.deepEqual(byPhase.warmup.map(row => row.episode), byPhase.measured.map(row => row.episode));
  assert.deepEqual(byPhase.warmup.map(stable), byPhase.measured.map(stable));
  const all = [...byPhase.warmup, ...byPhase.measured];
  assert.ok(tail.process_cpu_ns >= meta.corpus_cpu_ns + meta.model_load_cpu_ns + all.reduce((sum, row) => sum + row.cpu_ns, 0));
  assert.ok(tail.process_wall_ns >= meta.corpus_ns + meta.model_load_ns + all.reduce((sum, row) => sum + row.wall_ns, 0));
  return { meta, tail, ...byPhase };
}

const mapKey = map => [...map.matrix, ...map.bias].join(",");
const operationsKey = maps => maps.map(mapKey).join(":");
const identityMap = () => ({ matrix: [1,0,0,0,1,0,0,0,1], bias: [0,0,0] });
function compose(a, b) {
  const matrix = [], bias = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let value = 0;
      for (let k = 0; k < 3; k++) value += a.matrix[r * 3 + k] * b.matrix[k * 3 + c];
      matrix.push(value % 5);
    }
    bias.push((a.bias[r] + b.bias.reduce((sum, value, c) => sum + a.matrix[r * 3 + c] * value, 0)) % 5);
  }
  return { matrix, bias };
}
function mix64(input) {
  const mask = (1n << 64n) - 1n;
  let value = (input + 0x9e3779b97f4a7c15n) & mask;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
  return (value ^ (value >> 31n)) & mask;
}
function rng(seed, stream) {
  const range = 1n << 64n;
  let state = mix64(seed ^ mix64(stream));
  return bound => {
    let value;
    do { state = (state + 0x9e3779b97f4a7c15n) % range; value = mix64(state); } while (value < range % BigInt(bound));
    return Number(value % BigInt(bound));
  };
}
function candidate(root, ordinal, nonce) {
  const seed = mix64(BigInt(`0x${root}`) ^ (BigInt(ordinal) << 16n) ^ BigInt(nonce));
  const family = generateR55FamilyFromSeed({ familySeed: seed, generator: 0, ordinal });
  if (ordinal >= 64) for (const role of [6, 7]) {
    const random = rng(seed, 0x64656e73652d7631n + BigInt(role));
    let dense;
    for (let attempt = 0; attempt < 1024; attempt++) {
      const m = Array.from({ length: 9 }, () => 1 + random(4));
      const det = m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
      if ((det % 5 + 5) % 5 === 0) continue;
      dense = { matrix: m, bias: role === 7 ? Array.from({ length: 3 }, () => 1 + random(4)) : [0,0,0] };
      break;
    }
    assert.ok(dense, "dense generation exhausted");
    family.primitiveByRole[role] = dense;
  }
  const random = rng(seed, 0x636f6d702d763031n), binding = [0,1,2,3,4,5,6,7];
  for (let i = 7; i > 0; i--) { const j = random(i + 1); [binding[i], binding[j]] = [binding[j], binding[i]]; }
  family.targetRoles = Array.from({ length: 4 }, (_, i) => binding[Math.floor(ordinal / 32) % 2 ? i % 2 : i]);
  family.targetSurface = family.targetRoles.map(role => family.roleToSurface[role]);
  family.target = family.targetRoles.reduce((map, role) => compose(family.primitiveByRole[role], map), identityMap());
  family.exampleOutput = family.target.bias.map((bias, r) => (bias + family.exampleInput.reduce((sum, value, c) =>
    sum + family.target.matrix[r * 3 + c] * value, 0)) % 5);
  return family;
}
export function verifyCohort(records, perCell, seed) {
  assert.match(seed, /^[0-9a-f]{16}$/u);
  assert.deepEqual(records.map(row => row.ordinal), episodes(perCell).filter((_, i) => i % 4 === 0).map(i => i / 4));
  const readJSON = path => JSON.parse(readFileSync(resolve(ROOT, path)));
  const sources = readJSON(`${DIAGNOSTICS}/DIAGNOSTICS.json`).arms[0].sources.map(row =>
    generateR55FamilyFromSeed({ familySeed: row.family_seed, generator: row.generator, ordinal: row.ordinal }));
  const development = new Map();
  for (const row of nativeRows(readFileSync(resolve(ROOT, ORIGINAL, "DEVELOPMENT-TRACE.jsonl"))))
    if (row.arm === "target_only") {
      const family = decodeR55Replay(row);
      development.set(`${family.generator}:${family.ordinal}`, family);
    }
  const previous = readJSON("benchmarks/reasoner55-fixed-transfer-v1/RESULTS.json").families;
  const behaviors = new Set([...sources, ...development.values()].map(family => mapKey(family.target)));
  const operations = new Set([...sources, ...development.values()].map(family => operationsKey(family.primitiveByRole)));
  for (const row of previous) { behaviors.add(mapKey(row.target)); operations.add(operationsKey(row.primitive_by_role)); }
  const families = [];
  for (const row of records) {
    assert.equal(row.cell, Math.floor(row.ordinal / 32));
    assert.ok(!behaviors.has(mapKey(row.target)), "target behavior was already used");
    assert.ok(!operations.has(operationsKey(row.primitive_by_role)), "primitive set was already used");
    assert.equal(row.rejections.reduce((sum, value) => sum + value, 0), row.nonce);
    assert.ok(row.target_roles.some(role => role >= 6));
    for (const family of sources)
      assert.notEqual(mapKey(row.target_roles.reduce((map, role) => compose(family.primitiveByRole[role], map), identityMap())),
        mapKey(family.target), "declared composition solves a source task");
    for (const family of development.values()) assert.notDeepEqual(row.target_roles, family.targetRoles);
    const family = candidate(seed, row.ordinal, row.nonce);
    assert.equal(family.familySeed.toString(16).padStart(16, "0"), row.family_seed);
    assert.deepEqual(family.surfaceToRole, row.surface_to_role);
    assert.deepEqual(family.surfaceIds, row.surface_ids);
    assert.deepEqual(family.exampleInput, row.example_input);
    assert.deepEqual(row.primitive_by_role, family.primitiveByRole);
    assert.deepEqual(row.target_roles, family.targetRoles);
    assert.deepEqual(family.target, row.target);
    assert.deepEqual(family.exampleOutput, row.example_output);
    behaviors.add(mapKey(row.target)); operations.add(operationsKey(row.primitive_by_role)); families.push(family);
  }
  return families;
}

export function replayRows(families, armRows, checkDeadline = () => {}) {
  const model = loadModel();
  let count = 0;
  for (const original of families) {
    checkDeadline();
    const references = new Map(), cache = new Map();
    for (let source = 0; source < 2; source++) for (let tie = 0; tie < 2; tie++) {
      const family = { ...original, sourceGenerator: source, tie, tieSalt: deriveR55TieSalt(original.familySeed, source, tie) };
      const digest = sha(Buffer.concat([Buffer.from("reasoner55-affine\0"), Buffer.from([...family.target.matrix, ...family.target.bias])]));
      references.set(`0:${family.ordinal}:${source}:${tie}`, { family, row: { accepted_semantic_sha256: digest } });
    }
    const context = { references, bases: new Map() };
    for (const [index, arm] of ARMS.entries()) {
      const rows = armRows[arm].filter(row => Math.floor(row.episode / 4) === original.ordinal);
      assert.deepEqual(rows.map(row => row.episode).sort((a, b) => a - b), Array.from({ length: 4 }, (_, view) => original.ordinal * 4 + view));
      for (const record of rows) {
        const source = Math.floor(record.episode / 2) % 2, tie = record.episode % 2;
        const reference = references.get(`0:${original.ordinal}:${source}:${tie}`), family = reference.family;
        const row = { ...record, target_generator: 0, ordinal: family.ordinal, source_generator: source, tie,
          family_seed: family.familySeed.toString(16).padStart(16, "0") };
        assert.equal(row.accepted_semantic_sha256, reference.row.accepted_semantic_sha256);
        if (index < 2) replayR55Search({ ...row, arm, family_id: `matched:${family.ordinal}`,
          episode_id: String(row.episode), censoring_reason: null }, family, model.guides[source], cache);
        else replayRow(row, [1, 3, 5, 7][index - 2], model, context);
        count++;
      }
    }
  }
  return count;
}

export function collectChild({ executable, args, output, timeoutMs, cwd = ROOT }) {
  const started = performance.now();
  const child = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" });
  // Preserve complete and partial output before inspecting the child's status.
  const stdout = child.stdout ?? "", stderr = child.stderr ?? "";
  writeFileSync(`${output}.jsonl`, stdout, { flag: "wx" });
  writeFileSync(`${output}.stderr`, stderr, { flag: "wx" });
  const terminal = { status: child.status, signal: child.signal, error: child.error?.code ?? null,
    elapsed_ms: performance.now() - started, stdout_sha256: sha(stdout), stderr_sha256: sha(stderr),
    timeout_ms: timeoutMs, args };
  writeFileSync(`${output}.terminal.json`, encode(terminal), { flag: "wx" });
  assert.equal(child.error, undefined, `child error: ${terminal.error}`);
  assert.equal(child.status, 0, `child exited ${child.status}; output and terminal record retained`);
  return nativeRows(stdout);
}

function bootstrap(perCell) {
  let state = 0x55356d31;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  return Array.from({ length: 5000 }, () => Array.from({ length: perCell * 4 }, (_, i) =>
    Math.floor(i / perCell) * perCell + random() % perCell));
}
function interval(logs, draws) {
  const samples = draws.map(draw => Math.exp(mean(draw.map(i => logs[i])))).sort((a, b) => a - b);
  return { ratio: Math.exp(mean(logs)), upper_one_sided_95: samples[Math.ceil(samples.length * 0.95) - 1] };
}

export function analyze(processes, { seed = STUDY_SEED, perCell = 32, passes = 12 } = {}) {
  assert.equal(passes, 12);
  const order = Array.from({ length: passes }, (_, pass) => armOrder(pass).map(arm => `${pass}:${arm}`)).flat();
  assert.deepEqual(processes.map(process => `${process.pass}:${process.arm}`), order);
  const samples = new Map(), expected = episodes(perCell), identity = new Map();
  const totals = Object.fromEntries(ARMS.map(arm => [arm, { process_cpu_ns: 0, process_wall_ns: 0,
    corpus_cpu_ns: 0, model_load_cpu_ns: 0, warmup_cpu_ns: 0, measured_cpu_ns: 0, peak_rss_bytes: 0 }]));
  const orders = new Map();
  for (const process of processes) {
    const parsed = validateProcess(process.rows, { arm: process.arm, pass: process.pass, seed, perCell });
    const sorted = [...parsed.measured].sort((a, b) => a.episode - b.episode);
    if (identity.has(process.arm)) assert.deepEqual(sorted.map(stable), identity.get(process.arm));
    else identity.set(process.arm, sorted.map(stable));
    const sequence = parsed.measured.map(row => row.episode);
    if (orders.has(process.pass)) assert.deepEqual(sequence, orders.get(process.pass));
    else orders.set(process.pass, sequence);
    for (const row of sorted) {
      const key = `${process.arm}:${row.episode}`;
      if (!samples.has(key)) samples.set(key, []);
      samples.get(key).push(row);
    }
    const total = totals[process.arm];
    for (const name of ["process_cpu_ns", "process_wall_ns"]) total[name] += parsed.tail[name];
    total.peak_rss_bytes = Math.max(total.peak_rss_bytes, parsed.tail.peak_rss_bytes);
    for (const name of ["corpus_cpu_ns", "model_load_cpu_ns"]) total[name] += parsed.meta[name];
    for (const phase of ["warmup", "measured"]) total[`${phase}_cpu_ns`] += parsed[phase].reduce((sum, row) => sum + row.cpu_ns, 0);
  }
  const medians = new Map([...samples].map(([key, values]) => {
    assert.equal(values.length, passes);
    return [key, { cpu: median(values.map(row => row.cpu_ns)), checks: values[0].verifier_checks }];
  }));
  const draws = bootstrap(perCell);
  const comparisons = ARMS.filter(arm => arm !== "task_guide").map(reference => {
    const logs = { cpu: [], checks: [] };
    for (let i = 0; i < expected.length; i += 4) {
      const local = { cpu: [], checks: [] };
      for (const episode of expected.slice(i, i + 4)) {
        const actual = medians.get(`task_guide:${episode}`), base = medians.get(`${reference}:${episode}`);
        local.cpu.push(Math.log(actual.cpu / base.cpu));
        local.checks.push(Math.log((actual.checks + 1) / (base.checks + 1)));
      }
      for (const metric of Object.keys(logs)) logs[metric].push(mean(local[metric]));
    }
    return { reference, paired: Object.fromEntries(Object.entries(logs).map(([metric, values]) => [metric, interval(values, draws)])),
      strata: Array.from({ length: 4 }, (_, cell) => ({ cell, ...Object.fromEntries(Object.entries(logs).map(([metric, values]) =>
        [metric, Math.exp(mean(values.slice(cell * perCell, (cell + 1) * perCell)))])) })),
      family_outcomes: Object.fromEntries(Object.entries(logs).map(([metric, values]) => [metric,
        { wins: values.filter(value => value < 0).length, ties: values.filter(value => value === 0).length,
          losses: values.filter(value => value > 0).length }])) };
  });
  const primary = comparisons.find(row => row.reference === "raw_lexical_task_guide");
  return { schema: "zero.reasoner55_matched_analysis.v1", families: perCell * 4, passes, exact: true,
    primary_reference: primary.reference, primary_effect: Object.values(primary.paired).every(value => value.upper_one_sided_95 < 1),
    bootstrap_draws: draws.length, comparisons, totals };
}

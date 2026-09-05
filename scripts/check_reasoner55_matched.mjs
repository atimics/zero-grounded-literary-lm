import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ARMS, FAST, PLAIN, ROOT, SMOKE_SEED, STUDY_SEED, sha, nativeRows, stable, validateProcess,
  verifyCohort, replayRows, analyze, armOrder, collectChild, sourceBindings } from "./lib/reasoner55_matched.mjs";

const call = (binary, args) => nativeRows(execFileSync(binary, args, { cwd: ROOT, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--write-smoke"));
assert.notEqual(SMOKE_SEED, STUDY_SEED);
const cohort = call(FAST, ["cohort", SMOKE_SEED, "1"]);
assert.deepEqual(cohort, call(PLAIN, ["cohort", SMOKE_SEED, "1"]));
assert.deepEqual(cohort, call(FAST, ["cohort", SMOKE_SEED, "1"]));
const families = verifyCohort(cohort, 1, SMOKE_SEED);
assert.throws(() => verifyCohort(cohort, 1, STUDY_SEED));
const swappedCohort = structuredClone(cohort);
swappedCohort[1].target = swappedCohort[0].target;
assert.throws(() => verifyCohort(swappedCohort, 1, SMOKE_SEED), /target behavior was already used/u);
const old = JSON.parse(readFileSync(resolve(ROOT, "benchmarks/reasoner55-fixed-transfer-v1/RESULTS.json"))).families[0];
assert.throws(() => verifyCohort([old, ...cohort.slice(1)], 1, SMOKE_SEED), /target behavior was already used/u);

const rawByArm = {}, armRows = {};
for (const arm of ARMS) {
  const outputs = [PLAIN, FAST].map(binary => call(binary, ["benchmark", SMOKE_SEED, "1", arm, "0"]));
  const parsed = outputs.map((rows, index) => validateProcess(rows, { arm, pass: 0, seed: SMOKE_SEED, perCell: 1, fast: index === 1 }));
  assert.deepEqual(parsed[0].measured.map(stable), parsed[1].measured.map(stable), `${arm}: plain and fast receipts agree`);
  rawByArm[arm] = outputs[1];
  armRows[arm] = parsed[1].measured;
}
const replayed = replayRows(families, armRows);
assert.equal(replayed, 96);
for (const binary of [PLAIN, FAST]) {
  const [backend] = call(binary, ["--hash-self-test"]);
  assert.equal(backend.sha256, sha("Reasoner matched controls"));
  assert.equal(backend.typed_sort, binary === FAST);
  for (const args of [[], ["cohort", SMOKE_SEED, "0"], ["cohort", SMOKE_SEED, "33"],
    ["cohort", "z".repeat(16), "1"], ["benchmark", SMOKE_SEED, "1", "task_guide", "12"],
    ["benchmark", SMOKE_SEED, "1", "unknown", "0"]])
    assert.equal(spawnSync(binary, args, { cwd: ROOT, stdio: "ignore" }).status, 2);
}

// Synthetic timing tests exercise the complete 12-pass pairing and gate.
// Native smoke times are replaced before they enter the analysis test.
const synthetic = Array.from({ length: 12 }, (_, pass) => armOrder(pass).map(arm => {
  const rows = structuredClone(rawByArm[arm]);
  rows[0].pass = pass;
  for (const key of ["corpus_ns", "corpus_cpu_ns", "model_load_ns", "model_load_cpu_ns"]) rows[0][key] = 0;
  for (const row of rows.slice(1, -1)) {
    for (const key of Object.keys(row)) if (key.endsWith("_ns")) row[key] = 0;
    row.cpu_ns = row.wall_ns = arm === "task_guide" ? 100 : 200;
    row.verifier_checks = arm === "task_guide" ? 4 : 9;
  }
  rows.at(-1).process_cpu_ns = rows.at(-1).process_wall_ns = 1000000;
  return { pass, arm, rows };
})).flat();
const analysis = analyze(synthetic, { seed: SMOKE_SEED, perCell: 1 });
assert.equal(analysis.primary_effect, true);
assert.ok(analysis.comparisons.every(row => row.paired.cpu.ratio === 0.5 && row.paired.checks.ratio === 0.5));
const reversed = structuredClone(synthetic);
for (const process of reversed.filter(process => process.arm === "task_guide"))
  for (const row of process.rows.slice(1, -1)) row.cpu_ns = row.wall_ns = 400;
assert.equal(analyze(reversed, { seed: SMOKE_SEED, perCell: 1 }).primary_effect, false);
for (const mutate of [
  data => data[0].rows.splice(1, 1),
  data => data[0].rows[1].exact = false,
  data => data[0].rows[1].cpu_ns = 0,
  data => data[0].rows.at(-1).process_cpu_ns = 1,
  data => data[0].rows[0].typed_sort = false,
  data => data[0].rows[0].seed = STUDY_SEED,
  data => [data[0], data[1]] = [data[1], data[0]],
]) {
  const changed = structuredClone(synthetic); mutate(changed);
  assert.throws(() => analyze(changed, { seed: SMOKE_SEED, perCell: 1 }));
}
const wrongOrder = structuredClone(synthetic);
for (const start of [1, 17]) [wrongOrder[0].rows[start], wrongOrder[0].rows[start + 1]] = [wrongOrder[0].rows[start + 1], wrongOrder[0].rows[start]];
assert.throws(() => analyze(wrongOrder, { seed: SMOKE_SEED, perCell: 1 }));

const temporary = mkdtempSync(resolve(tmpdir(), "reasoner55-matched-failure-"));
try {
  for (const [name, code, timeoutMs] of [
    ["exit", "process.stdout.write('partial evidence\\n'); process.stderr.write('failure detail\\n'); process.exit(7)", 2000],
    ["timeout", "process.stdout.write('partial evidence\\n'); setInterval(()=>{},1000)", 500],
  ]) {
    const output = resolve(temporary, name);
    assert.throws(() => collectChild({ executable: process.execPath, args: ["-e", code], output, timeoutMs }));
    assert.equal(readFileSync(`${output}.jsonl`, "utf8"), "partial evidence\n");
    const terminal = JSON.parse(readFileSync(`${output}.terminal.json`));
    assert.equal(terminal.stdout_sha256, sha("partial evidence\n"));
    if (name === "exit") assert.equal(terminal.status, 7);
    else { assert.equal(terminal.error, "ETIMEDOUT"); assert.equal(terminal.signal, "SIGKILL"); }
  }
  const missing = resolve(temporary, "missing-model");
  assert.throws(() => collectChild({ executable: FAST, args: ["benchmark", SMOKE_SEED, "1", "task_guide", "0"],
    output: missing, timeoutMs: 60000, cwd: temporary }));
  assert.equal(JSON.parse(readFileSync(`${missing}.terminal.json`)).status, 1);
  assert.deepEqual(nativeRows(readFileSync(`${missing}.jsonl`)), [{ kind: "model_failure" }]);
} finally { rmSync(temporary, { recursive: true, force: true }); }

const report = { schema: "zero.reasoner55_matched_smoke.v1", scope: "four_family_engineering_smoke",
  seed: SMOKE_SEED, families: 4, views_per_family: 4, arms: 6, implementations: 2,
  exact_native_episodes_including_warmup: 384, independently_replayed_measured_rows: replayed,
  timing_evidence: false, source_bindings: sourceBindings(),
  cohort_sha256: sha(JSON.stringify(cohort)),
  stable_receipts_sha256: sha(JSON.stringify(Object.fromEntries(ARMS.map(arm => [arm, armRows[arm].map(stable)])))) };
writeFileSync(resolve(ROOT, "build/reasoner55-matched-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
const frozen = resolve(ROOT, "benchmarks/reasoner55-matched-controls-v1/SMOKE.json");
if (process.argv[2] === "--write-smoke") writeFileSync(frozen, `${JSON.stringify(report, null, 2)}\n`);
else assert.deepEqual(report, JSON.parse(readFileSync(frozen)), "saved smoke and source bindings agree");
console.log("Matched controls passed: 384 native smoke episodes, 96 independent replays, fresh behavior checks, paired analysis, failure and timeout retention.");

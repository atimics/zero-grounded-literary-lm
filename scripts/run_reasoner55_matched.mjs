import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arch, cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { ARMS, MODEL, MODEL_SHA, ROOT, FAST, STUDY_SEED, sourceBindings, sha, encode, armOrder,
  collectChild, validateProcess, analyze, verifyCohort, replayRows } from "./lib/reasoner55_matched.mjs";

assert.equal(process.argv.length, 4, "usage: node scripts/run_reasoner55_matched.mjs --run NEW_OUTPUT_DIRECTORY");
assert.equal(process.argv[2], "--run");
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: false });
const started = performance.now(), deadline = started + 45 * 60 * 1000;
const processes = [];
let stage = "identity";
try {
  const model = Buffer.from(readFileSync(resolve(ROOT, MODEL), "utf8").trim(), "hex");
  assert.equal(sha(model), MODEL_SHA);
  const identity = { schema: "zero.reasoner55_matched_identity.v1", seed: STUDY_SEED, families_per_cell: 32,
    passes: 12, arms: ARMS, model_sha256: MODEL_SHA, executable_sha256: sha(readFileSync(FAST)),
    source_bindings: sourceBindings(), machine: { platform: platform(), architecture: arch(), release: release(), cpu: cpus()[0]?.model },
    worker_count: 1, child_timeout_ms: 60000, controller_timeout_ms: 45 * 60 * 1000 };
  writeFileSync(resolve(output, "identity.json"), encode(identity), { flag: "wx" });
  stage = "cohort";
  const cohort = collectChild({ executable: FAST, args: ["cohort", STUDY_SEED, "32"],
    output: resolve(output, "cohort"), timeoutMs: 60000 });
  assert.equal(cohort.length, 128);
  const families = verifyCohort(cohort, 32, STUDY_SEED);
  for (let pass = 0; pass < 12; pass++) for (const arm of armOrder(pass)) {
    stage = `${pass}:${arm}`;
    const remaining = Math.floor(deadline - performance.now());
    assert.ok(remaining > 0, "controller time limit reached");
    assert.equal(sha(readFileSync(FAST)), identity.executable_sha256, "executable changed during run");
    assert.deepEqual(sourceBindings(), identity.source_bindings, "source changed during run");
    const rows = collectChild({ executable: FAST, args: ["benchmark", STUDY_SEED, "32", arm, String(pass)],
      output: resolve(output, `${String(pass).padStart(2, "0")}-${arm}`), timeoutMs: Math.min(60000, remaining) });
    validateProcess(rows, { arm, pass, seed: STUDY_SEED, perCell: 32 });
    processes.push({ pass, arm, rows });
    writeFileSync(resolve(output, "progress.json"), encode({ completed_processes: processes.length, last_stage: stage }));
  }
  stage = "analysis";
  const analysis = analyze(processes);
  stage = "independent_replay";
  analysis.replayed_rows = replayRows(families, Object.fromEntries(ARMS.map(arm => [arm,
    processes.find(process => process.arm === arm).rows.filter(row => row.phase === "measured")])),
  () => assert.ok(performance.now() < deadline, "controller time limit reached"));
  assert.ok(performance.now() < deadline, "controller time limit reached");
  writeFileSync(resolve(output, "analysis.json"), encode(analysis), { flag: "wx" });
  writeFileSync(resolve(output, "terminal.json"), encode({ status: "completed", primary_effect: analysis.primary_effect,
    analysis_sha256: sha(encode(analysis)), elapsed_ms: performance.now() - started }), { flag: "wx" });
  console.log(encode({ output, primary_effect: analysis.primary_effect }));
} catch (error) {
  writeFileSync(resolve(output, "terminal.json"), encode({ status: "failed", stage,
    completed_processes: processes.length, error: String(error), elapsed_ms: performance.now() - started }), { flag: "wx" });
  throw error;
}

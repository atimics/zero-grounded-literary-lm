#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ARMS, BINARY, ROOT, FIXTURE, TIMERS, collectNative, episodeKey, lossGradient,
  publicTask, readJSON, replayContext, replayRow, sha256, sourceBindings,
  summarizeRun, summarizeTiming, trainModel, validateRun,
} from "./lib/reasoner55_semantic_guide.mjs";

const resultBytes = readFileSync(resolve(ROOT, FIXTURE, "DEVELOPMENT.json"));
const result = JSON.parse(resultBytes), timing = readJSON(`${FIXTURE}/TIMING.json`);
assert.equal(result.schema, "zero.reasoner55_semantic_guide_result.v1");
assert.equal(result.lane, "development");
assert.deepEqual(result.source_bindings, sourceBindings());
assert.deepEqual(execFileSync(BINARY, ["--list-arms"], { encoding: "utf8" }).trim().split("\n"), ARMS);
for (const args of [["execute"], ["development", "unknown", "1"],
  ["development", "task_guide", "0"], ["development", "task_guide", "32"],
  ["development", "task_guide", "1x"]]) assert.equal(spawnSync(BINARY, args).status, 2);

// Check the gradient against changes in the actual loss, with unequal task sizes.
const tiny = [
  { features: [[0,1000000,250000,0], [1000000,0,500000,500000]], label: 1 },
  { features: [[0,0,0,0], [500000,500000,750000,0], [1000000,500000,0,1000000]], label: 0 },
];
const weights = [0.2,-0.3,0.1,0.7], delta = 1e-6;
const { gradient } = lossGradient(tiny, weights);
for (let f = 0; f < 4; ++f) {
  const plus = [...weights], minus = [...weights];
  plus[f] += delta; minus[f] -= delta;
  const numerical = (lossGradient(tiny, plus).loss - lossGradient(tiny, minus).loss) / (2 * delta);
  assert.ok(Math.abs(numerical - gradient[f]) < 1e-8, `feature ${f} loss gradient`);
}

const model = trainModel();
assert.deepEqual(validateRun(result, model), result.evidence);
assert.deepEqual(summarizeRun(result.arms), result.summary);
assert.equal(readFileSync(resolve(ROOT, FIXTURE, "MODEL.hex"), "utf8").trim(), model.artifact_hex);
const native = collectNative(1);
assert.deepEqual(native.metadata, result.metadata);
assert.deepEqual(native.arms, result.arms, "native experiment replay");

const context = replayContext(), family = context.references.values().next().value.family;
const poisoned = { ...family, target: { matrix: Array(9).fill(4), bias: [4,4,4] } };
assert.deepEqual(publicTask(poisoned), publicTask(family), "public task is independent of the verifier target");
for (const change of [
  copy => { copy.metadata.weights[0][0]++; },
  copy => { copy.metadata.training_sha256 = "0".repeat(64); },
  copy => { copy.arms[0].rows[1] = copy.arms[0].rows[0]; },
]) {
  const changed = structuredClone(result); change(changed);
  assert.throws(() => validateRun(changed, model));
}
for (const change of [
  row => { row.features_sha256 = "0".repeat(64); },
  row => { row.proposal_order_sha256 = "0".repeat(64); },
  row => { row.verifier_checks++; },
  row => { row.certificate_valid = false; },
  row => { row.groups++; },
  row => { row.source_artifact_reads = 0; },
]) {
  const row = structuredClone(result.arms[3].rows[0]); change(row);
  assert.throws(() => replayRow(row, 3, model, context));
}

assert.equal(timing.schema, "zero.reasoner55_semantic_guide_timing.v1");
assert.equal(timing.lane, "development");
assert.equal(timing.result_sha256, sha256(resultBytes));
assert.match(timing.binary_sha256, /^[0-9a-f]{64}$/u);
assert.ok(Number.isFinite(Date.parse(timing.measured_at)));
assert.equal(timing.prefix_compositions_per_episode, 4680);
assert.equal(timing.repeats, 3); assert.equal(timing.warmup_passes, 1);
assert.deepEqual(timing.process_order, ARMS);
assert.deepEqual(timing.arms.map(item => item.arm), ARMS);
assert.deepEqual(summarizeTiming(timing.arms), timing.summary);
for (const [index, arm] of timing.arms.entries()) {
  assert.ok(arm.corpus_ns > 0 && arm.training_ns > 0 && arm.process_peak_rss_bytes > 0);
  assert.deepEqual(arm.episodes.map(item => item.episode), result.arms[index].rows.map(episodeKey));
  for (const episode of arm.episodes) {
    assert.equal(episode.samples.length, timing.repeats);
    for (const sample of episode.samples) {
      assert.deepEqual(Object.keys(sample), TIMERS);
      for (const value of Object.values(sample)) assert.ok(Number.isSafeInteger(value) && value >= 0);
      assert.ok(sample.wall_ns >= TIMERS.slice(0, -2).reduce((sum, timer) => sum + sample[timer], 0));
      assert.ok(sample.cpu_ns > 0 && sample.enumerate_ns > 0 && sample.search_ns > 0);
    }
  }
}
console.log(`Reasoner 5.5 task guide passed: ${result.evidence.replayed_rows} independently replayed rows, ` +
  `128 source tasks, 8 target tasks, ${model.artifact_bytes} model bytes`);

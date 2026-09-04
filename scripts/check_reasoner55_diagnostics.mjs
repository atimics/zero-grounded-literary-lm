#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ARMS, BINARY, ROOT, FIXTURE, collectDiagnostics, sha256, sourceBindings,
  summarizeDiagnostics, summarizeTimings, validateDiagnostics,
} from "./lib/reasoner55_diagnostics.mjs";

const resultBytes = readFileSync(resolve(ROOT, FIXTURE, "DIAGNOSTICS.json"));
const result = JSON.parse(resultBytes);
const timing = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "TIMING.json")));
assert.equal(result.schema, "zero.reasoner55_diagnostics_result.v1");
assert.equal(result.lane, "development");
assert.deepEqual(result.source_bindings, sourceBindings());
assert.deepEqual(execFileSync(BINARY, ["--list-arms"], { encoding: "utf8" })
  .trim().split("\n"), ARMS);
for (const args of [["execute"], ["development", "unknown", "1"],
  ["development", "full", "0"], ["development", "full", "32"],
  ["development", "full", "1x"]])
  assert.equal(spawnSync(BINARY, args).status, 2);

assert.deepEqual(validateDiagnostics(result.arms), result.evidence);
assert.deepEqual(summarizeDiagnostics(result.arms), result.summary);
const rerun = collectDiagnostics(1);
assert.deepEqual(rerun.deterministic, result.arms, "native development replay");

// Fail on false exact counts, altered source choices, and false search receipts.
for (const change of [
  copy => { copy[0].sources[0].exact_count++; },
  copy => { copy[0].sources[0].selected_syntax = 4096; },
  copy => { copy[6].rows[0].verifier_checks++; },
  copy => { copy[6].rows[0].proposal_order_sha256 = "0".repeat(64); },
  copy => { copy[6].rows[1] = copy[6].rows[0]; },
]) {
  const changed = structuredClone(result.arms);
  change(changed);
  assert.throws(() => validateDiagnostics(changed));
}
assert.equal(timing.schema, "zero.reasoner55_diagnostics_timing.v1");
assert.equal(timing.lane, "development");
assert.equal(timing.result_sha256, sha256(resultBytes));
assert.match(timing.binary_sha256, /^[0-9a-f]{64}$/u);
assert.ok(Number.isFinite(Date.parse(timing.measured_at)));
assert.equal(timing.repeats, 3);
assert.equal(timing.warmup_passes, 1);
assert.deepEqual(timing.process_order, ARMS);
assert.deepEqual(timing.arms.map(item => item.arm), ARMS);
assert.deepEqual(summarizeTimings(timing.arms), timing.summary);
for (const [armIndex, item] of timing.arms.entries()) {
  assert.equal(item.episodes.length, 32);
  assert.deepEqual(item.episodes.map(episode => episode.episode),
    result.arms[armIndex].rows.map(row => [row.target_generator, row.ordinal,
      row.source_generator, row.tie].join(":")), "timing episode binding");
  assert.ok(item.training_ns > 0 && item.corpus_ns > 0 && item.process_peak_rss_bytes > 0);
  for (const episode of item.episodes) {
    assert.equal(episode.samples.length, timing.repeats);
    for (const sample of episode.samples) {
      assert.deepEqual(Object.keys(sample).sort(),
        ["adapter_ns", "cpu_ns", "jit_ns", "search_ns", "wall_ns"]);
      for (const value of Object.values(sample)) assert.ok(Number.isSafeInteger(value) && value >= 0);
      assert.ok(sample.search_ns > 0 && sample.cpu_ns > 0);
      assert.ok(sample.wall_ns >= sample.adapter_ns + sample.jit_ns + sample.search_ns);
      assert.equal(sample.jit_ns > 0, item.arm === "source_free_jit");
      assert.equal(sample.adapter_ns > 0, item.arm === "adapter_only" ||
        item.arm === "source_free_jit" || item.arm === "full" || armIndex >= 6);
    }
  }
}
console.log(`Reasoner 5.5 diagnostics passed: ${result.evidence.replayed_rows} rows, ` +
  `${result.evidence.target_families} target families, ${ARMS.length} arms`);

#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { BINARY, ROOT, FIXTURE, collectDiagnostics, sha256, sourceBindings,
  summarizeDiagnostics, summarizeTimings, validateDiagnostics,
} from "./lib/reasoner55_diagnostics.mjs";

assert.deepEqual(process.argv.slice(2), ["--write"]);
const run = collectDiagnostics(3);
const evidence = validateDiagnostics(run.deterministic);
const result = { schema: "zero.reasoner55_diagnostics_result.v1", lane: "development",
  purpose: "source solution choice and full search cost", source_bindings: sourceBindings(),
  evidence, summary: summarizeDiagnostics(run.deterministic), arms: run.deterministic };
const bytes = `${JSON.stringify(result, null, 2)}\n`;
const timing = { schema: "zero.reasoner55_diagnostics_timing.v1", lane: "development",
  result_sha256: sha256(bytes), measured_at: new Date().toISOString(),
  host: { platform: platform(), arch: arch(), release: release(),
    cpu: cpus()[0]?.model ?? "unknown", node: process.version },
  binary_sha256: sha256(readFileSync(BINARY)), warmup_passes: 1, repeats: 3,
  process_order: run.timings.map(item => item.arm),
  search_scope: "public episode, adapter with domain audit, JIT if used, ranking, exact verification, fallback, search receipts",
  training_scope: "all 4096 source programs per family, one exact selection, guide counts and serialization; all arms run this diagnostic audit",
  memory_scope: "process peak RSS including corpus generation, source audit, warmup, and measured search",
  summary: summarizeTimings(run.timings), arms: run.timings };
mkdirSync(resolve(ROOT, FIXTURE), { recursive: true });
writeFileSync(resolve(ROOT, FIXTURE, "DIAGNOSTICS.json"), bytes);
writeFileSync(resolve(ROOT, FIXTURE, "TIMING.json"), `${JSON.stringify(timing, null, 2)}\n`);
console.log(JSON.stringify({ evidence, summary: result.summary.map(({ family_values, ...row }) => row),
  timing: timing.summary }, null, 2));

#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { BINARY, ROOT, FIXTURE, collectNative, sha256, sourceBindings,
  summarizeRun, summarizeTiming, trainModel, validateRun,
} from "./lib/reasoner55_semantic_guide.mjs";

assert.deepEqual(process.argv.slice(2), ["--write"]);
const run = collectNative(3);
const model = trainModel();
const evidence = validateRun(run, model);
const result = { schema: "zero.reasoner55_semantic_guide_result.v1", lane: "development",
  source_bindings: sourceBindings(), metadata: run.metadata, evidence,
  summary: summarizeRun(run.arms), arms: run.arms };
const bytes = `${JSON.stringify(result, null, 2)}\n`;
const timing = { schema: "zero.reasoner55_semantic_guide_timing.v1", lane: "development",
  result_sha256: sha256(bytes), measured_at: new Date().toISOString(),
  host: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model, node: process.version },
  binary_sha256: sha256(readFileSync(BINARY)), warmup_passes: 1, repeats: 3,
  process_order: run.timing.map(item => item.arm),
  scope: "allocation, public adapter and domain audit, prefix enumeration, grouping, features and scores, sorting, receipts, exact verification and fallback, release",
  prefix_compositions_per_episode: 4680,
  memory_scope: "process peak RSS including corpus generation, source training, warmup, and measured search",
  summary: summarizeTiming(run.timing), arms: run.timing };
mkdirSync(resolve(ROOT, FIXTURE), { recursive: true });
writeFileSync(resolve(ROOT, FIXTURE, "DEVELOPMENT.json"), bytes);
writeFileSync(resolve(ROOT, FIXTURE, "MODEL.hex"), `${model.artifact_hex}\n`);
writeFileSync(resolve(ROOT, FIXTURE, "TIMING.json"), `${JSON.stringify(timing, null, 2)}\n`);
console.log(JSON.stringify({ evidence, model: { weights: model.weights, initial_loss: model.initial_loss,
  final_loss: model.final_loss }, summary: result.summary.map(({ family_ratios, ...row }) => row),
  timing: timing.summary.slice(0, 8) }, null, 2));

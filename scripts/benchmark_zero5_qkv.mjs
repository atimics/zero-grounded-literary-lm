#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function parseReport(output) {
  const reports = [...output.matchAll(
    /update\s+(\d+)\s+train\s+([0-9.]+)\s+val\s+([0-9.]+)\s+grad\s+([0-9.]+)\s+lr\s+([^ ]+)\s+tok\/s\s+(\d+)\s+active\/s\s+(\d+)/g,
  )];
  const time = output.match(/training time\s+([0-9.]+)\s+seconds/);
  if (reports.length === 0 || time === null) fail("trainer report is missing");
  const report = reports.at(-1);
  return {
    update: Number(report[1]),
    train_loss: Number(report[2]),
    validation_loss: Number(report[3]),
    gradient_norm: Number(report[4]),
    tokens_per_second: Number(report[6]),
    elapsed_seconds: Number(time[1]),
  };
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (process.argv.includes("--self-test")) {
  const parsed = parseReport(
    "update 200 train 2.0549 val 1.8532 grad 1.512 lr 0.0002 " +
    "tok/s 27065 active/s 23908\ntraining time 15.39 seconds\n",
  );
  assert.equal(parsed.update, 200);
  assert.equal(parsed.tokens_per_second, 27065);
  assert.equal(parsed.elapsed_seconds, 15.39);
  assert.equal(mean([2, 4]), 3);
  process.stdout.write("Q/K/V benchmark self-test passed\n");
  process.exit(0);
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) fail("--asset-root is required");
const assetRoot = path.resolve(assetRootValue);
const updates = Number(option("--updates", "200"));
const repetitions = Number(option("--repetitions", "2"));
if (!Number.isInteger(updates) || updates < 1 || updates > 9442) {
  fail("--updates must be from 1 through 9442");
}
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
  fail("--repetitions must be from 1 through 10");
}

const assets = {
  initial: path.join(assetRoot, "build/zero5-c2-v1/run/best.ckpt"),
  tokenizer: path.join(assetRoot,
    "build/zero5-c0-v1/corpus-one/byte-bpe512.sero"),
  train: path.join(assetRoot,
    "build/zero5-c33-v1/import-final/train.interleaved.z5pack"),
  validation: path.join(assetRoot,
    "build/zero5-c33-v1/import-final/validation.interleaved.z5pack"),
};
for (const file of Object.values(assets)) {
  if (!fs.existsSync(file)) fail(`asset is missing: ${file}`);
}

const variants = [
  ["baseline", "zero5_c32_lm_fast"],
  ["forward", "zero5_c32_lm_qkv_forward"],
  ["backward", "zero5_c32_lm_qkv_backward"],
  ["both", "zero5_c32_lm_qkv"],
];
if (!process.argv.includes("--skip-build")) {
  run("make", ["-B", ...variants.map(([, binary]) => binary)]);
}
for (const [, binary] of variants) {
  if (!fs.existsSync(binary)) fail(`trainer is missing: ${binary}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-qkv-"));
const common = [
  "--init", assets.initial,
  "--tokenizer", assets.tokenizer,
  "--packed-train", assets.train,
  "--packed-validation", assets.validation,
  "--run-contract-sha256",
  "f06365554a16ec0557503fe35ff6e074a0720312dd4295e3d54e1a7df6fa73d1",
  "--steps", "9442", "--max-run-steps", String(updates),
  "--batch", "4", "--parallel-batch", "4", "--lr", "0.0003",
  "--weight-decay", "0.01", "--clip", "1", "--warmup", "300",
  "--schedule-total", "9442", "--cosine", "--dropout", "0.1",
  "--report", String(updates), "--validation", "8", "--seed", "0",
  "--save-every", "0", "--claim-answer-weight", "3.009199423",
  "--cloze-answer-weight", "1", "--retrieval-answer-weight",
  "1.941452456", "--tokens", "0",
];
const measurements = Object.fromEntries(variants.map(([name]) => [name, []]));

try {
  for (let repetition = 0; repetition < repetitions; ++repetition) {
    const ordered = repetition % 2 === 0 ? variants : [...variants].reverse();
    for (const [name, binary] of ordered) {
      const prefix = path.join(temporary, `${repetition}-${name}`);
      process.stdout.write(`Running ${name}, repetition ${repetition + 1}...\n`);
      const output = run(path.resolve(binary), [
        ...common, "--best", `${prefix}-best.ckpt`,
        "--save", `${prefix}-active.ckpt`,
      ]);
      measurements[name].push({
        ...parseReport(output),
        checkpoint_sha256: digest(`${prefix}-active.ckpt`),
      });
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const referenceHashes = measurements.baseline.map(run => run.checkpoint_sha256);
for (const [name] of variants) {
  measurements[name].forEach((run, index) => {
    assert.equal(run.checkpoint_sha256, referenceHashes[index],
      `${name} changed the checkpoint in repetition ${index + 1}`);
    assert.equal(run.train_loss, measurements.baseline[index].train_loss);
    assert.equal(run.validation_loss,
      measurements.baseline[index].validation_loss);
    assert.equal(run.gradient_norm,
      measurements.baseline[index].gradient_norm);
  });
}

const baselineThroughput = mean(
  measurements.baseline.map(run => run.tokens_per_second));
const result = {
  schema: "zero.qkv_fusion_benchmark.v1",
  recorded_at: new Date().toISOString(),
  platform: { os: os.platform(), architecture: os.arch(), release: os.release() },
  workload: { updates, repetitions, batch: 4, context_tokens: 512 },
  variants: Object.fromEntries(variants.map(([name]) => {
    const runs = measurements[name];
    const throughput = mean(runs.map(run => run.tokens_per_second));
    return [name, {
      runs,
      mean_tokens_per_second: throughput,
      throughput_change_from_baseline: throughput / baselineThroughput - 1,
    }];
  })),
  correctness: {
    checkpoints_bit_identical: true,
    reported_metrics_match: true,
  },
};
const json = `${JSON.stringify(result, null, 2)}\n`;
const destination = option("--out");
if (destination !== null) fs.writeFileSync(path.resolve(destination), json);
process.stdout.write(json);

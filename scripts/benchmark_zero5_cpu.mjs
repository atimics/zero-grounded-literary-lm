#!/usr/bin/env node

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

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseReport(output) {
  const reports = [...output.matchAll(
    /update\s+(\d+)\s+train\s+([0-9.]+)\s+val\s+([0-9.]+)\s+grad\s+([0-9.]+)\s+lr\s+([^ ]+)\s+tok\/s\s+(\d+)\s+active\/s\s+(\d+)/g,
  )];
  const time = output.match(/training time\s+([0-9.]+)\s+seconds/);
  if (reports.length === 0 || time === null) fail("trainer output has no final report");
  const match = reports.at(-1);
  return {
    update: Number(match[1]),
    train_loss: Number(match[2]),
    validation_loss: Number(match[3]),
    gradient_norm: Number(match[4]),
    learning_rate: Number(match[5]),
    tokens_per_second: Number(match[6]),
    active_targets_per_second: Number(match[7]),
    elapsed_seconds: Number(time[1]),
  };
}

function requireFile(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
}

function close(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
}

function selfTest() {
  const report = parseReport(
    "update      200 train 2.0549 val 1.8532 grad 1.512 lr 0.0002 " +
    "tok/s 11025 active/s 9739\ntraining time 37.44 seconds\n",
  );
  if (report.update !== 200 || report.tokens_per_second !== 11025 ||
      report.validation_loss !== 1.8532 || report.elapsed_seconds !== 37.44) {
    fail("CPU benchmark parser self-test failed");
  }
  process.stdout.write("CPU benchmark parser self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) {
  fail("--asset-root must name a checkout containing the C2, C3.3, and tokenizer assets");
}
const assetRoot = path.resolve(assetRootValue);
const updates = Number(option("--updates", "50"));
if (!Number.isInteger(updates) || updates < 1 || updates > 9442) {
  fail("--updates must be an integer from 1 through 9442");
}

const files = {
  initial: path.join(assetRoot, "build/zero5-c2-v1/run/best.ckpt"),
  tokenizer: path.join(assetRoot,
    "build/zero5-c0-v1/corpus-one/byte-bpe512.sero"),
  train: path.join(assetRoot,
    "build/zero5-c33-v1/import-final/train.interleaved.z5pack"),
  validation: path.join(assetRoot,
    "build/zero5-c33-v1/import-final/validation.interleaved.z5pack"),
};
for (const [label, file] of Object.entries(files)) requireFile(file, label);

if (!process.argv.includes("--skip-build")) {
  process.stdout.write("Building strict and fast CPU trainers...\n");
  run("make", ["-B", "zero5_c32_lm", "zero5_c32_lm_fast"]);
}
requireFile("zero5_c32_lm", "strict trainer");
requireFile("zero5_c32_lm_fast", "fast trainer");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-cpu-benchmark-"));
const common = [
  "--init", files.initial,
  "--tokenizer", files.tokenizer,
  "--packed-train", files.train,
  "--packed-validation", files.validation,
  "--run-contract-sha256",
  "f06365554a16ec0557503fe35ff6e074a0720312dd4295e3d54e1a7df6fa73d1",
  "--steps", "9442",
  "--max-run-steps", String(updates),
  "--batch", "4",
  "--lr", "0.0003",
  "--weight-decay", "0.01",
  "--clip", "1",
  "--warmup", "300",
  "--schedule-total", "9442",
  "--cosine",
  "--dropout", "0.1",
  "--report", String(updates),
  "--validation", "8",
  "--seed", "0",
  "--save-every", "0",
  "--claim-answer-weight", "3.009199423",
  "--cloze-answer-weight", "1",
  "--retrieval-answer-weight", "1.941452456",
  "--tokens", "0",
];

function benchmark(name, binary) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory);
  process.stdout.write(`Running ${name} CPU trainer for ${updates} updates...\n`);
  const output = run(path.resolve(binary), [
    ...common,
    "--best", path.join(directory, "best.ckpt"),
    "--save", path.join(directory, "active.ckpt"),
  ]);
  const checkpoint = path.join(directory, "active.ckpt");
  return {
    ...parseReport(output),
    checkpoint_sha256: sha256(checkpoint),
  };
}

const strict = benchmark("strict", "zero5_c32_lm");
const fast = benchmark("fast", "zero5_c32_lm_fast");
const sameReportedMetrics =
  close(strict.train_loss, fast.train_loss, 0.0001) &&
  close(strict.validation_loss, fast.validation_loss, 0.0001) &&
  close(strict.gradient_norm, fast.gradient_norm, 0.001);
if (!sameReportedMetrics) fail("fast trainer drifted beyond the reporting tolerance");

const result = {
  schema: "zero.cpu_speed_benchmark.v1",
  recorded_at: new Date().toISOString(),
  platform: { os: os.platform(), architecture: os.arch(), release: os.release() },
  workload: {
    source: "C3.3 frozen training packs",
    updates,
    sequences_per_update: 4,
    context_tokens: 512,
  },
  strict,
  fast,
  comparison: {
    same_reported_metrics: sameReportedMetrics,
    checkpoint_bit_identical: strict.checkpoint_sha256 === fast.checkpoint_sha256,
    throughput_speedup: fast.tokens_per_second / strict.tokens_per_second,
    elapsed_time_reduction:
      1.0 - fast.elapsed_seconds / strict.elapsed_seconds,
  },
};

const destination = option("--out");
const json = `${JSON.stringify(result, null, 2)}\n`;
if (destination !== null) fs.writeFileSync(path.resolve(destination), json);
process.stdout.write(json);
if (process.argv.includes("--keep")) {
  process.stdout.write(`Kept checkpoints in ${temporary}\n`);
} else {
  fs.rmSync(temporary, { recursive: true, force: true });
}

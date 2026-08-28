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
    env: {
      ...process.env,
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      OPENBLAS_DYNAMIC: "0",
      OMP_DYNAMIC: "FALSE",
    },
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
  const elapsed = output.match(/training time\s+([0-9.]+)\s+seconds/);
  const math = output.match(/math-backend=([a-z0-9-]+)/);
  const linear = output.match(/linear-backend=([a-z0-9-]+)/);
  const attention = output.match(/attention-backend=([a-z0-9-]+)/);
  if (reports.length === 0 || elapsed === null || math === null ||
      linear === null || attention === null) {
    fail("trainer report or backend identity is missing");
  }
  const report = reports.at(-1);
  return {
    update: Number(report[1]),
    train_loss: Number(report[2]),
    validation_loss: Number(report[3]),
    gradient_norm: Number(report[4]),
    learning_rate: Number(report[5]),
    tokens_per_second: Number(report[6]),
    active_targets_per_second: Number(report[7]),
    elapsed_seconds: Number(elapsed[1]),
    math_backend: math[1],
    linear_backend: linear[1],
    attention_backend: attention[1],
  };
}

const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;

if (process.argv.includes("--self-test")) {
  const report = parseReport(
    "zero5_lm: backend=OpenBLAS " +
    "math-backend=avx512-linear-gnu-libmvec-tanh-exp " +
    "linear-backend=avx512-f32 attention-backend=dense-blas context=512\n" +
    "update 25 train 2.1 val 2.0 grad 1.1 lr 0.0001 tok/s 7000 " +
    "active/s 6000\ntraining time 8.5 seconds\n",
  );
  assert.equal(report.linear_backend, "avx512-f32");
  assert.equal(report.tokens_per_second, 7000);
  process.stdout.write("AVX-512 linear benchmark self-test passed\n");
  process.exit(0);
}

if (os.platform() !== "linux" || os.arch() !== "x64") {
  fail("the AVX-512 linear benchmark requires Linux x86-64");
}
const cpuInfo = fs.readFileSync("/proc/cpuinfo", "utf8");
if (!/\bavx512f\b/.test(cpuInfo) || !/\bfma\b/.test(cpuInfo)) {
  fail("this CPU does not advertise AVX-512F and FMA");
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) fail("--asset-root is required");
const assetRoot = path.resolve(assetRootValue);
const updates = Number(option("--updates", "25"));
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
  ["openblas", "zero5_c32_lm_vector_math", "gnu-libmvec-tanh-exp",
    "cblas-sgemm"],
  ["avx512", "zero5_c32_lm_avx512_linear",
    "avx512-linear-gnu-libmvec-tanh-exp", "avx512-f32"],
];
if (!process.argv.includes("--skip-build")) {
  run("make", ["-B", ...variants.map(([, binary]) => binary)]);
}
for (const [, binary] of variants) {
  if (!fs.existsSync(binary)) fail(`trainer is missing: ${binary}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(),
  "zero-avx512-linear-"));
const common = [
  "--init", assets.initial,
  "--tokenizer", assets.tokenizer,
  "--packed-train", assets.train,
  "--packed-validation", assets.validation,
  "--run-contract-sha256",
  "f06365554a16ec0557503fe35ff6e074a0720312dd4295e3d54e1a7df6fa73d1",
  "--steps", "9442", "--max-run-steps", String(updates),
  "--batch", "4", "--parallel-batch", "4",
  "--lr", "0.0003", "--weight-decay", "0.01", "--clip", "1",
  "--warmup", "300", "--schedule-total", "9442", "--cosine",
  "--dropout", "0.1", "--report", String(updates), "--validation", "8",
  "--seed", "0", "--save-every", "0",
  "--claim-answer-weight", "3.009199423", "--cloze-answer-weight", "1",
  "--retrieval-answer-weight", "1.941452456", "--tokens", "0",
  "--require-attention-backend", "dense-blas",
];
const measurements = Object.fromEntries(variants.map(([name]) => [name, []]));

try {
  for (let repetition = 0; repetition < repetitions; ++repetition) {
    const ordered = repetition % 2 === 0 ? variants : [...variants].reverse();
    for (const [name, binary, mathBackend, linearBackend] of ordered) {
      const prefix = path.join(temporary, `${repetition}-${name}`);
      process.stdout.write(`Running ${name}, repetition ${repetition + 1}...\n`);
      const output = run(path.resolve(binary), [
        ...common,
        "--require-math-backend", mathBackend,
        "--require-linear-backend", linearBackend,
        "--best", `${prefix}-best.ckpt`,
        "--save", `${prefix}-active.ckpt`,
      ]);
      const report = parseReport(output);
      assert.equal(report.math_backend, mathBackend);
      assert.equal(report.linear_backend, linearBackend);
      assert.equal(report.attention_backend, "dense-blas");
      measurements[name].push({
        ...report,
        checkpoint_version:
          fs.readFileSync(`${prefix}-active.ckpt`).readUInt32LE(8),
        checkpoint_sha256: sha256(`${prefix}-active.ckpt`),
      });
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const tolerance = [0.0001, 0.0001, 0.005];
let metricsWithinTolerance = true;
for (const [name] of variants) {
  measurements[name].forEach((measurement, index) => {
    const reference = measurements.openblas[index];
    const values = [measurement.train_loss, measurement.validation_loss,
      measurement.gradient_norm];
    const expected = [reference.train_loss, reference.validation_loss,
      reference.gradient_norm];
    if (!values.every((value, metric) =>
      Math.abs(value - expected[metric]) <= tolerance[metric])) {
      metricsWithinTolerance = false;
    }
    assert.equal(measurement.checkpoint_version, 6);
  });
  assert.equal(new Set(measurements[name]
    .map(measurement => measurement.checkpoint_sha256)).size, 1,
  `${name} is not deterministic across repetitions`);
}
if (!metricsWithinTolerance) fail("the AVX-512 run exceeded tolerance");

const baselineThroughput = mean(measurements.openblas
  .map(run => run.tokens_per_second));
const avx512Throughput = mean(measurements.avx512
  .map(run => run.tokens_per_second));
const result = {
  schema: "zero.avx512_linear_benchmark.v1",
  recorded_at: new Date().toISOString(),
  status: "performance-only; AVX-512 changes float reduction order",
  platform: {
    os: os.platform(), architecture: os.arch(), release: os.release(),
    cpu: os.cpus()[0]?.model ?? "unknown",
  },
  workload: {
    source: "C3.3 frozen training packs", updates, repetitions,
    sequences_per_update: 4, context_tokens: 512,
    parallel_workers: 4, blas_threads_per_worker: 1,
    dynamic_threading: false,
  },
  variants: {
    openblas: {
      runs: measurements.openblas,
      mean_tokens_per_second: baselineThroughput,
    },
    avx512: {
      runs: measurements.avx512,
      mean_tokens_per_second: avx512Throughput,
    },
  },
  comparison: {
    throughput_change: avx512Throughput / baselineThroughput - 1,
    elapsed_time_reduction: 1 - mean(measurements.avx512
      .map(run => run.elapsed_seconds)) / mean(measurements.openblas
      .map(run => run.elapsed_seconds)),
  },
  correctness: {
    metrics_within_tolerance: metricsWithinTolerance,
    deterministic_checkpoints_per_backend: true,
    cross_backend_checkpoint_bit_identical:
      measurements.openblas[0].checkpoint_sha256 ===
      measurements.avx512[0].checkpoint_sha256,
    checkpoint_version: 6,
    tolerance: {
      train_loss: tolerance[0], validation_loss: tolerance[1],
      gradient_norm: tolerance[2],
    },
  },
  claim_boundary: {
    scientific_replication: false,
    test_metrics_opened: false,
  },
};
const json = `${JSON.stringify(result, null, 2)}\n`;
const destination = option("--out");
if (destination !== null) fs.writeFileSync(path.resolve(destination), json);
process.stdout.write(json);

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
  const time = output.match(/training time\s+([0-9.]+)\s+seconds/);
  const math = output.match(/math-backend=([a-z0-9-]+)/);
  const attention = output.match(/attention-backend=([a-z0-9-]+)/);
  if (reports.length === 0 || time === null || math === null ||
      attention === null) {
    fail("trainer report or execution identity is missing");
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
    elapsed_seconds: Number(time[1]),
    math_backend: math[1],
    attention_backend: attention[1],
  };
}

const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;

function attentionWork(context, block) {
  if (block === null) return context * context;
  let work = 0;
  for (let start = 0; start < context; start += block) {
    const rows = Math.min(block, context - start);
    work += rows * (start + rows);
  }
  return work;
}

if (process.argv.includes("--self-test")) {
  const report = parseReport(
    "zero5_lm: backend=OpenBLAS math-backend=gnu-libmvec-tanh-exp " +
    "attention-backend=blocked-causal-blas-64 context=512\n" +
    "update 50 train 2.6 val 2.3 grad 1.2 lr 0.0001 tok/s 7000 " +
    "active/s 6000\ntraining time 14.6 seconds\n",
  );
  assert.equal(report.attention_backend, "blocked-causal-blas-64");
  assert.equal(attentionWork(512, null), 262144);
  assert.equal(attentionWork(512, 64), 147456);
  process.stdout.write("blocked attention benchmark self-test passed\n");
  process.exit(0);
}

if (os.platform() !== "linux" || os.arch() !== "x64") {
  fail("the blocked attention speed benchmark requires Linux x86-64");
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) fail("--asset-root is required");
const assetRoot = path.resolve(assetRootValue);
const updates = Number(option("--updates", "50"));
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
  ["dense", "zero5_c32_lm_vector_math", "dense-blas", null],
  ["blocked-32", "zero5_c32_lm_attention_b32",
    "blocked-causal-blas-32", 32],
  ["blocked-64", "zero5_c32_lm_attention_b64",
    "blocked-causal-blas-64", 64],
  ["blocked-128", "zero5_c32_lm_attention_b128",
    "blocked-causal-blas-128", 128],
];
if (!process.argv.includes("--skip-build")) {
  run("make", ["-B", ...variants.map(([, binary]) => binary)]);
}
for (const [, binary] of variants) {
  if (!fs.existsSync(binary)) fail(`trainer is missing: ${binary}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(),
  "zero-blocked-attention-"));
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
  "--require-math-backend", "gnu-libmvec-tanh-exp",
];
const measurements = Object.fromEntries(variants.map(([name]) => [name, []]));

try {
  for (let repetition = 0; repetition < repetitions; ++repetition) {
    const ordered = repetition % 2 === 0 ? variants : [...variants].reverse();
    for (const [name, binary, attentionBackend] of ordered) {
      const prefix = path.join(temporary, `${repetition}-${name}`);
      process.stdout.write(`Running ${name}, repetition ${repetition + 1}...\n`);
      const output = run(path.resolve(binary), [
        ...common, "--require-attention-backend", attentionBackend,
        "--best", `${prefix}-best.ckpt`,
        "--save", `${prefix}-active.ckpt`,
      ]);
      const report = parseReport(output);
      assert.equal(report.math_backend, "gnu-libmvec-tanh-exp");
      assert.equal(report.attention_backend, attentionBackend);
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
let allMetricsWithinTolerance = true;
for (const [name] of variants) {
  measurements[name].forEach((measurement, index) => {
    const baseline = measurements.dense[index];
    const values = [measurement.train_loss, measurement.validation_loss,
      measurement.gradient_norm];
    const reference = [baseline.train_loss, baseline.validation_loss,
      baseline.gradient_norm];
    if (!values.every((value, metric) =>
      Math.abs(value - reference[metric]) <= tolerance[metric])) {
      allMetricsWithinTolerance = false;
    }
    assert.equal(measurement.checkpoint_version, 6);
  });
  assert.equal(new Set(measurements[name]
    .map(measurement => measurement.checkpoint_sha256)).size, 1,
  `${name} is not deterministic across repetitions`);
}
if (!allMetricsWithinTolerance) fail("a blocked variant exceeded tolerance");

const baselineThroughput = mean(measurements.dense
  .map(measurement => measurement.tokens_per_second));
const summarized = Object.fromEntries(variants.map(
  ([name, , attentionBackend, block]) => {
    const runs = measurements[name];
    const throughput = mean(runs.map(run => run.tokens_per_second));
    return [name, {
      attention_backend: attentionBackend,
      query_block: block,
      attention_gemm_work_fraction:
        attentionWork(512, block) / attentionWork(512, null),
      runs,
      mean_tokens_per_second: throughput,
      throughput_change_from_dense: throughput / baselineThroughput - 1,
    }];
  }));
const selected = Object.entries(summarized).reduce((best, entry) =>
  entry[1].mean_tokens_per_second > best[1].mean_tokens_per_second
    ? entry : best);
const result = {
  schema: "zero.blocked_attention_benchmark.v1",
  recorded_at: new Date().toISOString(),
  status: "performance-only; blocked BLAS shapes may change float rounding",
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
  variants: summarized,
  selected: {
    variant: selected[0],
    mean_tokens_per_second: selected[1].mean_tokens_per_second,
    throughput_change_from_dense:
      selected[1].throughput_change_from_dense,
  },
  correctness: {
    all_metrics_within_tolerance: allMetricsWithinTolerance,
    deterministic_checkpoints_per_variant: true,
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

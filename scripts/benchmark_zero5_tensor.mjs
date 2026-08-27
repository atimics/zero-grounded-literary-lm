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

function run(program, args, environment = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...environment },
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
  const backend = output.match(/zero5_lm: backend=([^ ]+)/);
  if (reports.length === 0 || time === null || backend === null) {
    fail("trainer output has no final report or backend");
  }
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
    backend: backend[1],
  };
}

function close(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
}

if (process.argv.includes("--self-test")) {
  const report = parseReport(
    "zero5_lm: backend=OpenBLAS context=512\n" +
    "update 20 train 2.0549 val 1.8532 grad 1.512 lr 0.0002 " +
    "tok/s 11025 active/s 9739\ntraining time 3.72 seconds\n",
  );
  if (report.backend !== "OpenBLAS" || report.tokens_per_second !== 11025 ||
      report.elapsed_seconds !== 3.72) {
    fail("tensor benchmark parser self-test failed");
  }
  process.stdout.write("tensor benchmark parser self-test passed\n");
  process.exit(0);
}

if (os.platform() !== "linux") {
  fail("the tensor speed benchmark is Linux/OpenBLAS-only; do not use Apple Silicon results to choose the AWS path");
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) {
  fail("--asset-root must name a checkout containing the frozen C3.3 assets");
}
const assetRoot = path.resolve(assetRootValue);
const updates = Number(option("--updates", "50"));
const tensorThreads = Number(option("--blas-threads", "8"));
if (!Number.isInteger(updates) || updates < 1 || updates > 9442) {
  fail("--updates must be an integer from 1 through 9442");
}
if (!Number.isInteger(tensorThreads) || tensorThreads < 1 ||
    tensorThreads > 64) {
  fail("--blas-threads must be an integer from 1 through 64");
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
for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
}

if (!process.argv.includes("--skip-build")) {
  run("make", ["-B", "zero5_c32_lm_fast", "zero5_c32_lm_tensor",
    "zero5_c32_lm_tensor_qkv"], { LITERARY_BACKEND: "openblas" });
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-tensor-benchmark-"));
const common = [
  "--init", files.initial,
  "--tokenizer", files.tokenizer,
  "--packed-train", files.train,
  "--packed-validation", files.validation,
  "--run-contract-sha256",
  "f06365554a16ec0557503fe35ff6e074a0720312dd4295e3d54e1a7df6fa73d1",
  "--steps", "9442", "--max-run-steps", String(updates), "--batch", "4",
  "--lr", "0.0003", "--weight-decay", "0.01", "--clip", "1",
  "--warmup", "300", "--schedule-total", "9442", "--cosine",
  "--dropout", "0.1", "--report", String(updates), "--validation", "8",
  "--seed", "0", "--save-every", "0",
  "--claim-answer-weight", "3.009199423", "--cloze-answer-weight", "1",
  "--retrieval-answer-weight", "1.941452456", "--tokens", "0",
];

function benchmark(name, binary, mode, threads) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory);
  const output = run(path.resolve(binary), [
    ...common, ...mode,
    "--best", path.join(directory, "best.ckpt"),
    "--save", path.join(directory, "active.ckpt"),
  ], {
    OPENBLAS_NUM_THREADS: String(threads),
    OMP_NUM_THREADS: String(threads),
    OPENBLAS_DYNAMIC: "0",
    OMP_DYNAMIC: "FALSE",
  });
  const checkpoint = path.join(directory, "active.ckpt");
  const report = parseReport(output);
  if (report.backend !== "OpenBLAS") {
    fail(`${name} used ${report.backend}, not OpenBLAS`);
  }
  return { ...report, blas_threads: threads,
    checkpoint_sha256: sha256(checkpoint) };
}

const parallel = benchmark("parallel", "zero5_c32_lm_fast",
  ["--parallel-batch", "4"], 1);
const tensor = benchmark("tensor", "zero5_c32_lm_tensor",
  ["--tensor-batch", "4"], tensorThreads);
const tensorQkv = benchmark("tensor-qkv", "zero5_c32_lm_tensor_qkv",
  ["--tensor-batch", "4"], tensorThreads);
const sameReportedMetrics = [tensor, tensorQkv].every((candidate) =>
  close(parallel.train_loss, candidate.train_loss, 0.0001) &&
  close(parallel.validation_loss, candidate.validation_loss, 0.0001) &&
  close(parallel.gradient_norm, candidate.gradient_norm, 0.001));
if (!sameReportedMetrics) {
  fail("a tensor trainer drifted beyond the reporting tolerance");
}

const result = {
  schema: "zero.aws_tensor_batch_benchmark.v1",
  recorded_at: new Date().toISOString(),
  scientific_status: "performance-only; does not replace the frozen C3.3 run",
  platform: {
    os: os.platform(), architecture: os.arch(), release: os.release(),
    cpu: os.cpus()[0]?.model ?? "unknown",
  },
  workload: {
    source: "C3.3 frozen training packs", updates,
    sequences_per_update: 4, context_tokens: 512,
    tensor_blas_threads: tensorThreads,
  },
  parallel,
  tensor,
  tensor_qkv: tensorQkv,
  comparison: {
    same_reported_metrics: sameReportedMetrics,
    tensor_over_parallel_speedup:
      tensor.tokens_per_second / parallel.tokens_per_second,
    tensor_qkv_over_parallel_speedup:
      tensorQkv.tokens_per_second / parallel.tokens_per_second,
    tensor_qkv_over_tensor_speedup:
      tensorQkv.tokens_per_second / tensor.tokens_per_second,
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

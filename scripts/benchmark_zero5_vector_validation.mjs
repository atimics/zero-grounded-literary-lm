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

function parseRun(output) {
  const backend = output.match(/math-backend=([a-z0-9-]+)/);
  const reports = [...output.matchAll(
    /update\s+(\d+)\s+train\s+([0-9.]+)\s+val\s+([0-9.]+)\s+grad\s+([0-9.]+)\s+lr\s+([^ ]+)\s+tok\/s\s+(\d+)\s+active\/s\s+(\d+)/g,
  )].map(match => ({
    update: Number(match[1]),
    train_loss: Number(match[2]),
    validation_loss: Number(match[3]),
    gradient_norm: Number(match[4]),
    learning_rate: Number(match[5]),
    interval_tokens_per_second: Number(match[6]),
    interval_active_targets_per_second: Number(match[7]),
  }));
  const time = output.match(/training time\s+([0-9.]+)\s+seconds/);
  if (backend === null || reports.length === 0 || time === null) {
    fail("trainer output is missing its backend, trajectory, or elapsed time");
  }
  return {
    math_backend: backend[1],
    reports,
    elapsed_seconds: Number(time[1]),
  };
}

const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;

function compare(baseline, vector, workloadTokens) {
  assert.equal(baseline.reports.length, vector.reports.length);
  const points = baseline.reports.map((reference, index) => {
    const candidate = vector.reports[index];
    assert.equal(candidate.update, reference.update);
    return {
      update: reference.update,
      baseline_validation_loss: reference.validation_loss,
      vector_validation_loss: candidate.validation_loss,
      vector_minus_baseline: candidate.validation_loss -
        reference.validation_loss,
    };
  });
  const baselineValidation = baseline.reports.map(row => row.validation_loss);
  const vectorValidation = vector.reports.map(row => row.validation_loss);
  const baselineThroughput = workloadTokens / baseline.elapsed_seconds;
  const vectorThroughput = workloadTokens / vector.elapsed_seconds;
  const finalDelta = points.at(-1).vector_minus_baseline;
  const meanDelta = mean(vectorValidation) - mean(baselineValidation);
  const maximumDelta = Math.max(...points.map(point =>
    point.vector_minus_baseline));
  return {
    points,
    effective_tokens_per_second: {
      baseline: baselineThroughput,
      vector: vectorThroughput,
    },
    vector_throughput_gain_fraction:
      vectorThroughput / baselineThroughput - 1,
    fixed_work_time_reduction_fraction:
      1 - vector.elapsed_seconds / baseline.elapsed_seconds,
    final_validation_loss_delta: finalDelta,
    mean_validation_loss_delta: meanDelta,
    maximum_validation_loss_delta: maximumDelta,
  };
}

if (process.argv.includes("--self-test")) {
  const sample = backend => parseRun(
    `zero5_lm: backend=OpenBLAS math-backend=${backend} context=512\n` +
    "update 100 train 2.4 val 2.3 grad 1.1 lr 0.0001 tok/s 5000 active/s 4000\n" +
    "update 200 train 2.2 val 2.1 grad 1.0 lr 0.0001 tok/s 5100 active/s 4100\n" +
    "training time 80 seconds\n",
  );
  const baseline = sample("scalar-array");
  const vector = sample("gnu-libmvec-tanh-exp");
  vector.elapsed_seconds = 60;
  vector.reports[0].validation_loss = 2.301;
  vector.reports[1].validation_loss = 2.102;
  const comparison = compare(baseline, vector, 409600);
  assert.equal(comparison.points.length, 2);
  assert(comparison.vector_throughput_gain_fraction > 0.3);
  assert(Math.abs(comparison.final_validation_loss_delta - 0.002) < 1e-12);
  process.stdout.write("vector validation replay self-test passed\n");
  process.exit(0);
}

if (os.platform() !== "linux" || os.arch() !== "x64") {
  fail("the GNU libmvec validation replay requires Linux x86-64");
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) fail("--asset-root is required");
const assetRoot = path.resolve(assetRootValue);
const contractSha256 = option("--run-contract-sha256");
if (!/^[0-9a-f]{64}$/.test(contractSha256 ?? "")) {
  fail("--run-contract-sha256 must be 64 lowercase hexadecimal characters");
}
const updates = Number(option("--updates", "1000"));
const reportEvery = Number(option("--report-every", "100"));
if (!Number.isInteger(updates) || updates < 100 || updates > 2000) {
  fail("--updates must be an integer from 100 through 2000");
}
if (!Number.isInteger(reportEvery) || reportEvery < 10 ||
    updates % reportEvery !== 0) {
  fail("--report-every must be at least 10 and divide --updates exactly");
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

const arms = [
  ["baseline", "zero5_c32_lm_fast", "scalar-array"],
  ["vector", "zero5_c32_lm_vector_math", "gnu-libmvec-tanh-exp"],
];
if (!process.argv.includes("--skip-build")) {
  run("make", ["-B", ...arms.map(([, binary]) => binary)]);
}
for (const [, binary] of arms) {
  if (!fs.existsSync(binary)) fail(`trainer is missing: ${binary}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(),
  "zero-vector-validation-"));
const common = [
  "--init", assets.initial,
  "--tokenizer", assets.tokenizer,
  "--packed-train", assets.train,
  "--packed-validation", assets.validation,
  "--run-contract-sha256", contractSha256,
  "--steps", "9442", "--max-run-steps", String(updates),
  "--batch", "4", "--parallel-batch", "4",
  "--lr", "0.0003", "--weight-decay", "0.01", "--clip", "1",
  "--warmup", "300", "--schedule-total", "9442", "--cosine",
  "--dropout", "0.1", "--report", String(reportEvery),
  "--validation", "16", "--seed", "0", "--save-every", "0",
  "--claim-answer-weight", "3.009199423", "--cloze-answer-weight", "1",
  "--retrieval-answer-weight", "1.941452456", "--tokens", "0",
];
const measured = {};

try {
  for (const [name, binary, mathBackend] of arms) {
    const prefix = path.join(temporary, name);
    process.stdout.write(`Running ${name} for ${updates} updates...\n`);
    const output = run(path.resolve(binary), [
      ...common, "--require-math-backend", mathBackend,
      "--best", `${prefix}-best.ckpt`,
      "--save", `${prefix}-active.ckpt`,
    ]);
    measured[name] = {
      ...parseRun(output),
      checkpoint_version:
        fs.readFileSync(`${prefix}-active.ckpt`).readUInt32LE(8),
      checkpoint_sha256: sha256(`${prefix}-active.ckpt`),
      best_checkpoint_sha256: sha256(`${prefix}-best.ckpt`),
    };
    assert.equal(measured[name].math_backend, mathBackend);
    assert.equal(measured[name].checkpoint_version, 6);
    assert.equal(measured[name].reports.at(-1).update, updates);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const workloadTokens = updates * 4 * 512;
const comparison = compare(measured.baseline, measured.vector, workloadTokens);
const finite = Object.values(measured).every(arm =>
  Number.isFinite(arm.elapsed_seconds) && arm.elapsed_seconds > 0 &&
  arm.reports.every(row => Object.values(row).every(Number.isFinite)));
const gates = {
  math_backends_match_contract:
    measured.baseline.math_backend === "scalar-array" &&
    measured.vector.math_backend === "gnu-libmvec-tanh-exp",
  checkpoint_version_6: measured.baseline.checkpoint_version === 6 &&
    measured.vector.checkpoint_version === 6,
  all_metrics_finite: finite,
  vector_speed_gain_at_least_fifteen_percent:
    comparison.vector_throughput_gain_fraction >= 0.15,
  final_validation_not_worse_by_more_than_0_01:
    comparison.final_validation_loss_delta <= 0.01,
  mean_validation_not_worse_by_more_than_0_01:
    comparison.mean_validation_loss_delta <= 0.01,
  no_validation_point_worse_by_more_than_0_02:
    comparison.maximum_validation_loss_delta <= 0.02,
  sealed_test_stayed_closed: true,
};
const eligible = Object.values(gates).every(Boolean);
const result = {
  schema: "zero.vector_math_validation_replay.v1",
  recorded_at: new Date().toISOString(),
  status: "performance-validation-only",
  run_contract_sha256: contractSha256,
  claim_boundary: {
    scientific_replication: false,
    new_model_result: false,
    test_metrics_opened: false,
  },
  platform: {
    os: os.platform(), architecture: os.arch(), release: os.release(),
    cpu: os.cpus()[0]?.model ?? "unknown",
  },
  workload: {
    source: "C3.3 frozen training packs",
    updates_per_arm: updates,
    report_every_updates: reportEvery,
    validation_batches_per_report: 16,
    sequences_per_update: 4,
    context_tokens: 512,
    total_tokens_per_arm: workloadTokens,
    parallel_workers: 4,
    blas_threads_per_worker: 1,
    dynamic_threading: false,
  },
  arms: measured,
  comparison,
  gates,
  decision: {
    eligible_to_promote_vector_math_default: eligible,
    next_kernel_if_eligible: "blocked-causal-attention",
  },
};
const json = `${JSON.stringify(result, null, 2)}\n`;
const destination = option("--out");
if (destination !== null) fs.writeFileSync(path.resolve(destination), json);
process.stdout.write(json);

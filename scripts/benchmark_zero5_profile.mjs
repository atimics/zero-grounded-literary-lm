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

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseTraining(output) {
  const reports = [...output.matchAll(
    /update\s+(\d+)\s+train\s+([0-9.]+)\s+val\s+([0-9.]+)\s+grad\s+([0-9.]+)\s+lr\s+([^ ]+)\s+tok\/s\s+(\d+)\s+active\/s\s+(\d+)/g,
  )];
  const time = output.match(/training time\s+([0-9.]+)\s+seconds/);
  if (reports.length === 0 || time === null) {
    fail("trainer output has no final report");
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
  };
}

function parsePhaseProfile(output) {
  const match = output.match(/^phase-profile (\{.*\})$/m);
  if (match === null) fail("profile trainer output has no phase report");
  const profile = JSON.parse(match[1]);
  if (profile.schema !== "zero.cpu_phase_profile.v1") {
    fail(`unexpected phase profile schema: ${profile.schema}`);
  }
  return profile;
}

function close(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
}

if (process.argv.includes("--self-test")) {
  const sample =
    "update 10 train 2.7735 val 2.6366 grad 2.295 lr 1e-05 " +
    "tok/s 5135 active/s 4657\ntraining time 5.50 seconds\n" +
    "phase-profile {\"schema\":\"zero.cpu_phase_profile.v1\"," +
    "\"updates\":10,\"workers\":4,\"wall_seconds\":{" +
    "\"input_setup\":0.1,\"train_wave\":4," +
    "\"gradient_merge\":0.4,\"optimizer\":0.5}," +
    "\"worker_cpu_seconds\":{\"forward\":8,\"backward\":8," +
    "\"linear_forward\":4,\"linear_backward\":4," +
    "\"attention_forward\":2,\"attention_backward\":2," +
    "\"norm_forward\":0.5,\"norm_backward\":0.5," +
    "\"gelu_forward\":0.2,\"gelu_backward\":0.2," +
    "\"rope\":0.1,\"output_softmax_loss\":0.1," +
    "\"unattributed\":2.4}}\n";
  const training = parseTraining(sample);
  const profile = parsePhaseProfile(sample);
  if (training.tokens_per_second !== 5135 || profile.updates !== 10 ||
      profile.worker_cpu_seconds.attention_backward !== 2) {
    fail("phase profile parser self-test failed");
  }
  process.stdout.write("phase profile parser self-test passed\n");
  process.exit(0);
}

if (os.platform() !== "linux") {
  fail("the phase speed benchmark is Linux-only; use other systems for mechanics checks");
}

const assetRootValue = option("--asset-root");
if (assetRootValue === null) {
  fail("--asset-root must name a checkout containing the frozen C3.3 assets");
}
const assetRoot = path.resolve(assetRootValue);
const updates = Number(option("--updates", "100"));
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
for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
}

if (!process.argv.includes("--skip-build")) {
  run("make", ["-B", "zero5_c32_lm_fast", "zero5_c32_lm_profile"]);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-profile-"));
const common = [
  "--init", files.initial,
  "--tokenizer", files.tokenizer,
  "--packed-train", files.train,
  "--packed-validation", files.validation,
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
];

function benchmark(name, binary, withProfile) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory);
  const output = run(path.resolve(binary), [
    ...common,
    "--best", path.join(directory, "best.ckpt"),
    "--save", path.join(directory, "active.ckpt"),
  ]);
  return {
    ...parseTraining(output),
    checkpoint_sha256: sha256(path.join(directory, "active.ckpt")),
    ...(withProfile ? { phase_profile: parsePhaseProfile(output) } : {}),
  };
}

try {
  const baseline = benchmark("baseline", "zero5_c32_lm_fast", false);
  const profiled = benchmark("profiled", "zero5_c32_lm_profile", true);
  const sameReportedMetrics =
    close(baseline.train_loss, profiled.train_loss, 0.0001) &&
    close(baseline.validation_loss, profiled.validation_loss, 0.0001) &&
    close(baseline.gradient_norm, profiled.gradient_norm, 0.001);
  const checkpointBitIdentical =
    baseline.checkpoint_sha256 === profiled.checkpoint_sha256;
  if (!sameReportedMetrics || !checkpointBitIdentical) {
    fail("profiling changed the frozen trainer result");
  }
  if (profiled.phase_profile.updates !== updates ||
      profiled.phase_profile.workers !== 4) {
    fail("phase report does not match the workload");
  }
  const result = {
    schema: "zero.cpu_phase_profile_benchmark.v1",
    recorded_at: new Date().toISOString(),
    scientific_status: "performance-only; does not replace the frozen C3.3 run",
    platform: {
      os: os.platform(), architecture: os.arch(), release: os.release(),
      cpu: os.cpus()[0]?.model ?? "unknown",
    },
    workload: {
      source: "C3.3 frozen training packs", updates,
      sequences_per_update: 4, context_tokens: 512, parallel_workers: 4,
      blas_threads_per_worker: 1, dynamic_threading: false,
    },
    baseline,
    profiled,
    comparison: {
      same_reported_metrics: sameReportedMetrics,
      checkpoint_bit_identical: checkpointBitIdentical,
      profiler_elapsed_overhead_fraction:
        profiled.elapsed_seconds / baseline.elapsed_seconds - 1,
      profiler_throughput_overhead_fraction:
        1 - profiled.tokens_per_second / baseline.tokens_per_second,
    },
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const destination = option("--out");
  if (destination !== null) fs.writeFileSync(path.resolve(destination), json);
  process.stdout.write(json);
} finally {
  if (!process.argv.includes("--keep")) {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

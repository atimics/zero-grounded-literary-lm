#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write("error: " + message + "\n");
  process.exit(1);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail("missing value for " + name);
  return process.argv[index + 1];
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(label + " is missing: " + file);
  const observed = artifact(file);
  if (observed.sha256 !== expected)
    fail(label + " hash does not match the frozen C0 result");
  return observed;
}

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    fail(program + " failed: " + (result.stderr || result.stdout).trim());
  return result.stdout;
}

const contractPath = "benchmarks/zero5-c1-v1/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
if (contract.status !== "preregistered-unrun" || !contract.authorized)
  fail("C1 contract is not preregistered and authorized");
if (sha256(fs.readFileSync("zero5_lm.c")) !==
    contract.implementation.trainer_sha256)
  fail("zero5_lm.c drifted from the C1 contract");

const c0Dir = path.resolve(option("--c0-dir", "build/zero5-c0-v1/corpus-one"));
const out = path.resolve(option("--out", "build/zero5-c1-v1"));
if (fs.existsSync(out)) fail("output directory already exists: " + out);
fs.mkdirSync(out, { recursive: true });

const c0Bytes = fs.readFileSync(contract.input.c0_result);
if (sha256(c0Bytes) !== contract.input.c0_result_sha256)
  fail("frozen C0 result drifted");
const c0 = JSON.parse(c0Bytes);
if (c0.braid.collection_id !== contract.input.collection_id ||
    c0.braid.source_commit !== contract.input.braid_commit)
  fail("C0 Braid lineage does not match C1");
if (c0.braid.test.tokenizer_metrics_opened !== false)
  fail("C0 did not preserve the sealed test boundary");

const tokenizer = path.join(c0Dir, "byte-bpe512.sero");
const trainTokens = path.join(c0Dir, "train.byte-bpe512.tok");
const validationTokens = path.join(c0Dir, "validation.byte-bpe512.tok");
const inputArtifacts = {
  tokenizer: requireArtifact(tokenizer, contract.input.tokenizer_sha256,
    "tokenizer"),
  train_tokens: requireArtifact(trainTokens,
    contract.input.train_tokens_sha256, "training token stream"),
  validation_tokens: requireArtifact(validationTokens,
    contract.input.validation_tokens_sha256, "validation token stream"),
};

function trainingArgs(seed, checkpoint) {
  const model = contract.model;
  const training = contract.training;
  return [
    "--preset", "literary",
    "--context", String(model.context),
    "--dim", String(model.dimension),
    "--heads", String(model.heads),
    "--layers", String(model.layers),
    "--ff", String(model.feed_forward),
    "--vocab", String(model.vocabulary),
    "--tokenizer", tokenizer,
    "--text", trainTokens,
    "--validation-text", validationTokens,
    "--steps", String(training.updates),
    "--batch", String(training.batch_sequences),
    "--lr", String(training.peak_learning_rate),
    "--weight-decay", String(training.weight_decay),
    "--clip", String(training.gradient_clip),
    "--warmup", String(training.warmup_updates),
    "--schedule-total", String(training.updates),
    "--cosine",
    "--dropout", String(training.residual_dropout),
    "--report", String(training.report_every_updates),
    "--validation", String(training.validation_windows),
    "--best", checkpoint,
    "--seed", String(seed),
    "--tokens", "0",
  ];
}

function parseTraining(log, seed) {
  const modelMatch = log.match(
    /zero5_lm: backend=([^ ]+).*positions=([^ ]+) parameters=(\d+) trainable-scope=all/,
  );
  if (!modelMatch) fail("could not parse model identity for seed " + seed);
  const reports = [];
  for (const line of log.split("\n")) {
    const match = line.match(
      /^update\s+(\d+) train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+)/,
    );
    if (match) reports.push({
      update: Number(match[1]),
      train_nats_per_token: Number(match[2]),
      validation_nats_per_token: Number(match[3]),
      gradient_norm: Number(match[4]),
      learning_rate: Number(match[5]),
    });
  }
  const expectedReports = contract.training.updates /
    contract.training.report_every_updates;
  if (reports.length !== expectedReports)
    fail("seed " + seed + " did not produce every frozen report");
  if (reports.at(-1).update !== contract.training.updates)
    fail("seed " + seed + " did not complete the frozen schedule");
  return {
    backend: modelMatch[1],
    positions: modelMatch[2],
    model_parameters: Number(modelMatch[3]),
    reports,
  };
}

function evaluateCheckpoint(checkpoint) {
  const output = run("./zero5_lm", [
    "--resume", checkpoint,
    "--tokenizer", tokenizer,
    "--text", trainTokens,
    "--validation-text", validationTokens,
    "--eval-only",
    "--validation", String(contract.training.validation_windows),
  ]);
  const match = output.match(/evaluation-only val ([0-9.]+) batches=(\d+)/);
  if (!match) fail("could not parse checkpoint validation");
  if (Number(match[2]) !== contract.training.validation_windows)
    fail("checkpoint validation window count drifted");
  return Number(match[1]);
}

function trainSeed(seed, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const checkpoint = path.join(directory, "best.ckpt");
  const log = run("./zero5_lm", trainingArgs(seed, checkpoint));
  fs.writeFileSync(path.join(directory, "training.log"), log);
  if (!fs.existsSync(checkpoint))
    fail("seed " + seed + " did not produce a best checkpoint");
  const parsed = parseTraining(log, seed);
  if (parsed.model_parameters !== contract.model.parameters)
    fail("seed " + seed + " model parameter count drifted");
  if (parsed.positions !== contract.model.positions)
    fail("seed " + seed + " position encoding drifted");
  const validation = evaluateCheckpoint(checkpoint);
  const bestReport = parsed.reports.reduce((best, row) =>
    row.validation_nats_per_token < best.validation_nats_per_token
      ? row
      : best,
  );
  if (Math.abs(validation - bestReport.validation_nats_per_token) > 0.0001)
    fail("seed " + seed + " best checkpoint did not reproduce validation");
  const multiplier = contract.input.validation_tokens /
    contract.input.validation_raw_bytes;
  return {
    seed,
    backend: parsed.backend,
    positions: parsed.positions,
    completed_updates: contract.training.updates,
    token_exposures: contract.training.token_exposures_per_seed,
    model_parameters: parsed.model_parameters,
    validation_windows: contract.training.validation_windows,
    best_update: bestReport.update,
    best_validation_nats_per_token: validation,
    best_validation_bits_per_raw_byte:
      validation * multiplier / Math.LN2,
    relative_validation_reduction_from_uniform:
      1 - validation / contract.baselines.uniform_validation_nats_per_token,
    checkpoint: artifact(checkpoint),
    reports: parsed.reports,
  };
}

const seeds = contract.training.seeds.map(seed => {
  process.stdout.write("training ZERO.5-C1 seed " + seed + "\n");
  return trainSeed(seed, path.join(out, "seed" + seed));
});
const repeatSeed = contract.training.repeat_seed_for_determinism;
process.stdout.write("repeating ZERO.5-C1 seed " + repeatSeed + "\n");
const repeated = trainSeed(repeatSeed, path.join(out, "seed0-repeat"));
const original = seeds.find(row => row.seed === repeatSeed);
const byteIdentical = original.checkpoint.sha256 === repeated.checkpoint.sha256;

const validationValues = seeds.map(row => row.best_validation_nats_per_token);
const meanValidation = validationValues.reduce((a, b) => a + b, 0) /
  validationValues.length;
const spread = Math.max(...validationValues) - Math.min(...validationValues);
const gates = {
  all_three_seeds_complete: seeds.length === 3 &&
    seeds.every(row => row.completed_updates === contract.training.updates),
  every_seed_validation_nats_per_token: seeds.every(row =>
    row.best_validation_nats_per_token <=
      contract.gates.every_seed_validation_nats_per_token_maximum),
  mean_validation_nats_per_token: meanValidation <=
    contract.gates.mean_validation_nats_per_token_maximum,
  maximum_seed_spread_nats_per_token: spread <=
    contract.gates.maximum_seed_spread_nats_per_token,
  seed_zero_repeat_checkpoint_byte_identical: byteIdentical,
  test_metrics_opened: false,
};
const allGatesPass = Object.entries(gates).every(([name, value]) =>
  name === "test_metrics_opened" ? value === false : value === true,
);

const result = {
  schema: "zero.c_training_result.v1",
  experiment: contract.experiment,
  status: "complete",
  contract_sha256: sha256(contractBytes),
  implementation: {
    trainer_sha256: contract.implementation.trainer_sha256,
    runner_sha256: sha256(fs.readFileSync(contract.implementation.orchestration)),
  },
  input: {
    c0_result_sha256: contract.input.c0_result_sha256,
    collection_id: contract.input.collection_id,
    braid_commit: contract.input.braid_commit,
    artifacts: inputArtifacts,
  },
  seeds,
  aggregate: {
    mean_best_validation_nats_per_token: meanValidation,
    mean_best_validation_bits_per_raw_byte:
      meanValidation * contract.input.validation_tokens /
      contract.input.validation_raw_bytes / Math.LN2,
    seed_spread_nats_per_token: spread,
  },
  determinism: {
    seed: repeatSeed,
    original_checkpoint_sha256: original.checkpoint.sha256,
    repeat_checkpoint_sha256: repeated.checkpoint.sha256,
    byte_identical_checkpoint: byteIdentical,
  },
  test: {
    records: c0.braid.test.documents,
    metrics_opened: false,
  },
  gates,
  decision: {
    all_gates_pass: allGatesPass,
    outcome: allGatesPass ? "pass-c-training-signal" : "no-go",
    broad_pretraining_authorized: false,
    test_evaluation_authorized: false,
  },
};
fs.writeFileSync(path.join(out, "result.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

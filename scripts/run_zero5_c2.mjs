#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
    fail(label + " hash does not match the frozen contract");
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

function runStreaming(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(program + " failed: " + (stderr || stdout).trim()));
    });
  });
}

const contractPath = "benchmarks/zero5-c2-v1/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
if (contract.status !== "preregistered-unrun" || !contract.authorized)
  fail("C2 contract is not preregistered and authorized");
if (sha256(fs.readFileSync(contract.implementation.trainer)) !==
    contract.implementation.trainer_sha256)
  fail("C2 trainer drifted from the contract");

const importDirectory = path.resolve(
  option("--import-dir", "build/zero5-c2-v1/import-final"),
);
const c0Directory = path.resolve(
  option("--c0-dir", "build/zero5-c0-v1/corpus-one"),
);
const c1Directory = path.resolve(
  option("--c1-dir", "build/zero5-c1-v1"),
);
const out = path.resolve(option("--out", "build/zero5-c2-v1/run"));
if (fs.existsSync(out)) fail("output directory already exists: " + out);
fs.mkdirSync(out, { recursive: true });

const importBytes = fs.readFileSync(contract.input.import_manifest);
if (sha256(importBytes) !== contract.input.import_manifest_sha256)
  fail("frozen C2 import manifest drifted");
const imported = JSON.parse(importBytes);
const c1Bytes = fs.readFileSync(contract.initialization.c1_result);
if (sha256(c1Bytes) !== contract.initialization.c1_result_sha256)
  fail("frozen C1 result drifted");

const tokenizer = path.join(c0Directory, "byte-bpe512.sero");
const atlasTrain = path.join(importDirectory,
  "atlas.train.byte-bpe512.tok");
const atlasValidation = path.join(importDirectory,
  "atlas.validation.byte-bpe512.tok");
const anchorTrain = path.join(c0Directory, "train.byte-bpe512.tok");
const anchorValidation = path.join(c0Directory,
  "validation.byte-bpe512.tok");
const initialCheckpoint = path.join(c1Directory, "seed0", "best.ckpt");
requireArtifact(tokenizer, contract.input.tokenizer.sha256, "tokenizer");
requireArtifact(atlasTrain, contract.input.atlas_train.tokens_sha256,
  "Atlas training tokens");
requireArtifact(atlasValidation,
  contract.input.atlas_validation.tokens_sha256,
  "Atlas validation tokens");
requireArtifact(initialCheckpoint,
  contract.initialization.checkpoint_sha256,
  "C1 seed-0 checkpoint");

function evaluate(checkpoint, train, validation, windows) {
  const output = run("./zero5_c2_lm", [
    "--init", checkpoint, "--tokenizer", tokenizer,
    "--text", train, "--validation-text", validation,
    "--eval-only", "--validation", String(windows),
  ]);
  const match = output.match(/evaluation-only val ([0-9.]+) batches=(\d+)/);
  if (!match || Number(match[2]) !== windows)
    fail("could not reproduce a frozen validation measurement");
  return Number(match[1]);
}

const initialAtlasSelection = evaluate(initialCheckpoint, atlasTrain,
  atlasValidation, contract.baselines.atlas_validation_selection_windows);
const initialAtlasFinal = evaluate(initialCheckpoint, atlasTrain,
  atlasValidation, contract.baselines.atlas_validation_final_windows);
const initialAnchor = evaluate(initialCheckpoint, anchorTrain,
  anchorValidation, contract.baselines.anchor_validation_windows);
if (Math.abs(initialAtlasSelection -
      contract.baselines.atlas_validation_selection_nats_per_token) > 0.0001 ||
    Math.abs(initialAtlasFinal -
      contract.baselines.atlas_validation_final_nats_per_token) > 0.0001 ||
    Math.abs(initialAnchor -
      contract.baselines.anchor_validation_nats_per_token) > 0.0001)
  fail("C2 initialization baselines did not reproduce");

const bestCheckpoint = path.join(out, "best.ckpt");
const training = contract.training;
const log = await runStreaming("./zero5_c2_lm", [
  "--init", initialCheckpoint,
  "--tokenizer", tokenizer,
  "--text", atlasTrain,
  "--validation-text", atlasValidation,
  "--sequential",
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
  "--validation", String(training.selection_validation_windows),
  "--best", bestCheckpoint,
  "--seed", String(training.seed),
  "--tokens", "0",
]);
fs.writeFileSync(path.join(out, "training.log"), log);
if (!fs.existsSync(bestCheckpoint)) fail("C2 did not save a best checkpoint");

const modelMatch = log.match(
  /zero5_lm: backend=([^ ]+).*positions=([^ ]+) parameters=(\d+) trainable-scope=all/,
);
if (!modelMatch) fail("could not parse C2 model identity");
const reports = [];
for (const line of log.split("\n")) {
  const match = line.match(
    /^update\s+(\d+) train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+)/,
  );
  if (match) reports.push({
    update: Number(match[1]),
    train_nats_per_token: Number(match[2]),
    atlas_validation_nats_per_token: Number(match[3]),
    gradient_norm: Number(match[4]),
    learning_rate: Number(match[5]),
  });
}
const expectedReports = Math.floor(training.updates /
  training.report_every_updates) + 1;
if (reports.length !== expectedReports ||
    reports.at(-1).update !== training.updates)
  fail("C2 did not complete every frozen report");
const sequential = log.match(
  /sequential sampling windows=(\d+) token-exposures=(\d+) wraps=(\d+)/,
);
if (!sequential) fail("C2 did not report ordered-stream accounting");

const selectedAtlas = evaluate(bestCheckpoint, atlasTrain, atlasValidation,
  training.selection_validation_windows);
const bestReport = reports.reduce((best, row) =>
  row.atlas_validation_nats_per_token <
      best.atlas_validation_nats_per_token ? row : best,
);
if (Math.abs(selectedAtlas - bestReport.atlas_validation_nats_per_token) >
    0.0001)
  fail("C2 selected checkpoint did not reproduce selection validation");
const finalAtlas = evaluate(bestCheckpoint, atlasTrain, atlasValidation,
  training.final_atlas_validation_windows);
const finalAnchor = evaluate(bestCheckpoint, anchorTrain, anchorValidation,
  training.final_anchor_validation_windows);
const atlasRelativeImprovement = 1 - finalAtlas / initialAtlasFinal;
const anchorRelativeRegression = finalAnchor / initialAnchor - 1;
const atlasBitsPerRawByte = finalAtlas *
  contract.input.atlas_validation.tokens /
  contract.input.atlas_validation.raw_bytes / Math.LN2;

const gates = {
  full_ordered_atlas_pass:
    Number(sequential[1]) === training.updates * training.batch_sequences &&
    Number(sequential[2]) === training.token_exposures &&
    Number(sequential[3]) === training.expected_stream_wraps,
  atlas_validation_final_nats_per_token:
    finalAtlas <= contract.gates.atlas_validation_final_nats_per_token_maximum,
  atlas_relative_improvement:
    atlasRelativeImprovement >=
      contract.gates.atlas_relative_improvement_minimum,
  anchor_validation_nats_per_token:
    finalAnchor <= contract.gates.anchor_validation_nats_per_token_maximum,
  anchor_relative_regression:
    anchorRelativeRegression <=
      contract.gates.anchor_relative_regression_maximum,
  finite_metrics: [selectedAtlas, finalAtlas, finalAnchor,
    atlasBitsPerRawByte].every(Number.isFinite),
  test_metrics_opened: false,
};
const allGatesPass = Object.entries(gates).every(([name, value]) =>
  name === "test_metrics_opened" ? value === false : value === true,
);
const result = {
  schema: "zero.c_continued_training_result.v1",
  experiment: contract.experiment,
  status: "complete",
  contract_sha256: sha256(contractBytes),
  implementation: {
    trainer_sha256: contract.implementation.trainer_sha256,
    runner_sha256: sha256(fs.readFileSync(contract.implementation.runner)),
  },
  input: {
    import_manifest_sha256: contract.input.import_manifest_sha256,
    initial_checkpoint_sha256: contract.initialization.checkpoint_sha256,
  },
  model: {
    backend: modelMatch[1],
    positions: modelMatch[2],
    parameters: Number(modelMatch[3]),
  },
  baselines: {
    atlas_selection_nats_per_token: initialAtlasSelection,
    atlas_final_nats_per_token: initialAtlasFinal,
    anchor_nats_per_token: initialAnchor,
  },
  training: {
    seed: training.seed,
    completed_updates: training.updates,
    ordered_windows: Number(sequential[1]),
    token_exposures: Number(sequential[2]),
    ordered_stream_wraps: Number(sequential[3]),
    best_report_update: bestReport.update,
    reports,
  },
  validation: {
    atlas_selection_nats_per_token: selectedAtlas,
    atlas_final_nats_per_token: finalAtlas,
    atlas_bits_per_raw_byte: atlasBitsPerRawByte,
    atlas_relative_improvement: atlasRelativeImprovement,
    anchor_nats_per_token: finalAnchor,
    anchor_relative_regression: anchorRelativeRegression,
  },
  checkpoint: artifact(bestCheckpoint),
  test: {
    anchor_records: imported.test.anchors_records,
    atlas_records: imported.test.atlas_records,
    metrics_opened: false,
  },
  rights: {
    atlas_license: contract.input.rights.atlas,
    dataset_published: false,
    checkpoint_published: false,
    publication_review_required: true,
  },
  gates,
  decision: {
    all_gates_pass: allGatesPass,
    outcome: allGatesPass ? "pass-c2-pilot" : "no-go",
    replication_seeds_authorized: false,
    broad_model_promotion_authorized: false,
    checkpoint_publication_authorized: false,
  },
};
fs.writeFileSync(path.join(out, "result.json"),
  JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

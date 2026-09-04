#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const defaultContract = "benchmarks/zero5-ht1-mergetree-v1/contract.json";
const defaultImplementation = "benchmarks/zero5-ht1-mergetree-v1/implementation.json";
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = file => {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
};
const option = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(index + 1 < process.argv.length, `${name} requires a value`);
  return process.argv[index + 1];
};
const integerOption = (name, fallback, minimum, maximum) => {
  const value = Number(option(name, String(fallback)));
  assert(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${name} must be an integer from ${minimum} through ${maximum}`);
  return value;
};
const median = values => {
  assert(values.length > 0 && values.every(Number.isFinite));
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const environment = threads => ({ ...process.env,
  OPENBLAS_NUM_THREADS: String(threads), OMP_NUM_THREADS: String(threads),
  VECLIB_MAXIMUM_THREADS: String(threads), OPENBLAS_DYNAMIC: "0" });

function run(program, args, env, label) {
  const started = process.hrtime.bigint();
  const result = spawnSync(program, args, { encoding: "utf8", env,
    maxBuffer: 32 * 1024 * 1024 });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  assert.equal(result.status, 0,
    `${label} failed\n${result.stderr}\n${result.stdout}`);
  return { seconds, stdout: result.stdout, stderr: result.stderr };
}

function checkpoint(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString(), "ZEROLM2\0", `${file}: checkpoint magic`);
  assert.equal(bytes.readUInt32LE(8), 6, `${file}: checkpoint version`);
  const parameterCount = bytes.readUInt32LE(36);
  const parameters = [];
  let offset = 64 + 128;
  for (let index = 0; index < parameterCount; index++) {
    assert(offset + 8 <= bytes.length, `${file}: parameter header`);
    const cells = Number(bytes.readBigUInt64LE(offset));
    assert(Number.isSafeInteger(cells) && cells > 0, `${file}: parameter size`);
    const length = 8 + cells * 12;
    assert(offset + length <= bytes.length, `${file}: parameter data`);
    parameters.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  assert.equal(offset, bytes.length, `${file}: complete checkpoint parse`);
  return { bytes, parameters, step: bytes.readBigUInt64LE(48),
    rng: bytes.readBigUInt64LE(56), orchestration: bytes.subarray(64, 192) };
}

function compareGateOff(controlPath, treatmentPath) {
  const control = checkpoint(controlPath), treatment = checkpoint(treatmentPath);
  assert.equal(treatment.parameters.length, control.parameters.length + 1,
    "HT1 checkpoint must append one gate parameter");
  assert.equal(control.step, 10n, "control checkpoint must contain ten updates");
  assert.equal(treatment.step, control.step, "update cursor identity");
  assert.equal(treatment.rng, control.rng, "random state identity");
  assert.deepEqual(treatment.orchestration, control.orchestration,
    "schedule and selection state identity");
  for (let index = 0; index < control.parameters.length; index++) {
    assert.deepEqual(treatment.parameters[index], control.parameters[index],
      `shared parameter ${index} and AdamW state identity`);
  }
  const gates = treatment.parameters.at(-1);
  assert.equal(gates.readBigUInt64LE(0), 249n, "gate count");
  assert(gates.subarray(8).every(value => value === 0), "gate weights and state stay zero");
  return { shared_parameters: control.parameters.length,
    shared_state_sha256: sha256(Buffer.concat(control.parameters)),
    orchestration_sha256: sha256(control.orchestration) };
}

function firstUpdateShape(file, updates) {
  const descriptor = fs.openSync(file, "r");
  try {
    const prefix = Buffer.alloc(76 + (updates + 1) * 4);
    assert.equal(fs.readSync(descriptor, prefix, 0, prefix.length, 0), prefix.length,
      "training packs contain the required update offsets");
    assert.equal(prefix.subarray(0, 8).toString(), "Z5PKV3\0\0");
    assert(prefix.readUInt32LE(72) >= updates, "training packs contain ten update groups");
    const first = prefix.readUInt32LE(76);
    const last = prefix.readUInt32LE(76 + updates * 4);
    assert.equal(first, 0, "training schedule starts at pack zero");
    assert(last >= updates && last <= updates * 2, "training groups contain one or two packs");
    return { updates, sequences: last };
  } finally {
    fs.closeSync(descriptor);
  }
}

/* This count uses every executed dense matrix shape as the base denominator.
   It counts the complete MergeTree refresh, backward pass, and gate update as
   added scalar operations. Omitting other base work makes the ratio conservative. */
function operationCount(model, shape) {
  const { context: t, dimension: d, layers: l, feed_forward: f,
    language_vocabulary: v } = model;
  const densePerSequence = 6 * t * (l * (4 * d * d + 2 * d * f) + d * v);
  const merges = v - 264, gates = merges + 1;
  const treePerUpdate = d * (5 * merges + 5 * v + 264) + 20 * gates;
  const control = densePerSequence * shape.sequences;
  const treatment = control + treePerUpdate * shape.updates;
  assert(Number.isSafeInteger(control) && Number.isSafeInteger(treatment));
  return { schema: "zero.ht1_scalar_operation_count.v1",
    method: "executed-shape-conservative-dense-denominator",
    updates: shape.updates, sequences: shape.sequences,
    control_operations: control, added_mergetree_operations: treatment - control,
    treatment_operations: treatment, compute_ratio: treatment / control };
}

function selfTest() {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 2]), 3);
  const count = operationCount({ context: 512, dimension: 256, layers: 6,
    feed_forward: 1024, language_vocabulary: 512 }, { updates: 10, sequences: 13 });
  assert(count.compute_ratio > 1 && count.compute_ratio < 1.03);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-ht1-preflight-test-"));
  try {
    const makeCheckpoint = (file, extra) => {
      const header = Buffer.alloc(192);
      header.write("ZEROLM2\0"); header.writeUInt32LE(6, 8);
      header.writeUInt32LE(1 + extra, 36); header.writeBigUInt64LE(10n, 48);
      header.writeBigUInt64LE(42n, 56); header.fill(7, 64, 192);
      const shared = Buffer.alloc(8 + 3 * 4); shared.writeBigUInt64LE(1n); shared.fill(9, 8);
      const gate = Buffer.alloc(8 + 249 * 12); gate.writeBigUInt64LE(249n);
      fs.writeFileSync(file, Buffer.concat(extra ? [header, shared, gate] : [header, shared]));
    };
    makeCheckpoint(path.join(directory, "control.ckpt"), 0);
    makeCheckpoint(path.join(directory, "treatment.ckpt"), 1);
    assert.equal(compareGateOff(path.join(directory, "control.ckpt"),
      path.join(directory, "treatment.ckpt")).shared_parameters, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  process.stdout.write("HT1 artifact preflight self-test passed\n");
}

function main() {
  if (process.argv.includes("--self-test")) { selfTest(); return; }
  const contractPath = path.resolve(option("--contract", defaultContract));
  const implementationPath = path.resolve(option("--implementation", defaultImplementation));
  const paths = Object.fromEntries([
    ["initial", option("--initial-checkpoint")], ["tokenizer", option("--tokenizer")],
    ["training", option("--training-packs")], ["validation", option("--validation-packs")],
    ["out", option("--out-dir")],
  ].map(([name, value]) => {
    assert(value, `--${name.replaceAll("_", "-")} is required`);
    return [name, path.resolve(value)];
  }));
  const trainer = path.resolve(option("--trainer", "./zero5_ht1_mergetree_lm"));
  const controlTrainer = path.resolve(option("--control-trainer", "./zero5_c32_lm_vector_math"));
  const tokenizerBinary = path.resolve(option("--tokenizer-binary", "./sero_tokenizer"));
  const trials = integerOption("--trials", 3, 3, 9);
  const warmups = integerOption("--warmups", 1, 0, 2);
  const contract = JSON.parse(fs.readFileSync(contractPath));
  const implementation = JSON.parse(fs.readFileSync(implementationPath));
  const seriesPath = path.resolve(contract.series.path);
  const series = JSON.parse(fs.readFileSync(seriesPath));
  const controlContractPath = path.resolve(contract.control.contract);
  const controlContract = JSON.parse(fs.readFileSync(controlContractPath));
  assert.equal(contract.schema, "zero.ht1_mergetree_contract.v1");
  assert.equal(implementation.schema, "zero.ht1_mergetree_implementation.v1");
  assert.equal(implementation.preregistration.contract_sha256, artifact(contractPath).sha256);
  assert.equal(contract.series.sha256, artifact(seriesPath).sha256);
  assert.equal(contract.control.contract_sha256, artifact(controlContractPath).sha256);
  for (const [name, file] of Object.entries(implementation.implementation)) {
    if (name.endsWith("_sha256")) continue;
    const expected = implementation.implementation[`${name}_sha256`];
    if (expected) assert.equal(artifact(path.resolve(file)).sha256, expected, `${name} source hash`);
  }
  assert.equal(artifact(paths.initial).sha256, series.shared_inputs.initial_checkpoint_sha256);
  assert.equal(artifact(paths.tokenizer).sha256, series.shared_inputs.tokenizer_sha256);
  assert.equal(artifact(paths.training).sha256, series.shared_inputs.training_packs_sha256);
  assert.equal(artifact(paths.validation).sha256, series.shared_inputs.combined_validation_sha256);
  for (const file of [trainer, controlTrainer, tokenizerBinary])
    assert(fs.statSync(file).isFile(), `binary is missing: ${path.basename(file)}`);
  fs.mkdirSync(paths.out);
  const executionPath = path.join(paths.out, "execution.json");
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.ht1_preflight_execution.v1", experiment: contract.experiment,
    contract_sha256: artifact(contractPath).sha256, status: "running",
  }, null, 2) + "\n", { flag: "wx" });

  const env = environment(controlContract.execution.blas_threads);
  const checker = run("node", [implementation.implementation.checker], env,
    "synthetic mechanics checker");
  const roundTripInput = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    Buffer.from("hierarchical tokenization café 🧪\n")]);
  const rawPath = path.join(paths.out, "roundtrip.raw");
  const tokenPath = path.join(paths.out, "roundtrip.tokens");
  const decodedPath = path.join(paths.out, "roundtrip.decoded");
  fs.writeFileSync(rawPath, roundTripInput, { flag: "wx" });
  run(tokenizerBinary, ["encode", "--vocab", paths.tokenizer, "--text", rawPath,
    "--out", tokenPath], env, "actual tokenizer encode");
  run(tokenizerBinary, ["decode", "--vocab", paths.tokenizer, "--tokens", tokenPath,
    "--out", decodedPath], env, "actual tokenizer decode");
  assert.deepEqual(fs.readFileSync(decodedPath), roundTripInput, "actual tokenizer round trip");

  const updates = contract.control.gate_off_equivalence_updates;
  assert.equal(updates, 10);
  const runHash = artifact(contractPath).sha256;
  const common = ["--init", paths.initial, "--tokenizer", paths.tokenizer,
    "--packed-train", paths.training, "--packed-validation", paths.validation,
    "--steps", String(contract.training.update_groups), "--max-run-steps", String(updates),
    "--batch", String(series.shared_training.maximum_batch_sequences),
    "--parallel-batch", String(series.shared_training.parallel_workers),
    "--seed", String(contract.training.seed),
    "--lr", String(series.shared_training.peak_learning_rate),
    "--weight-decay", String(series.shared_training.weight_decay),
    "--clip", String(series.shared_training.gradient_clip),
    "--warmup", String(series.shared_training.warmup_updates),
    "--report", "500", "--validation", "64",
    "--dropout", String(series.shared_training.residual_dropout),
    "--claim-answer-weight", String(series.shared_training.answer_weights.claim),
    "--cloze-answer-weight", String(series.shared_training.answer_weights.cloze),
    "--retrieval-answer-weight", String(series.shared_training.answer_weights.retrieval),
    "--run-contract-sha256", runHash,
    "--require-math-backend", controlContract.execution.math_backend,
    "--require-attention-backend", controlContract.execution.attention_backend];
  const controlArgs = [...common, "--cosine", "--tokens", "0"];
  const treatmentArgs = [...common];
  const controlCheckpoint = path.join(paths.out, "gate-off-control.ckpt");
  const treatmentCheckpoint = path.join(paths.out, "gate-off-ht1.ckpt");
  const controlRun = run(controlTrainer, [...controlArgs, "--save", controlCheckpoint], env,
    "actual control gate-off run");
  const treatmentRun = run(trainer, [...treatmentArgs, "--gate-off", "--save", treatmentCheckpoint],
    env, "actual HT1 gate-off run");
  fs.writeFileSync(path.join(paths.out, "gate-off-control.log"), controlRun.stdout, { flag: "wx" });
  fs.writeFileSync(path.join(paths.out, "gate-off-ht1.log"), treatmentRun.stdout, { flag: "wx" });
  const identity = compareGateOff(controlCheckpoint, treatmentCheckpoint);
  const identityArgs = checkpoint => ["--init", checkpoint, "--tokenizer", paths.tokenizer,
    "--identity-eval", paths.validation, "--validation", "64", "--gate-off"];
  const controlIdentity = JSON.parse(run(trainer, identityArgs(controlCheckpoint), env,
    "control identity evaluation").stdout.trim());
  const treatmentIdentity = JSON.parse(run(trainer, identityArgs(treatmentCheckpoint), env,
    "HT1 identity evaluation").stdout.trim());
  assert.equal(controlIdentity.schema, "zero.ht1_identity_eval.v1");
  assert.deepEqual(treatmentIdentity, controlIdentity, "actual logits and loss identity");

  for (let index = 0; index < warmups; index++) {
    run(controlTrainer, controlArgs, env, `control timing warmup ${index + 1}`);
    run(trainer, treatmentArgs, env, `HT1 timing warmup ${index + 1}`);
  }
  const seconds = { control: [], treatment: [] };
  for (let index = 0; index < trials; index++) {
    const order = index % 2 === 0 ? ["control", "treatment"] : ["treatment", "control"];
    for (const arm of order) {
      const measured = arm === "control"
        ? run(controlTrainer, controlArgs, env, `control timing trial ${index + 1}`)
        : run(trainer, treatmentArgs, env, `HT1 timing trial ${index + 1}`);
      seconds[arm].push(measured.seconds);
    }
  }
  const wall = { schema: "zero.ht1_wall_time_measurement.v1", clock: "monotonic",
    timed_scope: "process-start-through-ten-training-updates", warmups, trials,
    control_seconds: seconds.control, treatment_seconds: seconds.treatment,
    control_median_seconds: median(seconds.control),
    treatment_median_seconds: median(seconds.treatment) };
  wall.wall_time_ratio = wall.treatment_median_seconds / wall.control_median_seconds;
  const operations = operationCount(contract.model, firstUpdateShape(paths.training, updates));
  const mechanics = { gate_off_shared_state_identity: true,
    gate_off_logits_and_loss_identity: true, exact_round_trip: true,
    causality: true, finite_gradients: true, tied_effective_table: true,
    gate_off_updates: updates };
  const resourcePass = operations.compute_ratio <= contract.gates.maximum_compute_ratio &&
    wall.wall_time_ratio <= contract.gates.maximum_wall_time_ratio;
  const receipt = { schema: "zero.ht1_preflight_evidence.v1",
    experiment: contract.experiment, status: resourcePass ? "complete-pass" : "complete-no-go",
    contract_sha256: artifact(contractPath).sha256,
    implementation_sha256: artifact(implementationPath).sha256,
    bindings: { initial_checkpoint_sha256: artifact(paths.initial).sha256,
      training_packs_sha256: artifact(paths.training).sha256,
      validation_packs_sha256: artifact(paths.validation).sha256,
      tokenizer_sha256: artifact(paths.tokenizer).sha256,
      control_trainer_sha256: artifact(controlTrainer).sha256,
      trainer_sha256: artifact(trainer).sha256,
      gate_off_control_checkpoint_sha256: artifact(controlCheckpoint).sha256,
      gate_off_ht1_checkpoint_sha256: artifact(treatmentCheckpoint).sha256,
      shared_state_sha256: identity.shared_state_sha256,
      orchestration_sha256: identity.orchestration_sha256,
      synthetic_checker_sha256: artifact(path.resolve(implementation.implementation.checker)).sha256,
      synthetic_checker_stdout_sha256: sha256(checker.stdout) },
    mechanics, identity_evaluation: controlIdentity,
    resources: { compute_ratio: operations.compute_ratio,
      wall_time_ratio: wall.wall_time_ratio, operations, wall,
      environment: { platform: process.platform, architecture: process.arch,
        release: os.release(), cpu_model: os.cpus()[0]?.model ?? "unknown",
        logical_cpus: os.cpus().length, blas_threads: controlContract.execution.blas_threads,
        math_backend: controlContract.execution.math_backend,
        attention_backend: controlContract.execution.attention_backend } },
    gates: { compute: operations.compute_ratio <= contract.gates.maximum_compute_ratio,
      wall_time: wall.wall_time_ratio <= contract.gates.maximum_wall_time_ratio },
    eligible_for_pilot_authorization: resourcePass,
    experiment_runs_completed: 0, pilot_training_run_executed: false,
    diagnostic_training_updates_executed: updates * (2 + 2 * warmups + 2 * trials),
    test: { content_present: false, parsed: false, tokenized: false, packed: false,
      scored: false, metrics_opened: false } };
  const receiptPath = path.join(paths.out, "preflight-evidence.json");
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(executionPath, JSON.stringify({
    schema: "zero.ht1_preflight_execution.v1", experiment: contract.experiment,
    contract_sha256: receipt.contract_sha256, status: receipt.status,
    evidence_sha256: artifact(receiptPath).sha256,
  }, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ ...receipt,
    evidence: artifact(receiptPath) }) + "\n");
}

try { main(); } catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}

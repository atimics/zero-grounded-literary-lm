#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createCacheObject, validateBaseline, verifyCacheObject,
} from "./zero5_c32_baseline_cache.mjs";
import { verifyFrozenGitFile } from "./frozen_source.mjs";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function run(program, args, expectedStatus = 0) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result.stdout;
}

function packedReport(output) {
  const match = output.match(
    /update\s+\d+\s+train\s+([0-9.]+)\s+val\s+([0-9.]+)\s+grad\s+([0-9.]+)/,
  );
  assert.notEqual(match, null, "packed trainer output has no update report");
  return match.slice(1).map(Number);
}

function u32(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
}

function u64(values) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) =>
    bytes.writeBigUInt64LE(BigInt(value), index * 8));
  return bytes;
}

function writeTinyPack(file, packs = 4) {
  const context = 512;
  const header = Buffer.concat([
    Buffer.from([90, 53, 80, 75, 86, 50, 0, 0]),
    u32([2, 128, context, packs]),
    u64([packs, packs * 4, 3, 1, 1, 1]),
  ]);
  const tokens = Buffer.alloc(packs * (context + 1) * 2);
  for (let index = 0; index < packs * (context + 1); index++) {
    tokens.writeUInt16LE(32, index * 2);
  }
  const classes = Buffer.alloc(packs * context);
  for (let pack = 0; pack < packs; pack++) {
    const start = pack * context;
    classes[start] = 1;
    classes[start + 1] = pack < 3 ? pack + 2 : 1;
    classes[start + 2] = 1;
    classes[start + 3] = 1;
  }
  fs.writeFileSync(file, Buffer.concat([header, tokens, classes]));
}

function pairedCandidate(tokens, targetStart, label) {
  return Buffer.concat([
    u32([tokens.length, targetStart, tokens.length - targetStart, label]),
    Buffer.from(Uint16Array.from(tokens).buffer),
  ]);
}

function writeTinyPaired(file) {
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([90, 53, 80, 69, 86, 49, 0, 0]),
    u32([1, 128, 512, 1]),
    pairedCandidate([120, 65], 1, 65),
    pairedCandidate([120, 66], 1, 0),
    pairedCandidate([120, 66], 1, 66),
    pairedCandidate([120, 65], 1, 0),
  ]));
}

const contractPath = "benchmarks/zero5-c32-v1/contract.json";
const importPath = "benchmarks/zero5-c32-v1/import.json";
const resultPath = "benchmarks/zero5-c32-v1/result.json";
const awsExecutionPath = "benchmarks/zero5-c32-v1/aws-execution.json";
const awsContinuationPath =
  "benchmarks/zero5-c32-v1/aws-continuation.json";
const awsResultPath = "benchmarks/zero5-c32-v1/aws-result.json";
const dashboardPayloadPath =
  "benchmarks/zero5-c32-v1/dashboard-payload.json";
const localPartialPath = "benchmarks/zero5-c32-v1/local-partial-run.json";
const awsScripts = [
  "scripts/aws/zero5-c32-publish-baseline-cache.sh",
  "scripts/aws/zero5-c32-run-instance.sh",
  "scripts/aws/zero5-c32-stage.sh",
  "scripts/aws/zero5-c32-user-data.sh",
];
const baselineCacheScript = "scripts/zero5_c32_baseline_cache.mjs";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const importBytes = fs.readFileSync(importPath);
const imported = JSON.parse(importBytes);
const awsResultReceipt = JSON.parse(fs.readFileSync(awsResultPath));

assert.equal(contract.schema, "zero.c32_braid_experiment.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(contract.authorized, true);
assert.equal(contract.amendment.parent_source_commit, "361c861");
assert.equal(contract.amendment.scientific_change, false);
assert.equal(contract.execution.backend, "openblas");
assert.equal(contract.execution.checkpoint_every_updates, 250);
verifyFrozenGitFile(awsResultReceipt.source_commit,
  contract.implementation.trainer, contract.implementation.trainer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.importer)),
  contract.implementation.importer_sha256);
assert.equal(sha256(fs.readFileSync(contract.implementation.runner)),
  contract.implementation.runner_sha256);
assert.equal(sha256(importBytes), contract.input.import_manifest_sha256);
assert.equal(imported.schema, "zero.c32_import.v1");
assert.equal(imported.release.id, contract.input.release_id);
assert.equal(imported.release.braid_head, contract.input.braid_head);
assert.equal(imported.release.manifest.sha256,
  contract.input.release_manifest_sha256);
assert.equal(imported.tokenizer.sha256, contract.input.tokenizer_sha256);
assert.equal(imported.outputs.train_interleaved.sha256,
  contract.input.train_packs.sha256);
assert.equal(imported.outputs.train_interleaved.packs,
  contract.training.pack_sequences);
assert.equal(imported.outputs.train_interleaved.active_targets,
  contract.training.active_targets);
assert.deepEqual(imported.outputs.train_interleaved.answer_targets_by_task,
  contract.training.answer_targets_by_task);
assert.equal(imported.outputs.train_interleaved.maximum_same_task_pack_run, 2);
assert.equal(contract.training.updates * contract.training.batch_sequences,
  contract.training.pack_sequences);
assert.equal(contract.training.pack_sequences * contract.model.context,
  contract.training.compute_token_exposures);
assert.equal(imported.test.parsed, false);
assert.equal(imported.test.tokenized, false);
assert.equal(imported.test.packed, false);
assert.equal(imported.test.metrics_opened, false);
assert.equal(contract.decision.broad_model_promotion_authorized, false);
assert.equal(contract.decision.checkpoint_publication_authorized, false);
assert.deepEqual(Object.keys(contract.arms), ["C", "D"]);
assert.deepEqual(contract.arms.C.answer_weights,
  { claim: 1, cloze: 1, retrieval: 1 });
assert.deepEqual(contract.arms.D.answer_weights, imported.answer_weights.D);

const baselineFixture = {
  combined_selection_nats_per_token:
    contract.baselines.combined_selection_nats_per_token,
  combined_final_nats_per_token:
    contract.baselines.combined_final_nats_per_token,
  members: Object.fromEntries(["claim", "cloze", "retrieval"].map(task =>
    [task, contract.baselines.members[task].nats_per_token])),
  completion: Object.fromEntries(["claim", "cloze", "retrieval"].map(task =>
    [task, {
      schema: "zero.c3_completion_eval.v1",
      records: imported.outputs.completion_validation[task].records,
      target_tokens: imported.outputs.completion_validation[task].target_tokens,
      ...contract.baselines.completion[task],
    }])),
  paired: Object.fromEntries(["claim", "retrieval"].map(task =>
    [task, {
      schema: "zero.c32_paired_choice_eval.v1",
      pairs: imported.outputs.paired_validation[task].pairs,
      records: imported.outputs.paired_validation[task].records,
      target_tokens: imported.outputs.paired_validation[task].target_tokens,
      nats_per_target_token: 1,
      top1_token_accuracy: 0.5,
      teacher_forced_exact_accuracy: 0,
      ...contract.baselines.paired[task],
    }])),
  atlas_nats_per_token: contract.baselines.atlas_nats_per_token,
  anchor_nats_per_token: contract.baselines.anchor_nats_per_token,
};
validateBaseline(baselineFixture, contract, imported);
const bindingFixture = {
  schema: "zero.c32_baseline_binding.v1",
  experiment: contract.experiment,
  contract_sha256: sha256(contractBytes),
  backend: "openblas",
  implementation: { trainer: { sha256: "1".repeat(64), bytes: 1 } },
  import_manifest_sha256: sha256(importBytes),
  evaluation_sha256: "2".repeat(64),
  artifacts: { tokenizer: { sha256: contract.input.tokenizer_sha256,
    bytes: 1016 } },
};
const cacheFixture = createCacheObject({ baseline: baselineFixture,
  binding: bindingFixture, sourceRunId: "unit-test-run" });
const cacheReceipt = verifyCacheObject(cacheFixture, bindingFixture, contract,
  imported);
assert.match(cacheReceipt.cache_id, /^[0-9a-f]{64}$/);
const tamperedCache = structuredClone(cacheFixture);
tamperedCache.baseline.completion.claim.nats_per_target_token += 1;
assert.throws(() => verifyCacheObject(tamperedCache, bindingFixture, contract,
  imported), /baseline payload hash changed/);
const wrongBinding = structuredClone(bindingFixture);
wrongBinding.backend = "accelerate";
assert.throws(() => verifyCacheObject(cacheFixture, wrongBinding, contract,
  imported), /baseline cache binding does not match/);

const awsExecution = JSON.parse(fs.readFileSync(awsExecutionPath));
assert.equal(awsExecution.schema, "zero.c32_aws_execution.v1");
assert.equal(awsExecution.status, "authorized-unrun");
assert.equal(awsExecution.purchase_option, "on-demand");
assert.equal(awsExecution.instance_type, "c6i.4xlarge");
assert.equal(awsExecution.maximum_instance_seconds, 9000);
assert.equal(awsExecution.maximum_ec2_usd, 1.7);
assert.ok(awsExecution.maximum_instance_seconds *
  awsExecution.on_demand_usd_per_hour / 3600 <=
    awsExecution.maximum_ec2_usd);
assert.equal(awsExecution.controls.contract_bound_checkpoints, true);
assert.equal(awsExecution.controls.byte_exact_resume_test_required, true);
assert.equal(awsExecution.controls.provenance_bound_baseline_cache, true);
const awsContinuationBytes = fs.readFileSync(awsContinuationPath);
const awsContinuation = JSON.parse(awsContinuationBytes);
const throughputContractBytes = fs.readFileSync(
  awsContinuation.optimization_evidence.benchmark_contract);
const throughputResultBytes = fs.readFileSync(
  awsContinuation.optimization_evidence.benchmark_result);
const throughputResult = JSON.parse(throughputResultBytes);
assert.equal(awsContinuation.schema, "zero.c32_aws_continuation.v1");
assert.equal(awsContinuation.status, "authorized");
assert.equal(awsContinuation.scientific_change, false);
assert.equal(awsContinuation.parent.scientific_contract_sha256,
  sha256(contractBytes));
assert.equal(awsContinuation.parent.active_arm, "C");
assert.equal(awsContinuation.parent.completed_update, 3000);
assert.equal(awsContinuation.parent.arm_d_started, false);
assert.match(awsContinuation.parent.active_checkpoint_sha256,
  /^[0-9a-f]{64}$/);
assert.equal(awsContinuation.optimization_evidence.benchmark_contract_sha256,
  sha256(throughputContractBytes));
assert.equal(awsContinuation.optimization_evidence.benchmark_result_sha256,
  sha256(throughputResultBytes));
assert.equal(throughputResult.fastest_byte_identical_candidate.threads, 8);
assert.equal(throughputResult.fastest_byte_identical_candidate.compiler, "o2");
assert.ok(throughputResult.candidates.every(candidate =>
  candidate.byte_identical_to_reference));
assert.equal(awsContinuation.environment.openblas_threads, 8);
assert.equal(awsContinuation.environment.omp_threads, 8);
assert.equal(awsContinuation.environment.openblas_dynamic, false);
assert.equal(awsContinuation.budget.maximum_total_c32_ec2_usd, 6.75);
assert.equal(awsContinuation.budget.maximum_additional_ec2_usd,
  awsContinuation.budget.maximum_total_c32_ec2_usd -
    awsContinuation.parent.prior_ec2_usd);
assert.ok(awsContinuation.budget.maximum_segment_seconds *
  awsContinuation.environment.on_demand_usd_per_hour / 3600 <=
    awsContinuation.budget.maximum_segment_ec2_usd);
assert.equal(awsContinuation.budget_amendment.status, "authorized");
assert.equal(awsContinuation.budget_amendment.scientific_change, false);
assert.equal(awsContinuation.budget_amendment.resume_from.active_arm, "D");
assert.equal(awsContinuation.budget_amendment.resume_from.completed_update,
  5000);
assert.equal(
  awsContinuation.budget_amendment.resume_from.active_checkpoint_sha256,
  "3049f548984576b2c617201b01336adb89b9915508d63edfa3240660deb2b776");
assert.equal(awsContinuation.budget_amendment.resume_from.prior_ec2_usd,
  4.998188888889);
assert.equal(
  awsContinuation.budget_amendment.previous_maximum_total_c32_ec2_usd,
  5.42);
assert.equal(awsContinuation.budget_amendment.maximum_total_c32_ec2_usd,
  awsContinuation.budget.maximum_total_c32_ec2_usd);
assert.equal(awsContinuation.budget_amendment.maximum_increment_ec2_usd,
  awsContinuation.budget.maximum_total_c32_ec2_usd -
    awsContinuation.budget_amendment.previous_maximum_total_c32_ec2_usd);
assert.equal(awsContinuation.budget_amendment.approval_id,
  awsContinuation.approval_id);
assert.equal(sha256(fs.readFileSync(
  awsContinuation.implementation.user_data)),
awsContinuation.implementation.user_data_sha256);
assert.equal(sha256(fs.readFileSync(
  awsContinuation.implementation.launcher)),
awsContinuation.implementation.launcher_sha256);
for (const script of awsScripts) {
  run("bash", ["-n", script]);
  assert.ok((fs.statSync(script).mode & 0o111) !== 0,
    script + " must be executable");
}
run("node", ["--check", baselineCacheScript]);
const awsUserData = fs.readFileSync(
  "scripts/aws/zero5-c32-user-data.sh", "utf8");
const awsLauncher = fs.readFileSync(
  "scripts/aws/zero5-c32-run-instance.sh", "utf8");
assert.match(awsLauncher, /execution\.lock/);
assert.match(awsLauncher, /--if-none-match '\*'/);
assert.match(awsLauncher, /launch-\$\{launch_epoch\}\.json/);
assert.match(awsLauncher, /BaselineCacheKey/);
assert.match(awsUserData, /test "\$INSTANCE_TYPE" = c6i\.4xlarge/);
assert.match(awsUserData, /export LITERARY_BACKEND=openblas/);
assert.match(awsUserData, /export OPENBLAS_NUM_THREADS=8/);
assert.match(awsUserData, /export OMP_NUM_THREADS=8/);
assert.match(awsUserData, /export OPENBLAS_DYNAMIC=0/);
assert.match(awsUserData, /test "\$MAX_COMPUTE_USD" = 6\.75/);
assert.match(awsUserData,
  /test "\$APPROVAL_ID" = zero5-c32-aws-2026-08-25-v3/);
assert.match(awsUserData, /aws-continuation\.json/);
assert.match(awsUserData, /--resume-run/);
assert.match(awsUserData, /publish_zero_telemetry\.mjs/);
assert.match(awsUserData, /zero5_c32_baseline_cache\.mjs --mode install/);
assert.match(awsLauncher, /max_usd=6\.75/);
assert.match(awsLauncher, /if \(value > 9000\) value=9000/);

const localPartial = JSON.parse(fs.readFileSync(localPartialPath));
assert.equal(localPartial.schema, "zero.c32_local_partial_run.v1");
assert.equal(localPartial.official_result, false);
assert.equal(localPartial.arm_d.completed_updates, 2500);
assert.equal(localPartial.arm_d.next_pack, 10000);
const localPartialCheckpoint = "build/zero5-c32-v1/run/D/best.ckpt";
if (fs.existsSync(localPartialCheckpoint)) {
  assert.equal(sha256(fs.readFileSync(localPartialCheckpoint)),
    localPartial.arm_d.checkpoint_sha256);
}

for (const task of ["claim", "cloze", "retrieval"]) {
  const baseline = contract.baselines.completion[task].nats_per_target_token;
  assert.ok(Math.abs(
    contract.gates.completion_nats_per_target_token_maximum[task] -
      baseline * 0.9) < 1e-9);
}
assert.ok(Math.abs(contract.gates.combined_validation_nats_per_token_maximum -
  contract.baselines.combined_final_nats_per_token * 0.9) < 1e-12);

const localImport = "build/zero5-c32-v1/import-final";
if (fs.existsSync(localImport)) {
  const paths = {
    "train.interleaved.z5pack": imported.outputs.train_interleaved.sha256,
    "validation.interleaved.z5pack":
      imported.outputs.validation_interleaved.sha256,
    "claim.validation.paired-eval.bin":
      imported.outputs.paired_validation.claim.sha256,
    "retrieval.validation.paired-eval.bin":
      imported.outputs.paired_validation.retrieval.sha256,
  };
  for (const [file, expected] of Object.entries(paths)) {
    assert.equal(sha256(fs.readFileSync(path.join(localImport, file))), expected);
  }
  const cacheCheck = fs.mkdtempSync(path.join(os.tmpdir(),
    "zero5-c32-cache-check-"));
  try {
    const source = path.join(cacheCheck, "baseline.json");
    const cache = path.join(cacheCheck, "cache.json");
    const installed = path.join(cacheCheck, "installed.json");
    fs.writeFileSync(source, JSON.stringify({
      schema: "zero.c32_baseline_cache.v1",
      contract_sha256: sha256(contractBytes),
      baseline: baselineFixture,
    }, null, 2) + "\n");
    const created = JSON.parse(run("node", [baselineCacheScript,
      "--mode", "create", "--input", source, "--output", cache,
      "--backend", "openblas", "--source-run-id", "cache-check-run"]));
    assert.equal(created.schema, "zero.c32_baseline_cache_receipt.v1");
    fs.copyFileSync(source, installed);
    const verified = JSON.parse(run("node", [baselineCacheScript,
      "--mode", "install", "--input", cache, "--output", installed,
      "--backend", "openblas"]));
    assert.equal(verified.cache_id, created.cache_id);
    assert.equal(verified.installed, true);
    assert.equal(JSON.parse(fs.readFileSync(installed)).provenance.cache_id,
      created.cache_id);
  } finally {
    fs.rmSync(cacheCheck, { recursive: true, force: true });
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-c32-check-"));
try {
  const tensorBinary = process.env.ZERO5_TENSOR_BINARY ?? null;
  const profileBinary = process.env.ZERO5_PROFILE_BINARY ?? null;
  const vectorBinary = process.env.ZERO5_VECTOR_BINARY ?? null;
  const runContractSha256 = "0".repeat(64);
  const packed = path.join(temporary, "tiny.z5pack");
  const paired = path.join(temporary, "tiny.z5pair");
  const checkpoint = path.join(temporary, "best.ckpt");
  writeTinyPack(packed);
  writeTinyPaired(paired);
  const mechanics = run("./zero5_c32_lm", [
    "--preset", "literary", "--context", "512", "--dim", "8",
    "--heads", "2", "--layers", "1", "--ff", "16", "--vocab", "128",
    "--packed-train", packed, "--packed-validation", packed,
    "--run-contract-sha256", runContractSha256,
    "--steps", "1", "--batch", "4", "--lr", "0.0001",
    "--warmup", "1", "--report", "1", "--validation", "4",
    "--best", checkpoint, "--claim-answer-weight", "3.009199423",
    "--cloze-answer-weight", "1", "--retrieval-answer-weight",
    "1.941452456", "--tokens", "0",
  ]);
  assert.match(mechanics,
    /packed sampling sequences=4 compute-token-exposures=2048 active-targets=16 answer-targets=3 claim-answer-targets=1 cloze-answer-targets=1 retrieval-answer-targets=1 padding-targets=2032 wraps=0 claim-answer-weight=3\.00919938 cloze-answer-weight=1 retrieval-answer-weight=1\.9414525/);
  assert.ok(fs.existsSync(checkpoint));
  assert.match(run("./zero5_c32_lm", [
    "--init", checkpoint, "--paired-eval", paired,
  ]), /"schema":"zero\.c32_paired_choice_eval\.v1"/);

  const parallel = path.join(temporary, "parallel.ckpt");
  const parallelRepeat = path.join(temporary, "parallel-repeat.ckpt");
  const parallelArgs = [
    "--preset", "literary", "--context", "512", "--dim", "8",
    "--heads", "2", "--layers", "1", "--ff", "16", "--vocab", "128",
    "--packed-train", packed, "--packed-validation", packed,
    "--run-contract-sha256", runContractSha256,
    "--steps", "1", "--batch", "4", "--parallel-batch", "4",
    "--lr", "0.0001", "--warmup", "1", "--report", "1",
    "--validation", "4", "--seed", "17", "--tokens", "0",
  ];
  const parallelOutput = run("./zero5_c32_lm", [...parallelArgs,
    "--save", parallel]);
  assert.match(parallelOutput, /packed parallel-batch=4 private-caches=3/);
  run("./zero5_c32_lm", [...parallelArgs, "--save", parallelRepeat]);
  assert.equal(sha256(fs.readFileSync(parallel)),
    sha256(fs.readFileSync(parallelRepeat)));
  run("./zero5_c32_lm", [
    ...parallelArgs.filter((value, index, values) =>
      value !== "--parallel-batch" && values[index - 1] !== "--parallel-batch"),
    "--resume", parallel, "--save", parallel,
  ], 1);

  if (tensorBinary !== null) {
    const tensor = path.join(temporary, "tensor.ckpt");
    const tensorRepeat = path.join(temporary, "tensor-repeat.ckpt");
    const tensorArgs = parallelArgs.flatMap((value, index, values) => {
      if (value === "--parallel-batch") return ["--tensor-batch"];
      if (values[index - 1] === "--parallel-batch") return [value];
      return [value];
    });
    const tensorOutput = run(tensorBinary, [...tensorArgs, "--save", tensor]);
    assert.match(tensorOutput,
      /packed tensor-batch=4 contiguous-rows=2048 attention-domains=4 private-caches=0 optimizer-workers=4/);
    const referenceMetrics = packedReport(parallelOutput);
    const tensorMetrics = packedReport(tensorOutput);
    assert.ok(referenceMetrics.every((value, index) =>
      Math.abs(value - tensorMetrics[index]) <= (index === 2 ? 0.001 : 0.0001)),
    `tensor metrics drifted: reference=${referenceMetrics} tensor=${tensorMetrics}`);
    run(tensorBinary, [...tensorArgs, "--save", tensorRepeat]);
    assert.equal(sha256(fs.readFileSync(tensor)),
      sha256(fs.readFileSync(tensorRepeat)));
    run(tensorBinary, [
      ...tensorArgs.filter((value, index, values) =>
        value !== "--tensor-batch" && values[index - 1] !== "--tensor-batch"),
      "--resume", tensor, "--save", tensor,
    ], 1);
  }

  if (profileBinary !== null) {
    const profile = path.join(temporary, "profile.ckpt");
    const profileRepeat = path.join(temporary, "profile-repeat.ckpt");
    const profileOutput = run(profileBinary, [...parallelArgs,
      "--save", profile]);
    const profileMatch = profileOutput.match(/^phase-profile (\{.*\})$/m);
    assert.notEqual(profileMatch, null, "profile output is missing");
    const profileReport = JSON.parse(profileMatch[1]);
    assert.equal(profileReport.schema, "zero.cpu_phase_profile.v1");
    assert.equal(profileReport.updates, 1);
    assert.equal(profileReport.workers, 4);
    for (const group of [profileReport.wall_seconds,
      profileReport.worker_cpu_seconds]) {
      for (const value of Object.values(group)) {
        assert.ok(Number.isFinite(value) && value >= 0);
      }
    }
    const referenceMetrics = packedReport(parallelOutput);
    const profileMetrics = packedReport(profileOutput);
    assert.ok(referenceMetrics.every((value, index) =>
      Math.abs(value - profileMetrics[index]) <=
        (index === 2 ? 0.001 : 0.0001)),
    `profile metrics drifted: reference=${referenceMetrics} profile=${profileMetrics}`);
    run(profileBinary, [...parallelArgs, "--save", profileRepeat]);
    assert.equal(sha256(fs.readFileSync(profile)),
      sha256(fs.readFileSync(profileRepeat)));
  }

  if (vectorBinary !== null) {
    const vector = path.join(temporary, "vector.ckpt");
    const vectorRepeat = path.join(temporary, "vector-repeat.ckpt");
    const vectorOutput = run(vectorBinary, [...parallelArgs,
      "--save", vector]);
    const referenceMetrics = packedReport(parallelOutput);
    const vectorMetrics = packedReport(vectorOutput);
    assert.ok(referenceMetrics.every((value, index) =>
      Math.abs(value - vectorMetrics[index]) <=
        (index === 2 ? 0.005 : 0.0001)),
    `vector metrics drifted: reference=${referenceMetrics} vector=${vectorMetrics}`);
    run(vectorBinary, [...parallelArgs, "--save", vectorRepeat]);
    assert.equal(sha256(fs.readFileSync(vector)),
      sha256(fs.readFileSync(vectorRepeat)));
  }

  const corrupt = path.join(temporary, "corrupt.z5pack");
  const corruptBytes = fs.readFileSync(packed);
  corruptBytes[corruptBytes.length - 1] = 5;
  fs.writeFileSync(corrupt, corruptBytes);
  run("./zero5_c32_lm", [
    "--init", checkpoint, "--packed-validation", corrupt,
    "--eval-only", "--validation", "4",
  ], 1);

  const resumePacked = path.join(temporary, "resume.z5pack");
  const continuous = path.join(temporary, "continuous.ckpt");
  const continuousBest = path.join(temporary, "continuous-best.ckpt");
  const resumed = path.join(temporary, "resumed.ckpt");
  const resumedBest = path.join(temporary, "resumed-best.ckpt");
  writeTinyPack(resumePacked, 8);
  const resumeArgs = [
    "--preset", "literary", "--context", "512", "--dim", "8",
    "--heads", "2", "--layers", "1", "--ff", "16", "--vocab", "128",
    "--packed-train", resumePacked, "--packed-validation", resumePacked,
    "--run-contract-sha256", runContractSha256,
    "--steps", "4", "--batch", "2", "--lr", "0.0001",
    "--warmup", "1", "--schedule-total", "4", "--cosine",
    "--report", "1", "--validation", "4", "--save-every", "1",
    "--seed", "17", "--tokens", "0",
  ];
  run("./zero5_c32_lm", [...resumeArgs, "--save", continuous,
    "--best", continuousBest]);
  const paused = run("./zero5_c32_lm", [...resumeArgs, "--save", resumed,
    "--best", resumedBest, "--max-run-steps", "2"]);
  assert.match(paused,
    /packed paused completed-steps=2 total-steps=4 next-pack=4 attempt-steps=2/);
  const continued = run("./zero5_c32_lm", [...resumeArgs,
    "--resume", resumed, "--save", resumed, "--best", resumedBest]);
  assert.match(continued,
    /packed resume completed-steps=2 next-pack=4/);
  assert.equal(sha256(fs.readFileSync(resumed)),
    sha256(fs.readFileSync(continuous)));
  assert.equal(sha256(fs.readFileSync(resumedBest)),
    sha256(fs.readFileSync(continuousBest)));
  run("./zero5_c32_lm", [...resumeArgs, "--resume", resumed,
    "--run-contract-sha256", "1".repeat(64), "--save", resumed], 1);
  assert.match(run("./zero5_c32_lm", ["--self-test"]),
    /35 finite-difference gradient checks passed/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

if (fs.existsSync(resultPath)) {
  const resultBytes = fs.readFileSync(resultPath);
  const result = JSON.parse(resultBytes);
  assert.equal(sha256(resultBytes),
    "e87305b52d229a71483c49a9aed09258211e118dd14b2f09855b77f89a059688");
  assert.equal(result.schema, "zero.c32_braid_result.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.contract_sha256, sha256(contractBytes));
  assert.deepEqual(Object.keys(result.arms), ["C", "D"]);
  for (const arm of Object.values(result.arms)) {
    assert.equal(arm.training.completed_updates, contract.training.updates);
    assert.equal(arm.training.pack_sequences, contract.training.pack_sequences);
    assert.equal(arm.training.wraps, 0);
  }
  assert.equal(result.test.metrics_opened, false);
  assert.deepEqual(result.decision.eligible_arms, []);
  assert.equal(result.decision.preferred_arm, null);
  assert.equal(result.decision.outcome, "no-go");
  assert.equal(result.decision.broad_model_promotion_authorized, false);
  assert.equal(result.decision.checkpoint_publication_authorized, false);
  assert.ok(result.arms.D.validation.mean_paired_choice_accuracy >
    result.arms.C.validation.mean_paired_choice_accuracy);
  assert.ok(result.arms.D.validation.mean_pair_exact_accuracy >
    result.arms.C.validation.mean_pair_exact_accuracy);
  assert.equal(result.arms.D.gates.claim_position_gap, true);
  assert.equal(result.arms.D.gates.claim_swap_consistency, false);
  assert.equal(result.arms.D.gates.retrieval_swap_consistency, false);
  assert.equal(result.arms.D.gates.claim_pair_exact, false);
  assert.equal(result.arms.D.gates.retrieval_pair_exact, false);

  const awsResult = awsResultReceipt;
  assert.equal(awsResult.schema, "zero.c32_aws_result_receipt.v1");
  assert.equal(awsResult.status, "complete");
  assert.equal(awsResult.exit_code, 0);
  assert.equal(awsResult.ec2_usd, 6.5484);
  assert.equal(awsResult.result.sha256, sha256(resultBytes));
  assert.equal(awsResult.scientific_contract_sha256,
    result.contract_sha256);
  assert.equal(awsResult.test_metrics_opened, false);

  const dashboardPayload = JSON.parse(fs.readFileSync(dashboardPayloadPath));
  assert.equal(dashboardPayload.metric_kind, "paired-invariance");
  assert.equal(dashboardPayload.mean_choice_accuracy,
    result.arms.D.validation.mean_paired_choice_accuracy);
  assert.equal(dashboardPayload.mean_pair_exact_accuracy,
    result.arms.D.validation.mean_pair_exact_accuracy);
  assert.equal(dashboardPayload.result_sha256, sha256(resultBytes));
  assert.equal(dashboardPayload.test_metrics_opened, false);
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C3.2 result mechanics passed"
  : "ZERO.5-C3.2 preregistration and paired mechanics passed");

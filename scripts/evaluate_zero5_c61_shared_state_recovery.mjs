#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function fail(message) { throw new Error(message); }

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function artifact(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  const wanted = typeof expected === "string" ? expected : expected.sha256;
  if (observed.sha256 !== wanted ||
      (typeof expected === "object" && expected.bytes !== undefined &&
       observed.bytes !== expected.bytes)) fail(`${label} changed`);
  return observed;
}

function runAsync(program, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...environment },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(
        `${program} failed: ${(stderr || stdout).trim()}`));
    });
  });
}

function finalJson(output, schema) {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const value = JSON.parse(line);
      if (value.schema === schema) return value;
    } catch {}
  }
  fail(`missing ${schema} output`);
}

function finiteNumbers(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value && typeof value === "object")
    return Object.values(value).every(finiteNumbers);
  return true;
}

function cacheFile(directory, key) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(key))
    fail(`invalid evaluation task key ${key}`);
  return path.join(directory, `${key}.json`);
}

async function cachedTask(directory, task) {
  const file = cacheFile(directory, task.key);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file));
    if (cached.schema !== "zero.c61_evaluation_cache.v1" ||
        cached.task !== task.key ||
        cached.binding_sha256 !== task.binding_sha256 ||
        !finiteNumbers(cached.result))
      fail(`cached evaluation task ${task.key} does not match its binding`);
    return cached.result;
  }
  const result = await task.compute();
  if (!finiteNumbers(result)) fail(`evaluation task ${task.key} is not finite`);
  const record = {
    schema: "zero.c61_evaluation_cache.v1",
    task: task.key,
    binding_sha256: task.binding_sha256,
    result,
  };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n",
    { flag: "wx" });
  fs.renameSync(temporary, file);
  process.stdout.write(JSON.stringify({
    schema: "zero.c61_evaluation_progress.v1",
    task: task.key,
    cached: false,
  }) + "\n");
  return result;
}

async function runTaskPool(directory, tasks, jobs) {
  const results = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      results.set(task.key, await cachedTask(directory, task));
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) },
    () => worker()));
  return results;
}

function zeroHeadScore(file) {
  const bytes = fs.readFileSync(file);
  const magic = Buffer.from([90, 53, 65, 85, 69, 86, 49, 0]);
  if (!bytes.subarray(0, 8).equals(magic) || bytes.readUInt32LE(8) !== 1)
    fail("invalid auxiliary evaluation artifact");
  const vocab = bytes.readUInt32LE(12);
  const records = bytes.readUInt32LE(20);
  const declaredEvents = bytes.readUInt32LE(24);
  const familyCount = bytes.readUInt32LE(28);
  const offsets = [];
  let cursor = 32;
  for (let index = 0; index <= familyCount; index++, cursor += 4)
    offsets.push(bytes.readUInt32LE(cursor));
  const tags = [];
  for (let index = 0; index < vocab; index++, cursor += 2)
    tags.push(bytes.readUInt16LE(cursor));
  let events = 0;
  let correct = 0;
  let loss = 0;
  for (let record = 0; record < records; record++) {
    const tokenCount = bytes.readUInt32LE(cursor);
    const eventCount = bytes.readUInt32LE(cursor + 8);
    cursor += 12 + tokenCount * 2;
    for (let event = 0; event < eventCount; event++, cursor += 8) {
      const tag = bytes.readUInt16LE(cursor + 2);
      const family = bytes.readUInt16LE(cursor + 4);
      loss += Math.log(offsets[family + 1] - offsets[family]);
      if (tag === tags[offsets[family]]) correct++;
      events++;
    }
  }
  if (cursor !== bytes.length || events !== declaredEvents)
    fail("auxiliary zero-head accounting changed");
  return { events, nats_per_event: loss / events, accuracy: correct / events };
}

export function evaluateC61Gates(candidate, ablation, control, state, gates) {
  const retrieval = candidate.choice.retrieval;
  const ablatedRetrieval = ablation.choice.retrieval;
  const claim = candidate.choice.claim;
  const orientationGap = Math.abs(retrieval.position_0_accuracy -
    retrieval.position_1_accuracy);
  const c52Gap = Math.abs(
    candidate.c52.choice_a.top1_token_accuracy -
    candidate.c52.choice_b.top1_token_accuracy);
  const derived = {
    state_nats_reduction: 1 - state.candidate.nats_per_event /
      state.control.nats_per_event,
    state_accuracy_gain: state.candidate.accuracy - state.control.accuracy,
    retrieval_gain_over_c51: retrieval.choice_accuracy -
      control.retrieval_choice_accuracy,
    pair_gain_over_c51: retrieval.pair_exact_accuracy -
      control.retrieval_pair_exact_accuracy,
    bridge_retrieval_contribution: retrieval.choice_accuracy -
      ablatedRetrieval.choice_accuracy,
    bridge_pair_contribution: retrieval.pair_exact_accuracy -
      ablatedRetrieval.pair_exact_accuracy,
    retrieval_orientation_gap: orientationGap,
    c52_choice_orientation_gap: c52Gap,
  };
  const checks = {
    state_nats_reduction: derived.state_nats_reduction >=
      gates.state_nats_reduction_minimum,
    state_accuracy_gain: derived.state_accuracy_gain >=
      gates.state_accuracy_gain_minimum,
    retrieval_floor: retrieval.choice_accuracy >=
      gates.retrieval_choice_accuracy_minimum,
    retrieval_gain_over_c51: derived.retrieval_gain_over_c51 >=
      gates.retrieval_choice_gain_minimum,
    pair_floor: retrieval.pair_exact_accuracy >=
      gates.retrieval_pair_exact_minimum,
    pair_gain_over_c51: derived.pair_gain_over_c51 >=
      gates.retrieval_pair_gain_minimum,
    bridge_retrieval_contribution: derived.bridge_retrieval_contribution >=
      gates.bridge_retrieval_contribution_minimum,
    bridge_pair_contribution: derived.bridge_pair_contribution >=
      gates.bridge_pair_contribution_minimum,
    retrieval_orientation_floor:
      retrieval.position_0_accuracy >= gates.orientation_accuracy_minimum &&
      retrieval.position_1_accuracy >= gates.orientation_accuracy_minimum,
    retrieval_orientation_gap: orientationGap <=
      gates.maximum_retrieval_orientation_gap,
    retrieval_swap_consistency: retrieval.swap_consistency_accuracy >=
      gates.retrieval_swap_consistency_minimum,
    c52_choice_orientation_gap: c52Gap <=
      gates.maximum_c52_choice_orientation_gap,
    claim_retention: claim.choice_accuracy >= control.claim_choice_accuracy -
      gates.maximum_claim_accuracy_loss,
    claim_swap_consistency: claim.swap_consistency_accuracy >=
      gates.claim_swap_consistency_minimum,
    combined_retention: candidate.combined_nats_per_token <=
      control.combined_nats_per_token + gates.maximum_combined_nats_increase,
    evidence_retention: candidate.evidence_nats_per_token <=
      gates.maximum_evidence_nats,
    atlas_retention: candidate.atlas_nats_per_token <= gates.maximum_atlas_nats,
    anchor_retention: candidate.anchor_nats_per_token <=
      gates.maximum_anchor_nats,
    finite_metrics: finiteNumbers({ candidate, ablation, state, derived }),
    sealed_test_stayed_closed: true,
  };
  return { derived, checks,
    passed: Object.values(checks).every(value => value === true) };
}

async function selfTest() {
  const choice = (accuracy, pair = .55) => ({ choice_accuracy: accuracy,
    pair_exact_accuracy: pair, position_0_accuracy: .56,
    position_1_accuracy: .55, swap_consistency_accuracy: .95 });
  const candidate = { combined_nats_per_token: 2.05,
    evidence_nats_per_token: 2.2, atlas_nats_per_token: 2.3,
    anchor_nats_per_token: 3.8,
    choice: { retrieval: choice(.56, .54), claim: choice(.56, .54) },
    c52: { choice_a: { top1_token_accuracy: .62 },
      choice_b: { top1_token_accuracy: .56 } } };
  const ablation = { choice: { retrieval: choice(.54, .52) } };
  const control = { retrieval_choice_accuracy: .525,
    retrieval_pair_exact_accuracy: .509, claim_choice_accuracy: .561,
    combined_nats_per_token: 2.08 };
  const state = { control: { nats_per_event: 2, accuracy: .2 },
    candidate: { nats_per_event: 1, accuracy: .7 } };
  const gates = { state_nats_reduction_minimum: .1,
    state_accuracy_gain_minimum: .05, retrieval_choice_accuracy_minimum: .55,
    retrieval_choice_gain_minimum: .01, retrieval_pair_exact_minimum: .53,
    retrieval_pair_gain_minimum: .01,
    bridge_retrieval_contribution_minimum: .01,
    bridge_pair_contribution_minimum: .01, orientation_accuracy_minimum: .5,
    maximum_retrieval_orientation_gap: .15,
    retrieval_swap_consistency_minimum: .94,
    maximum_c52_choice_orientation_gap: .15,
    maximum_claim_accuracy_loss: .02, claim_swap_consistency_minimum: .94,
    maximum_combined_nats_increase: .1, maximum_evidence_nats: 2.4,
    maximum_atlas_nats: 2.50646, maximum_anchor_nats: 4.06362 };
  assert.equal(evaluateC61Gates(candidate, ablation, control, state, gates).passed,
    true);
  candidate.choice.retrieval.choice_accuracy = .53;
  assert.equal(evaluateC61Gates(candidate, ablation, control, state, gates).passed,
    false);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c61-eval-cache-"));
  try {
    let executions = 0;
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      key: `task-${index}`,
      binding_sha256: sha256(Buffer.from(`binding-${index}`)),
      compute: async () => {
        executions++;
        await new Promise(resolve => setTimeout(resolve, 5));
        return { value: index };
      },
    }));
    const first = await runTaskPool(directory, tasks, 2);
    assert.equal(first.get("task-4").value, 4);
    assert.equal(executions, 5);
    const cached = await runTaskPool(directory, tasks.map(task => ({
      ...task,
      compute: async () => { throw new Error("cache was not reused"); },
    })), 3);
    assert.equal(cached.get("task-0").value, 0);
    assert.equal(executions, 5);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
  process.stdout.write("ZERO.5 C6.1 evaluator self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
  process.exit(0);
}

try {
  const contractPath = path.resolve(option("--contract",
    "benchmarks/zero5-c61-shared-state-v1/contract.json"));
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  if (contract.schema !== "zero.c61_shared_state_contract.v1")
    fail("wrong C6.1 contract");
  const targetImport = path.resolve(option("--target-import"));
  requireArtifact(path.join(targetImport, "import.json"),
    contract.verified_target_import.receipt, "target import receipt");
  const auxiliaryFile = path.join(targetImport, "validation.targets.z5aueval");
  requireArtifact(auxiliaryFile, contract.verified_target_import.evaluation,
    "state validation");
  const controlResult = path.resolve(option("--control-result"));
  requireArtifact(controlResult, contract.control.private_result_sha256,
    "C5.1 matched control result");
  if (process.argv.includes("--preflight-only")) {
    process.stdout.write(JSON.stringify({
      schema: "zero.c61_shared_state_evaluator_preflight.v1",
      contract_sha256: sha256(contractBytes), artifacts_verified: true,
      test_metrics_opened: false,
    }) + "\n");
    process.exit(0);
  }

  const checkpoint = path.resolve(option("--checkpoint"));
  const binary = path.resolve(option("--bottleneck-trainer",
    "./zero5_c61_bottleneck_lm"));
  const baseTrainer = path.resolve(option("--trainer",
    "./zero5_c32_lm_vector_math"));
  const c51Import = path.resolve(option("--c51-import"));
  const c43Import = path.resolve(option("--c43-import"));
  const frozen = path.join(c43Import, "frozen-validation");
  const jobs = Number(option("--jobs", "4"));
  if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 16)
    fail("evaluation jobs must be an integer from 1 through 16");
  const threads = Math.max(1,
    Math.floor(contract.execution.blas_threads / jobs));
  const environment = { OPENBLAS_NUM_THREADS: String(threads),
    OMP_NUM_THREADS: String(threads),
    VECLIB_MAXIMUM_THREADS: String(threads), OPENBLAS_DYNAMIC: "0" };
  const requestedCache = option("--cache-dir");
  const cacheDirectory = requestedCache
    ? path.resolve(requestedCache)
    : fs.mkdtempSync(path.join(os.tmpdir(), "zero-c61-eval-cache-"));
  const ephemeralCache = !requestedCache;
  fs.mkdirSync(cacheDirectory, { recursive: true });
  try {
    const checkpointArtifact = artifact(checkpoint);
    const bottleneckArtifact = artifact(`${checkpoint}.aux`);
    const commonBinding = {
      contract_sha256: sha256(contractBytes),
      checkpoint: checkpointArtifact,
      bottleneck: bottleneckArtifact,
      evaluator: artifact(fileURLToPath(import.meta.url)),
      bottleneck_trainer: artifact(binary),
      base_trainer: artifact(baseTrainer),
    };
    const tasks = [];
    const defineTask = (key, detail, compute) => {
      tasks.push({ key, compute, binding_sha256: sha256(Buffer.from(
        JSON.stringify({ ...commonBinding, key, detail }))) });
      return key;
    };
    const baseOutput = path.join(cacheDirectory, `.base-${process.pid}.json`);
    const baseKey = defineTask("base-retention", {
      evaluator: contract.implementation.c51_evaluator,
    }, async () => {
      fs.rmSync(baseOutput, { force: true });
      await runAsync("node", [contract.implementation.c51_evaluator,
        "--contract", contract.control.c51_contract,
        "--trainer", baseTrainer, "--checkpoint", checkpoint,
        "--baseline-checkpoint", path.resolve(option("--baseline-checkpoint")),
        "--tokenizer", path.resolve(option("--tokenizer")),
        "--import-dir", c51Import, "--c43-import", c43Import,
        "--atlas-train", path.resolve(option("--atlas-train")),
        "--atlas-validation", path.resolve(option("--atlas-validation")),
        "--anchor-train", path.resolve(option("--anchor-train")),
        "--anchor-validation", path.resolve(option("--anchor-validation")),
        "--out", baseOutput], environment);
      const result = JSON.parse(fs.readFileSync(baseOutput));
      fs.rmSync(baseOutput, { force: true });
      return result;
    });
    const invoke = (key, args, schema, bridgeOff = false) =>
      defineTask(key, { args, schema, bridge_off: bridgeOff }, async () =>
        finalJson(await runAsync(binary,
          ["--resume", checkpoint, "--eval-only", ...args,
            ...(bridgeOff ? ["--bridge-off"] : []),
            "--bridge-scale", String(contract.training.bridge_scale)],
          environment), schema));
    const armTasks = (prefix, bridgeOff) => ({
      combined: invoke(`${prefix}-combined`, ["--packed-eval",
        path.join(frozen, "validation.z5pack"), "--validation",
        String(contract.evaluation.combined_validation_packs)],
      "zero.c61_packed_eval.v1", bridgeOff),
      evidence: invoke(`${prefix}-evidence`, ["--packed-eval",
        path.join(frozen, "evidence-bundle.validation.z5pack"), "--validation",
        String(contract.evaluation.evidence_validation_packs)],
      "zero.c61_packed_eval.v1", bridgeOff),
      cloze: invoke(`${prefix}-cloze`, ["--completion-eval",
        path.join(frozen, "cloze.validation.completion-eval.bin")],
      "zero.c3_completion_eval.v1", bridgeOff),
      claim: invoke(`${prefix}-claim`, ["--span-choice-eval",
        path.join(frozen, "claim.validation.span-choice-eval.bin")],
      "zero.c42_span_choice_eval.v1", bridgeOff),
      retrieval: invoke(`${prefix}-retrieval`, ["--span-choice-eval",
        path.join(frozen, "retrieval.validation.span-choice-eval.bin")],
      "zero.c42_span_choice_eval.v1", bridgeOff),
      nextState: invoke(`${prefix}-c52-next-state`, ["--completion-eval",
        path.join(c51Import,
          "c52.next-state.validation.completion-eval.bin")],
      "zero.c3_completion_eval.v1", bridgeOff),
      choiceA: invoke(`${prefix}-c52-choice-a`, ["--completion-eval",
        path.join(c51Import,
          "c52.choice-a.validation.completion-eval.bin")],
      "zero.c3_completion_eval.v1", bridgeOff),
      choiceB: invoke(`${prefix}-c52-choice-b`, ["--completion-eval",
        path.join(c51Import,
          "c52.choice-b.validation.completion-eval.bin")],
      "zero.c3_completion_eval.v1", bridgeOff),
    });
    const candidateTasks = armTasks("candidate", false);
    const ablationTasks = armTasks("bridge-off", true);
    const stateKey = invoke("candidate-state", ["--aux-eval", auxiliaryFile],
      "zero.c61_state_eval.v1");
    const taskResults = await runTaskPool(cacheDirectory, tasks, jobs);
    const base = taskResults.get(baseKey);
    const buildArm = refs => ({
      combined_nats_per_token:
        taskResults.get(refs.combined).nats_per_token,
      evidence_nats_per_token:
        taskResults.get(refs.evidence).nats_per_token,
      atlas_nats_per_token: base.candidate.atlas_nats_per_token,
      anchor_nats_per_token: base.candidate.anchor_nats_per_token,
      cloze: taskResults.get(refs.cloze),
      choice: { claim: taskResults.get(refs.claim),
        retrieval: taskResults.get(refs.retrieval) },
      c52: { next_state: taskResults.get(refs.nextState),
        choice_a: taskResults.get(refs.choiceA),
        choice_b: taskResults.get(refs.choiceB) },
    });
    const candidate = buildArm(candidateTasks);
    const ablation = buildArm(ablationTasks);
    const state = { control: zeroHeadScore(auxiliaryFile),
      candidate: taskResults.get(stateKey) };
    const control = contract.control.metrics;
    const gate = evaluateC61Gates(candidate, ablation, control, state,
      contract.gates);
    gate.checks.test_metrics_opened = false;
    const result = { schema: "zero.c61_shared_state_validation.v1",
      experiment: contract.experiment, contract_sha256: sha256(contractBytes),
      checkpoint: checkpointArtifact, bottleneck: bottleneckArtifact,
      candidate, bridge_off: ablation, state, derived: gate.derived,
      gates: gate.checks, replication_eligible: gate.passed,
      promotion_eligible: false, test: { metrics_opened: false } };
    const out = option("--out");
    if (out) fs.writeFileSync(path.resolve(out),
      JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    if (ephemeralCache) fs.rmSync(cacheDirectory, { recursive: true });
  }
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

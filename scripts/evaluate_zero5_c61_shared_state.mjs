#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function run(program, args, environment = {}) {
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ...environment } });
  if (result.status !== 0)
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
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

function selfTest() {
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
  process.stdout.write("ZERO.5 C6.1 evaluator self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
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
  const environment = { OPENBLAS_NUM_THREADS: "4", OMP_NUM_THREADS: "4",
    VECLIB_MAXIMUM_THREADS: "4", OPENBLAS_DYNAMIC: "0" };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c61-eval-"));
  let base;
  try {
    const basePath = path.join(temporary, "base.json");
    run("node", [contract.implementation.c51_evaluator,
      "--contract", contract.control.c51_contract,
      "--trainer", baseTrainer, "--checkpoint", checkpoint,
      "--baseline-checkpoint", path.resolve(option("--baseline-checkpoint")),
      "--tokenizer", path.resolve(option("--tokenizer")),
      "--import-dir", c51Import, "--c43-import", c43Import,
      "--atlas-train", path.resolve(option("--atlas-train")),
      "--atlas-validation", path.resolve(option("--atlas-validation")),
      "--anchor-train", path.resolve(option("--anchor-train")),
      "--anchor-validation", path.resolve(option("--anchor-validation")),
      "--out", basePath], environment);
    base = JSON.parse(fs.readFileSync(basePath));
  } finally { fs.rmSync(temporary, { recursive: true }); }

  const invoke = (args, schema, bridgeOff = false) => finalJson(run(binary,
    ["--resume", checkpoint, "--eval-only", ...args,
      ...(bridgeOff ? ["--bridge-off"] : []),
      "--bridge-scale", String(contract.training.bridge_scale)], environment),
    schema);
  const packed = (name, batches, off) => invoke(["--packed-eval",
    path.join(frozen, name), "--validation", String(batches)],
  "zero.c61_packed_eval.v1", off).nats_per_token;
  const completion = (file, off) => invoke(["--completion-eval", file],
    "zero.c3_completion_eval.v1", off);
  const span = (file, off) => invoke(["--span-choice-eval", file],
    "zero.c42_span_choice_eval.v1", off);
  const buildArm = off => ({
    combined_nats_per_token: packed("validation.z5pack",
      contract.evaluation.combined_validation_packs, off),
    evidence_nats_per_token: packed("evidence-bundle.validation.z5pack",
      contract.evaluation.evidence_validation_packs, off),
    atlas_nats_per_token: base.candidate.atlas_nats_per_token,
    anchor_nats_per_token: base.candidate.anchor_nats_per_token,
    cloze: completion(path.join(frozen,
      "cloze.validation.completion-eval.bin"), off),
    choice: { claim: span(path.join(frozen,
      "claim.validation.span-choice-eval.bin"), off),
    retrieval: span(path.join(frozen,
      "retrieval.validation.span-choice-eval.bin"), off) },
    c52: Object.fromEntries([["next_state", "next-state"],
      ["choice_a", "choice-a"], ["choice_b", "choice-b"]].map(
      ([key, file]) => [key, completion(path.join(c51Import,
        `c52.${file}.validation.completion-eval.bin`), off)])),
  });
  const candidate = buildArm(false);
  const ablation = buildArm(true);
  const state = { control: zeroHeadScore(auxiliaryFile),
    candidate: invoke(["--aux-eval", auxiliaryFile],
      "zero.c61_state_eval.v1") };
  const control = contract.control.metrics;
  const gate = evaluateC61Gates(candidate, ablation, control, state,
    contract.gates);
  gate.checks.test_metrics_opened = false;
  const result = { schema: "zero.c61_shared_state_validation.v1",
    experiment: contract.experiment, contract_sha256: sha256(contractBytes),
    checkpoint: artifact(checkpoint),
    bottleneck: artifact(`${checkpoint}.aux`), candidate, bridge_off: ablation,
    state, derived: gate.derived, gates: gate.checks,
    replication_eligible: gate.passed, promotion_eligible: false,
    test: { metrics_opened: false } };
  const out = option("--out");
  if (out) fs.writeFileSync(path.resolve(out),
    JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

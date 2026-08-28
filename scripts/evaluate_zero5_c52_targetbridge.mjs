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
  const lines = output.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value.schema === schema) return value;
    } catch {}
  }
  fail(`missing ${schema} output`);
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
  for (let index = 0; index <= familyCount; index++) {
    offsets.push(bytes.readUInt32LE(cursor));
    cursor += 4;
  }
  const tags = [];
  for (let index = 0; index < vocab; index++) {
    tags.push(bytes.readUInt16LE(cursor));
    cursor += 2;
  }
  let events = 0;
  let correct = 0;
  let loss = 0;
  for (let record = 0; record < records; record++) {
    const tokenCount = bytes.readUInt32LE(cursor);
    const eventCount = bytes.readUInt32LE(cursor + 8);
    cursor += 12 + tokenCount * 2;
    for (let event = 0; event < eventCount; event++) {
      const tag = bytes.readUInt16LE(cursor + 2);
      const family = bytes.readUInt16LE(cursor + 4);
      const size = offsets[family + 1] - offsets[family];
      loss += Math.log(size);
      if (tag === tags[offsets[family]]) correct++;
      events++;
      cursor += 8;
    }
  }
  if (cursor !== bytes.length || events !== declaredEvents)
    fail("auxiliary zero-head accounting changed");
  return { schema: "zero.c52_target_eval.v1", events,
    nats_per_event: loss / events, accuracy: correct / events };
}

function evaluateGates(candidate, c52, control, auxiliary, thresholds) {
  const retrieval = candidate.choice.retrieval;
  const claim = candidate.choice.claim;
  const gap = Math.abs(retrieval.position_0_accuracy -
    retrieval.position_1_accuracy);
  const c52Gap = Math.abs(c52.candidate.choice_a.top1_token_accuracy -
    c52.candidate.choice_b.top1_token_accuracy);
  const auxNatsReduction = 1 - auxiliary.candidate.nats_per_event /
    auxiliary.control.nats_per_event;
  const checks = {
    auxiliary_nats_reduction:
      auxNatsReduction >= thresholds.auxiliary_nats_reduction,
    auxiliary_accuracy_gain:
      auxiliary.candidate.accuracy - auxiliary.control.accuracy >=
        thresholds.auxiliary_accuracy_gain,
    retrieval_accuracy_gain:
      retrieval.choice_accuracy - control.retrieval_choice_accuracy >=
        thresholds.retrieval_accuracy_gain,
    retrieval_pair_gain:
      retrieval.pair_exact_accuracy - control.retrieval_pair_exact_accuracy >=
        thresholds.retrieval_pair_gain,
    retrieval_orientation_gap:
      gap <= thresholds.maximum_retrieval_orientation_gap,
    c52_choice_orientation_gap:
      c52Gap <= thresholds.maximum_c52_choice_orientation_gap,
    claim_retention:
      claim.choice_accuracy >= control.claim_choice_accuracy -
        thresholds.maximum_claim_accuracy_loss,
    combined_retention:
      candidate.combined_nats_per_token <= control.combined_nats_per_token +
        thresholds.maximum_combined_nats_increase,
    evidence_floor: candidate.evidence_nats_per_token <=
      thresholds.maximum_evidence_nats,
    atlas_retention: candidate.atlas_nats_per_token <=
      thresholds.maximum_atlas_nats,
    anchor_retention: candidate.anchor_nats_per_token <=
      thresholds.maximum_anchor_nats,
    test_metrics_opened: false,
  };
  const decision = Object.entries(checks).filter(([name]) =>
    name !== "test_metrics_opened").every(([, value]) => value === true);
  return { decision, checks, derived: { aux_nats_reduction: auxNatsReduction,
    aux_accuracy_gain: auxiliary.candidate.accuracy - auxiliary.control.accuracy,
    retrieval_accuracy_gain: retrieval.choice_accuracy -
      control.retrieval_choice_accuracy,
    retrieval_pair_gain: retrieval.pair_exact_accuracy -
      control.retrieval_pair_exact_accuracy,
    retrieval_orientation_gap: gap, c52_choice_orientation_gap: c52Gap } };
}

function selfTest() {
  const gate = evaluateGates({ combined_nats_per_token: 2,
    evidence_nats_per_token: 1, atlas_nats_per_token: 2,
    anchor_nats_per_token: 2, choice: { retrieval: { choice_accuracy: .55,
      pair_exact_accuracy: .54, position_0_accuracy: .56,
      position_1_accuracy: .54 }, claim: { choice_accuracy: .56 } } },
  { candidate: { choice_a: { top1_token_accuracy: .7 },
    choice_b: { top1_token_accuracy: .5 } } },
  { retrieval_choice_accuracy: .53, retrieval_pair_exact_accuracy: .52,
    claim_choice_accuracy: .56, combined_nats_per_token: 2 },
  { control: { nats_per_event: 2, accuracy: .2 },
    candidate: { nats_per_event: 1, accuracy: .8 } }, {
    auxiliary_nats_reduction: .1, auxiliary_accuracy_gain: .1,
    retrieval_accuracy_gain: .01, retrieval_pair_gain: .01,
    maximum_retrieval_orientation_gap: .1,
    maximum_c52_choice_orientation_gap: .3,
    maximum_claim_accuracy_loss: .02,
    maximum_combined_nats_increase: .1, maximum_evidence_nats: 2,
    maximum_atlas_nats: 3, maximum_anchor_nats: 3 });
  assert.equal(gate.decision, true);
  process.stdout.write("ZERO.5 C5.2 TargetBridge evaluator self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const contractPath = path.resolve(option("--contract"));
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  if (contract.schema !== "zero.c52_targetbridge_contract.v1")
    fail("wrong TargetBridge contract");
  const targetImport = path.resolve(option("--target-import"));
  const targetReceiptPath = path.join(targetImport, "import.json");
  requireArtifact(targetReceiptPath, contract.verified_target_import.receipt,
    "target import receipt");
  const imported = JSON.parse(fs.readFileSync(targetReceiptPath));
  const evalFile = path.join(targetImport, "validation.targets.z5aueval");
  requireArtifact(evalFile, contract.verified_target_import.evaluation,
    "auxiliary validation");
  if (imported.test.metrics_opened !== false) fail("test boundary changed");
  const controlResult = path.resolve(option("--control-result"));
  requireArtifact(controlResult, contract.control.private_result_sha256,
    "matched loss-off control");
  if (process.argv.includes("--preflight-only")) {
    process.stdout.write(JSON.stringify({
      schema: "zero.c52_targetbridge_evaluator_preflight.v1",
      contract_sha256: sha256(contractBytes), artifacts_verified: true,
      test_metrics_opened: false }) + "\n");
    process.exit(0);
  }
  const candidate = path.resolve(option("--checkpoint"));
  const targetTrainer = path.resolve(option("--target-trainer",
    "./zero5_c51_target_lm"));
  const environment = { OPENBLAS_NUM_THREADS: "4", OMP_NUM_THREADS: "4",
    VECLIB_MAXIMUM_THREADS: "4", OPENBLAS_DYNAMIC: "0" };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-c52-eval-"));
  let structured;
  try {
    const structuredPath = path.join(temporary, "structured.json");
    run("node", [contract.implementation.c51_evaluator,
      "--contract", contract.control.c51_contract,
      "--trainer", path.resolve(option("--trainer")),
      "--checkpoint", candidate,
      "--baseline-checkpoint", path.resolve(option("--baseline-checkpoint")),
      "--tokenizer", path.resolve(option("--tokenizer")),
      "--import-dir", path.resolve(option("--c51-import")),
      "--c43-import", path.resolve(option("--c43-import")),
      "--atlas-train", path.resolve(option("--atlas-train")),
      "--atlas-validation", path.resolve(option("--atlas-validation")),
      "--anchor-train", path.resolve(option("--anchor-train")),
      "--anchor-validation", path.resolve(option("--anchor-validation")),
      "--out", structuredPath], environment);
    structured = JSON.parse(fs.readFileSync(structuredPath));
  } finally { fs.rmSync(temporary, { recursive: true }); }
  const auxControl = zeroHeadScore(evalFile);
  const auxCandidate = finalJson(run(targetTrainer,
    ["--resume", candidate, "--aux-eval", evalFile, "--eval-only"],
    environment), "zero.c52_target_eval.v1");
  const control = JSON.parse(fs.readFileSync(controlResult));
  const controlMetrics = {
    retrieval_choice_accuracy:
      control.validation.candidate.choice.retrieval.choice_accuracy,
    retrieval_pair_exact_accuracy:
      control.validation.candidate.choice.retrieval.pair_exact_accuracy,
    claim_choice_accuracy:
      control.validation.candidate.choice.claim.choice_accuracy,
    combined_nats_per_token:
      control.validation.candidate.combined_nats_per_token,
  };
  const auxiliary = { control: auxControl, candidate: auxCandidate };
  const gate = evaluateGates(structured.candidate, structured.c52_validation,
    controlMetrics, auxiliary, contract.gates);
  const result = { schema: "zero.c52_targetbridge_validation.v1",
    experiment: contract.experiment, contract_sha256: sha256(contractBytes),
    checkpoint: artifact(candidate), auxiliary_head: artifact(`${candidate}.aux`),
    matched_control_result_sha256: artifact(controlResult).sha256,
    candidate: structured.candidate, c52_validation: structured.c52_validation,
    auxiliary, derived: gate.derived, gates: gate.checks,
    replication_eligible: gate.decision, promotion_eligible: false,
    cloze_exact_metric_status: "reported-retired-not-a-decision-gate",
    test: { metrics_opened: false } };
  const out = option("--out");
  if (out) fs.writeFileSync(path.resolve(out),
    JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

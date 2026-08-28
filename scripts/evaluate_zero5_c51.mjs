#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) { throw new Error(message); }

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
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
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  const observed = artifact(file);
  const wanted = typeof expected === "string" ? expected : expected.sha256;
  if (observed.sha256 !== wanted ||
      (typeof expected === "object" && expected.bytes !== undefined &&
       observed.bytes !== expected.bytes)) fail(`${label} changed`);
  return observed;
}

function run(program, args, environment = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) {
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function finalJson(output, schema) {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const value = JSON.parse(line);
      if (value.schema === schema) return value;
    } catch {
      // Keep looking for the final structured line.
    }
  }
  fail(`command did not return ${schema}`);
}

function finiteNumbers(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value && typeof value === "object") {
    return Object.values(value).every(finiteNumbers);
  }
  return true;
}

export function evaluateC51Gates(candidate, control, c2, c5, gates) {
  const relative = (value, baseline) => value / baseline - 1;
  const derived = {
    retrieval_choice_gain_over_c43:
      candidate.choice.retrieval.choice_accuracy -
      control.choice.retrieval.choice_accuracy,
    retrieval_pair_exact_gain_over_c43:
      candidate.choice.retrieval.pair_exact_accuracy -
      control.choice.retrieval.pair_exact_accuracy,
    claim_choice_change_from_c43:
      candidate.choice.claim.choice_accuracy -
      control.choice.claim.choice_accuracy,
    combined_change_from_c43: relative(candidate.combined_nats_per_token,
      control.combined_nats_per_token),
    atlas_regression_from_c2: relative(candidate.atlas_nats_per_token,
      c2.atlas_nats_per_token),
    anchor_regression_from_c2: relative(candidate.anchor_nats_per_token,
      c2.anchor_nats_per_token),
    evidence_regression_from_c2: relative(candidate.evidence_nats_per_token,
      c2.evidence_nats_per_token),
    c52_next_state_target_nats_improvement: 1 -
      c5.candidate.next_state.nats_per_target_token /
      c5.baseline.next_state.nats_per_target_token,
    c52_choice_top1_gain: {
      a: c5.candidate.choice_a.top1_token_accuracy -
        c5.baseline.choice_a.top1_token_accuracy,
      b: c5.candidate.choice_b.top1_token_accuracy -
        c5.baseline.choice_b.top1_token_accuracy,
    },
  };
  const retrieval = candidate.choice.retrieval;
  const claim = candidate.choice.claim;
  const checks = {
    retrieval_choice_floor:
      retrieval.choice_accuracy >= gates.retrieval_choice_accuracy_minimum,
    retrieval_gain_over_c43: derived.retrieval_choice_gain_over_c43 >=
      gates.retrieval_choice_gain_minimum,
    retrieval_orientation_floor:
      retrieval.position_0_accuracy >= gates.orientation_accuracy_minimum &&
      retrieval.position_1_accuracy >= gates.orientation_accuracy_minimum,
    retrieval_orientation_gap:
      Math.abs(retrieval.position_0_accuracy -
        retrieval.position_1_accuracy) <= gates.orientation_gap_maximum,
    retrieval_swap_consistency: retrieval.swap_consistency_accuracy >=
      gates.retrieval_swap_consistency_minimum,
    retrieval_pair_exact: retrieval.pair_exact_accuracy >=
      gates.retrieval_pair_exact_minimum,
    claim_retention: claim.choice_accuracy >=
      control.choice.claim.choice_accuracy - gates.claim_regression_maximum,
    claim_swap_consistency: claim.swap_consistency_accuracy >=
      gates.claim_swap_consistency_minimum,
    combined_retention: derived.combined_change_from_c43 <=
      gates.combined_regression_from_c43_maximum,
    evidence_retention: derived.evidence_regression_from_c2 <=
      gates.c2_relative_regression_maximum,
    atlas_retention: candidate.atlas_nats_per_token <=
      gates.atlas_nats_per_token_maximum &&
      derived.atlas_regression_from_c2 <= gates.c2_relative_regression_maximum,
    anchor_retention: candidate.anchor_nats_per_token <=
      gates.anchor_nats_per_token_maximum &&
      derived.anchor_regression_from_c2 <= gates.c2_relative_regression_maximum,
    c52_target_learning: derived.c52_next_state_target_nats_improvement >=
      gates.c52_next_state_target_nats_improvement_minimum,
    finite_metrics: finiteNumbers(candidate) && finiteNumbers(control) &&
      finiteNumbers(c2) && finiteNumbers(c5) && finiteNumbers(derived),
    sealed_test_stayed_closed: true,
  };
  return { derived, checks,
    passed: Object.values(checks).every(value => value === true) };
}

function selfTest() {
  const choice = (accuracy, p0, p1, swap, pair) => ({
    choice_accuracy: accuracy, position_0_accuracy: p0,
    position_1_accuracy: p1, swap_consistency_accuracy: swap,
    pair_exact_accuracy: pair,
  });
  const c2 = { evidence_nats_per_token: 2.3, atlas_nats_per_token: 2.28,
    anchor_nats_per_token: 3.7 };
  const control = { combined_nats_per_token: 2,
    choice: { claim: choice(.70, .70, .70, .95, .68),
      retrieval: choice(.538, .52, .55, .96, .52) } };
  const candidate = { combined_nats_per_token: 2.02,
    evidence_nats_per_token: 2.4, atlas_nats_per_token: 2.3,
    anchor_nats_per_token: 3.75,
    choice: { claim: choice(.69, .68, .70, .95, .67),
      retrieval: choice(.56, .54, .58, .95, .54) } };
  const completion = nats => ({ nats_per_target_token: nats,
    top1_token_accuracy: .2, teacher_forced_exact_accuracy: 0 });
  const c5 = { baseline: { next_state: completion(3),
    choice_a: completion(3), choice_b: completion(3) },
  candidate: { next_state: completion(2.5), choice_a: completion(2.5),
    choice_b: completion(2.5) } };
  const gates = { retrieval_choice_accuracy_minimum: .55,
    retrieval_choice_gain_minimum: .01, orientation_accuracy_minimum: .5,
    orientation_gap_maximum: .15, retrieval_swap_consistency_minimum: .94,
    retrieval_pair_exact_minimum: .53, claim_regression_maximum: .03,
    claim_swap_consistency_minimum: .94,
    combined_regression_from_c43_maximum: .05,
    c2_relative_regression_maximum: .1,
    atlas_nats_per_token_maximum: 2.50646,
    anchor_nats_per_token_maximum: 4.06362,
    c52_next_state_target_nats_improvement_minimum: .05 };
  assert.equal(evaluateC51Gates(candidate, control, c2, c5, gates).passed,
    true);
  candidate.choice.retrieval.choice_accuracy = .54;
  assert.equal(evaluateC51Gates(candidate, control, c2, c5, gates).passed,
    false);
  process.stdout.write("ZERO.5 C5.1 evaluator self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const contractPath = path.resolve(option("--contract",
    "benchmarks/zero5-c51-statebridge-v1/contract.json"));
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  if (contract.schema !== "zero.c51_statebridge_contract.v1" ||
      contract.claim_boundary?.structured_content_only !== true ||
      contract.test?.content_present !== false ||
      contract.test?.metrics_opened !== false) {
    fail("C5.1 evaluation contract changed");
  }
  const importDirectory = path.resolve(option("--import-dir",
    "build/zero5-c51-statebridge-v1/import-final"));
  const importedPath = path.join(importDirectory, "import.json");
  const imported = JSON.parse(fs.readFileSync(importedPath));
  requireArtifact(importedPath, contract.verified_import.receipt_sha256,
    "C5.1 import receipt");
  if (imported.schema !== "zero.c51_statebridge_import.v1" ||
      imported.release.id !== contract.braid.release_id ||
      imported.test.content_present !== false ||
      imported.test.metrics_opened !== false) fail("C5.1 import changed");
  const evaluation = imported.outputs.evaluation;
  const files = {
    next_state: path.join(importDirectory,
      "c52.next-state.validation.completion-eval.bin"),
    choice_a: path.join(importDirectory,
      "c52.choice-a.validation.completion-eval.bin"),
    choice_b: path.join(importDirectory,
      "c52.choice-b.validation.completion-eval.bin"),
  };
  for (const name of Object.keys(files)) {
    requireArtifact(files[name], evaluation[name], `C5.2 ${name} evaluation`);
  }
  requireArtifact(contract.control.public_result.path,
    contract.control.public_result.sha256, "C4.3 public result");
  if (process.argv.includes("--preflight-only")) {
    process.stdout.write(JSON.stringify({
      schema: "zero.c51_statebridge_evaluator_preflight.v1",
      contract_sha256: sha256(contractBytes),
      import_receipt_sha256: artifact(importedPath).sha256,
      evaluator_artifacts_verified: true,
      test_metrics_opened: false,
    }) + "\n");
    process.exit(0);
  }

  const trainer = path.resolve(option("--trainer", "./zero5_c32_lm_vector_math"));
  const checkpoint = path.resolve(option("--checkpoint"));
  const baselineCheckpoint = path.resolve(option("--baseline-checkpoint"));
  const tokenizer = path.resolve(option("--tokenizer"));
  const c43Import = path.resolve(option("--c43-import"));
  const atlasTrain = path.resolve(option("--atlas-train"));
  const atlasValidation = path.resolve(option("--atlas-validation"));
  const anchorTrain = path.resolve(option("--anchor-train"));
  const anchorValidation = path.resolve(option("--anchor-validation"));
  requireArtifact(baselineCheckpoint,
    contract.initialization.checkpoint_sha256, "C2 checkpoint");
  requireArtifact(tokenizer, contract.model.tokenizer_sha256, "tokenizer");
  const c43 = finalJson(run("node", [contract.implementation.c43_evaluator,
    "--contract", contract.control.contract_path,
    "--import-dir", c43Import, "--trainer", trainer,
    "--checkpoint", checkpoint,
    "--baseline-checkpoint", baselineCheckpoint,
    "--tokenizer", tokenizer, "--atlas-train", atlasTrain,
    "--atlas-validation", atlasValidation, "--anchor-train", anchorTrain,
    "--anchor-validation", anchorValidation]),
  "zero.c43_validation_result.v1");
  const completion = (model, file) => finalJson(run(trainer,
    ["--init", model, "--tokenizer", tokenizer,
      "--completion-eval", file]), "zero.c3_completion_eval.v1");
  const c5 = { baseline: {}, candidate: {} };
  for (const name of Object.keys(files)) {
    c5.baseline[name] = completion(baselineCheckpoint, files[name]);
    c5.candidate[name] = completion(checkpoint, files[name]);
  }
  const published = JSON.parse(fs.readFileSync(
    contract.control.public_result.path, "utf8"));
  const gate = evaluateC51Gates(c43.candidate,
    published.validation.candidate, c43.baseline, c5, contract.gates);
  gate.checks.test_metrics_opened = false;
  const result = {
    schema: "zero.c51_statebridge_validation.v1",
    experiment: contract.experiment,
    contract_sha256: sha256(contractBytes),
    import_receipt_sha256: artifact(importedPath).sha256,
    checkpoint: artifact(checkpoint),
    baseline_checkpoint: artifact(baselineCheckpoint),
    c43_control: published.validation.candidate,
    c2_baseline: c43.baseline,
    candidate: c43.candidate,
    c52_validation: c5,
    derived: gate.derived,
    gates: gate.checks,
    replication_eligible: gate.passed,
    promotion_eligible: false,
    cloze_exact_metric_status: "reported-retired-not-a-decision-gate",
    test: { metrics_opened: false },
  };
  const out = option("--out");
  if (out) fs.writeFileSync(path.resolve(out),
    JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

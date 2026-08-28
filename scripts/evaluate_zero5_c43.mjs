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
  const expectedSha256 = typeof expected === "string" ? expected :
    expected.sha256;
  if (observed.sha256 !== expectedSha256 ||
      (typeof expected === "object" && expected.bytes !== undefined &&
       observed.bytes !== expected.bytes)) {
    fail(`${label} changed`);
  }
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
      // Continue until the final structured result is found.
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

function relativeChange(observed, baseline) {
  return observed / baseline - 1;
}

export function evaluateC43Gates(candidate, baseline, gates) {
  const derived = {
    combined_relative_improvement:
      1 - candidate.combined_nats_per_token / baseline.combined_nats_per_token,
    evidence_relative_regression: relativeChange(
      candidate.evidence_nats_per_token, baseline.evidence_nats_per_token),
    atlas_relative_regression: relativeChange(
      candidate.atlas_nats_per_token, baseline.atlas_nats_per_token),
    anchor_relative_regression: relativeChange(
      candidate.anchor_nats_per_token, baseline.anchor_nats_per_token),
    cloze_exact_improvement:
      candidate.cloze.teacher_forced_exact_accuracy -
      baseline.cloze.teacher_forced_exact_accuracy,
    choice_improvement: {}, swap_regression: {}, pair_exact_improvement: {},
  };
  for (const task of ["claim", "retrieval"]) {
    derived.choice_improvement[task] =
      candidate.choice[task].choice_accuracy -
      baseline.choice[task].choice_accuracy;
    derived.swap_regression[task] =
      baseline.choice[task].swap_consistency_accuracy -
      candidate.choice[task].swap_consistency_accuracy;
    derived.pair_exact_improvement[task] =
      candidate.choice[task].pair_exact_accuracy -
      baseline.choice[task].pair_exact_accuracy;
  }
  const checks = {
    combined_validation_step: derived.combined_relative_improvement >=
      gates.combined_relative_improvement_minimum,
    cloze_exact_step: derived.cloze_exact_improvement >=
      gates.cloze_exact_improvement_minimum,
    evidence_retention: derived.evidence_relative_regression <=
      gates.evidence_relative_regression_maximum,
    atlas_retention: candidate.atlas_nats_per_token <=
      gates.atlas_nats_per_token_maximum &&
      derived.atlas_relative_regression <= gates.c2_relative_regression_maximum,
    anchor_retention: candidate.anchor_nats_per_token <=
      gates.anchor_nats_per_token_maximum &&
      derived.anchor_relative_regression <=
        gates.c2_relative_regression_maximum,
  };
  for (const task of ["claim", "retrieval"]) {
    const observed = candidate.choice[task];
    checks[`${task}_choice_accuracy`] =
      observed.choice_accuracy >= gates.choice_accuracy_minimum[task] &&
      derived.choice_improvement[task] >= gates.choice_improvement_minimum;
    checks[`${task}_position_accuracy`] =
      observed.position_0_accuracy >= gates.position_accuracy_minimum &&
      observed.position_1_accuracy >= gates.position_accuracy_minimum &&
      Math.abs(observed.position_0_accuracy - observed.position_1_accuracy) <=
        gates.position_gap_maximum[task];
    checks[`${task}_swap_consistency`] =
      observed.swap_consistency_accuracy >=
        gates.swap_consistency_minimum[task] &&
      derived.swap_regression[task] <= gates.swap_regression_maximum[task];
    checks[`${task}_pair_exact`] =
      derived.pair_exact_improvement[task] >=
        gates.pair_exact_improvement_minimum;
  }
  checks.finite_metrics = finiteNumbers(candidate) && finiteNumbers(baseline) &&
    finiteNumbers(derived);
  checks.sealed_test_stayed_closed = true;
  return { derived, checks,
    eligible: Object.values(checks).every(value => value === true) };
}

function choice(accuracy, position0, position1, swap, pairExact) {
  return { choice_accuracy: accuracy, position_0_accuracy: position0,
    position_1_accuracy: position1, swap_consistency_accuracy: swap,
    pair_exact_accuracy: pairExact };
}

function selfTest() {
  const baseline = { combined_nats_per_token: 2,
    evidence_nats_per_token: 2, atlas_nats_per_token: 2.2786,
    anchor_nats_per_token: 3.6942,
    cloze: { teacher_forced_exact_accuracy: 0 },
    choice: { claim: choice(0.52, 0.51, 0.53, 0.96, 0.50),
      retrieval: choice(0.51, 0.50, 0.52, 0.95, 0.48) } };
  const candidate = { combined_nats_per_token: 1.75,
    evidence_nats_per_token: 2.1, atlas_nats_per_token: 2.3,
    anchor_nats_per_token: 3.7,
    cloze: { teacher_forced_exact_accuracy: 0.02 },
    choice: { claim: choice(0.57, 0.55, 0.59, 0.955, 0.54),
      retrieval: choice(0.56, 0.54, 0.58, 0.95, 0.52) } };
  const gates = { combined_relative_improvement_minimum: 0.1,
    cloze_exact_improvement_minimum: 0.01,
    evidence_relative_regression_maximum: 0.1,
    atlas_nats_per_token_maximum: 2.50646,
    anchor_nats_per_token_maximum: 4.06362,
    c2_relative_regression_maximum: 0.1,
    choice_accuracy_minimum: { claim: 0.55, retrieval: 0.55 },
    choice_improvement_minimum: 0.02,
    position_accuracy_minimum: 0.5,
    position_gap_maximum: { claim: 0.1, retrieval: 0.15 },
    swap_consistency_minimum: { claim: 0.95, retrieval: 0.95 },
    swap_regression_maximum: { claim: 0.01, retrieval: 0.01 },
    pair_exact_improvement_minimum: 0.03 };
  assert.equal(evaluateC43Gates(candidate, baseline, gates).eligible, true);
  candidate.choice.claim.swap_consistency_accuracy = 0.949;
  const failed = evaluateC43Gates(candidate, baseline, gates);
  assert.equal(failed.eligible, false);
  assert.equal(failed.checks.claim_swap_consistency, false);
  process.stdout.write("ZERO.5 C4.3 evaluator self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const contractPath = path.resolve(option("--contract",
    "benchmarks/zero5-c43-v1/contract.json"));
  const contractBytes = fs.readFileSync(contractPath);
  const contract = JSON.parse(contractBytes);
  if (contract.schema !== "zero.c43_experiment_contract.v1" ||
      contract.evaluation.evaluator_status !== "implemented-frozen" ||
      contract.test.policy.includes("absent") === false) {
    fail("C4.3 evaluation contract is not frozen");
  }
  for (const name of ["trainer", "importer", "evaluator"]) {
    requireArtifact(contract.implementation[name],
      contract.implementation[`${name}_sha256`],
    `frozen C4.3 ${name}`);
  }
  const importDirectory = path.resolve(option("--import-dir",
    "build/zero5-c43-v1/import-final"));
  const importedPath = path.join(importDirectory, "import.json");
  const imported = JSON.parse(fs.readFileSync(importedPath));
  requireArtifact(importedPath,
    contract.verified_import.first_receipt_sha256, "C4.3 import receipt");
  if (imported.schema !== "zero.c43_import_receipt.v1" ||
      imported.release.id !== contract.braid.release_id ||
      imported.test.content_present !== false ||
      imported.test.parsed !== false || imported.test.tokenized !== false ||
      imported.test.packed !== false || imported.test.metrics_opened !== false) {
    fail("C4.3 import or sealed-test policy changed");
  }
  const frozenDirectory = path.join(importDirectory, "frozen-validation");
  const files = {
    validation: path.join(frozenDirectory, "validation.z5pack"),
    evidence: path.join(frozenDirectory,
      "evidence-bundle.validation.z5pack"),
    cloze: path.join(frozenDirectory,
      "cloze.validation.completion-eval.bin"),
    choice: Object.fromEntries(["claim", "retrieval"].map(task => [task,
      path.join(frozenDirectory,
        `${task}.validation.span-choice-eval.bin`)])),
  };
  const frozen = contract.verified_import.frozen_validation;
  requireArtifact(files.validation, frozen.combined_sha256,
    "combined frozen validation packs");
  requireArtifact(files.evidence, frozen.evidence_validation_sha256,
    "frozen evidence validation packs");
  requireArtifact(files.cloze, frozen.cloze_completion_sha256,
    "frozen cloze evaluation");
  requireArtifact(files.choice.claim, frozen.claim_span_choices_sha256,
    "frozen claim evaluation");
  requireArtifact(files.choice.retrieval,
    frozen.retrieval_span_choices_sha256, "frozen retrieval evaluation");
  if (process.argv.includes("--preflight-only")) {
    process.stdout.write(JSON.stringify({
      schema: "zero.c43_evaluator_preflight.v1",
      contract_sha256: sha256(contractBytes),
      import_receipt_sha256: artifact(importedPath).sha256,
      evaluator_artifacts_verified: true,
      test_metrics_opened: false,
    }) + "\n");
    process.exit(0);
  }

  const trainer = path.resolve(option("--trainer", "./zero5_c32_lm_fast"));
  const checkpoint = path.resolve(option("--checkpoint"));
  const baselineCheckpoint = path.resolve(option("--baseline-checkpoint"));
  const tokenizer = path.resolve(option("--tokenizer"));
  const atlasTrain = path.resolve(option("--atlas-train"));
  const atlasValidation = path.resolve(option("--atlas-validation"));
  const anchorTrain = path.resolve(option("--anchor-train"));
  const anchorValidation = path.resolve(option("--anchor-validation"));
  requireArtifact(baselineCheckpoint,
    contract.initialization.checkpoint_sha256, "C2 checkpoint");
  requireArtifact(tokenizer, contract.model.tokenizer_sha256, "tokenizer");
  const retention = contract.evaluation.retention_inputs;
  requireArtifact(retention.c2_import_manifest.path,
    retention.c2_import_manifest.sha256, "C2 import manifest");
  requireArtifact(retention.c0_result.path,
    retention.c0_result.sha256, "C0 result");
  requireArtifact(atlasTrain, retention.atlas_train_sha256,
    "Atlas training tokens");
  requireArtifact(atlasValidation, retention.atlas_validation_sha256,
    "Atlas validation tokens");
  requireArtifact(anchorTrain, retention.anchor_train_sha256,
    "C1 anchor training tokens");
  requireArtifact(anchorValidation, retention.anchor_validation_sha256,
    "C1 anchor validation tokens");
  const common = ["--tokenizer", tokenizer];
  const packed = (model, file, batches) => {
    const output = run(trainer, ["--init", model, ...common,
      "--packed-validation", file, "--eval-only",
      "--validation", String(batches)]);
    const match = output.match(
      /packed-evaluation-only val ([0-9.]+) batches=(\d+)/u);
    if (!match || Number(match[2]) !== batches) {
      fail("packed validation measurement did not reproduce");
    }
    return Number(match[1]);
  };
  const legacy = (model, train, validation, batches) => {
    const output = run(trainer, ["--init", model, ...common,
      "--text", train, "--validation-text", validation, "--eval-only",
      "--validation", String(batches)]);
    const match = output.match(/evaluation-only val ([0-9.]+) batches=(\d+)/u);
    if (!match || Number(match[2]) !== batches) {
      fail("C2 retention measurement did not reproduce");
    }
    return Number(match[1]);
  };
  const score = model => ({
    combined_nats_per_token: packed(model, files.validation,
      contract.evaluation.combined_validation_packs),
    evidence_nats_per_token: packed(model, files.evidence,
      contract.evaluation.evidence_validation_packs),
    cloze: finalJson(run(trainer, ["--init", model, ...common,
      "--completion-eval", files.cloze]), "zero.c3_completion_eval.v1"),
    choice: Object.fromEntries(["claim", "retrieval"].map(task => [task,
      finalJson(run(trainer, ["--init", model, ...common,
        "--span-choice-eval", files.choice[task]]),
      "zero.c42_span_choice_eval.v1")])),
    atlas_nats_per_token: legacy(model, atlasTrain, atlasValidation,
      contract.evaluation.atlas_windows),
    anchor_nats_per_token: legacy(model, anchorTrain, anchorValidation,
      contract.evaluation.anchor_windows),
  });
  const baseline = score(baselineCheckpoint);
  const candidate = score(checkpoint);
  const gateResult = evaluateC43Gates(candidate, baseline, contract.gates);
  gateResult.checks.test_metrics_opened = imported.test.metrics_opened;
  const result = {
    schema: "zero.c43_validation_result.v1",
    experiment: contract.experiment,
    contract_sha256: sha256(contractBytes),
    import_receipt_sha256: artifact(importedPath).sha256,
    checkpoint: artifact(checkpoint),
    baseline_checkpoint: artifact(baselineCheckpoint),
    baseline, candidate, derived: gateResult.derived,
    gates: gateResult.checks,
    eligible_for_promotion: gateResult.eligible,
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

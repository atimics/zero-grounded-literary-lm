#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadBraidC43Release,
  readJson,
  sha256File,
  validateImportPair,
  validateReleaseReport,
} from "./lib/zero5_c43_intake.mjs";

function fail(message) { throw new Error(message); }

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

function artifact(file) {
  return { sha256: sha256File(file), bytes: fs.statSync(file).size };
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

function parseAccounting(log) {
  const match = log.match(/packed sampling sequences=(\d+) compute-token-exposures=(\d+) active-targets=(\d+) answer-targets=(\d+) claim-answer-targets=(\d+) cloze-answer-targets=(\d+) retrieval-answer-targets=(\d+) padding-targets=(\d+) wraps=(\d+)/u);
  if (!match) return null;
  return {
    pack_sequences: Number(match[1]),
    compute_token_exposures: Number(match[2]),
    active_targets: Number(match[3]),
    answer_targets: Number(match[4]),
    claim_answer_targets: Number(match[5]),
    cloze_answer_targets: Number(match[6]),
    retrieval_answer_targets: Number(match[7]),
    padding_targets: Number(match[8]),
    wraps: Number(match[9]),
  };
}

function pilotIdentity({ proposal, loaded, imports, variant, trainerSource,
  runner }) {
  const value = JSON.stringify({
    schema: "zero.c43_pilot_run_contract.v1",
    experiment: proposal.experiment,
    release_id: loaded.manifest.releaseId,
    release_manifest_sha256: loaded.handoff.releaseManifestSha256,
    primary_import_sha256: imports.primary.sha256,
    development_import_sha256: imports.development.sha256,
    initial_checkpoint_sha256: proposal.initialization.checkpoint_sha256,
    variant,
    optimizer_groups: loaded.trainingReport.development.optimizerGroups,
    trainer_source_sha256: sha256File(trainerSource),
    runner_sha256: sha256File(runner),
  });
  return crypto.createHash("sha256").update(value).digest("hex");
}

function selfTest() {
  const accounting = parseAccounting("packed sampling sequences=1476 " +
    "compute-token-exposures=755712 active-targets=592243 " +
    "answer-targets=128333 claim-answer-targets=48450 " +
    "cloze-answer-targets=20939 retrieval-answer-targets=58944 " +
    "padding-targets=163469 wraps=0");
  assert.equal(accounting.pack_sequences, 1476);
  assert.equal(accounting.wraps, 0);
  process.stdout.write("ZERO.5 C4.3 pilot runner self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

try {
  const proposalPath = path.resolve(option("--proposal",
    "benchmarks/zero5-c43-v1/contract-proposal.json"));
  const proposal = readJson(proposalPath);
  const c42Contract = readJson(path.resolve(proposal.c42_decision.contract));
  const releaseDirectory = path.resolve(option("--release"));
  const handoffPath = path.resolve(option("--handoff"));
  const importDirectory = path.resolve(option("--import-dir"));
  const firstImportPath = path.resolve(option("--import-a"));
  const secondImportPath = path.resolve(option("--import-b"));
  const trainer = path.resolve(option("--trainer",
    "./zero5_c32_lm_vector_math"));
  const trainerSource = path.resolve(option("--trainer-source",
    "zero5_c32_lm.c"));
  const tokenizer = path.resolve(option("--tokenizer"));
  const initialCheckpoint = path.resolve(option("--initial-checkpoint"));
  const variantId = option("--variant");
  const out = path.resolve(option("--out"));
  if (!variantId || !out) fail("--variant and --out are required");
  if (fs.existsSync(out)) fail(`output directory already exists: ${out}`);

  const loaded = loadBraidC43Release(releaseDirectory, handoffPath, proposal);
  validateReleaseReport(loaded.report, proposal, c42Contract,
    releaseDirectory);
  const imports = validateImportPair(readJson(firstImportPath),
    readJson(secondImportPath), loaded.report, proposal, c42Contract);
  const importedPath = path.join(importDirectory, "import.json");
  const imported = readJson(importedPath);
  if (JSON.stringify(imported.outputs) !==
      JSON.stringify(readJson(firstImportPath).outputs)) {
    fail("pilot import directory differs from the verified first import");
  }
  const variant = loaded.pilotContract.variants.find(value =>
    value.id === variantId);
  if (!variant) fail(`unregistered C4.3 pilot variant: ${variantId}`);
  if (loaded.pilotContract.variants.length >
      proposal.training_proposal.pilot.weight_variants_maximum) {
    fail("pilot variant count crossed the preregistered maximum");
  }

  requireArtifact(tokenizer, proposal.fixed_model.tokenizer_sha256,
    "ZERO.5 tokenizer");
  requireArtifact(initialCheckpoint,
    proposal.initialization.checkpoint_sha256, "C2 checkpoint");
  if (!fs.existsSync(trainer) || !fs.existsSync(trainerSource)) {
    fail("pilot trainer or trainer source is missing");
  }
  const files = {
    train: path.join(importDirectory, "development.grouped.z5pack"),
    cloze: path.join(importDirectory,
      "cloze.development.completion-eval.bin"),
    claim: path.join(importDirectory,
      "claim.development.span-choice-eval.bin"),
    retrieval: path.join(importDirectory,
      "retrieval.development.span-choice-eval.bin"),
  };
  requireArtifact(files.train, imports.development, "development packs");
  for (const task of ["cloze", "claim", "retrieval"]) {
    requireArtifact(files[task], imported.outputs.development.evaluation[
      task === "cloze" ? "cloze_completion" : "span_choices"][
      task === "cloze" ? "sha256" : task],
    `${task} development evaluation`);
  }

  fs.mkdirSync(out, { recursive: true });
  const runContractSha256 = pilotIdentity({ proposal, loaded, imports,
    variant, trainerSource, runner: path.resolve(process.argv[1]) });
  const environment = {
    VECLIB_MAXIMUM_THREADS: "4", OMP_NUM_THREADS: "4",
  };
  const common = ["--tokenizer", tokenizer];
  const score = checkpoint => {
    const completion = finalJson(run(trainer, ["--init", checkpoint,
      ...common, "--completion-eval", files.cloze], environment),
    "zero.c3_completion_eval.v1");
    const choice = Object.fromEntries(["claim", "retrieval"].map(task =>
      [task, finalJson(run(trainer, ["--init", checkpoint, ...common,
        "--span-choice-eval", files[task]], environment),
      "zero.c42_span_choice_eval.v1")]));
    return { cloze_exact_accuracy:
        completion.teacher_forced_exact_accuracy,
      claim_choice_accuracy: choice.claim.choice_accuracy,
      retrieval_choice_accuracy: choice.retrieval.choice_accuracy,
      details: { cloze: completion, choice } };
  };
  const baseline = score(initialCheckpoint);
  const activeCheckpoint = path.join(out, "active.ckpt");
  const bestCheckpoint = path.join(out, "best.ckpt");
  const groups = loaded.trainingReport.development.optimizerGroups;
  const warmup = Math.max(1, Math.round(groups * 1000 / 27962));
  const started = process.hrtime.bigint();
  const trainingLog = run(trainer, [
    "--init", initialCheckpoint, ...common,
    "--packed-train", files.train,
    "--packed-validation", files.train,
    "--run-contract-sha256", runContractSha256,
    "--steps", String(groups), "--schedule-total", String(groups),
    "--batch", "2", "--parallel-batch", "2",
    "--lr", "0.0003", "--weight-decay", "0.01", "--clip", "1",
    "--warmup", String(warmup), "--cosine", "--dropout", "0.1",
    "--report", "100", "--validation", "64",
    "--best", bestCheckpoint, "--seed", "0",
    "--save", activeCheckpoint, "--save-every", "250",
    "--claim-answer-weight", String(variant.weights.claim),
    "--cloze-answer-weight", String(variant.weights.cloze),
    "--retrieval-answer-weight", String(variant.weights.retrieval),
    "--tokens", "0",
  ], environment);
  const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  fs.writeFileSync(path.join(out, "training.log"), trainingLog,
    { flag: "wx" });
  const reports = [...trainingLog.matchAll(
    /^update\s+(\d+) train ([0-9.]+) val ([0-9.]+) grad ([0-9.]+) lr ([0-9.e+-]+) tok\/s (\d+)/gmu,
  )].map(match => ({ update: Number(match[1]),
    train_nats_per_token: Number(match[2]),
    validation_nats_per_token: Number(match[3]),
    gradient_norm: Number(match[4]), learning_rate: Number(match[5]),
    tokens_per_second: Number(match[6]) }));
  if (reports.at(-1)?.update !== groups) {
    fail("C4.3 pilot did not reach its final optimizer group");
  }
  const accounting = parseAccounting(trainingLog);
  const expected = imported.outputs.development;
  if (!accounting || accounting.pack_sequences !== expected.packs ||
      accounting.compute_token_exposures !== expected.compute_token_exposures ||
      accounting.active_targets !== expected.active_targets ||
      accounting.padding_targets !== expected.padding_targets ||
      accounting.claim_answer_targets !==
        expected.answer_targets_by_task.claim ||
      accounting.cloze_answer_targets !==
        expected.answer_targets_by_task.cloze ||
      accounting.retrieval_answer_targets !==
        expected.answer_targets_by_task.retrieval ||
      accounting.wraps !== 0) {
    fail("C4.3 pilot training accounting changed");
  }
  const candidate = score(bestCheckpoint);
  const result = {
    schema: "zero.c43_pilot_variant_result.v1",
    experiment: proposal.experiment,
    variant: variant.id,
    status: "complete",
    release_id: loaded.manifest.releaseId,
    primary_import_sha256: imports.primary.sha256,
    initial_checkpoint_sha256: proposal.initialization.checkpoint_sha256,
    data_split: "development",
    optimizer_groups: groups,
    answer_weights: variant.weights,
    run_contract_sha256: runContractSha256,
    implementation: {
      trainer_source: path.relative(process.cwd(), trainerSource),
      trainer_source_sha256: sha256File(trainerSource),
      trainer_binary_sha256: sha256File(trainer),
      runner_sha256: sha256File(path.resolve(process.argv[1])),
      math_backend: "accelerate-vforce",
      attention_backend: "dense-blas",
    },
    training: { elapsed_seconds: elapsedSeconds, warmup_updates: warmup,
      reports, accounting },
    checkpoints: { active: artifact(activeCheckpoint),
      best: artifact(bestCheckpoint) },
    metrics: { baseline, candidate },
    frozen_validation_scored: false,
    test_metrics_opened: false,
    promotion_eligible: false,
  };
  fs.writeFileSync(path.join(out, "result.json"),
    JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  loadBraidC43Release,
  readJson,
  sha256File,
  validateImportPair,
  validatePilotSelection,
  validatePilotVariant,
  validateReleaseReport,
} from "./lib/zero5_c43_intake.mjs";

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

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
}

function requireSafeEvidence(value, label) {
  const text = JSON.stringify(value);
  for (const forbidden of ["/Users/", "/private/", "data.text",
    "model-facing text"]) {
    if (text.includes(forbidden)) fail(`${label} contains private path or text`);
  }
}

try {
  const proposalPath = path.resolve(option("--proposal",
    "benchmarks/zero5-c43-v1/contract-proposal.json"));
  const proposal = readJson(proposalPath);
  const c42Contract = readJson(path.resolve(proposal.c42_decision.contract));
  const releaseDirectory = path.resolve(option("--release"));
  const handoffPath = path.resolve(option("--handoff"));
  const reportPath = path.resolve(option("--report"));
  const firstImportPath = path.resolve(option("--import-a"));
  const secondImportPath = path.resolve(option("--import-b"));
  const balancedPath = path.resolve(option("--pilot-balanced"));
  const clozePlusPath = path.resolve(option("--pilot-cloze-plus"));
  const selectionPath = path.resolve(option("--pilot-selection"));
  const out = path.resolve(option("--out",
    "benchmarks/zero5-c43-v1/evidence"));
  if (fs.existsSync(out)) fail(`output directory already exists: ${out}`);

  const loaded = loadBraidC43Release(releaseDirectory, handoffPath, proposal);
  const report = readJson(reportPath);
  if (!isDeepStrictEqual(report, loaded.report)) {
    fail("normalized release report differs from the governed handoff");
  }
  validateReleaseReport(report, proposal, c42Contract, releaseDirectory);
  const firstImport = readJson(firstImportPath);
  const secondImport = readJson(secondImportPath);
  const imports = validateImportPair(firstImport, secondImport, report,
    proposal, c42Contract);
  const balanced = readJson(balancedPath);
  const clozePlus = readJson(clozePlusPath);
  validatePilotVariant(balanced, report, imports, proposal);
  validatePilotVariant(clozePlus, report, imports, proposal);
  const selection = readJson(selectionPath);
  validatePilotSelection(selection, report, imports, proposal);
  if (selection.selected.variant !== "cloze-plus-five-v1" ||
      selection.variants.length !== 2) {
    fail("pilot selection differs from the preregistered two-variant result");
  }
  for (const [label, value] of Object.entries({ report, firstImport,
    secondImport, balanced, clozePlus, selection })) {
    requireSafeEvidence(value, label);
  }

  fs.mkdirSync(out, { recursive: true });
  const evidence = {
    release_report: [reportPath, "release-report.json"],
    import_a: [firstImportPath, "import-a.json"],
    import_b: [secondImportPath, "import-b.json"],
    pilot_balanced: [balancedPath, "pilot-balanced.json"],
    pilot_cloze_plus: [clozePlusPath, "pilot-cloze-plus-five.json"],
    pilot_selection: [selectionPath, "pilot-selection.json"],
  };
  const evidenceHashes = {};
  for (const [name, [source, filename]] of Object.entries(evidence)) {
    const destination = path.join(out, filename);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    evidenceHashes[name] = { path: path.relative(process.cwd(), destination),
      sha256: sha256File(destination), bytes: fs.statSync(destination).size };
  }

  const implementation = {
    trainer: "zero5_c32_lm.c",
    importer: "scripts/prepare_zero5_c43.mjs",
    intake_library: "scripts/lib/zero5_c43_intake.mjs",
    pilot_runner: "scripts/run_zero5_c43_pilot.mjs",
    evaluator: "scripts/evaluate_zero5_c43.mjs",
    runner: "scripts/run_zero5_c43.mjs",
  };
  for (const [name, file] of Object.entries({ ...implementation })) {
    implementation[`${name}_sha256`] = sha256File(file);
  }
  implementation.model_and_training = "C11";
  implementation.orchestration = "Node.js";
  implementation.pack_format = "Z5PKV3 grouped packs";

  const c42Evaluation = c42Contract.evaluation;
  const contract = {
    schema: "zero.c43_experiment_contract.v1",
    experiment: proposal.experiment,
    status: "frozen-awaiting-primary-training-authorization",
    authorized: false,
    source_proposal_sha256: sha256File(proposalPath),
    braid: {
      pull_request: proposal.braid_request.pull_request,
      merge_commit: proposal.braid_request.merge_commit,
      release_id: report.release.id,
      source_commit: report.release.source_commit,
      manifest_sha256: report.release.manifest_sha256,
      membership_digest: report.release.membership_digest,
      pack_plan_sha256: report.release.pack_plan_sha256,
      training_report_sha256: loaded.handoff.trainingReportHash,
      report: evidenceHashes.release_report,
      rights: { license: loaded.manifest.rights.license,
        private_by_default: true, dataset_published_by_zero: false },
    },
    verified_import: {
      deterministic: true,
      first_receipt_sha256: evidenceHashes.import_a.sha256,
      second_receipt_sha256: evidenceHashes.import_b.sha256,
      evidence: { first: evidenceHashes.import_a,
        second: evidenceHashes.import_b },
      primary: imports.primary,
      development: imports.development,
      frozen_validation: imports.frozen_validation,
    },
    pilot: {
      status: "complete-non-promotional",
      selected_variant: selection.selected.variant,
      selected_answer_weights: selection.selected.answer_weights,
      selection: evidenceHashes.pilot_selection,
      variants: { balanced: evidenceHashes.pilot_balanced,
        cloze_plus_five: evidenceHashes.pilot_cloze_plus },
      optimizer_groups_per_variant:
        loaded.trainingReport.development.optimizerGroups,
      primary_starts_from_pilot: false,
      frozen_validation_scored: false,
      test_metrics_opened: false,
      promotion_eligible: false,
    },
    model: proposal.fixed_model,
    initialization: proposal.initialization,
    implementation,
    training: {
      status: "frozen-unauthorized",
      seed: proposal.initialization.seed,
      update_groups: imports.primary.update_groups,
      maximum_batch_sequences: imports.primary.maximum_packs_per_update,
      parallel_workers: 2,
      pack_sequences: imports.primary.packs,
      compute_token_exposures: imports.primary.compute_token_exposures,
      pair_atomic_updates: true,
      zero_wraps_required: true,
      answer_weights: selection.selected.answer_weights,
      primary_initialization: "C2-not-C4.2-or-pilot",
      optimizer: "AdamW with fresh state",
      peak_learning_rate: 0.0003,
      weight_decay: 0.01,
      gradient_clip: 1,
      warmup_updates: 1000,
      schedule: "cosine over all 28,707 update groups",
      residual_dropout: 0.1,
      report_every_updates: 500,
      selection_validation_packs: 64,
      checkpoint_selection:
        "lowest frozen validation loss at fixed reports; no test access",
      paid_compute_authorized: false,
      cost_ceiling_usd: null,
    },
    execution: {
      status: "frozen-local-unauthorized",
      scale_policy: "local first; scale only after measured saturation",
      venue: "local",
      compute_resource: "Apple Silicon CPU",
      math_backend: "accelerate-vforce",
      attention_backend: "dense-blas",
      blas_threads: 4,
      checkpoint_every_updates: 250,
      maximum_execution_seconds: 3600,
      throughput_evidence: {
        development_compute_token_exposures: 755712,
        balanced_elapsed_seconds: 73.060036083,
        balanced_compute_tokens_per_second: 10343.7,
        cloze_plus_five_elapsed_seconds: 71.768870458,
        cloze_plus_five_compute_tokens_per_second: 10529.8,
        conservative_projected_primary_seconds: 1869.47,
      },
      automatic_termination_required_for_paid_compute: true,
    },
    evaluation: {
      evaluator_status: "implemented-frozen",
      contract_sha256: c42Evaluation.contract_sha256,
      reuse_c42_validation_artifacts: true,
      reuse_c42_evaluator_semantics: true,
      baseline: proposal.evaluation.baseline,
      baseline_metrics: proposal.evaluation.baseline_metrics,
      combined_validation_packs: c42Evaluation.combined_validation_packs,
      evidence_validation_packs: c42Evaluation.evidence_validation_packs,
      atlas_windows: c42Evaluation.atlas_windows,
      anchor_windows: c42Evaluation.anchor_windows,
      retention_inputs: c42Evaluation.retention_inputs,
    },
    gates: proposal.gates,
    test: {
      ...proposal.test,
      content_present: false, parsed: false, tokenized: false,
      packed: false, scored: false, metrics_opened: false,
    },
    authorization: {
      training_authorized: false,
      aws_use_authorized: false,
      paid_compute_authorized: false,
      promotion_authorized: false,
      sealed_test_access_authorized: false,
      approval_id: null,
    },
    claim_boundary: proposal.claim_boundary,
    blockers: [
      "Braid and user authorization for primary training",
      "authorization PR that changes status to authorized-unrun",
    ],
  };
  const intakePath = path.join(out, "intake.json");
  writeJson(intakePath, {
    schema: "zero.c43_intake_check.v1", status: "pass",
    proposal_sha256: sha256File(proposalPath),
    report_sha256: evidenceHashes.release_report.sha256,
    first_import_sha256: evidenceHashes.import_a.sha256,
    second_import_sha256: evidenceHashes.import_b.sha256,
    release_id: report.release.id,
    primary_sha256: imports.primary.sha256,
    development_sha256: imports.development.sha256,
    deterministic: true, paid_compute_authorized: false,
    test_metrics_opened: false,
  });
  contract.verified_import.intake = {
    path: path.relative(process.cwd(), intakePath),
    sha256: sha256File(intakePath),
    bytes: fs.statSync(intakePath).size,
  };
  const contractPath = path.resolve(path.dirname(out), "contract.json");
  writeJson(contractPath, contract);
  process.stdout.write(JSON.stringify({
    contract: path.relative(process.cwd(), contractPath),
    contract_sha256: sha256File(contractPath),
    evidence_directory: path.relative(process.cwd(), out),
    selected_variant: selection.selected.variant,
    primary_training_authorized: false,
    paid_compute_authorized: false,
    test_metrics_opened: false,
  }) + "\n");
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const DIGEST = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TASKS = ["claim", "cloze", "retrieval"];
const MIRRORED_TASKS = ["claim", "retrieval"];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function integer(value, label, minimum = 0) {
  requireValue(Number.isSafeInteger(value) && value >= minimum,
    `${label} must be an integer >= ${minimum}`);
}

function unit(value, label) {
  requireValue(Number.isFinite(value) && value >= 0 && value <= 1,
    `${label} must be between 0 and 1`);
}

function digest(value, label) {
  requireValue(typeof value === "string" && DIGEST.test(value),
    `${label} must be a lowercase SHA-256 digest`);
}

function commit(value, label) {
  requireValue(typeof value === "string" && COMMIT.test(value),
    `${label} must be a lowercase Git commit`);
}

function jsonEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireSame(left, right, label) {
  requireValue(left === right, `${label} changed`);
}

function artifactKind(relativePath) {
  if (relativePath === "data/train.jsonl") return "train";
  if (relativePath === "development/data.jsonl") return "development";
  return relativePath;
}

export function loadBraidC43Release(releaseDirectory, handoffPath,
  proposal) {
  const release = path.resolve(releaseDirectory);
  const handoff = readJson(path.resolve(handoffPath));
  const manifestPath = path.join(release, "release.json");
  const manifest = readJson(manifestPath);
  const dataReport = readJson(path.join(release, "reports/data-report.json"));
  const trainingReport = readJson(
    path.join(release, "reports/training-report.json"));
  const pilotContract = readJson(path.join(release, "pilot-contract.json"));

  requireValue(handoff.schemaVersion === "braid.c43-zero-handoff/v1",
    "unexpected Braid C4.3 handoff schema");
  requireValue(manifest.schemaVersion === "braid.c43-release/v1" &&
    manifest.status === "RELEASED", "Braid C4.3 is not released");
  requireValue(dataReport.schemaVersion === "braid.c43-data-report/v1",
    "unexpected Braid C4.3 data report schema");
  requireValue(trainingReport.schemaVersion ===
    "braid.c43-training-report/v1",
  "unexpected Braid C4.3 training report schema");
  requireValue(pilotContract.schemaVersion ===
    "braid.c43-pilot-contract/v1",
  "unexpected Braid C4.3 pilot contract schema");

  const manifestSha256 = sha256File(manifestPath);
  requireSame(manifest.releaseId, handoff.releaseId, "release ID");
  requireSame(manifestSha256, handoff.releaseManifestSha256,
    "release manifest hash");
  requireSame(manifest.membershipDigest, handoff.membershipDigest,
    "membership digest");
  requireSame(manifest.packPlanHash, handoff.packPlanHash,
    "pack-plan hash");
  requireSame(manifest.trainingReportHash, handoff.trainingReportHash,
    "training-report hash");
  requireSame(manifest.tokenizer.sha256, handoff.tokenizer.sha256,
    "tokenizer hash");
  requireSame(manifest.tokenizer.sha256, proposal.fixed_model.tokenizer_sha256,
    "C4.2 tokenizer identity");
  commit(handoff.sourceCommit, "Braid source commit");
  requireSame(handoff.releaseId, proposal.braid_request.release_id,
    "proposal release ID");
  requireSame(handoff.sourceCommit, proposal.braid_request.source_commit,
    "proposal Braid source commit");
  requireSame(handoff.releaseManifestSha256,
    proposal.braid_request.manifest_sha256, "proposal manifest hash");
  requireSame(handoff.membershipDigest,
    proposal.braid_request.membership_digest, "proposal membership digest");
  requireSame(handoff.packPlanHash, proposal.braid_request.pack_plan_sha256,
    "proposal pack-plan hash");
  requireValue(handoff.status === "release-ready; training-blocked",
    "Braid handoff crossed its training boundary");
  for (const field of ["trainingAuthorized", "awsUseAuthorized",
    "paidComputeAuthorized", "promotionAuthorized",
    "sealedTestAccessAuthorized"]) {
    requireValue(handoff.consumerContract?.[field] === false,
      `Braid handoff ${field} must be false`);
  }
  requireValue(!fs.existsSync(path.join(release, "data/test.jsonl")),
    "sealed test content is present in the C4.3 release");

  const declared = new Map(manifest.artifacts.map(item => [item.path, item]));
  requireValue(declared.size === manifest.artifacts.length,
    "release manifest contains duplicate artifact paths");
  for (const item of manifest.artifacts) {
    requireValue(typeof item.path === "string" && !path.isAbsolute(item.path) &&
      !item.path.split(/[\\/]/u).includes(".."),
    `invalid Braid artifact path: ${item.path}`);
    const file = path.join(release, item.path);
    requireValue(fs.existsSync(file), `Braid artifact is missing: ${item.path}`);
    requireSame(fs.statSync(file).size, item.bytes,
      `${item.path} byte count`);
    requireSame(sha256File(file), item.sha256, `${item.path} hash`);
    requireSame(handoff.artifacts?.[item.path], item.sha256,
      `${item.path} handoff hash`);
  }
  requireValue(Object.keys(handoff.artifacts ?? {}).length === declared.size,
    "handoff artifact set differs from the release manifest");
  requireSame(sha256File(path.join(release, "reports/data-report.json")),
    manifest.dataReportHash, "data-report hash");
  requireSame(sha256File(path.join(release, "reports/training-report.json")),
    manifest.trainingReportHash, "training-report hash");

  requireSame(handoff.training.contextTokens, proposal.fixed_model.context,
    "training context");
  requireSame(handoff.training.vocabularySize,
    proposal.fixed_model.vocabulary, "training vocabulary");
  requireSame(handoff.training.seed, proposal.initialization.seed,
    "training seed");
  requireSame(handoff.training.initialization,
    proposal.initialization.source, "training initialization");
  requireValue(handoff.training.pairAtomicUpdates === true &&
    trainingReport.pairAtomic === true &&
    trainingReport.pairAtomicFailures === 0,
  "C4.3 pair-atomic training changed");
  requireSame(trainingReport.computeTokenExposures,
    proposal.training_proposal.primary_compute_token_exposures,
  "primary compute exposure");
  requireValue(trainingReport.wraps === 0 && handoff.training.wraps === 0,
    "C4.3 release contains data wraps");
  requireValue(pilotContract.data === "development slice only" &&
    pilotContract.frozenValidationOpened === false &&
    pilotContract.sealedTestOpened === false &&
    pilotContract.promotional === false &&
    pilotContract.primaryStartsFromPilot === false,
  "C4.3 pilot crossed its preregistered boundary");
  requireValue(pilotContract.variants.length >= 1 &&
    pilotContract.variants.length <=
      proposal.training_proposal.pilot.weight_variants_maximum,
  "C4.3 pilot variant count changed");
  requireValue(trainingReport.development.optimizerGroups <=
    pilotContract.maximumOptimizerGroups &&
    pilotContract.maximumOptimizerGroups ===
      proposal.training_proposal.pilot.maximum_optimizer_groups,
  "C4.3 development pilot exceeds its group ceiling");

  const raw = dataReport.answerTargets.rawTokensByTask;
  const band = dataReport.answerTargets.clozeBands;
  const claim = dataReport.orientation.claim;
  const retrieval = dataReport.retrieval;
  const overlap = dataReport.overlap;
  const report = {
    schema: "braid.zero5_c43_release_report.v1",
    release: {
      status: "released", id: manifest.releaseId,
      source_commit: handoff.sourceCommit,
      manifest_sha256: manifestSha256,
      membership_digest: manifest.membershipDigest,
      pack_plan_sha256: manifest.packPlanHash,
      tokenizer_sha256: manifest.tokenizer.sha256,
      marker_free: dataReport.serializerLeakage.passed,
      context: handoff.training.contextTokens,
    },
    artifacts: manifest.artifacts.map(item => ({
      kind: artifactKind(item.path), path: item.path,
      sha256: item.sha256, bytes: item.bytes,
    })),
    primary: {
      compute_token_exposures: trainingReport.computeTokenExposures,
      wraps: trainingReport.wraps,
      answer_targets: { ...raw, total: dataReport.answerTargets.totalRawTokens },
      cloze: {
        length_band_target_tokens: Object.fromEntries(Object.entries(band)
          .map(([name, value]) => [name, value.answerTokens])),
        maximum_derived_per_source_record:
          dataReport.clozeDuplicates.maximumDerivedPerSourceRecord,
        source_documents: dataReport.clozeDuplicates.sourceRecords,
        maximum_source_share: dataReport.clozeDuplicates.largestSourceShare,
        answer_leakage_records:
          dataReport.clozeDuplicates.answerLeakageRecords,
      },
      retrieval: {
        pairs: retrieval.logicalPairs,
        negative_type_counts: retrieval.negativeTypes,
        answer_span_shortcut_audit_passed:
          retrieval.answerOnlyShortcutAudit.passed &&
          retrieval.answerRoleMultiset.identical,
      },
      mirroring: {
        claim: {
          pairs: claim.first,
          orientation_records: claim.first + claim.second,
          position_0_records: claim.first,
          position_1_records: claim.second,
          missing_orientations: 0,
          group_violations: trainingReport.pairAtomicFailures,
        },
        retrieval: {
          pairs: retrieval.logicalPairs,
          orientation_records: retrieval.records,
          position_0_records: retrieval.correctPosition.first,
          position_1_records: retrieval.correctPosition.second,
          missing_orientations: 0,
          group_violations: trainingReport.pairAtomicFailures,
        },
      },
    },
    development: {
      records: dataReport.counts.developmentRecords,
      overlap: {
        training: { record: overlap.developmentTrainRecordIds,
          normalized_text: overlap.developmentTrainNormalizedText,
          source_document: overlap.developmentTrainSourceDocuments },
        validation: { record: 0,
          normalized_text: overlap.developmentValidationNormalizedText,
          source_document: overlap.developmentValidationSourceDocuments },
        test: { record: 0, normalized_text: 0, source_document: 0 },
      },
    },
    governance: {
      provenance_complete: true,
      attribution_complete: true,
      rights_record_present: declared.has("RIGHTS.md"),
      artifact_hashes_complete: true,
      machine_readable_task_report_present:
        declared.has("reports/data-report.json") &&
        declared.has("reports/training-report.json"),
    },
    test: {
      records: handoff.sealedTest.records,
      bytes: handoff.sealedTest.bytes,
      sha256: handoff.sealedTest.sha256,
      content_present: false, parsed: false, tokenized: false,
      packed: false, scored: false, metrics_opened: false,
    },
  };
  return { release, handoff, manifest, dataReport, trainingReport,
    pilotContract, report };
}

export function writeJsonExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
}

function validateSealedTest(test, proposal, label) {
  requireValue(test && typeof test === "object", `${label} is missing`);
  requireValue(test.sha256 === proposal.test.sha256,
    `${label} hash changed`);
  for (const field of ["content_present", "parsed", "tokenized", "packed",
    "scored", "metrics_opened"]) {
    requireValue(test[field] === false, `${label}.${field} must be false`);
  }
}

function validateArtifacts(artifacts, baseDirectory) {
  requireValue(Array.isArray(artifacts) && artifacts.length >= 2,
    "release artifacts are missing");
  const kinds = new Set();
  const paths = new Set();
  const realBase = fs.realpathSync(baseDirectory);
  for (const artifact of artifacts) {
    requireValue(typeof artifact.kind === "string" && artifact.kind.length > 0,
      "artifact kind is missing");
    requireValue(!kinds.has(artifact.kind),
      `duplicate artifact kind: ${artifact.kind}`);
    kinds.add(artifact.kind);
    digest(artifact.sha256, `${artifact.kind} artifact hash`);
    integer(artifact.bytes, `${artifact.kind} artifact bytes`, 1);
    requireValue(typeof artifact.path === "string" && artifact.path.length > 0,
      `${artifact.kind} artifact path is missing`);
    requireValue(!path.isAbsolute(artifact.path) &&
      !artifact.path.split(/[\\/]/u).includes(".."),
    `${artifact.kind} artifact path must stay inside the release`);
    requireValue(!paths.has(artifact.path),
      `duplicate artifact path: ${artifact.path}`);
    paths.add(artifact.path);
    const file = path.resolve(baseDirectory, artifact.path);
    requireValue(fs.existsSync(file), `${artifact.kind} artifact is missing`);
    const realFile = fs.realpathSync(file);
    requireValue(realFile.startsWith(realBase + path.sep),
      `${artifact.kind} artifact resolves outside the release`);
    requireValue(fs.statSync(file).size === artifact.bytes,
      `${artifact.kind} artifact byte count changed`);
    requireValue(sha256File(file) === artifact.sha256,
      `${artifact.kind} artifact hash changed`);
  }
  requireValue(kinds.has("train") && kinds.has("development"),
    "train and development artifacts are required");
}

export function validateReleaseReport(report, proposal, c42Contract,
  baseDirectory, { verifyArtifacts = true } = {}) {
  requireValue(report.schema === "braid.zero5_c43_release_report.v1",
    "unexpected C4.3 release report schema");
  requireValue(report.release?.status === "released",
    "Braid C4.3 release is not released");
  requireValue(typeof report.release.id === "string" &&
    report.release.id.includes("four-three"), "unexpected C4.3 release ID");
  commit(report.release.source_commit, "Braid source commit");
  for (const field of ["manifest_sha256", "membership_digest",
    "pack_plan_sha256", "tokenizer_sha256"]) {
    digest(report.release[field], `release ${field}`);
  }
  requireValue(report.release.tokenizer_sha256 ===
    proposal.fixed_model.tokenizer_sha256, "tokenizer changed from C4.2");
  requireValue(report.release.marker_free === true,
    "C4.3 release is not marker-free");
  requireValue(report.release.context === proposal.fixed_model.context,
    "C4.3 context changed");

  if (verifyArtifacts) validateArtifacts(report.artifacts, baseDirectory);

  const primary = report.primary;
  requireValue(primary && typeof primary === "object",
    "primary training report is missing");
  requireValue(primary.compute_token_exposures ===
    proposal.training_proposal.primary_compute_token_exposures,
  "primary compute exposure changed");
  requireValue(primary.wraps === 0, "primary release has data wraps");

  const answerTargets = primary.answer_targets;
  let answerTotal = 0;
  for (const task of TASKS) {
    integer(answerTargets?.[task], `${task} answer targets`, 1);
    answerTotal += answerTargets[task];
  }
  requireValue(answerTargets.total === answerTotal,
    "answer target total does not match task counts");
  const clozeRequest = proposal.braid_request.cloze;
  requireValue(answerTargets.cloze >= clozeRequest.answer_target_tokens_minimum,
    "cloze answer-target coverage is below the C4.3 minimum");
  requireValue(answerTargets.cloze / answerTotal >=
    clozeRequest.answer_target_share_minimum,
  "cloze answer-target share is below the C4.3 minimum");

  const cloze = primary.cloze;
  const bandCounts = cloze?.length_band_target_tokens;
  let bandTotal = 0;
  for (const band of clozeRequest.length_bands) {
    integer(bandCounts?.[band], `cloze ${band} target tokens`);
    bandTotal += bandCounts[band];
  }
  requireValue(bandTotal === answerTargets.cloze,
    "cloze length bands do not sum to cloze answer targets");
  integer(cloze.maximum_derived_per_source_record,
    "cloze maximum derived records per source", 1);
  requireValue(cloze.maximum_derived_per_source_record <= 1,
    "cloze release derives more than one record per source record");
  integer(cloze.source_documents, "cloze source documents", 2);
  unit(cloze.maximum_source_share, "cloze maximum source share");
  requireValue(cloze.maximum_source_share < 1,
    "all cloze coverage comes from one source");
  integer(cloze.answer_leakage_records, "cloze answer leakage records");
  requireValue(cloze.answer_leakage_records === 0,
    "some cloze answers leak into the model-facing context");

  const retrieval = primary.retrieval;
  integer(retrieval?.pairs, "retrieval pairs", 1);
  const negativeRequest = proposal.braid_request.retrieval;
  for (const type of negativeRequest.negative_types_required) {
    const count = retrieval.negative_type_counts?.[type];
    integer(count, `${type} retrieval negatives`, 1);
    requireValue(count / retrieval.pairs <=
      negativeRequest.negative_type_share_maximum,
    `${type} retrieval-negative share exceeds the maximum`);
  }
  requireValue(retrieval.negative_type_counts["lexical-confounder"] /
    retrieval.pairs >= negativeRequest.lexical_confounder_share_minimum,
  "lexical-confounder retrieval share is below the minimum");
  requireValue(retrieval.answer_span_shortcut_audit_passed === true,
    "retrieval answer-span shortcut audit did not pass");

  for (const task of MIRRORED_TASKS) {
    const mirrored = primary.mirroring?.[task];
    integer(mirrored?.pairs, `${task} mirrored pairs`, 1);
    requireValue(mirrored.orientation_records === 2 * mirrored.pairs,
      `${task} mirrored orientations are incomplete`);
    requireValue(mirrored.position_0_records + mirrored.position_1_records ===
      mirrored.orientation_records,
    `${task} position counts do not match orientation records`);
    requireValue(Math.abs(mirrored.position_0_records -
      mirrored.position_1_records) <=
      proposal.braid_request.mirroring.maximum_position_count_difference,
    `${task} answer positions are imbalanced`);
    requireValue(mirrored.missing_orientations === 0,
      `${task} has missing mirrored orientations`);
    requireValue(mirrored.group_violations === 0,
      `${task} mirrored pairs cross optimizer groups`);
  }
  requireValue(primary.mirroring.retrieval.pairs === retrieval.pairs,
    "retrieval pair counts disagree");

  integer(report.development?.records, "development records", 1);
  for (const split of ["training", "validation", "test"]) {
    const overlap = report.development.overlap?.[split];
    for (const field of ["record", "normalized_text", "source_document"]) {
      integer(overlap?.[field], `development/${split} ${field} overlap`);
      requireValue(overlap[field] === 0,
        `development has ${field} overlap with ${split}`);
    }
  }

  for (const field of ["provenance_complete", "attribution_complete",
    "rights_record_present", "artifact_hashes_complete",
    "machine_readable_task_report_present"]) {
    requireValue(report.governance?.[field] === true,
      `governance check failed: ${field}`);
  }
  validateSealedTest(report.test, proposal, "release test policy");
  requireValue(report.test.records === c42Contract.test.records &&
    report.test.bytes === c42Contract.test.bytes,
  "sealed test identity changed");

  return {
    release_id: report.release.id,
    source_commit: report.release.source_commit,
    answer_targets: answerTargets,
    compute_token_exposures: primary.compute_token_exposures,
    test_metrics_opened: false,
  };
}

function validateImportReceipt(receipt, report, proposal, c42Contract) {
  requireValue(receipt.schema === "zero.c43_import_receipt.v1",
    "unexpected C4.3 import receipt schema");
  requireValue(typeof receipt.import_id === "string" &&
    receipt.import_id.length > 0, "import ID is missing");
  requireValue(receipt.release?.id === report.release.id,
    "import release ID does not match Braid report");
  requireValue(receipt.release.source_commit === report.release.source_commit,
    "import source commit does not match Braid report");
  requireValue(receipt.release.manifest_sha256 ===
    report.release.manifest_sha256,
  "import manifest does not match Braid report");
  requireValue(receipt.release.membership_digest ===
    report.release.membership_digest,
  "import membership does not match Braid report");
  requireValue(receipt.release.pack_plan_sha256 ===
    report.release.pack_plan_sha256,
  "import pack plan does not match Braid report");

  const primary = receipt.outputs?.primary;
  digest(primary?.sha256, "primary import hash");
  integer(primary.bytes, "primary import bytes", 1);
  integer(primary.packs, "primary import packs", 1);
  integer(primary.update_groups, "primary import update groups", 1);
  requireValue(primary.compute_token_exposures ===
    proposal.training_proposal.primary_compute_token_exposures,
  "import compute exposure changed");
  requireValue(primary.wraps === 0, "import receipt records data wraps");
  requireValue(jsonEqual(primary.answer_targets,
    report.primary.answer_targets),
  "import answer targets do not match Braid report");

  const development = receipt.outputs.development;
  digest(development?.sha256, "development import hash");
  integer(development.bytes, "development import bytes", 1);
  requireValue(development.records === report.development.records,
    "development import record count changed");

  const frozen = receipt.outputs.frozen_validation;
  const expected = {
    combined_sha256: c42Contract.verified_import.validation_packs.sha256,
    claim_span_choices_sha256:
      c42Contract.verified_import.evaluation_artifacts
        .claim_span_choices.sha256,
    retrieval_span_choices_sha256:
      c42Contract.verified_import.evaluation_artifacts
        .retrieval_span_choices.sha256,
    cloze_completion_sha256:
      c42Contract.verified_import.evaluation_artifacts
        .cloze_completion.sha256,
    evidence_validation_sha256:
      c42Contract.verified_import.evaluation_artifacts
        .evidence_validation.sha256,
  };
  requireValue(jsonEqual(frozen, expected),
    "frozen C4.2 validation identities changed");
  validateSealedTest(receipt.test, proposal, "import test policy");
  return receipt;
}

export function validateImportPair(first, second, report, proposal,
  c42Contract) {
  validateImportReceipt(first, report, proposal, c42Contract);
  validateImportReceipt(second, report, proposal, c42Contract);
  requireValue(first.import_id !== second.import_id,
    "deterministic imports must have distinct import IDs");
  requireValue(jsonEqual(first.outputs, second.outputs),
    "independent C4.3 imports produced different outputs");
  return {
    first_import_id: first.import_id,
    second_import_id: second.import_id,
    primary: first.outputs.primary,
    development: first.outputs.development,
    frozen_validation: first.outputs.frozen_validation,
    deterministic: true,
  };
}

export function validateAnswerWeights(weights, answerTargets, proposal) {
  const masses = {};
  for (const task of TASKS) {
    requireValue(Number.isFinite(weights?.[task]) && weights[task] > 0 &&
      weights[task] <= proposal.training_proposal.answer_weight_maximum,
    `${task} answer weight is outside the C4.3 bounds`);
    masses[task] = weights[task] * answerTargets[task];
  }
  const values = Object.values(masses);
  const gap = Math.max(...values) / Math.min(...values) - 1;
  requireValue(gap <=
    proposal.training_proposal.weighted_task_mass_gap_maximum,
  "weighted task mass gap exceeds the C4.3 maximum");
  return { masses, gap };
}

export function validatePilotVariant(variant, report, imports, proposal) {
  requireValue(variant.schema === "zero.c43_pilot_variant_result.v1",
    "unexpected C4.3 pilot variant schema");
  requireValue(variant.experiment === proposal.experiment,
    "pilot experiment changed");
  requireValue(typeof variant.variant === "string" &&
    variant.variant.length > 0, "pilot variant ID is missing");
  requireValue(variant.status === "complete",
    `${variant.variant} pilot is incomplete`);
  requireValue(variant.release_id === report.release.id,
    `${variant.variant} release ID changed`);
  requireValue(variant.primary_import_sha256 === imports.primary.sha256,
    `${variant.variant} primary import changed`);
  requireValue(variant.initial_checkpoint_sha256 ===
    proposal.initialization.checkpoint_sha256,
  `${variant.variant} initialization changed`);
  requireValue(variant.data_split === "development",
    `${variant.variant} did not use development data only`);
  integer(variant.optimizer_groups, `${variant.variant} optimizer groups`, 1);
  requireValue(variant.optimizer_groups <=
    proposal.training_proposal.pilot.maximum_optimizer_groups,
  `${variant.variant} exceeded the pilot optimizer-group limit`);
  requireValue(variant.frozen_validation_scored === false,
    `${variant.variant} opened frozen validation during pilot selection`);
  requireValue(variant.test_metrics_opened === false,
    `${variant.variant} opened sealed test metrics`);
  requireValue(variant.promotion_eligible === false,
    `${variant.variant} pilot cannot be promotion eligible`);
  validateAnswerWeights(variant.answer_weights,
    report.primary.answer_targets, proposal);

  const baseline = variant.metrics?.baseline;
  const candidate = variant.metrics?.candidate;
  unit(baseline?.claim_choice_accuracy,
    `${variant.variant} development baseline claim choice`);
  for (const metric of ["cloze_exact_accuracy", "retrieval_choice_accuracy",
    "claim_choice_accuracy"]) {
    unit(candidate?.[metric], `${variant.variant} ${metric}`);
  }
  requireValue(candidate.claim_choice_accuracy >=
    baseline.claim_choice_accuracy,
  `${variant.variant} regressed development claim choice`);
  return variant;
}

export function selectPilotVariants(entries, report, imports, proposal) {
  requireValue(entries.length >= 1 && entries.length <=
    proposal.training_proposal.pilot.weight_variants_maximum,
  "pilot must contain one or two weight variants");
  const seen = new Set();
  const validated = entries.map(entry => {
    validatePilotVariant(entry.value, report, imports, proposal);
    requireValue(!seen.has(entry.value.variant),
      `duplicate pilot variant: ${entry.value.variant}`);
    seen.add(entry.value.variant);
    digest(entry.sha256, `${entry.value.variant} result hash`);
    return entry;
  });
  validated.sort((left, right) => {
    const a = left.value.metrics.candidate;
    const b = right.value.metrics.candidate;
    return b.cloze_exact_accuracy - a.cloze_exact_accuracy ||
      b.retrieval_choice_accuracy - a.retrieval_choice_accuracy ||
      b.claim_choice_accuracy - a.claim_choice_accuracy ||
      left.value.variant.localeCompare(right.value.variant);
  });
  const selected = validated[0];
  return {
    schema: "zero.c43_pilot_selection.v1",
    experiment: proposal.experiment,
    status: "complete-non-promotional",
    release_id: report.release.id,
    primary_import_sha256: imports.primary.sha256,
    variants: validated.map(entry => ({
      variant: entry.value.variant,
      result_sha256: entry.sha256,
      answer_weights: entry.value.answer_weights,
      metrics: entry.value.metrics,
    })),
    selected: {
      variant: selected.value.variant,
      result_sha256: selected.sha256,
      answer_weights: selected.value.answer_weights,
      metrics: selected.value.metrics,
    },
    selection_order: [
      "development cloze exact accuracy descending",
      "development retrieval choice accuracy descending",
      "development claim choice accuracy descending",
      "variant ID ascending",
    ],
    frozen_validation_scored: false,
    test_metrics_opened: false,
    promotion_eligible: false,
    paid_compute_authorized: false,
  };
}

export function validatePilotSelection(selection, report, imports, proposal) {
  requireValue(selection.schema === "zero.c43_pilot_selection.v1",
    "unexpected C4.3 pilot selection schema");
  requireValue(selection.experiment === proposal.experiment &&
    selection.release_id === report.release.id,
  "pilot selection identity changed");
  requireValue(selection.primary_import_sha256 === imports.primary.sha256,
    "pilot selection import changed");
  requireValue(selection.status === "complete-non-promotional" &&
    selection.promotion_eligible === false &&
    selection.paid_compute_authorized === false,
  "pilot selection crossed its authorization boundary");
  requireValue(selection.frozen_validation_scored === false &&
    selection.test_metrics_opened === false,
  "pilot selection opened protected evaluation data");
  requireValue(Array.isArray(selection.variants) &&
    selection.variants.length >= 1 && selection.variants.length <=
      proposal.training_proposal.pilot.weight_variants_maximum,
  "pilot selection has an invalid variant count");
  const matchingVariant = selection.variants.find(variant =>
    variant.variant === selection.selected?.variant &&
    variant.result_sha256 === selection.selected?.result_sha256);
  requireValue(matchingVariant !== undefined,
    "selected pilot variant is not present in the result set");
  requireValue(jsonEqual(matchingVariant.answer_weights,
    selection.selected.answer_weights) &&
    jsonEqual(matchingVariant.metrics, selection.selected.metrics),
  "selected pilot data differs from its result-set entry");
  for (const variant of selection.variants) {
    digest(variant.result_sha256, `${variant.variant} selected result hash`);
  }
  validateAnswerWeights(selection.selected?.answer_weights,
    report.primary.answer_targets, proposal);
  return selection;
}

export function buildContractCandidate({ proposal, proposalSha256, report,
  reportSha256, imports, firstImportSha256, secondImportSha256,
  pilotSelection, pilotSelectionSha256 }) {
  validatePilotSelection(pilotSelection, report, imports, proposal);
  for (const [label, value] of Object.entries({ proposalSha256, reportSha256,
    firstImportSha256, secondImportSha256, pilotSelectionSha256 })) {
    digest(value, label);
  }
  return {
    schema: "zero.c43_experiment_contract_candidate.v1",
    experiment: proposal.experiment,
    status: "blocked-pending-final-review-and-compute-approval",
    authorized: false,
    source_proposal_sha256: proposalSha256,
    braid: {
      release_id: report.release.id,
      source_commit: report.release.source_commit,
      manifest_sha256: report.release.manifest_sha256,
      membership_digest: report.release.membership_digest,
      pack_plan_sha256: report.release.pack_plan_sha256,
      report_sha256: reportSha256,
    },
    verified_import: {
      deterministic: true,
      first_receipt_sha256: firstImportSha256,
      second_receipt_sha256: secondImportSha256,
      primary: imports.primary,
      development: imports.development,
      frozen_validation: imports.frozen_validation,
    },
    model: proposal.fixed_model,
    initialization: proposal.initialization,
    training: {
      compute_token_exposures: imports.primary.compute_token_exposures,
      update_groups: imports.primary.update_groups,
      zero_wraps_required: true,
      pair_atomic_updates: true,
      answer_weights: pilotSelection.selected.answer_weights,
      paid_compute_authorized: false,
      cost_ceiling_usd: null,
    },
    pilot: {
      selection_sha256: pilotSelectionSha256,
      selected_variant: pilotSelection.selected.variant,
      promotion_eligible: false,
      frozen_validation_scored: false,
      test_metrics_opened: false,
    },
    evaluation: proposal.evaluation,
    gates: proposal.gates,
    test: proposal.test,
    blockers: [
      "freeze final importer, evaluator, runner, and artifact hashes",
      "freeze runtime venue and maximum instance time",
      "approve an explicit paid-compute cost ceiling",
      "merge the final executable contract before launch",
    ],
  };
}

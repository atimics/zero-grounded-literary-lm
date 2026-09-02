import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/reasoner42-abstraction-library-v1";
const resultBytes = fs.readFileSync(`${directory}/RESULT.json`);
const result = JSON.parse(resultBytes);
const report = fs.readFileSync(`${directory}/RESULT.md`, "utf8");
const normalizedReport = report.replace(/\s+/g, " ");
const contractBytes = fs.readFileSync(`${directory}/contract.json`);
const contract = JSON.parse(contractBytes);
const provenance = JSON.parse(
  fs.readFileSync(`${directory}/CLOUD_PROVENANCE.json`, "utf8"),
);

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner 4.2 result: ${message}`);
}

function exactEvaluation(
  evaluation,
  targets,
  episodes,
  queries,
  replays,
  applications,
) {
  return (
    evaluation.target_programs === targets &&
    evaluation.episodes === episodes &&
    evaluation.demonstrations === episodes &&
    evaluation.queries === queries &&
    evaluation.exact_queries === queries &&
    evaluation.identifications === episodes &&
    evaluation.exact_identifications === episodes &&
    evaluation.commits === episodes &&
    evaluation.exact_commits === episodes &&
    evaluation.premature_commits === 0 &&
    evaluation.replay_checks === replays &&
    evaluation.exact_replays === replays &&
    evaluation.applications === applications &&
    evaluation.exact_applications === applications &&
    evaluation.reports === episodes &&
    evaluation.exact_reports === episodes &&
    evaluation.maximum_queries <= 1 &&
    evaluation.exact === true
  );
}

const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
requireValue(
  sha256(resultBytes) ===
    "04abc43c23f26db5114e085906395c508497562ec8b3d90b7da04676a85f47ee",
  "raw result hash",
);
requireValue(
  sha256(contractBytes) ===
    "373740c1a2bd305e5f57b5b1d6ff0d5d87a6b47d47311e4f544cf14f95a82a6b",
  "executed contract hash",
);
requireValue(result.schema === "zero.reasoner42_abstraction_library.v1", "schema");
requireValue(result.version === "4.2", "version");
requireValue(result.frozen_base_programs === 170, "frozen base census");
requireValue(result.learned_library_entries === 3, "library size");
requireValue(result.learned_library_definition_tokens === 6, "definition tokens");
requireValue(result.learned_library_occurrences === 9, "library occurrences");
requireValue(result.learned_library_mdl_gain === 3, "library MDL gain");
requireValue(result.planned_sealed_raw_programs === 820, "library search census");
requireValue(
  result.planned_sealed_base_raw_programs === 55987,
  "base search census",
);
requireValue(result.sealed_library_tokens === 51, "sealed library tokens");
requireValue(result.sealed_base_tokens === 102, "sealed base tokens");
for (const name of [
  "frozen_base_certificate_passed",
  "affine_certificate_passed",
  "library_discovery_certificate_passed",
  "library_freeze_certificate_passed",
  "compression_certificate_passed",
  "search_budget_certificate_passed",
  "semantic_oracle_control_passed",
  "no_library_control_passed",
  "shuffled_curriculum_control_passed",
  "single_use_library_control_passed",
  "curriculum_lookup_control_passed",
  "no_query_control_passed",
  "sealed_minimum_certificate_passed",
  "development_gate_passed",
  "sealed_gate_passed",
  "sealed_execution_locked",
]) {
  requireValue(result[name] === true, name);
}
requireValue(result.library_digest === "3cf6bb033d68d2a3", "library digest");
requireValue(result.result_digest === "77c0a177ce2ba04f", "result digest");
requireValue(exactEvaluation(result.curriculum, 9, 9, 6, 729, 27), "curriculum");
requireValue(
  exactEvaluation(result.development, 7, 14, 6, 1134, 42),
  "development",
);
requireValue(exactEvaluation(result.sealed, 17, 34, 14, 2754, 102), "sealed");

requireValue(contract.authorized === true, "execution authorization");
requireValue(contract.execution.retry === false, "no retry");
requireValue(contract.execution.maximum_instance_seconds === 2400, "time cap");
requireValue(contract.execution.maximum_ec2_usd === 0.007, "EC2 cap");
requireValue(contract.execution.maximum_total_run_usd === 0.01, "total cap");
requireValue(
  provenance.run_id === "reasoner42-20260902t030000z",
  "provenance run",
);
requireValue(provenance.instance_id === "i-0bb4aacea751e7b92", "instance");
requireValue(provenance.instance_state === "terminated", "termination");
requireValue(provenance.execution.attempts === 1, "single attempt");
requireValue(provenance.execution.retry === false, "provenance no retry");
requireValue(
  provenance.execution.tuning_after_seal === false,
  "no post-seal tuning",
);
requireValue(provenance.execution.elapsed_instance_seconds === 198, "runtime");
requireValue(provenance.execution.estimated_ec2_usd === 0.000572, "cost");
requireValue(
  provenance.source.sha256 === contract.source.bundle_sha256 &&
    provenance.source.bundle_bytes === contract.source.bundle_bytes,
  "source provenance",
);
requireValue(
  provenance.contract_sha256 === sha256(contractBytes),
  "contract provenance",
);
requireValue(
  provenance.artifacts.result.sha256 === sha256(resultBytes) &&
    provenance.artifacts.result.bytes === resultBytes.length,
  "result provenance",
);
requireValue(provenance.scientific_result.gate_passed === true, "published pass");
requireValue(provenance.scientific_result.episodes === 34, "published episodes");
requireValue(provenance.scientific_result.exact_replays === 2754, "published replays");

for (const evidence of [
  "reasoner42-20260902t030000z",
  "i-0bb4aacea751e7b92` (terminated)",
  "61,608 bytes",
  "198 instance-seconds",
  "$0.000572000000",
  "All 34 fresh episodes passed",
  "2,754 affine certificate replays",
  "55,987 raw six-operation programs",
  "this was the only attempt",
  "no post-seal tuning",
]) {
  requireValue(normalizedReport.includes(evidence), `report evidence ${evidence}`);
}

console.log("Reasoner 4.2 sealed result passed");

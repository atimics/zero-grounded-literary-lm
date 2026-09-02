import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/reasoner41-joint-transfer-v1";
const resultBytes = fs.readFileSync(`${directory}/RESULT.json`);
const result = JSON.parse(resultBytes);
const report = fs.readFileSync(`${directory}/RESULT.md`, "utf8");
const contractBytes = fs.readFileSync(`${directory}/contract.json`);
const contract = JSON.parse(contractBytes);

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner 4.1 result: ${message}`);
}

function exactEvaluation(
  evaluation,
  episodes,
  adapters,
  laws,
  pairs,
  adapterQueries,
  replayChecks,
  lawQueries,
  actions,
  maximumLawQueries,
) {
  return (
    evaluation.episodes === episodes &&
    evaluation.target_adapters === adapters &&
    evaluation.target_laws === laws &&
    evaluation.target_pairs === pairs &&
    evaluation.alignment_demonstrations === episodes &&
    evaluation.adapter_queries === adapterQueries &&
    evaluation.exact_adapter_queries === adapterQueries &&
    evaluation.adapter_identifications === episodes &&
    evaluation.exact_adapter_identifications === episodes &&
    evaluation.adapter_commits === episodes &&
    evaluation.exact_adapter_commits === episodes &&
    evaluation.premature_adapter_commits === 0 &&
    evaluation.replay_checks === replayChecks &&
    evaluation.exact_replays === replayChecks &&
    evaluation.law_demonstrations === episodes * 2 &&
    evaluation.law_queries === lawQueries &&
    evaluation.exact_law_queries === lawQueries &&
    evaluation.law_identifications === episodes &&
    evaluation.exact_law_identifications === episodes &&
    evaluation.law_commits === episodes &&
    evaluation.exact_law_commits === episodes &&
    evaluation.premature_law_commits === 0 &&
    evaluation.actions === actions &&
    evaluation.exact_actions === actions &&
    evaluation.commits === episodes &&
    evaluation.exact_commits === episodes &&
    evaluation.reports === episodes &&
    evaluation.exact_reports === episodes &&
    evaluation.premature_commits === 0 &&
    evaluation.maximum_adapter_queries <= 1 &&
    evaluation.maximum_law_queries <= maximumLawQueries &&
    evaluation.exact === true
  );
}

const resultSha256 = crypto.createHash("sha256").update(resultBytes).digest("hex");
const contractSha256 = crypto
  .createHash("sha256")
  .update(contractBytes)
  .digest("hex");
requireValue(
  resultSha256 ===
    "ef6cab0e8114ab635eeae37e6c7135edae919292b5edd7c6276b7e9739dec6b4",
  "raw result hash",
);
requireValue(
  contractSha256 ===
    "1798eb2b50840a3a05981f77e0ea6f7f4f1d82e96c5e94cf8dc4020476782499",
  "executed contract hash",
);
requireValue(result.schema === "zero.reasoner41_joint_transfer.v1", "schema");
requireValue(result.version === "4.1", "version");
requireValue(result.canonical_adapter_programs === 170, "adapter census");
requireValue(result.canonical_law_programs === 52, "law census");
requireValue(result.sealed_adapters === 134, "sealed adapter census");
requireValue(result.sealed_laws === 31, "sealed law census");
requireValue(result.planned_sealed_pairs === 4154, "planned pairs");
requireValue(result.planned_sealed_episodes === 33232, "planned episodes");
requireValue(result.frozen_representation_core_passed === true, "representation core");
requireValue(result.frozen_law_core_passed === true, "law core");
requireValue(result.separate_commit_certificate_passed === true, "separate commits");
requireValue(result.oracle_adapter_control_passed === true, "adapter oracle");
requireValue(result.oracle_law_control_passed === true, "law oracle");
for (const name of [
  "identity_adapter_control_passed",
  "curriculum_pair_control_passed",
  "no_adapter_query_control_passed",
  "no_law_query_control_passed",
  "shuffled_alignment_control_passed",
  "shuffled_law_feedback_control_passed",
]) {
  requireValue(result[name] === false, `${name} negative control`);
}
requireValue(result.development_gate_passed === true, "development gate");
requireValue(result.sealed_gate_passed === true, "sealed gate");
requireValue(result.sealed_execution_locked === true, "one-shot lock");
requireValue(result.result_digest === "8a85f4d640ca9785", "result digest");
requireValue(
  exactEvaluation(result.curriculum, 72, 6, 6, 36, 72, 20736, 180, 216, 4),
  "curriculum evaluation",
);
requireValue(
  exactEvaluation(
    result.development,
    3480,
    29,
    15,
    435,
    3480,
    1002240,
    13340,
    10440,
    5,
  ),
  "development evaluation",
);
requireValue(
  exactEvaluation(
    result.sealed,
    33232,
    134,
    31,
    4154,
    29512,
    9570816,
    132928,
    99696,
    5,
  ),
  "sealed evaluation",
);
requireValue(contract.authorized === true, "execution authorization");
requireValue(contract.execution.retry === false, "no retry");
requireValue(contract.execution.maximum_instance_seconds === 2400, "time cap");
requireValue(contract.execution.maximum_ec2_usd === 0.007, "EC2 cap");
for (const evidence of [
  "reasoner41-20260901t15431788277411z",
  "8a85f4d640ca9785",
  "1,236 instance-seconds",
  "$0.003570666667",
  "4,154 unseen adapter-law pairs",
  "9,570,816 raw-to-IR replays",
  "132,928 law queries",
  "99,696 actions",
  "no premature commits",
  "instance terminated",
]) {
  requireValue(report.includes(evidence), `report evidence ${evidence}`);
}

console.log("Reasoner 4.1 sealed result passed");

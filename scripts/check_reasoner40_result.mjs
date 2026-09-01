import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/reasoner40-active-representation-v1";
const resultPath = `${directory}/RESULT.json`;
const reportPath = `${directory}/RESULT.md`;
const contractPath = `${directory}/aws-contract.json`;
const resultBytes = fs.readFileSync(resultPath);
const result = JSON.parse(resultBytes);
const report = fs.readFileSync(reportPath, "utf8");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner 4.0 result: ${message}`);
}

function exactEvaluation(evaluation, episodes, adapters, replayChecks, actions) {
  return (
    evaluation.episodes === episodes &&
    evaluation.target_adapters === adapters &&
    evaluation.target_laws === 6 &&
    evaluation.adapter_queries === evaluation.exact_adapter_queries &&
    evaluation.adapter_identifications === episodes &&
    evaluation.exact_adapter_identifications === episodes &&
    evaluation.replay_checks === replayChecks &&
    evaluation.exact_replays === replayChecks &&
    evaluation.law_queries === evaluation.exact_law_queries &&
    evaluation.law_identifications === episodes &&
    evaluation.exact_law_identifications === episodes &&
    evaluation.actions === actions &&
    evaluation.exact_actions === actions &&
    evaluation.commits === episodes &&
    evaluation.exact_commits === episodes &&
    evaluation.reports === episodes &&
    evaluation.exact_reports === episodes &&
    evaluation.premature_commits === 0 &&
    evaluation.maximum_adapter_queries <= 1 &&
    evaluation.maximum_law_queries <= 2 &&
    evaluation.exact === true
  );
}

const resultSha256 = crypto.createHash("sha256").update(resultBytes).digest("hex");
requireValue(
  resultSha256 ===
    "fefbad874886301b02380bd5d9842bd17ab6c002a91f45e7b6e5fad11ab39fb2",
  "raw result hash",
);
requireValue(result.schema === "zero.reasoner40_active_representation.v1", "schema");
requireValue(result.version === "4.0", "version");
requireValue(result.raw_adapter_programs === 259, "raw adapter census");
requireValue(result.canonical_adapter_programs === 170, "adapter census");
requireValue(result.sealed_adapters === 134, "sealed adapter census");
requireValue(result.frozen_core_programs === 52, "frozen core census");
requireValue(result.familiar_laws === 6, "familiar law census");
requireValue(result.planned_sealed_episodes === 6432, "planned episodes");
requireValue(result.adapter_canonicalization_passed === true, "canonicalization");
requireValue(result.adapter_unique_minimum_passed === true, "unique minimum");
requireValue(result.adapter_grammar_certificate_passed === true, "grammar");
requireValue(result.frozen_core_certificate_passed === true, "frozen core");
requireValue(result.oracle_adapter_control_passed === true, "oracle control");
requireValue(result.identity_adapter_control_passed === false, "identity control");
requireValue(
  result.curriculum_lookup_control_passed === false,
  "curriculum lookup control",
);
requireValue(result.no_adapter_query_control_passed === false, "no-query control");
requireValue(
  result.shuffled_alignment_control_passed === false,
  "shuffled-alignment control",
);
requireValue(result.development_gate_passed === true, "development gate");
requireValue(result.sealed_gate_passed === true, "sealed gate");
requireValue(result.sealed_execution_locked === true, "one-shot lock");
requireValue(result.result_digest === "f29ed90fe597daa8", "result digest");
requireValue(
  exactEvaluation(result.curriculum, 72, 6, 20736, 216),
  "curriculum evaluation",
);
requireValue(
  exactEvaluation(result.development, 1392, 29, 400896, 4176),
  "development evaluation",
);
requireValue(
  exactEvaluation(result.sealed, 6432, 134, 1852416, 19296),
  "sealed evaluation",
);
requireValue(contract.authorized === true, "execution authorization");
requireValue(contract.execution.retry === false, "no retry");
for (const evidence of [
  "f29ed90fe597daa8",
  "327 instance-seconds",
  "$0.000944666667",
  "1,852,416 raw-to-IR replays",
  "19,296",
  "no premature",
]) {
  requireValue(report.includes(evidence), `report evidence ${evidence}`);
}

console.log("Reasoner 4.0 sealed result passed");

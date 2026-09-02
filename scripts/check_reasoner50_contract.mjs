import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const directory = "benchmarks/reasoner50-residual-transfer-v1";
const contract = JSON.parse(readFileSync(`${directory}/contract.json`, "utf8"));
const preregistration = readFileSync(`${directory}/PREREGISTRATION.md`, "utf8");
const normalizedPreregistration = preregistration.replace(/\s+/g, " ");

function requireValue(condition, label) {
  if (!condition) throw new Error(`Reasoner 5.0 contract mismatch: ${label}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

requireValue(
  contract.schema === "zero.reasoner50_residual_transfer_contract.v1",
  "schema",
);
requireValue(contract.experiment === "reasoner50-residual-transfer-v1", "experiment");
requireValue(contract.version === "5.0", "version");
requireValue(contract.status === "preregistered-unopened", "status");
requireValue(contract.authorization.authorized === true, "authorization");
requireValue(contract.authorization.scope.includes("local"), "local scope");
requireValue(contract.execution.cloud_resources === false, "no cloud authority");
requireValue(contract.execution.scientific_executions === 1, "one execution");
requireValue(contract.execution.scientific_retries === 0, "no retry");
requireValue(contract.execution.maximum_seconds === 300, "time cap");
requireValue(contract.execution.tuning_after_open === false, "no tuning");
requireValue(
  sha256("benchmarks/reasoner42-abstraction-library-v1/RESULT.json") ===
    contract.frozen_base.result_sha256,
  "frozen Reasoner 4.2 result",
);
requireValue(contract.frozen_base.library_digest === "3cf6bb033d68d2a3", "library");
requireValue(contract.interface.integer_only === true, "integer interface");
requireValue(contract.interface.feature_slots === 92, "feature count");
requireValue(
  contract.interface.training_and_execution_share_one_score_function === true,
  "deployment-exact scorer",
);
requireValue(contract.interface.ranker_can_authorize_commit === false, "ranker authority");
requireValue(
  contract.interface.exact_affine_verifier_is_authoritative === true,
  "verifier authority",
);
requireValue(contract.source.target_programs === 7, "source programs");
requireValue(
  contract.source.artifact_must_be_frozen_before_target_calibration === true,
  "artifact freeze",
);
requireValue(contract.target.target_programs === 17, "target census");
requireValue(contract.target.calibration_programs === 5, "calibration census");
requireValue(contract.target.held_out_programs === 12, "held-out census");
requireValue(contract.target.held_out_episodes === 24, "episode census");
requireValue(contract.target.raw_candidate_programs === 820, "raw candidates");
requireValue(contract.ranking.maximum_expansions_per_episode === 128, "budget");
requireValue(
  contract.gate.full_expansions_at_most_fraction_of_target_only === 0.8,
  "transfer effect",
);
requireValue(
  contract.gate.full_model_individual_wins_over_target_only_at_least === 12,
  "individual wins",
);
requireValue(contract.gate.oracle_expansions_per_episode === 1, "oracle");
requireValue(Object.keys(contract.controls).length === 7, "controls");
requireValue(contract.non_claims.length === 5, "non-claims");

for (const evidence of [
  "92 signed integer fields",
  "five lowest digests",
  "24 episodes",
  "128 exact candidate expansions",
  "no scientific retry",
  "pass or no-go",
]) {
  requireValue(
    normalizedPreregistration.includes(evidence),
    `preregistration ${evidence}`,
  );
}

console.log("Reasoner 5.0 prospective contract passed");

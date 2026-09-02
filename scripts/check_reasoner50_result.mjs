import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const directory = "benchmarks/reasoner50-residual-transfer-v1";
const resultBytes = readFileSync(`${directory}/RESULT.json`);
const result = JSON.parse(resultBytes);
const executionBytes = readFileSync(`${directory}/EXECUTION.json`);
const execution = JSON.parse(executionBytes);
const contractBytes = readFileSync(`${directory}/contract.json`);
const contract = JSON.parse(contractBytes);
const provenance = JSON.parse(readFileSync(`${directory}/PROVENANCE.json`, "utf8"));
const report = readFileSync(`${directory}/RESULT.md`, "utf8").replace(/\s+/g, " ");
const artifactHex = readFileSync(`${directory}/ARTIFACT.hex`, "utf8").replace(/\s+/g, "");
const artifact = Buffer.from(artifactHex, "hex");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireValue = (condition, label) => {
  if (!condition) throw new Error(`Reasoner 5.0 result mismatch: ${label}`);
};

requireValue(
  sha256(resultBytes) === "8d0fca3c6d787dcfe330637716fbff7101e1f8d81738d05f6f348166e919c990",
  "raw result hash",
);
requireValue(
  sha256(executionBytes) === "5b66095000ed60e9d03684a57fd55da1fc74a86d5e81b9e8a2ccbe88b7e6b51a",
  "raw execution hash",
);
requireValue(
  sha256(contractBytes) === "876bfa3edf82a4894f9bb38b3210ffc281ce4ca3d1533398bac74d4912978360",
  "executed contract hash",
);
requireValue(artifact.length === 368, "artifact bytes");
requireValue(
  sha256(artifact) === "9538a3449d66ec43dc58a139a39fb52392816b7eb3a4e36df798ce602784323b",
  "artifact hash",
);
requireValue(result.schema === "zero.reasoner50_residual_transfer.v1", "schema");
requireValue(result.decision === "no-go" && result.gate_passed === false, "decision");
requireValue(result.full.episodes === 24, "episodes");
requireValue(result.full.expansions === 229, "full expansions");
requireValue(result.target_only.expansions === 248, "target-only expansions");
requireValue(result.source_only.expansions === 187, "source-only expansions");
requireValue(result.source_ablation.expansions === 248, "source ablation");
requireValue(result.shuffled_source.expansions === 245, "shuffled source");
requireValue(result.runtime_mismatch.expansions === 225, "runtime mismatch");
requireValue(result.individual_wins_over_target_only === 10, "individual wins");
requireValue(result.exact_identifications === 24, "identifications");
requireValue(
  result.affine_replay_checks === 1944 && result.exact_affine_replays === 1944,
  "affine replays",
);
requireValue(
  result.applications === 72 && result.exact_applications === 72,
  "applications",
);
requireValue(result.reports === 24 && result.exact_reports === 24, "reports");
requireValue(result.premature_commits === 0, "premature commits");
requireValue(result.invalid_unverified_top_candidates === 24, "verifier authority");
requireValue(result.source_artifact_frozen === true, "artifact freeze");
requireValue(result.deployment_exact_score_passed === true, "deployment exactness");
requireValue(execution.scientific_execution === 1, "one execution");
requireValue(execution.scientific_retries === 0, "no retry");
requireValue(execution.post_open_tuning === false, "no tuning");
requireValue(execution.decision === "no-go", "execution decision");
requireValue(contract.status === "authorized-unopened", "frozen contract status");
requireValue(
  provenance.artifacts.execution_lock_sha256 ===
    "de8939a0eec2465e393102c67fabc1fbc4921db0abe42fc1433776bbfc16f112",
  "execution lock",
);
requireValue(provenance.execution.scientific_executions === 1, "provenance execution");
requireValue(provenance.execution.cost_usd === 0, "cost");

for (const evidence of [
  "contract-preserved residual-transfer gate",
  "no-go",
  "All 24 held-out programs",
  "1,944 affine certificate replays",
  "229 expansions",
  "248 expansions",
  "187 expansions",
  "about 7.7%",
  "no premature commit",
  "not sufficient",
]) {
  requireValue(report.includes(evidence), `report evidence ${evidence}`);
}

console.log("Reasoner 5.0 no-go result passed");

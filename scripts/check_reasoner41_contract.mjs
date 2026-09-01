import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const directory = "benchmarks/reasoner41-joint-transfer-v1";
const contract = JSON.parse(
  fs.readFileSync(`${directory}/contract.json`, "utf8"),
);

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner 4.1 contract: ${message}`);
}

function sha256(path) {
  return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

requireValue(
  contract.schema === "zero.reasoner41_joint_transfer_contract.v1",
  "schema",
);
requireValue(contract.experiment === "reasoner41-joint-transfer-v1", "experiment");
requireValue(contract.version === "4.1", "version");
requireValue(contract.status === "frozen-unopened", "seal status");
requireValue(contract.authorized === false, "sealed run must be unauthorized");

const frozen = contract.frozen_cores;
requireValue(frozen.representation_version === "4.0", "representation version");
requireValue(
  frozen.representation_development_digest === "6af623f4d0e176fe",
  "representation digest",
);
requireValue(
  sha256("reasoner40.c") === frozen.representation_implementation_sha256,
  "frozen reasoner40.c hash",
);
requireValue(
  sha256("reasoner40.h") === frozen.representation_header_sha256,
  "frozen reasoner40.h hash",
);
requireValue(frozen.law_version === "(3,9)", "law version");
requireValue(
  frozen.law_development_digest === "c16b44a0ab50c456",
  "law digest",
);
requireValue(
  sha256("reasoner310.c") === frozen.law_implementation_sha256,
  "frozen reasoner310.c hash",
);
requireValue(
  sha256("reasoner310.h") === frozen.law_header_sha256,
  "frozen reasoner310.h hash",
);

requireValue(contract.curriculum.adapters === 6, "curriculum adapters");
requireValue(contract.curriculum.laws === 6, "curriculum laws");
requireValue(contract.curriculum.pairs === 36, "curriculum pairs");
requireValue(contract.curriculum.episodes === 72, "curriculum episodes");
requireValue(contract.development.adapters === 29, "development adapters");
requireValue(contract.development.laws === 15, "development laws");
requireValue(contract.development.pairs === 435, "development pairs");
requireValue(contract.development.episodes === 3480, "development episodes");
requireValue(contract.development.exact_replays === 1002240, "development replays");
requireValue(contract.development.exact_adapter_queries === 3480, "adapter queries");
requireValue(contract.development.exact_law_queries === 13340, "law queries");
requireValue(contract.development.exact_actions === 10440, "actions");
requireValue(contract.sealed.adapters === 134, "sealed adapters");
requireValue(contract.sealed.laws === 31, "sealed laws");
requireValue(contract.sealed.pairs === 4154, "sealed pairs");
requireValue(contract.sealed.episodes === 33232, "sealed episodes");
requireValue(contract.sealed.local_execution_forbidden === true, "local seal");
requireValue(contract.sealed.scientific_retries === 0, "sealed retries");
requireValue(contract.sealed.tuning_after_open === false, "post-seal tuning");
for (const [field, value] of Object.entries(contract.protocol))
  requireValue(value === true, `protocol ${field}`);

const run = spawnSync("./reasoner41", ["development"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});
requireValue(run.status === 0, "development execution");
const result = JSON.parse(run.stdout);
requireValue(result.version === "4.1", "result version");
requireValue(result.canonical_adapter_programs === 170, "adapter census");
requireValue(result.canonical_law_programs === 52, "law census");
requireValue(result.development_pairs === 435, "result development pairs");
requireValue(result.planned_sealed_pairs === 4154, "result sealed pairs");
requireValue(result.planned_sealed_episodes === 33232, "result sealed episodes");
requireValue(result.frozen_representation_core_passed === true, "representation core");
requireValue(result.frozen_law_core_passed === true, "law core");
requireValue(result.separate_commit_certificate_passed === true, "separate commits");
requireValue(result.oracle_adapter_control_passed === true, "oracle adapter");
requireValue(result.oracle_law_control_passed === true, "oracle law");
for (const field of [
  "identity_adapter_control_passed",
  "curriculum_pair_control_passed",
  "no_adapter_query_control_passed",
  "no_law_query_control_passed",
  "shuffled_alignment_control_passed",
  "shuffled_law_feedback_control_passed",
]) {
  requireValue(result[field] === false, `negative control ${field}`);
}
requireValue(result.sealed_execution_locked === true, "sealed lock");
requireValue(result.development_gate_passed === true, "development gate");
requireValue(result.result_digest === "7096742092b4aa24", "development digest");

const development = result.development;
requireValue(development.episodes === 3480, "exact episodes");
requireValue(development.target_pairs === 435, "exact pairs");
requireValue(development.adapter_queries === 3480, "exact adapter-query count");
requireValue(
  development.adapter_queries === development.exact_adapter_queries,
  "adapter-query equality",
);
requireValue(development.replay_checks === 1002240, "exact replay count");
requireValue(development.replay_checks === development.exact_replays, "replays");
requireValue(development.law_queries === 13340, "exact law-query count");
requireValue(
  development.law_queries === development.exact_law_queries,
  "law-query equality",
);
requireValue(development.actions === 10440, "exact action count");
requireValue(development.actions === development.exact_actions, "actions");
requireValue(development.exact_commits === 3480, "joint commits");
requireValue(development.exact_reports === 3480, "reports");
requireValue(development.premature_adapter_commits === 0, "adapter commitment");
requireValue(development.premature_law_commits === 0, "law commitment");
requireValue(development.premature_commits === 0, "joint commitment");
requireValue(development.maximum_adapter_queries === 1, "adapter-query maximum");
requireValue(development.maximum_law_queries === 5, "law-query maximum");
requireValue(development.exact === true, "exact development result");

const sealed = spawnSync(
  "./reasoner41",
  ["sealed-run", `/tmp/reasoner41-unauthorized-${process.pid}.json`],
  { encoding: "utf8" },
);
requireValue(sealed.status !== 0, "sealed command must refuse execution");
requireValue(
  sealed.stderr.includes("cloud-only"),
  "local sealed refusal",
);
const missingApproval = spawnSync(
  "./reasoner41",
  ["sealed-run", `/tmp/reasoner41-unapproved-${process.pid}.json`],
  {
    encoding: "utf8",
    env: { ...process.env, R41_SEALED_EXECUTION: "cloud" },
  },
);
requireValue(missingApproval.status !== 0, "approval ID must be required");
requireValue(
  missingApproval.stderr.includes("frozen approval id"),
  "approval refusal",
);
const missingLock = spawnSync(
  "./reasoner41",
  ["sealed-run", `/tmp/reasoner41-unlocked-${process.pid}.json`],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      R41_SEALED_EXECUTION: "cloud",
      R41_SEAL_APPROVAL_ID: "reasoner41-joint-transfer-2026-09-01-v1",
    },
  },
);
requireValue(missingLock.status !== 0, "execution lock must be required");
requireValue(
  missingLock.stderr.includes("R41_EXECUTION_LOCK is required"),
  "lock refusal",
);
const existingLock = spawnSync(
  "./reasoner41",
  ["sealed-run", `/tmp/reasoner41-reused-${process.pid}.json`],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      R41_SEALED_EXECUTION: "cloud",
      R41_SEAL_APPROVAL_ID: "reasoner41-joint-transfer-2026-09-01-v1",
      R41_EXECUTION_LOCK: "/dev/null",
    },
  },
);
requireValue(existingLock.status !== 0, "existing lock must refuse execution");
requireValue(
  existingLock.stderr.includes("already exists"),
  "one-shot lock refusal",
);

console.log("Reasoner 4.1 frozen joint-transfer contract passed");

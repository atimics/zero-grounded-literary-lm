import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const directory = "benchmarks/reasoner42-abstraction-library-v1";
const contract = JSON.parse(readFileSync(`${directory}/contract.json`, "utf8"));
const expected = JSON.parse(readFileSync(`${directory}/DEVELOPMENT.json`, "utf8"));

function requireValue(condition, label) {
  if (!condition) throw new Error(`Reasoner 4.2 contract mismatch: ${label}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

requireValue(
  contract.schema === "zero.reasoner42_abstraction_library_contract.v1",
  "schema",
);
requireValue(contract.experiment === "reasoner42-abstraction-library-v1", "experiment");
requireValue(contract.version === "4.2", "version");
requireValue(contract.status === "frozen-unopened", "status");
requireValue(contract.authorized === false, "authorization");
requireValue(
  contract.frozen_base.development_digest === "6af623f4d0e176fe",
  "frozen base digest",
);
requireValue(
  sha256("reasoner40.c") === contract.frozen_base.implementation_sha256,
  "frozen reasoner40.c hash",
);
requireValue(
  sha256("reasoner40.h") === contract.frozen_base.header_sha256,
  "frozen reasoner40.h hash",
);

for (const [path, digest] of Object.entries(contract.source.files)) {
  requireValue(sha256(path) === digest, `source hash ${path}`);
}

requireValue(contract.canonicalization.field_modulus === 257, "field modulus");
requireValue(
  JSON.stringify(contract.canonicalization.dimensions) === JSON.stringify([4, 12]),
  "dimensions",
);
requireValue(contract.canonicalization.query_basis_size === 81, "query basis");
requireValue(contract.curriculum.raw_programs === 259, "curriculum raw programs");
requireValue(contract.curriculum.canonical_programs === 170, "curriculum programs");
requireValue(contract.curriculum.targets === 9, "curriculum targets");
requireValue(contract.library.entries.length === 3, "library entries");
requireValue(contract.library.digest === "3cf6bb033d68d2a3", "library digest");
requireValue(contract.library.net_mdl_gain === 3, "library MDL gain");
requireValue(contract.development.raw_programs === 91, "development raw programs");
requireValue(contract.development.canonical_programs === 74, "development programs");
requireValue(contract.development.targets === 7, "development targets");
requireValue(contract.development.episodes === 14, "development episodes");
requireValue(contract.development.exact_replays === 1134, "development replays");
requireValue(contract.development.exact_applications === 42, "development applications");
requireValue(contract.development.maximum_queries === 1, "maximum queries");
requireValue(contract.search_budget.maximum_raw_programs === 100, "search budget");
requireValue(contract.search_budget.library_raw_programs === 91, "library search size");
requireValue(contract.search_budget.base_depth_four_raw_programs === 1555, "base search size");
requireValue(
  contract.controls.semantic_oracle_uses_full_base_depth_four === true,
  "base semantic oracle",
);
requireValue(contract.sealed.authorized === false, "sealed authorization");
requireValue(contract.sealed.status === "implemented-locked", "sealed status");
requireValue(contract.sealed.targets === 17, "sealed targets");
requireValue(contract.sealed.evidence_orders === 2, "sealed evidence orders");
requireValue(contract.sealed.episodes === 34, "sealed episodes");
requireValue(contract.sealed.library_raw_programs === 820, "sealed library census");
requireValue(contract.sealed.base_raw_programs === 55987, "sealed base census");
requireValue(contract.sealed.library_tokens === 51, "sealed library tokens");
requireValue(contract.sealed.base_tokens === 102, "sealed base tokens");
requireValue(contract.sealed.exact_replays === 2754, "sealed replays");
requireValue(contract.sealed.exact_applications === 102, "sealed applications");
requireValue(contract.sealed.exact_reports === 34, "sealed reports");
requireValue(contract.sealed.maximum_queries === 2, "sealed query maximum");
requireValue(
  contract.sealed.exhaustive_base_minimum_certificate === true,
  "sealed base minimum certificate",
);
requireValue(contract.sealed.controls_repeat_on_seal === true, "sealed controls");
requireValue(
  contract.sealed.required_approval_id ===
    "reasoner42-abstraction-library-2026-09-01-v1",
  "sealed approval ID",
);
requireValue(contract.sealed.local_execution_forbidden === true, "local seal");
requireValue(contract.sealed.cloud_execution_required === true, "cloud seal");
requireValue(
  contract.sealed.exclusive_execution_lock_required === true,
  "one-shot lock",
);
requireValue(contract.sealed.scientific_retries === 0, "sealed retries");
requireValue(contract.sealed.tuning_after_open === false, "post-seal tuning");
requireValue(contract.sealed.cli_must_fail_closed === true, "sealed CLI lock");
requireValue(contract.result.digest === "ac7837bdb3030663", "result digest");

const outputPath = `/tmp/reasoner42-contract-${process.pid}.json`;
const run = spawnSync("./reasoner42", ["development", outputPath], {
  encoding: "utf8",
});
try {
  requireValue(run.status === 0, `development run: ${run.stderr.trim()}`);
  const stdout = JSON.parse(run.stdout);
  const generated = JSON.parse(readFileSync(outputPath, "utf8"));
  requireValue(stdout.development_gate_passed === true, "stdout development gate");
  requireValue(stdout.sealed_execution_locked === true, "stdout sealed lock");
  requireValue(stdout.result_digest === contract.result.digest, "stdout digest");
  requireValue(JSON.stringify(generated) === JSON.stringify(expected), "development result replay");
} finally {
  rmSync(outputPath, { force: true });
}

const sealedPath = `/tmp/reasoner42-sealed-${process.pid}.json`;
const sealed = spawnSync(
  "./reasoner42",
  ["sealed-run", sealedPath],
  { encoding: "utf8" },
);
requireValue(sealed.status !== 0, "sealed execution must fail closed");
requireValue(
  sealed.stderr.includes("cloud-only"),
  "local sealed rejection",
);
requireValue(!existsSync(sealedPath), "local rejection wrote a result");
const missingApproval = spawnSync(
  "./reasoner42",
  ["sealed-run", `/tmp/reasoner42-unapproved-${process.pid}.json`],
  {
    encoding: "utf8",
    env: { ...process.env, R42_SEALED_EXECUTION: "cloud" },
  },
);
requireValue(missingApproval.status !== 0, "approval ID must be required");
requireValue(
  missingApproval.stderr.includes("frozen approval id"),
  "approval rejection",
);
requireValue(
  !existsSync(`/tmp/reasoner42-unapproved-${process.pid}.json`),
  "approval rejection wrote a result",
);
const missingLock = spawnSync(
  "./reasoner42",
  ["sealed-run", `/tmp/reasoner42-unlocked-${process.pid}.json`],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      R42_SEALED_EXECUTION: "cloud",
      R42_SEAL_APPROVAL_ID:
        "reasoner42-abstraction-library-2026-09-01-v1",
    },
  },
);
requireValue(missingLock.status !== 0, "execution lock must be required");
requireValue(
  missingLock.stderr.includes("R42_EXECUTION_LOCK is required"),
  "execution-lock rejection",
);
requireValue(
  !existsSync(`/tmp/reasoner42-unlocked-${process.pid}.json`),
  "lock rejection wrote a result",
);
const reusedLock = spawnSync(
  "./reasoner42",
  ["sealed-run", `/tmp/reasoner42-reused-${process.pid}.json`],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      R42_SEALED_EXECUTION: "cloud",
      R42_SEAL_APPROVAL_ID:
        "reasoner42-abstraction-library-2026-09-01-v1",
      R42_EXECUTION_LOCK: "/dev/null",
    },
  },
);
requireValue(reusedLock.status !== 0, "execution lock must be exclusive");
requireValue(
  reusedLock.stderr.includes("already exists"),
  "one-shot rejection",
);
requireValue(
  !existsSync(`/tmp/reasoner42-reused-${process.pid}.json`),
  "one-shot rejection wrote a result",
);

console.log("Reasoner 4.2 frozen unopened contract verified");

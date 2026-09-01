import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
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
requireValue(contract.status === "development-passed-seal-locked", "status");
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
requireValue(contract.sealed.targets === 17, "sealed targets");
requireValue(contract.sealed.library_raw_programs === 820, "sealed library census");
requireValue(contract.sealed.base_raw_programs === 55987, "sealed base census");
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

const sealed = spawnSync(
  "./reasoner42",
  ["sealed-run", `/tmp/reasoner42-sealed-${process.pid}.json`],
  { encoding: "utf8" },
);
requireValue(sealed.status !== 0, "sealed execution must fail closed");
requireValue(
  sealed.stderr.includes("locked and unauthorized"),
  "sealed rejection message",
);

console.log("Reasoner 4.2 contract verified");

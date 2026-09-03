import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = "benchmarks/reasoner52-nonlinear-depth-transfer-v1/contract.json";
const contract = JSON.parse(readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(contract.schema === "zero.reasoner52_nonlinear_depth_contract.v1",
  "unexpected Reasoner 5.2 contract schema");
requireValue(contract.status === "authorized-unopened",
  "Reasoner 5.2 source contract must remain authorized-unopened");
requireValue(contract.authorization?.approval_id ===
  "reasoner52-nonlinear-depth-2026-09-02-v1", "approval ID changed");
requireValue(contract.source?.program_length === 2, "source depth changed");
requireValue(contract.target?.program_length === 3, "target depth changed");
requireValue(contract.target?.episodes === 24, "episode count changed");
requireValue(contract.ranking?.exact_truth_table_verifier_is_authoritative === true,
  "truth-table verifier must remain authoritative");
requireValue(contract.execution?.scientific_executions === 1,
  "exactly one scientific execution is required");
requireValue(contract.execution?.scientific_retries === 0,
  "scientific retries must remain zero");
requireValue(contract.execution?.tuning_after_open === false,
  "post-open tuning must remain forbidden");
requireValue(contract.gate?.full_exact_matches === 24,
  "exact-match gate changed");
requireValue(contract.gate?.premature_commits === 0,
  "premature commit gate changed");

for (const [file, expected] of Object.entries(contract.implementation_source.files)) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  requireValue(actual === expected, `${file} hash mismatch: ${actual}`);
}

const makefile = readFileSync("Makefile", "utf8");
requireValue(makefile.includes("reasoner52-check: reasoner52"),
  "Reasoner 5.2 self-test is not wired into Makefile");
requireValue(makefile.includes("reasoner52-contract-check:"),
  "Reasoner 5.2 contract check is not wired into Makefile");

console.log("Reasoner 5.2 prospective contract passed");

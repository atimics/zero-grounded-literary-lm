import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const contractPath = "benchmarks/reasoner51-unseen-primitive-v1/contract.json";
const contract = JSON.parse(readFileSync(contractPath, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(contract.schema === "zero.reasoner51_unseen_primitive_contract.v1",
  "unexpected Reasoner 5.1 contract schema");
requireValue(contract.status === "authorized-unopened",
  "Reasoner 5.1 source contract must remain authorized-unopened");
requireValue(contract.authorization?.approval_id ===
  "reasoner51-unseen-primitive-2026-09-02-v1", "approval ID changed");
requireValue(contract.execution?.scientific_executions === 1,
  "exactly one scientific execution is required");
requireValue(contract.execution?.scientific_retries === 0,
  "scientific retries must remain zero");
requireValue(contract.execution?.tuning_after_open === false,
  "post-open tuning must remain forbidden");
requireValue(contract.ranking?.exact_affine_verifier_is_authoritative === true,
  "the exact verifier must remain authoritative");
requireValue(contract.gate?.adapter_reconstruction_queries === 8,
  "adapter reconstruction query gate changed");
requireValue(contract.gate?.adapter_challenge_queries === 6,
  "adapter challenge query gate changed");
requireValue(contract.gate?.full_exact_matches === 24,
  "exact-match gate changed");
requireValue(contract.gate?.premature_commits === 0,
  "premature commit gate changed");

for (const [path, expected] of Object.entries(contract.implementation_source.files)) {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  requireValue(actual === expected, `${path} hash mismatch: ${actual}`);
}

const makefile = readFileSync("Makefile", "utf8");
requireValue(makefile.includes("reasoner51-check: reasoner51"),
  "Reasoner 5.1 self-test is not wired into Makefile");
requireValue(makefile.includes("reasoner51-contract-check:"),
  "Reasoner 5.1 contract check is not wired into Makefile");

console.log("Reasoner 5.1 prospective contract passed");

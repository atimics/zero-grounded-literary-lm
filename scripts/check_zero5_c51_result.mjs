// Verify the published ZERO.5 C5.1 result records against their frozen
// contracts and publication authorizations. Fails closed on any drift,
// missing gate, opened test metrics, or promotion claim.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`zero5-c51-result-check: ${message}`);
  process.exit(1);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const contract = await readJson(join(root, "benchmarks/zero5-c51-statebridge-v1/contract.json"));
const result = await readJson(join(root, "benchmarks/zero5-c51-statebridge-v1/result.json"));
const publication = await readJson(join(root, "benchmarks/zero5-c51-statebridge-v1/publication.json"));

if (result.schema !== "zero.c51_public_result.v1") fail("unexpected result schema");
if (result.experiment !== "zero5-c51-statebridge-v1") fail("unexpected experiment id");
if (result.status !== "complete-no-go") fail("unexpected status");

const contractBytes = await readFile(join(root, "benchmarks/zero5-c51-statebridge-v1/contract.json"));
if (sha256(contractBytes) !== result.contract_sha256) {
  fail("result contract hash does not match the frozen contract");
}

const resultBytes = await readFile(join(root, "benchmarks/zero5-c51-statebridge-v1/result.json"));
if (sha256(resultBytes) !== publication.public_result.sha256) {
  fail("published result bytes do not match the publication authorization");
}

if (result.decision.replication_eligible !== false) fail("no-go must not be replication-eligible");
if (result.decision.promotion_eligible !== false) fail("no-go must not be promotion-eligible");
if (result.validation.test_metrics_opened !== false) fail("test metrics must remain unopened");

for (const gate of ["retrieval_choice_floor", "retrieval_gain_over_c43", "claim_retention"]) {
  if (result.validation.gates[gate] !== false) {
    fail(`expected failed gate ${gate} to be recorded as failed`);
  }
}
if (result.validation.gates.sealed_test_stayed_closed !== true) {
  fail("sealed-test gate must pass");
}
if (result.checkpoints.published !== false) fail("checkpoints must not be published");

console.log("ZERO.5 C5.1 result publication checks passed");

// Verify the published ZERO.5 C5.2 result records against their frozen
// contracts and publication authorizations. Fails closed on any drift,
// missing gate, opened test metrics, or promotion claim.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`zero5-c52-result-check: ${message}`);
  process.exit(1);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

const result = await readJson(join(root, "benchmarks/zero5-c52-targetbridge-v1/result.json"));
const publication = await readJson(join(root, "benchmarks/zero5-c52-targetbridge-v1/publication.json"));
const contract = await readJson(join(root, "benchmarks/zero5-c52-targetbridge-v1/contract.json"));

if (result.schema !== "zero.c52_public_result.v1") fail("unexpected result schema");
if (result.experiment !== "zero5-c52-targetbridge-v1") fail("unexpected experiment id");
if (result.status !== "complete-no-go") fail("unexpected status");

const contractBytes = await readFile(join(root, "benchmarks/zero5-c52-targetbridge-v1/contract.json"));
if (sha256(contractBytes) !== result.contract_sha256) {
  fail("result contract hash does not match the frozen contract");
}

const resultBytes = await readFile(join(root, "benchmarks/zero5-c52-targetbridge-v1/result.json"));
if (sha256(resultBytes) !== publication.public_result.sha256) {
  fail("published result bytes do not match the publication authorization");
}

if (result.decision.replication_eligible !== false) fail("no-go must not be replication-eligible");
if (result.decision.promotion_eligible !== false) fail("no-go must not be promotion-eligible");
if (result.validation.test_metrics_opened !== false) fail("test metrics must remain unopened");

for (const gate of ["retrieval_accuracy_gain", "retrieval_pair_gain", "c52_choice_orientation_gap"]) {
  if (result.validation.gates[gate] !== false) {
    fail(`expected failed gate ${gate} to be recorded as failed`);
  }
}
if (result.validation.gates.auxiliary_nats_reduction !== true) fail("auxiliary learning gate must pass");
if (result.validation.gates.auxiliary_accuracy_gain !== true) fail("auxiliary accuracy gate must pass");

const aux = result.validation.auxiliary;
if (!(aux.candidate.accuracy > aux.control.accuracy)) {
  fail("published auxiliary numbers must show the recorded learning gain");
}
if (result.checkpoints.published !== false) fail("checkpoints must not be published");

console.log("ZERO.5 C5.2 result publication checks passed");

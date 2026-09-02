import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const version = Number(process.argv[2]);
assert.ok([53, 54].includes(version));
const id = version === 53 ? "reasoner53-evidence-transfer-v1" : "reasoner54-pixel-transfer-v1";
const contract = JSON.parse(readFileSync(`benchmarks/${id}/contract.json`));
assert.equal(contract.experiment, id);
assert.equal(contract.status, "authorized-unopened");
assert.equal(contract.variant, version);
assert.equal(contract.target.episodes, version === 53 ? 72 : 48);
assert.equal(contract.execution.scientific_executions, 1);
assert.equal(contract.execution.scientific_retries, 0);
assert.equal(contract.execution.maximum_seconds, 300);
assert.equal(contract.execution.tuning_after_open, false);
assert.equal(contract.gate.primary_condition, version === 53 ? 2 : 1);
assert.equal(contract.gate.full_fraction_of_target_only_max, 0.8);
assert.equal(contract.gate.full_expansions_per_episode_max, 64);
assert.equal(contract.gate.primary_individual_wins_min, 12);
assert.equal(contract.verifier.domain_points, 17);
assert.equal(contract.verifier.authority, "exact full-domain equality");
for (const [file, expected] of Object.entries(contract.source_files)) {
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), expected, file);
}
const makefile = readFileSync("Makefile", "utf8");
assert.ok(makefile.includes(`-DR5_VARIANT=${version} reasoner5_followup.c`));
console.log(`Reasoner ${version} prospective contract passed`);

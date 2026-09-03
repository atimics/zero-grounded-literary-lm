import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = "benchmarks/reasoner5-first-five-v1";
const series = JSON.parse(readFileSync(join(root, "series.json")));
assert.equal(series.schema, "zero.reasoner5_first_five.v1");
assert.equal(series.status, "complete");
assert.deepEqual(series.experiments.map(item => item.version),
  ["5.0", "5.1", "5.2", "5.3", "5.4"]);
assert.deepEqual(series.experiments.map(item => item.decision),
  ["no-go", "pass", "no-go", "pass", "no-go"]);
assert.equal(new Set(series.experiments.map(item => item.id)).size, 5);
let episodes = 0;
let exact = 0;
let executions = 0;
let retries = 0;
let cost = 0;
for (const item of series.experiments) {
  const resultPath = join(root, item.result);
  const provenancePath = join(root, item.provenance);
  const resultRaw = readFileSync(resultPath);
  const result = JSON.parse(resultRaw);
  const provenance = JSON.parse(readFileSync(provenancePath));
  const contractPath = join("benchmarks", item.id, "contract.json");
  const contractRaw = readFileSync(contractPath);
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  assert.equal(result.experiment ??
    (result.schema === "zero.reasoner50_residual_transfer.v1" ? item.id : undefined), item.id);
  assert.equal(result.decision, item.decision);
  assert.equal(provenance.decision, item.decision);
  assert.equal(digest(resultRaw), provenance.artifacts.result_sha256);
  assert.equal(digest(contractRaw), provenance.contract_sha256);
  assert.equal(JSON.parse(contractRaw).status, "authorized-unopened");
  assert.equal(provenance.execution.scientific_executions, 1);
  assert.equal(provenance.execution.scientific_retries, 0);
  assert.equal(provenance.execution.post_open_tuning, false);
  assert.equal(provenance.execution.cost_usd, 0);
  assert.equal(item.episodes, result.episodes ?? result.full.episodes);
  assert.equal(item.primary_full_expansions,
    item.primary_condition === undefined ?
      (result.full_expansions ?? result.full.expansions) :
      result.conditions[item.primary_condition].arms.full.expansions);
  assert.equal(item.primary_target_only_expansions,
    item.primary_condition === undefined ?
      (result.target_only_expansions ?? result.target_only.expansions) :
      result.conditions[item.primary_condition].arms.target_only.expansions);
  assert.equal(item.individual_wins,
    item.primary_condition === undefined ?
      (result.individual_wins_over_target_only ?? result.individual_wins_vs_target_only) :
      result.conditions[item.primary_condition].individual_wins);
  episodes += item.episodes;
  exact += item.version === "5.0" ? result.exact_identifications :
    item.primary_condition === undefined ? result.full_exact_matches :
      result.conditions.reduce((sum, condition) => sum + condition.arms.full.exact, 0);
  executions += provenance.execution.scientific_executions;
  retries += provenance.execution.scientific_retries;
  cost += provenance.execution.cost_usd;
}
assert.deepEqual(series.totals, {
  scientific_executions: executions,
  retries,
  cloud_cost_usd: cost,
  episodes,
  exact_final_answers: exact,
  passes: 2,
  no_go: 3,
});
assert.equal(series.next_scale_gate.primary_baseline_median_expansions_min, 4);
assert.equal(series.next_scale_gate.development_and_test_families_separate, true);
assert.equal(series.next_scale_gate.generated_target_families, true);
assert.equal(series.next_scale_gate.independent_replication, true);
console.log("Reasoner 5 first-five series audit passed");

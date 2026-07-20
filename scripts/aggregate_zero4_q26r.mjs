#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function percent(value) { return typeof value === "number" ? `${(100 * value).toFixed(3)}%` : "—"; }
function familyDecision(results) { return [1, 2, 3].every((seed) => results[String(seed)]?.decision === "go") ? "go" : "no-go"; }

function selfTest() {
  assert(familyDecision({ 1: { decision: "go" }, 2: { decision: "go" }, 3: { decision: "go" } }) === "go", "all-go family self-test failed");
  assert(familyDecision({ 1: { decision: "go" }, 2: { decision: "go" }, 3: { decision: "no-go" } }) === "no-go", "family no-go self-test failed");
  console.log("Q2.6-R family aggregation self-test passed");
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }

const root = process.argv[2] ?? "benchmarks/zero4-q26r-v1";
const contract = readJson(path.join(root, "contract.json"));
const sources = {
  1: path.join(root, "seed1", "result.json"),
  2: "benchmarks/zero4-q26-v1/seed2/result.json",
  3: path.join(root, "seed3", "result.json"),
};
const results = {};
for (const seed of contract.declared_family_seeds) {
  const file = sources[seed];
  if (!fs.existsSync(file)) fail(`missing declared Q2.6 family result: ${file}`);
  const result = readJson(file);
  assert(result.schema === "zero.zero4_q26_result.v1" && result.seed === seed, `seed ${seed} result identity drifted`);
  assert(["go", "no-go"].includes(result.decision), `seed ${seed} decision is invalid`);
  const checkpoint = result.selected ?? result.frontier?.at(-1) ?? null;
  results[String(seed)] = {
    decision: result.decision,
    stopped_reason: result.stoppedReason,
    committed_updates: result.committed,
    selected_update: result.selected?.committed ?? null,
    operation_rate: checkpoint?.rates?.operation ?? null,
    exact_artifact_rate: checkpoint?.rates?.exact_artifact ?? null,
    replay_relative_regression: checkpoint?.replayRegression ?? null,
    promotion_evaluated: result.promotion?.evaluatedOnceAtEnd === true,
    promotion_passed: result.promotion?.quantityPass === true,
    model_sha256: result.artifacts?.quantizedSha256 ?? null,
  };
}
const decision = familyDecision(results);
const failedSeeds = contract.declared_family_seeds.filter((seed) => results[String(seed)].decision !== "go");
const aggregate = {
  schema: "zero.zero4_q26_multiseed.v1",
  id: "zero4-q26-multiseed",
  decision,
  promotion_eligible: decision === "go",
  promotion_blocker: decision === "go" ? null : `declared seeds ${failedSeeds.join(", ")} did not pass the frozen public-and-promotion conjunction`,
  declared_seeds: contract.declared_family_seeds,
  completed_seeds: contract.declared_family_seeds,
  current_model: decision === "go" ? "ZERO.4" : "ZERO.3",
  promoted_model: decision === "go" ? {
    source_seed: 2,
    path: "benchmarks/zero4-q26-v1/seed2/selected.litq8",
    sha256: contract.family_rule.promoted_model_sha256,
  } : null,
  results,
};
const rows = contract.declared_family_seeds.map((seed) => {
  const result = results[String(seed)];
  return `| ${seed} | ${result.decision} | ${result.committed_updates} | ${result.selected_update ?? "—"} | ${percent(result.operation_rate)} | ${percent(result.exact_artifact_rate)} | ${percent(result.replay_relative_regression)} | ${result.promotion_evaluated ? (result.promotion_passed ? "pass" : "fail") : "sealed"} |`;
}).join("\n");
const conclusion = decision === "go"
  ? `All three declared seeds passed. The frozen seed-2 model \`${contract.family_rule.promoted_model_sha256}\` is eligible to become ZERO.4.`
  : `Seeds ${failedSeeds.join(", ")} did not pass. ZERO.3 remains current; no replication model may replace the frozen seed-2 candidate post hoc.`;
const markdown = `# ZERO.4-Q2.6 multi-seed decision\n\nDecision: **${decision}**. Family promotion eligible: **${decision === "go" ? "yes" : "no"}**.\n\nAll three declared seeds completed under the frozen Q2.6 policy. A diagnostic go is insufficient: family promotion requires every seed to pass both the public and exactly-once promotion gates.\n\n| Seed | Decision | Commits | Selected | Operation | Exact artifact | Replay regression | Promotion |\n| ---: | :---: | ---: | ---: | ---: | ---: | ---: | :---: |\n${rows}\n\n${conclusion}\n`;
atomicWrite(path.join(root, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
atomicWrite(path.join(root, "AGGREGATE.md"), markdown);
console.log(`ZERO.4-Q2.6 multi-seed decision: ${decision}`);

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function percent(value) { return `${(100 * value).toFixed(3)}%`; }

const root = process.argv[2] ?? "benchmarks/zero4-q22r-v1";
const declaredSeeds = [1, 2, 3];
const manifests = declaredSeeds.map((seed) => {
  const file = path.join(root, `seed${seed}`, "manifest.json");
  if (!fs.existsSync(file)) fail(`missing declared seed result: ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.schema !== "zero.zero4_q22r_result.v1") fail(`unexpected seed schema in ${file}: ${manifest.schema}`);
  if (manifest.id !== `zero4-q22r-seed${seed}`) fail(`seed identity mismatch in ${file}`);
  return { seed, manifest };
});

const teacherHashes = JSON.stringify(manifests[0].manifest.immutable_teachers);
for (const { seed, manifest } of manifests) {
  if (JSON.stringify(manifest.immutable_teachers) !== teacherHashes) fail(`immutable teacher mismatch for seed ${seed}`);
}

const results = Object.fromEntries(manifests.map(({ seed, manifest }) => {
  const selection = manifest.checkpoint_selection;
  const diagnostic = selection?.diagnosticBest;
  const replayRegression = manifest.replay?.relative_regression ?? diagnostic?.replayRegression;
  const rates = manifest.rates ?? diagnostic?.rates;
  if (!selection || typeof replayRegression !== "number" || !rates) fail(`incomplete result metrics for seed ${seed}`);
  return [String(seed), {
    decision: manifest.decision,
    stopped_reason: selection.stoppedReason ?? null,
    selected_model: manifest.model ? {
      update: manifest.model.update,
      sha256: manifest.model.sha256,
    } : null,
    operation_rate: rates.operation,
    exact_artifact_rate: rates.exact_artifact,
    replay_relative_regression: replayRegression,
    promotion_evaluated: selection.promotion?.evaluatedOnceAtEnd ?? selection.promotion_evaluated_once_at_end,
  }];
}));

const allPass = declaredSeeds.every((seed) => results[String(seed)].decision === "go");
const failedSeeds = declaredSeeds.filter((seed) => results[String(seed)].decision !== "go");
const aggregate = {
  schema: "zero.zero4_q22r_multiseed.v1",
  id: "zero4-q22r-multiseed",
  decision: allPass ? "go" : "no-go",
  promotion_eligible: allPass,
  promotion_blocker: allPass ? null : `declared seeds ${failedSeeds.join(", ")} did not pass jointly frozen quantity and replay gates`,
  declared_seeds: declaredSeeds,
  completed_seeds: declaredSeeds,
  immutable_teachers: manifests[0].manifest.immutable_teachers,
  results,
};

const rows = declaredSeeds.map((seed) => {
  const result = results[String(seed)];
  return `| ${seed} | ${result.decision} | ${percent(result.operation_rate)} | ${percent(result.exact_artifact_rate)} | ${percent(result.replay_relative_regression)} | ${result.promotion_evaluated ? "yes" : "no"} |`;
}).join("\n");
const markdown = `# ZERO.4-Q2.2-R multi-seed decision\n\nDecision: **${aggregate.decision}**. ZERO.4 is not promoted.\n\nAll three declared seeds completed under the frozen policy. A seed-level go is insufficient: family promotion requires every seed to pass the quantity and replay gates jointly.\n\n| Seed | Decision | Operation rate | Exact-artifact rate | Replay regression | Promotion split evaluated |\n| ---: | :---: | ---: | ---: | ---: | :---: |\n${rows}\n\nSeed 2 passed, but seeds 1 and 3 stopped after replay exceeded 2% on two consecutive full evaluations. Their best retained diagnostics also missed the operation, exact-request, commit, and exact-artifact gates. The disjoint promotion split remained untouched for both failed seeds. A new attempt requires a separately preregistered follow-up; no ZERO.4 checkpoint replaces ZERO.3.\n`;

atomicWrite(path.join(root, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
atomicWrite(path.join(root, "AGGREGATE.md"), markdown);
console.log(`ZERO.4-Q2.2-R multi-seed decision: ${aggregate.decision}`);

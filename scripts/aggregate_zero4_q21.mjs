#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || index + 1 >= argv.length) fail(`invalid argument ${argv[index] ?? "<missing>"}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  if (!options.seed1 || !options.seed2 || !options.out) fail("--seed1, --seed2, and --out are required");
  return options;
}
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function percent(value) { return `${(100 * value).toFixed(3)}%`; }

const options = parseArgs(process.argv);
const seedFiles = [options.seed1, options.seed2, options.seed3].filter(Boolean);
const seeds = seedFiles.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
for (const seed of seeds) if (seed.schema !== "zero.zero4_q21_result.v1") fail(`unexpected seed schema ${seed.schema}`);
const declaredSeeds = [1, 2, 3];
const results = Object.fromEntries(seeds.map((seed) => [String(seed.design.seed), {
  decision: seed.decision,
  model_update: seed.model.update,
  model_sha256: seed.model.sha256,
  cases: seed.quantity.cases,
  operation_requests: seed.quantity.exact_request,
  source_argument_bindings: seed.quantity.arguments,
  oracle_arithmetic: seed.quantity.oracle_arithmetic,
  committed_artifacts: seed.quantity.exact_artifact,
  rejected_state_mutations: seed.quantity.rejected_state_mutations,
  replay_relative_regression: seed.replay.relative_regression,
  gates: seed.gates
}]));
for (const seed of declaredSeeds) if (!results[String(seed)]) results[String(seed)] = { decision: "not-run" };
const allRun = declaredSeeds.every((seed) => results[String(seed)].decision !== "not-run");
const allPass = allRun && declaredSeeds.every((seed) => results[String(seed)].decision === "go");
const aggregate = {
  schema: "zero.zero4_q21_multiseed.v1",
  id: "zero4-q21-multiseed",
  decision: allPass ? "go" : "no-go",
  promotion_eligible: allPass,
  stop_reason: results["2"].decision === "no-go"
    ? "seed 2 exceeded the fixed 2% replay-regression ceiling; seed 3 was not run"
    : (!allRun ? "not all declared seeds were run" : null),
  declared_seeds: declaredSeeds,
  completed_seeds: seeds.map((seed) => seed.design.seed),
  immutable_teachers: seeds[0].immutable_teachers,
  results
};
const rows = declaredSeeds.map((seed) => {
  const item = results[String(seed)];
  if (item.decision === "not-run") return `| ${seed} | not run | — | — | — | — |`;
  return `| ${seed} | ${item.decision} | ${item.operation_requests}/${item.cases} | ${item.source_argument_bindings}/${item.cases} | ${item.committed_artifacts}/${item.cases} | ${percent(item.replay_relative_regression)} |`;
}).join("\n");
const markdown = `# ZERO.4-Q2.1 multi-seed decision\n\nDecision: **${aggregate.decision}**. ZERO.4 is not promoted.\n\nThe model selects only an operation. Source arguments are bound by the controller and arithmetic is executed by the deterministic kernel; neither is credited as neural arithmetic. Every channel remains visible below.\n\n| Seed | Decision | Model operations | Controller bindings | Exact commits | Replay regression |\n| ---: | :---: | ---: | ---: | ---: | ---: |\n${rows}\n\nSeed 1 passed all gates. Seed 2 passed every quantity and safety gate but replay regressed ${percent(results["2"].replay_relative_regression)}, narrowly above the fixed 2.000% ceiling. Seed 3 was therefore not run. The next experiment must freeze a stronger replay-preservation schedule or a multi-objective checkpoint selector before replication; geometry, art, and physics remain closed.\n`;
fs.mkdirSync(options.out, { recursive: true });
atomicWrite(path.join(options.out, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
atomicWrite(path.join(options.out, "AGGREGATE.md"), markdown);
console.log(`ZERO.4-Q2.1 multi-seed decision: ${aggregate.decision}`);

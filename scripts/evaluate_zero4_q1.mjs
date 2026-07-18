#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || index + 1 >= argv.length) fail(`invalid argument ${key ?? "<missing>"}`);
    options[key.slice(2)] = argv[index + 1];
  }
  for (const key of ["raw", "constrained", "baseline", "replay", "model", "out"]) {
    if (!options[key]) fail(`--${key} is required`);
  }
  return options;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function replayLoss(file) {
  const text = fs.readFileSync(file, "utf8");
  const matches = [...text.matchAll(/evaluation-only val ([0-9]+(?:\.[0-9]+)?)/g)];
  if (!matches.length) fail(`no evaluation loss in ${file}`);
  return Number(matches.at(-1)[1]);
}
function ratio(count, total) { return total ? count / total : 0; }
function percent(value) { return `${(100 * value).toFixed(1)}%`; }
function atomicWrite(file, contents) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, file);
}

const options = parseArgs(process.argv);
const raw = readJson(options.raw).domains.quantity;
const constrained = readJson(options.constrained).domains.quantity;
const baselineLoss = replayLoss(options.baseline);
const studentLoss = replayLoss(options.replay);
const replayRegression = (studentLoss - baselineLoss) / baselineLoss;
const model = fs.readFileSync(options.model);
if (model.subarray(0, 8).toString("binary") !== "LITQ8V1\0") fail("model is not LITQ8V1");
const modelUpdate = Number(model.readBigUInt64LE(40));
const modelSha256 = crypto.createHash("sha256").update(model).digest("hex");
const thresholds = {
  exact_artifact_minimum: 0.95,
  verified_artifact_minimum: 0.95,
  syntax_minimum: 1.0,
  controller_close_minimum: 1.0,
  natural_artifact_close_minimum: 0.99,
  replay_relative_regression_maximum: 0.02
};
const rates = {
  exact_artifact: ratio(constrained.exact_artifact, constrained.cases),
  verified_artifact: ratio(constrained.verified_artifact, constrained.cases),
  syntax: ratio(constrained.syntax, constrained.cases),
  controller_close: ratio(constrained.closed, constrained.cases),
  natural_artifact_close: ratio(constrained.natural_artifact_close, constrained.cases)
};
const gates = {
  exact_artifact: rates.exact_artifact >= thresholds.exact_artifact_minimum,
  verified_artifact: rates.verified_artifact >= thresholds.verified_artifact_minimum,
  syntax: rates.syntax >= thresholds.syntax_minimum,
  controller_close: rates.controller_close >= thresholds.controller_close_minimum,
  natural_artifact_close: rates.natural_artifact_close >= thresholds.natural_artifact_close_minimum,
  replay: replayRegression <= thresholds.replay_relative_regression_maximum
};
const decision = Object.values(gates).every(Boolean) ? "go" : "no-go";
const report = {
  schema: "zero.zero4_q1_result.v1",
  id: "zero4-q1-seed1",
  decision,
  design: {
    initialization: "frozen ZERO.3 weights with fresh optimizer and RNG",
    faculty: "quantity only; deterministic oracle; teacher logits excluded",
    replay: "ZERO.3 distillation on historical ranges only",
    sampling: { quantity: 0.85, historical_replay: 0.15 },
    artifact_loss_weight: 4,
    planned_updates: 4000,
    batch: 2,
    peak_learning_rate: 0.00002,
    decoder: "controller-scaffolded quantity grammar with semantic commit gate"
  },
  model: { path: options.model, update: modelUpdate, sha256: modelSha256, bytes: model.length },
  raw,
  constrained,
  replay: { baseline_loss: baselineLoss, student_loss: studentLoss, relative_regression: replayRegression },
  rates,
  thresholds,
  gates
};
const markdown = `# ZERO.4-Q1 seed 1\n\nDecision: **${decision}**.\n\nThis experiment trains only the quantity faculty, weights artifact contents 4x,\nkeeps new-domain targets hard-only, distills ZERO.3 only on historical replay,\nand applies a controller-owned quantity grammar plus an independent semantic\nvalidator before commit.\n\n| Gate | Result | Required | Pass |\n| --- | ---: | ---: | :---: |\n| Exact artifacts | ${constrained.exact_artifact}/${constrained.cases} (${percent(rates.exact_artifact)}) | ${percent(thresholds.exact_artifact_minimum)} | ${gates.exact_artifact ? "yes" : "no"} |\n| Semantically verified | ${constrained.verified_artifact}/${constrained.cases} (${percent(rates.verified_artifact)}) | ${percent(thresholds.verified_artifact_minimum)} | ${gates.verified_artifact ? "yes" : "no"} |\n| Typed syntax | ${constrained.syntax}/${constrained.cases} (${percent(rates.syntax)}) | ${percent(thresholds.syntax_minimum)} | ${gates.syntax ? "yes" : "no"} |\n| Controller closure | ${constrained.closed}/${constrained.cases} (${percent(rates.controller_close)}) | ${percent(thresholds.controller_close_minimum)} | ${gates.controller_close ? "yes" : "no"} |\n| Natural artifact boundary | ${constrained.natural_artifact_close}/${constrained.cases} (${percent(rates.natural_artifact_close)}) | ${percent(thresholds.natural_artifact_close_minimum)} | ${gates.natural_artifact_close ? "yes" : "no"} |\n| Historical replay loss | ${studentLoss.toFixed(4)} (${percent(replayRegression)} vs ${baselineLoss.toFixed(4)}) | <= ${percent(thresholds.replay_relative_regression_maximum)} regression | ${gates.replay ? "yes" : "no"} |\n\nRaw unconstrained decoding produced ${raw.exact_artifact}/${raw.cases} exact and\n${raw.verified_artifact}/${raw.cases} semantically valid artifacts. The constrained\nresult is not silently accepted: invalid arithmetic is rejected and does not mutate\nfaculty state.\n\nModel update: ${modelUpdate}; SHA-256: \`${modelSha256}\`.\n`;
fs.mkdirSync(options.out, { recursive: true });
atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
atomicWrite(path.join(options.out, "RESULTS.md"), markdown);
console.log(`ZERO.4-Q1 decision: ${decision}`);
for (const [gate, passed] of Object.entries(gates)) console.log(`${passed ? "PASS" : "FAIL"} ${gate}`);

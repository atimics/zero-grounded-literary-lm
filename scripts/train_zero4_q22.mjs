#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const THRESHOLDS = Object.freeze({
  closed: 0.99,
  syntax: 0.99,
  operation: 0.95,
  arguments: 0.95,
  exact_request: 0.95,
  oracle_arithmetic: 1.0,
  committed: 0.95,
  exact_artifact: 0.95,
  rejected_state_mutations: 0,
  replay_regression: 0.02,
});
const FACULTY_GATES = ["closed", "syntax", "operation", "exact_request", "committed", "exact_artifact"];

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = {
    prefix: "/tmp/zero4-q22-seed1",
    out: "benchmarks/zero4-q22-v1/seed1",
    data: "corpus/faculty/q22",
    experiment: "q22",
    steps: 1000,
    consolidationSteps: 400,
    batch: 2,
    seed: 1,
    chunk: 25,
    fullEvery: 100,
    sentinelReplayBatches: 12,
    fullReplayBatches: 48,
  };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!["--prefix", "--out", "--data", "--experiment", "--steps", "--consolidation-steps", "--batch", "--seed", "--chunk", "--full-every", "--sentinel-replay-batches", "--full-replay-batches"].includes(option) || index + 1 >= argv.length) fail(`unknown or incomplete option ${option}`);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[++index];
    options[key] = ["prefix", "out", "data", "experiment"].includes(key) ? value : Number(value);
  }
  for (const key of ["steps", "consolidationSteps", "batch", "seed", "chunk", "fullEvery", "sentinelReplayBatches", "fullReplayBatches"]) {
    if (!Number.isInteger(options[key]) || options[key] < (key === "seed" ? 0 : 1)) fail(`${key} must be a positive integer`);
  }
  if (options.chunk !== 25 || options.fullEvery % options.chunk !== 0) fail("Q2.2 requires 25-update chunks and fullEvery divisible by 25");
  if (!["q22", "q22r"].includes(options.experiment)) fail("experiment must be q22 or q22r");
  return options;
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function withoutDistillation(entry) {
  const result = [];
  for (let index = 0; index < entry.length; ++index) {
    if (entry[index] === "--distill") { ++index; continue; }
    result.push(entry[index]);
  }
  return result;
}
function percent(value) { return `${(100 * value).toFixed(3)}%`; }
function frontierMarkdown(selection) {
  const experimentLabel = selection.experiment === "q22r" ? "Q2.2-R" : "Q2.2";
  const rows = (selection.frontier ?? []).map((entry) =>
    `| ${entry.update} | ${entry.phase} | ${entry.quantityPass ? "yes" : "no"} | ${percent(entry.minimumFacultyMargin)} | ${entry.replayLoss.toFixed(4)} | ${percent(entry.replayRegression)} | ${entry.feasible ? "yes" : "no"} |`).join("\n");
  const selected = selection.selected
    ? `Selected update ${selection.selected.update} from the feasible frontier.`
    : "No checkpoint was selected because the public quantity and replay constraints never passed jointly.";
  const promotion = selection.promotion?.evaluatedOnceAtEnd
    ? `The disjoint promotion set was evaluated once at the end; quantity pass: ${selection.promotion.quantityPass ? "yes" : "no"}.`
    : `The disjoint promotion set remained untouched: ${selection.promotion?.reason ?? "no feasible checkpoint"}.`;
  return `# ZERO.4-${experimentLabel} seed ${selection.seed} frontier\n\nDecision: **${selection.decision}**. Stop: ${selection.stoppedReason}.\n\n${selected} ${promotion}\n\n| Update | Phase | Quantity pass | Minimum learned-gate margin | Replay loss | Replay regression | Feasible |\n| ---: | --- | :---: | ---: | ---: | ---: | :---: |\n${rows}\n\nReplay baseline: ${selection.baselines.fullReplayLoss.toFixed(4)}. Updates executed: ${selection.updates.total} (${selection.updates.acquisition} acquisition, ${selection.updates.consolidation} consolidation).\n`;
}
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${command} exited ${result.status}: ${args.join(" ")}`);
  return result.stdout;
}
function replayLoss(output) {
  const matches = [...output.matchAll(/evaluation-only val ([0-9]+(?:\.[0-9]+)?)/g)];
  if (!matches.length) fail("replay evaluation emitted no validation loss");
  return Number(matches.at(-1)[1]);
}
function quantityMetrics(report) {
  const quantity = report.quantity;
  const rate = (field) => quantity.cases ? quantity[field] / quantity.cases : 0;
  const rates = Object.fromEntries(["closed", "syntax", "operation", "arguments", "exact_request", "oracle_arithmetic", "committed", "exact_artifact"].map((field) => [field, rate(field)]));
  const gates = {
    ...Object.fromEntries(Object.entries(rates).map(([field, value]) => [field, value >= THRESHOLDS[field]])),
    rejected_state_mutations: quantity.rejected_state_mutations <= THRESHOLDS.rejected_state_mutations,
  };
  const minimumFacultyMargin = Math.min(...FACULTY_GATES.map((field) => rates[field] - THRESHOLDS[field]));
  return { quantity, rates, gates, quantityPass: Object.values(gates).every(Boolean), minimumFacultyMargin };
}
function dominates(left, right) {
  const feasibilityNotWorse = left.feasible || !right.feasible;
  const notWorse = feasibilityNotWorse && left.minimumFacultyMargin >= right.minimumFacultyMargin - 1e-12 && left.replayLoss <= right.replayLoss + 1e-12;
  const strict = (left.feasible && !right.feasible) || left.minimumFacultyMargin > right.minimumFacultyMargin + 1e-12 || left.replayLoss < right.replayLoss - 1e-12;
  return notWorse && strict;
}
function updateFrontier(frontier, candidate) {
  if (frontier.some((entry) => dominates(entry, candidate) || (entry.feasible === candidate.feasible && entry.minimumFacultyMargin === candidate.minimumFacultyMargin && entry.replayLoss === candidate.replayLoss))) return { frontier, added: false, removed: [] };
  const removed = frontier.filter((entry) => dominates(candidate, entry));
  return { frontier: [...frontier.filter((entry) => !removed.includes(entry)), candidate], added: true, removed };
}
function selfTest() {
  const a = { minimumFacultyMargin: 0.01, replayLoss: 1.02, feasible: false };
  const b = { minimumFacultyMargin: 0.02, replayLoss: 1.03, feasible: false };
  const c = { minimumFacultyMargin: 0.03, replayLoss: 1.01, feasible: false };
  let frontier = updateFrontier([], a).frontier;
  frontier = updateFrontier(frontier, b).frontier;
  const result = updateFrontier(frontier, c);
  if (!result.added || result.frontier.length !== 1 || result.removed.length !== 2 || result.frontier[0] !== c) fail("Pareto frontier self-test failed");
  const feasible = { minimumFacultyMargin: 0.0, replayLoss: 1.02, feasible: true };
  const infeasible = { minimumFacultyMargin: 0.1, replayLoss: 1.01, feasible: false };
  const protectedFrontier = updateFrontier([feasible], infeasible).frontier;
  if (protectedFrontier.length !== 2 || dominates(infeasible, feasible)) fail("feasibility-aware frontier self-test failed");
  const metrics = quantityMetrics({ quantity: { cases: 100, closed: 100, syntax: 100, operation: 95, arguments: 100, exact_request: 95, oracle_arithmetic: 100, committed: 95, exact_artifact: 95, rejected_state_mutations: 0 } });
  if (!metrics.quantityPass || Math.abs(metrics.minimumFacultyMargin) > 1e-12) fail("feasibility self-test failed");
  const markdown = frontierMarkdown({ seed: 2, decision: "no-go", stoppedReason: "test", frontier: [{ update: 100, phase: "acquisition", quantityPass: false, minimumFacultyMargin: -0.1, replayLoss: 1.1, replayRegression: 0.03, feasible: false }], selected: null, promotion: { evaluatedOnceAtEnd: false, reason: "test" }, baselines: { fullReplayLoss: 1.0 }, updates: { total: 100, acquisition: 100, consolidation: 0 } });
  if (!markdown.includes("promotion set remained untouched") || !markdown.includes("| 100 |")) fail("frontier report self-test failed");
  const evaluationRoute = withoutDistillation(["--foundation", "x", "--sample-weight", "1", "--distill", "0.1,0.2,0.3"]);
  if (evaluationRoute.join(" ") !== "--foundation x --sample-weight 1") fail("replay evaluation route self-test failed");
  console.log("Q2.2 selector self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) { selfTest(); process.exit(0); }

const tools = {
  lm: "./literary_lm",
  export: "./export_literary",
  quantity: "./quantity_request_eval",
};
const files = {
  tokens: path.join(options.data, "quantity-request.tok"),
  sentinel: path.join(options.data, "quantity-request.sentinel.tsv"),
  public: path.join(options.data, "quantity-request.public.tsv"),
  promotion: path.join(options.data, "quantity-request.promotion.tsv"),
  active: `${options.prefix}-active.ckpt`,
  selected: path.join(options.out, "selected.ckpt"),
  selectedQ8: path.join(options.out, "selected.litq8"),
};
const teachers = {
  zero1: "teachers/zero1-foundation.teacher",
  zero2: "teachers/zero2-literary.teacher",
  zero3: "teachers/zero3-balanced-final.teacher",
};
const replayData = [
  ["--foundation", "corpus/bpe/zero-foundation.tok", "--sample-weight", "1", "--distill", "0.25,0.05,0.10"],
  ["--text", "corpus/bpe/shakespeare.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--text", "corpus/bpe/blake.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--text", "corpus/bpe/crowley.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--text", "corpus/bpe/bible-kjv.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--channel", "corpus/channel/literary-dialogue.tok", "--sample-weight", "1", "--distill", "0,0.10,0.20"],
];
const replayEvaluationData = replayData.map(withoutDistillation);
for (const file of [tools.lm, tools.export, tools.quantity, files.tokens, files.sentinel, files.public, files.promotion, path.join(options.data, "manifest.json"), ...Object.values(teachers), "corpus/literary.bpe"]) if (!fs.existsSync(file)) fail(`required file missing: ${file}`);
fs.mkdirSync(options.out, { recursive: true });
const candidateDirectory = path.join(options.out, "frontier");
fs.mkdirSync(candidateDirectory, { recursive: true });
atomicWrite(path.join(options.out, "training.log"), "");
const events = [];
function event(type, fields) {
  const value = { type, at: new Date().toISOString(), ...fields };
  events.push(value);
  atomicWrite(path.join(options.out, "events.jsonl"), `${events.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}
function replayArgs(checkpoint, batches, init = false) {
  return [init ? "--init" : "--resume", checkpoint, "--eval-only", "--tokenizer", "corpus/literary.bpe", ...replayEvaluationData.flat(), "--validation", String(batches)];
}
function evaluateReplay(checkpoint, batches, init = false) {
  const output = run(tools.lm, replayArgs(checkpoint, batches, init), { quiet: true });
  return { loss: replayLoss(output), output };
}
function evaluateQuantity(checkpoint, tsv, limit, label) {
  const q8 = `${options.prefix}-working.litq8`;
  const json = path.join(options.out, ".working-quantity.json");
  run(tools.export, [checkpoint, q8], { quiet: true });
  run(tools.quantity, [q8, tsv, "--json", json, "--limit", String(limit)], { quiet: true });
  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  fs.unlinkSync(json);
  const metrics = quantityMetrics(report);
  event("quantity-evaluation", { label, cases: metrics.quantity.cases, rates: metrics.rates, gates: metrics.gates, minimumFacultyMargin: metrics.minimumFacultyMargin });
  return metrics;
}
function trainingArgs({ first, phaseOffset, phaseTotal, chunkSteps, requestWeight, learningRate, warmup }) {
  return [
    first ? "--init" : "--resume", first ? teachers.zero3 : files.active,
    "--teacher", teachers.zero2, "--teacher-weight", "0.20",
    "--teacher", teachers.zero3, "--teacher-weight", "0.20",
    "--zero1-teacher", teachers.zero1, "--zero1-weight", "0.25",
    "--tokenizer", "corpus/literary.bpe", ...replayData.flat(),
    "--hard-channel", files.tokens, "--sample-weight", String(requestWeight),
    "--steps", String(chunkSteps), "--batch", String(options.batch),
    "--lr", String(learningRate), "--warmup", String(warmup), "--dropout", learningRate < 1e-5 ? "0.01" : "0.02", "--cosine",
    "--schedule-offset", String(phaseOffset), "--schedule-total", String(phaseTotal),
    "--report", "10", "--validation", "56", "--patience", "0",
    "--gradient-cosine", "10", "--seed", String(options.seed),
    "--save", files.active, "--tokens", "0",
  ];
}

const baselineSentinelEvaluation = evaluateReplay(teachers.zero3, options.sentinelReplayBatches, true);
const baselineFullEvaluation = evaluateReplay(teachers.zero3, options.fullReplayBatches, true);
const baselineSentinel = baselineSentinelEvaluation.loss;
const baselineFull = baselineFullEvaluation.loss;
atomicWrite(path.join(options.out, "replay-baseline.log"), baselineFullEvaluation.output);
event("baseline", { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull, teacher: teachers.zero3, sha256: sha256(teachers.zero3) });
const policy = {
  trainingLossEvery: 10,
  gradientCosineEvery: 10,
  gradientCosineProbe: "fixed faculty validation record against one deterministic rotating historical replay source, hard loss only",
  quantitySentinelEvery: 25,
  quantitySentinelCases: 64,
  fullEvaluationEvery: options.fullEvery,
  publicQuantityCases: 500,
  replayPressureAt: 0.015,
  replayPressureAction: "ratchet quantity sampling weight 4 to 3 to 2, increasing replay share from 60% to 66.7% to 75%",
  replayStopAt: 0.02,
  replayStopConsecutive: 2,
  noParetoImprovementUpdates: 200,
  selection: "feasibility first, then maximum minimum learned faculty-gate margin, then lower replay loss",
  promotion: "disjoint 500-case split evaluated once after feasible selection",
};

let frontier = [];
let totalUpdate = 0;
let acquisitionUpdate = 0;
let consolidationUpdate = 0;
let phase = "acquisition";
let requestWeight = 4;
let first = true;
let lastParetoUpdate = 0;
let previousFullReplay = baselineFull;
let consecutiveReplayViolations = 0;
let stoppedReason = null;

while (!stoppedReason) {
  const phaseOffset = phase === "acquisition" ? acquisitionUpdate : consolidationUpdate;
  const phaseTotal = phase === "acquisition" ? options.steps : options.consolidationSteps;
  if (phaseOffset >= phaseTotal) {
    if (phase === "acquisition") {
      phase = "consolidation";
      requestWeight = 2;
      event("phase-transition", { update: totalUpdate, reason: "acquisition budget completed", phase });
      continue;
    }
    stoppedReason = "consolidation budget completed";
    break;
  }
  const chunkSteps = Math.min(options.chunk, phaseTotal - phaseOffset);
  const trainingOutput = run(tools.lm, trainingArgs({
    first,
    phaseOffset,
    phaseTotal,
    chunkSteps,
    requestWeight,
    learningRate: phase === "acquisition" ? 0.00002 : 0.000005,
    warmup: phase === "acquisition" ? 100 : 50,
  }));
  fs.appendFileSync(path.join(options.out, "training.log"), trainingOutput);
  first = false;
  totalUpdate += chunkSteps;
  if (phase === "acquisition") acquisitionUpdate += chunkSteps; else consolidationUpdate += chunkSteps;

  const sentinelQuantity = evaluateQuantity(files.active, files.sentinel, 64, `sentinel-u${totalUpdate}`);
  const sentinelReplay = evaluateReplay(files.active, options.sentinelReplayBatches).loss;
  const sentinelRegression = (sentinelReplay - baselineSentinel) / baselineSentinel;
  event("sentinel", { update: totalUpdate, phase, quantityPass: sentinelQuantity.quantityPass, minimumFacultyMargin: sentinelQuantity.minimumFacultyMargin, replayLoss: sentinelReplay, replayRegression: sentinelRegression, requestWeight });
  if (sentinelRegression > 0.015 && requestWeight > 2) {
    requestWeight -= 1;
    event("replay-pressure", { update: totalUpdate, replayRegression: sentinelRegression, requestWeight });
  }

  if (totalUpdate % options.fullEvery !== 0) continue;
  const publicQuantity = evaluateQuantity(files.active, files.public, 500, `public-u${totalUpdate}`);
  const fullReplay = evaluateReplay(files.active, options.fullReplayBatches).loss;
  const replayRegression = (fullReplay - baselineFull) / baselineFull;
  const feasible = publicQuantity.quantityPass && replayRegression <= THRESHOLDS.replay_regression;
  const checkpoint = path.join(candidateDirectory, `u${String(totalUpdate).padStart(6, "0")}.ckpt`);
  const candidate = {
    update: totalUpdate,
    phase,
    minimumFacultyMargin: publicQuantity.minimumFacultyMargin,
    quantityPass: publicQuantity.quantityPass,
    replayLoss: fullReplay,
    replayRegression,
    feasible,
    rates: publicQuantity.rates,
    gates: publicQuantity.gates,
    checkpoint,
  };
  const changed = updateFrontier(frontier, candidate);
  if (changed.added) {
    fs.copyFileSync(files.active, checkpoint);
    for (const removed of changed.removed) if (fs.existsSync(removed.checkpoint)) fs.unlinkSync(removed.checkpoint);
    frontier = changed.frontier;
    lastParetoUpdate = totalUpdate;
  }
  event("full-evaluation", { ...candidate, paretoAdded: changed.added, removedUpdates: changed.removed.map((entry) => entry.update) });
  atomicWrite(path.join(options.out, "frontier.json"), `${JSON.stringify({ schema: "zero.zero4_q22_frontier.v1", baselineFull, frontier }, null, 2)}\n`);

  consecutiveReplayViolations = replayRegression > 0.02 ? consecutiveReplayViolations + 1 : 0;
  if (consecutiveReplayViolations >= 2) {
    stoppedReason = "replay exceeded 2% on two consecutive full evaluations";
    break;
  }
  const replayWorsening = previousFullReplay !== null && fullReplay > previousFullReplay + 1e-5;
  previousFullReplay = fullReplay;
  if (phase === "acquisition" && publicQuantity.quantityPass && replayWorsening) {
    phase = "consolidation";
    requestWeight = 2;
    event("phase-transition", { update: totalUpdate, reason: "quantity passed while replay worsened", phase });
  }
  if (totalUpdate - lastParetoUpdate >= 200) {
    stoppedReason = "no Pareto improvement for 200 updates";
    break;
  }
}

if (!frontier.length) fail("Q2.2 completed without a full-evaluation frontier candidate");
const feasibleFrontier = frontier.filter((entry) => entry.feasible);
if (!feasibleFrontier.length) {
  const diagnostic = [...frontier].sort((left, right) => right.minimumFacultyMargin - left.minimumFacultyMargin || left.replayLoss - right.replayLoss || left.update - right.update)[0];
  const final = {
    schema: "zero.zero4_q22_selection.v1",
    experiment: options.experiment,
    seed: options.seed,
    decision: "no-go",
    stoppedReason,
    updates: { total: totalUpdate, acquisition: acquisitionUpdate, consolidation: consolidationUpdate },
    baselines: { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull },
    policy,
    frontier,
    selected: null,
    diagnosticBest: diagnostic,
    selectedFromFeasibleFrontier: false,
    promotion: { evaluatedOnceAtEnd: false, reason: "no jointly feasible public-validation checkpoint" },
  };
  atomicWrite(path.join(options.out, "selection.json"), `${JSON.stringify(final, null, 2)}\n`);
  atomicWrite(path.join(options.out, "FRONTIER.md"), frontierMarkdown(final));
  const result = {
    schema: `zero.zero4_${options.experiment}_result.v1`,
    id: `zero4-${options.experiment}-seed${options.seed}`,
    decision: "no-go",
    promotion_eligible: false,
    promotion_blocker: "No checkpoint jointly passed public quantity and replay; three declared seeds are required for promotion",
    immutable_teachers: Object.fromEntries(Object.entries(teachers).map(([id, file]) => [id, sha256(file)])),
    corpus: {
      manifest: path.join(options.data, "manifest.json"),
      manifest_sha256: sha256(path.join(options.data, "manifest.json")),
    },
    checkpoint_selection: final,
  };
  atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(path.join(options.out, "RESULTS.md"), frontierMarkdown(final).replace(" frontier\n", "\n"));
  event("complete", { stoppedReason, selectedUpdate: null, selectedFeasible: false, promotionEvaluated: false });
  console.error("Q2.2 no-go: no checkpoint jointly passed quantity and replay; promotion remained untouched");
  process.exit(0);
}
const selectionPool = [...feasibleFrontier];
selectionPool.sort((left, right) => right.minimumFacultyMargin - left.minimumFacultyMargin || left.replayLoss - right.replayLoss || left.update - right.update);
const selected = selectionPool[0];
fs.copyFileSync(selected.checkpoint, files.selected);
run(tools.export, [files.selected, files.selectedQ8]);
const promotionJson = path.join(options.out, `seed${options.seed}-promotion.json`);
run(tools.quantity, [files.selectedQ8, files.promotion, "--json", promotionJson, "--limit", "500"]);
const promotion = quantityMetrics(JSON.parse(fs.readFileSync(promotionJson, "utf8")));
const selectedReplayOutput = run(tools.lm, replayArgs(files.selected, options.fullReplayBatches), { quiet: true });
atomicWrite(path.join(options.out, `seed${options.seed}-selected-replay.log`), selectedReplayOutput);
const final = {
  schema: "zero.zero4_q22_selection.v1",
  experiment: options.experiment,
  seed: options.seed,
  decision: promotion.quantityPass ? "go" : "no-go",
  stoppedReason,
  updates: { total: totalUpdate, acquisition: acquisitionUpdate, consolidation: consolidationUpdate },
  baselines: { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull },
  policy,
  frontier,
  selected,
  selectedFromFeasibleFrontier: feasibleFrontier.length > 0,
  promotion: { evaluatedOnceAtEnd: true, quantityPass: promotion.quantityPass, quantity: promotion.quantity, rates: promotion.rates, gates: promotion.gates },
  artifacts: { checkpoint: files.selected, quantized: files.selectedQ8, checkpointSha256: sha256(files.selected), quantizedSha256: sha256(files.selectedQ8) },
};
atomicWrite(path.join(options.out, "selection.json"), `${JSON.stringify(final, null, 2)}\n`);
atomicWrite(path.join(options.out, "FRONTIER.md"), frontierMarkdown(final));
event("complete", { stoppedReason, selectedUpdate: selected.update, selectedFeasible: selected.feasible, promotionQuantityPass: promotion.quantityPass });
console.log(`Q2.2 selected update ${selected.update}; feasible=${selected.feasible}; promotion quantity pass=${promotion.quantityPass}; stop=${stoppedReason}`);

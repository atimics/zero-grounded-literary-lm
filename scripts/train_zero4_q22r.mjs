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
const LEARNED_GATES = ["closed", "syntax", "operation", "exact_request", "committed", "exact_artifact"];

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = {
    q22Selection: "benchmarks/zero4-q22-v1/seed2/selection.json",
    prefix: "/tmp/zero4-q22r-seed2",
    out: "benchmarks/zero4-q22r-v1/seed2",
    data: "corpus/faculty/q22",
    starts: "400,300",
    steps: 100,
    chunk: 25,
    fullEvery: 50,
    batch: 2,
    seed: 2,
    learningRate: 0.000001,
    sentinelReplayBatches: 12,
    fullReplayBatches: 48,
  };
  const stringKeys = new Set(["q22Selection", "prefix", "out", "data", "starts"]);
  const allowed = new Set(["--q22-selection", "--prefix", "--out", "--data", "--starts", "--steps", "--chunk", "--full-every", "--batch", "--seed", "--learning-rate", "--sentinel-replay-batches", "--full-replay-batches"]);
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!allowed.has(option) || index + 1 >= argv.length) fail(`unknown or incomplete option ${option}`);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[++index];
    options[key] = stringKeys.has(key) ? value : Number(value);
  }
  for (const key of ["steps", "chunk", "fullEvery", "batch", "sentinelReplayBatches", "fullReplayBatches"]) {
    if (!Number.isInteger(options[key]) || options[key] < 1) fail(`${key} must be a positive integer`);
  }
  if (!Number.isInteger(options.seed) || options.seed < 0 || !Number.isFinite(options.learningRate) || options.learningRate <= 0) fail("seed and learning rate are invalid");
  if (options.chunk !== 25 || options.fullEvery !== 50 || options.steps > 100 || options.steps % options.chunk !== 0) fail("Q2.2-R freezes 25-update chunks, 50-update full evaluations, and at most 100 repair updates");
  options.startUpdates = options.starts.split(",").map(Number);
  if (options.startUpdates.length !== 2 || options.startUpdates.some((value) => !Number.isInteger(value) || value < 1) || new Set(options.startUpdates).size !== 2) fail("--starts must name two distinct positive updates");
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
  return {
    quantity,
    rates,
    gates,
    quantityPass: Object.values(gates).every(Boolean),
    minimumFacultyMargin: Math.min(...LEARNED_GATES.map((field) => rates[field] - THRESHOLDS[field])),
  };
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
function render(result) {
  const rows = result.frontier.map((entry) => `| ${entry.sourceUpdate} | ${entry.repairUpdate} | ${entry.quantityPass ? "yes" : "no"} | ${percent(entry.minimumFacultyMargin)} | ${entry.replayLoss.toFixed(4)} | ${percent(entry.replayRegression)} | ${entry.feasible ? "yes" : "no"} |`).join("\n");
  const selection = result.selected
    ? `Selected source update ${result.selected.sourceUpdate} after ${result.selected.repairUpdate} replay-only updates.`
    : "No replay-repair checkpoint passed quantity and replay jointly.";
  const promotion = result.promotion.evaluatedOnceAtEnd
    ? `Promotion was evaluated once after selection; quantity pass: ${result.promotion.quantityPass ? "yes" : "no"}.`
    : `Promotion remained untouched: ${result.promotion.reason}.`;
  return `# ZERO.4-Q2.2-R seed ${result.seed}\n\nDecision: **${result.decision}**. ${selection} ${promotion}\n\n| Source update | Repair updates | Quantity pass | Minimum learned-gate margin | Replay loss | Replay regression | Feasible |\n| ---: | ---: | :---: | ---: | ---: | ---: | :---: |\n${rows}\n\nReplay baseline: ${result.baselines.fullReplayLoss.toFixed(4)}. Repair policy: replay only, fresh optimizer, learning rate ${result.policy.learningRate}, no warmup, no cosine decay.\n`;
}
function selfTest() {
  const feasible = { feasible: true, minimumFacultyMargin: 0.0, replayLoss: 1.02 };
  const infeasible = { feasible: false, minimumFacultyMargin: 0.1, replayLoss: 1.01 };
  if (dominates(infeasible, feasible) || updateFrontier([feasible], infeasible).frontier.length !== 2) fail("feasibility frontier self-test failed");
  const metrics = quantityMetrics({ quantity: { cases: 100, closed: 100, syntax: 100, operation: 95, arguments: 100, exact_request: 95, oracle_arithmetic: 100, committed: 95, exact_artifact: 95, rejected_state_mutations: 0 } });
  if (!metrics.quantityPass || Math.abs(metrics.minimumFacultyMargin) > 1e-12) fail("quantity gate self-test failed");
  const evaluationRoute = withoutDistillation(["--foundation", "x", "--sample-weight", "1", "--distill", "0.1,0.2,0.3"]);
  if (evaluationRoute.join(" ") !== "--foundation x --sample-weight 1") fail("replay evaluation route self-test failed");
  console.log("Q2.2-R replay-repair self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) { selfTest(); process.exit(0); }

const tools = { lm: "./literary_lm", export: "./export_literary", quantity: "./quantity_request_eval" };
const files = {
  sentinel: path.join(options.data, "quantity-request.sentinel.tsv"),
  public: path.join(options.data, "quantity-request.public.tsv"),
  promotion: path.join(options.data, "quantity-request.promotion.tsv"),
  selected: `${options.prefix}-best.ckpt`,
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
for (const file of [options.q22Selection, tools.lm, tools.export, tools.quantity, files.sentinel, files.public, files.promotion, ...Object.values(teachers), "corpus/literary.bpe"]) if (!fs.existsSync(file)) fail(`required file missing: ${file}`);
const q22 = JSON.parse(fs.readFileSync(options.q22Selection, "utf8"));
const sources = options.startUpdates.map((update) => {
  const entry = q22.frontier.find((candidate) => candidate.update === update);
  if (!entry || !entry.quantityPass || !fs.existsSync(entry.checkpoint)) fail(`Q2.2 source update ${update} is not a retained quantity-passing checkpoint`);
  return { ...entry, sourceUpdate: update };
});

fs.mkdirSync(options.out, { recursive: true });
const frontierDirectory = path.join(options.out, "frontier");
fs.mkdirSync(frontierDirectory, { recursive: true });
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
  const metrics = quantityMetrics(JSON.parse(fs.readFileSync(json, "utf8")));
  fs.unlinkSync(json);
  event("quantity-evaluation", { label, cases: metrics.quantity.cases, rates: metrics.rates, gates: metrics.gates, minimumFacultyMargin: metrics.minimumFacultyMargin });
  return metrics;
}
function trainingArgs({ source, active, first, chunkSteps }) {
  return [
    first ? "--init" : "--resume", first ? source.checkpoint : active,
    "--teacher", teachers.zero2, "--teacher-weight", "0.20",
    "--teacher", teachers.zero3, "--teacher-weight", "0.20",
    "--zero1-teacher", teachers.zero1, "--zero1-weight", "0.25",
    "--tokenizer", "corpus/literary.bpe", ...replayData.flat(),
    "--steps", String(chunkSteps), "--batch", String(options.batch),
    "--lr", String(options.learningRate), "--warmup", "0", "--dropout", "0.01",
    "--report", "10", "--validation", "48", "--patience", "0",
    "--seed", String(options.seed), "--save", active, "--tokens", "0",
  ];
}

const baselineSentinelEvaluation = evaluateReplay(teachers.zero3, options.sentinelReplayBatches, true);
const baselineFullEvaluation = evaluateReplay(teachers.zero3, options.fullReplayBatches, true);
const baselineSentinel = baselineSentinelEvaluation.loss;
const baselineFull = baselineFullEvaluation.loss;
atomicWrite(path.join(options.out, "replay-baseline.log"), baselineFullEvaluation.output);
event("baseline", { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull, teacher: teachers.zero3, sha256: sha256(teachers.zero3) });

let frontier = [];
const branchResults = [];
function addCandidate(source, repairUpdate, modelCheckpoint, quantity, replay, owned) {
  const replayRegression = (replay - baselineFull) / baselineFull;
  const checkpoint = owned
    ? path.join(frontierDirectory, `u${source.sourceUpdate}-r${String(repairUpdate).padStart(3, "0")}.ckpt`)
    : modelCheckpoint;
  const candidate = {
    sourceUpdate: source.sourceUpdate,
    repairUpdate,
    minimumFacultyMargin: quantity.minimumFacultyMargin,
    quantityPass: quantity.quantityPass,
    replayLoss: replay,
    replayRegression,
    feasible: quantity.quantityPass && replayRegression <= THRESHOLDS.replay_regression,
    rates: quantity.rates,
    gates: quantity.gates,
    checkpoint,
    owned,
  };
  const changed = updateFrontier(frontier, candidate);
  if (changed.added) {
    if (owned) fs.copyFileSync(modelCheckpoint, candidate.checkpoint);
    for (const removed of changed.removed) if (removed.owned && fs.existsSync(removed.checkpoint)) fs.unlinkSync(removed.checkpoint);
    frontier = changed.frontier;
  }
  event("full-evaluation", { ...candidate, paretoAdded: changed.added, removed: changed.removed.map((entry) => ({ sourceUpdate: entry.sourceUpdate, repairUpdate: entry.repairUpdate })) });
  atomicWrite(path.join(options.out, "frontier.json"), `${JSON.stringify({ schema: "zero.zero4_q22r_frontier.v1", baselineFull, frontier }, null, 2)}\n`);
  return candidate;
}

for (const source of sources) {
  const branch = `u${source.sourceUpdate}`;
  const active = `${options.prefix}-${branch}-active.ckpt`;
  const trainingLog = path.join(options.out, `${branch}-training.log`);
  atomicWrite(trainingLog, "");
  event("branch-start", { sourceUpdate: source.sourceUpdate, checkpoint: source.checkpoint, checkpointSha256: sha256(source.checkpoint), optimizer: "fresh", learningRate: options.learningRate });

  const startQuantity = evaluateQuantity(source.checkpoint, files.public, 500, `${branch}-public-r000`);
  const startReplay = evaluateReplay(source.checkpoint, options.fullReplayBatches).loss;
  addCandidate(source, 0, source.checkpoint, startQuantity, startReplay, false);
  let repairUpdate = 0;
  let first = true;
  let stoppedReason = null;
  while (repairUpdate < options.steps && !stoppedReason) {
    const chunkSteps = Math.min(options.chunk, options.steps - repairUpdate);
    const output = run(tools.lm, trainingArgs({ source, active, first, chunkSteps }));
    fs.appendFileSync(trainingLog, output);
    first = false;
    repairUpdate += chunkSteps;

    const sentinelQuantity = evaluateQuantity(active, files.sentinel, 64, `${branch}-sentinel-r${String(repairUpdate).padStart(3, "0")}`);
    const sentinelReplay = evaluateReplay(active, options.sentinelReplayBatches).loss;
    const sentinelRegression = (sentinelReplay - baselineSentinel) / baselineSentinel;
    event("sentinel", { sourceUpdate: source.sourceUpdate, repairUpdate, quantityPass: sentinelQuantity.quantityPass, minimumFacultyMargin: sentinelQuantity.minimumFacultyMargin, replayLoss: sentinelReplay, replayRegression: sentinelRegression });
    if (!sentinelQuantity.quantityPass) {
      stoppedReason = "quantity sentinel failed";
      break;
    }
    if (repairUpdate % options.fullEvery !== 0) continue;

    const publicQuantity = evaluateQuantity(active, files.public, 500, `${branch}-public-r${String(repairUpdate).padStart(3, "0")}`);
    const fullReplay = evaluateReplay(active, options.fullReplayBatches).loss;
    addCandidate(source, repairUpdate, active, publicQuantity, fullReplay, true);
    if (!publicQuantity.quantityPass) stoppedReason = "public quantity gate failed";
  }
  if (!stoppedReason) stoppedReason = "repair budget completed";
  branchResults.push({ sourceUpdate: source.sourceUpdate, repairUpdates: repairUpdate, stoppedReason });
  event("branch-complete", branchResults.at(-1));
}

const feasible = frontier.filter((entry) => entry.feasible).sort((left, right) => right.minimumFacultyMargin - left.minimumFacultyMargin || left.replayLoss - right.replayLoss || left.repairUpdate - right.repairUpdate);
const policy = {
  sources: options.startUpdates,
  replayOnly: true,
  freshOptimizerPerBranch: true,
  learningRate: options.learningRate,
  warmup: 0,
  cosineDecay: false,
  dropout: 0.01,
  sentinelEvery: options.chunk,
  fullEvaluationEvery: options.fullEvery,
  maximumRepairUpdates: options.steps,
  stopOnQuantityFailure: true,
  selection: "feasibility first, then maximum minimum learned faculty-gate margin, then lower replay loss",
};
if (!feasible.length) {
  const result = {
    schema: "zero.zero4_q22r_selection.v1",
    seed: options.seed,
    decision: "no-go",
    policy,
    baselines: { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull },
    branches: branchResults,
    frontier,
    selected: null,
    promotion: { evaluatedOnceAtEnd: false, reason: "no jointly feasible replay-repair checkpoint" },
  };
  atomicWrite(path.join(options.out, "selection.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(path.join(options.out, "FRONTIER.md"), render(result));
  event("complete", { decision: result.decision, selected: null, promotionEvaluated: false });
  console.error("Q2.2-R no-go: replay repair produced no jointly feasible checkpoint; promotion remained untouched");
  process.exit(2);
}

const selected = feasible[0];
run(tools.export, [selected.checkpoint, files.selectedQ8]);
const promotionJson = path.join(options.out, `seed${options.seed}-promotion.json`);
run(tools.quantity, [files.selectedQ8, files.promotion, "--json", promotionJson, "--limit", "500"]);
const promotion = quantityMetrics(JSON.parse(fs.readFileSync(promotionJson, "utf8")));
const selectedReplayOutput = evaluateReplay(selected.checkpoint, options.fullReplayBatches).output;
atomicWrite(path.join(options.out, `seed${options.seed}-selected-replay.log`), selectedReplayOutput);
const result = {
  schema: "zero.zero4_q22r_selection.v1",
  seed: options.seed,
  decision: promotion.quantityPass ? "go" : "no-go",
  policy,
  baselines: { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull },
  branches: branchResults,
  frontier,
  selected,
  promotion: { evaluatedOnceAtEnd: true, quantityPass: promotion.quantityPass, quantity: promotion.quantity, rates: promotion.rates, gates: promotion.gates },
  artifacts: { checkpoint: selected.checkpoint, quantized: files.selectedQ8, checkpointSha256: sha256(selected.checkpoint), quantizedSha256: sha256(files.selectedQ8) },
};
atomicWrite(path.join(options.out, "selection.json"), `${JSON.stringify(result, null, 2)}\n`);
atomicWrite(path.join(options.out, "FRONTIER.md"), render(result));
event("complete", { decision: result.decision, sourceUpdate: selected.sourceUpdate, repairUpdate: selected.repairUpdate, promotionQuantityPass: promotion.quantityPass });
console.log(`Q2.2-R selected source ${selected.sourceUpdate} + ${selected.repairUpdate} replay-only updates; promotion quantity pass=${promotion.quantityPass}`);

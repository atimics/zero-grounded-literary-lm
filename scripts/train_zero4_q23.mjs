#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const THRESHOLDS = Object.freeze({ closed: 0.99, syntax: 0.99, operation: 0.95, arguments: 0.95, exact_request: 0.95, oracle_arithmetic: 1, committed: 0.95, exact_artifact: 0.95, rejected_state_mutations: 0, replay_regression: 0.02 });
const FACULTY_GATES = ["closed", "syntax", "operation", "exact_request", "committed", "exact_artifact"];
function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${command} exited ${result.status}: ${args.join(" ")}`);
  return result.stdout;
}
function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { stage: "observer", prefix: "/tmp/zero4-q23-observer-seed2", out: "benchmarks/zero4-q23-v1/observer-seed2", data: "corpus/faculty/q22", observerResult: "benchmarks/zero4-q23-v1/observer-seed2/result.json", steps: 1000, consolidationSteps: 400, batch: 2, seed: 2, recoveryEvery: 25, fullEvery: 100, sentinelReplayBatches: 12, fullReplayBatches: 48 };
  const strings = new Set(["stage", "prefix", "out", "data", "observerResult"]);
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!option.startsWith("--") || index + 1 >= argv.length) fail(`unknown or incomplete option ${option}`);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!Object.hasOwn(options, key)) fail(`unknown option ${option}`);
    const value = argv[++index];
    options[key] = strings.has(key) ? value : Number(value);
  }
  assert(["observer", "guard"].includes(options.stage), "stage must be observer or guard");
  assert(options.seed === 2, "Q2.3 v1 permits diagnostic seed 2 only; seeds 1 and 3 are sealed");
  for (const key of ["steps", "consolidationSteps", "batch", "recoveryEvery", "fullEvery", "sentinelReplayBatches", "fullReplayBatches"]) assert(Number.isInteger(options[key]) && options[key] > 0, `${key} must be a positive integer`);
  assert(options.recoveryEvery === 25 && options.fullEvery === 100, "Q2.3 recovery/full cadences are frozen at 25/100 committed updates");
  return options;
}
function checkpointProgress(file) {
  const data = fs.readFileSync(file);
  assert(data.length >= 80 && data.toString("ascii", 0, 8) === "ZEROLM2\0", `invalid checkpoint ${file}`);
  assert(data.readUInt32LE(8) === 4, `Q2.3 requires checkpoint v4: ${file}`);
  return { committed: Number(data.readBigUInt64LE(48)), attempts: Number(data.readBigUInt64LE(64)), consecutiveRejections: data.readUInt32LE(72), transactionMode: data.readUInt32LE(76) };
}
function learnedStateEqual(left, right) {
  const a = fs.readFileSync(left);
  const b = fs.readFileSync(right);
  return a.subarray(80).equals(b.subarray(80));
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
  const gates = { ...Object.fromEntries(Object.entries(rates).map(([field, value]) => [field, value >= THRESHOLDS[field]])), rejected_state_mutations: quantity.rejected_state_mutations <= THRESHOLDS.rejected_state_mutations };
  return { quantity, rates, gates, quantityPass: Object.values(gates).every(Boolean), minimumFacultyMargin: Math.min(...FACULTY_GATES.map((field) => rates[field] - THRESHOLDS[field])) };
}
function dominates(left, right) {
  const notWorse = (left.feasible || !right.feasible) && left.minimumFacultyMargin >= right.minimumFacultyMargin - 1e-12 && left.replayLoss <= right.replayLoss + 1e-12;
  return notWorse && ((left.feasible && !right.feasible) || left.minimumFacultyMargin > right.minimumFacultyMargin + 1e-12 || left.replayLoss < right.replayLoss - 1e-12);
}
function updateFrontier(frontier, candidate) {
  if (frontier.some((entry) => dominates(entry, candidate))) return { frontier, added: false, removed: [] };
  const removed = frontier.filter((entry) => dominates(candidate, entry));
  return { frontier: [...frontier.filter((entry) => !removed.includes(entry)), candidate], added: true, removed };
}
function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}
function pearson(pairs) {
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + (pair.x - meanX) * (pair.y - meanY), 0);
  const denominatorX = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair.x - meanX) ** 2, 0));
  const denominatorY = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair.y - meanY) ** 2, 0));
  return denominatorX > 0 && denominatorY > 0 ? numerator / (denominatorX * denominatorY) : null;
}
function resultMarkdown(result) {
  const rows = (result.frontier ?? []).map((entry) => `| ${entry.committed} | ${entry.totalAttempts} | ${entry.phase} | ${entry.quantityPass ? "yes" : "no"} | ${(100 * entry.minimumFacultyMargin).toFixed(3)}% | ${(100 * entry.replayRegression).toFixed(3)}% | ${entry.feasible ? "yes" : "no"} |`).join("\n");
  const promotion = result.promotion?.evaluatedOnceAtEnd ? `Promotion was evaluated exactly once; quantity pass: ${result.promotion.quantityPass ? "yes" : "no"}.` : `Promotion remained sealed: ${result.promotion?.reason ?? "observer stage"}.`;
  const modelHash = result.decision === "go" ? `\nModel SHA-256: \`${result.artifacts.quantizedSha256}\`.\n` : "";
  const lastFrontier = result.frontier?.at(-1);
  const diagnostics = result.guardDiagnostics ? `\nGuard decisions: ${result.guardDiagnostics.accepted} accepted, ${result.guardDiagnostics.rejected} rejected. The maximum local replay-probe\nincrease was ${(100 * result.guardDiagnostics.maxRelativeProbeIncrease).toFixed(4)}%; ${result.guardDiagnostics.warningExceedances} attempts exceeded the ${(100 * result.guardDiagnostics.warningRelativeIncrease).toFixed(4)}% warning band and ${result.guardDiagnostics.hardExceedances === 0 ? "none" : result.guardDiagnostics.hardExceedances}\nexceeded the ${(100 * result.guardDiagnostics.hardRelativeIncrease).toFixed(2)}% hard band. The guard therefore made no intervention${lastFrontier ? `, while\nthe update-${lastFrontier.committed} public replay regression reached ${(100 * lastFrontier.replayRegression).toFixed(3)}% cumulatively` : ""}.\n` : "";
  return `# ZERO.4-Q2.3 seed 2 ${result.stage ?? "observer"}\n\nDecision: **${result.decision}**. Stop: ${result.stoppedReason}.\n\n${promotion}${modelHash}${diagnostics}\n| Committed | Attempts | Phase | Quantity pass | Minimum gate margin | Replay regression | Feasible |\n| ---: | ---: | --- | :---: | ---: | ---: | :---: |\n${rows || "| — | — | — | — | — | — | — |"}\n`;
}
function writeResultArtifacts(result) {
  atomicWrite(path.join(options.out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(path.join(options.out, "selection.json"), `${JSON.stringify({ schema: "zero.zero4_q23_selection.v1", seed: 2, stage: result.stage, decision: result.decision, stoppedReason: result.stoppedReason, attempts: result.attempts, committed: result.committed, guardBudget: result.guardBudget, ...(result.guardDiagnostics ? { guardDiagnostics: result.guardDiagnostics } : {}), frontier: result.frontier, selected: result.selected ?? null, promotion: result.promotion }, null, 2)}\n`);
  atomicWrite(path.join(options.out, result.stage === "observer" ? "OBSERVER.md" : "RESULTS.md"), resultMarkdown(result));
}
function selfTest() {
  const buffer = Buffer.alloc(80); buffer.write("ZEROLM2\0", 0, "ascii"); buffer.writeUInt32LE(4, 8); buffer.writeBigUInt64LE(7n, 48); buffer.writeBigUInt64LE(9n, 64); buffer.writeUInt32LE(2, 72); buffer.writeUInt32LE(2, 76);
  const file = "/tmp/zero4-q23-driver-self-test.ckpt"; fs.writeFileSync(file, buffer);
  const progress = checkpointProgress(file);
  assert(progress.committed === 7 && progress.attempts === 9 && progress.consecutiveRejections === 2 && progress.transactionMode === 2, "checkpoint progress self-test failed");
  const feasible = { feasible: true, minimumFacultyMargin: 0, replayLoss: 1.02 };
  const infeasible = { feasible: false, minimumFacultyMargin: 0.1, replayLoss: 1.01 };
  assert(updateFrontier([feasible], infeasible).frontier.length === 2, "feasibility frontier self-test failed");
  const report = resultMarkdown({ stage: "guard", decision: "no-go", stoppedReason: "test", promotion: { evaluatedOnceAtEnd: false, reason: "test" }, guardDiagnostics: { accepted: 2, rejected: 0, warningRelativeIncrease: 0.001641, hardRelativeIncrease: 0.0025, warningExceedances: 1, hardExceedances: 0, maxRelativeProbeIncrease: 0.002013 }, frontier: [{ committed: 200, totalAttempts: 200, phase: "acquisition", quantityPass: true, minimumFacultyMargin: 0, replayRegression: 0.026854, feasible: false }] });
  assert(report.includes("0.25% hard band") && report.includes("2.685% cumulatively"), "guard result report self-test failed");
  let rejected = false; try { parseArgs(["node", "script", "--seed", "1"]); } catch { rejected = true; }
  assert(rejected, "sealed seed self-test failed");
  console.log("Q2.3 driver self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) { selfTest(); process.exit(0); }
const contract = JSON.parse(fs.readFileSync("benchmarks/zero4-q23-v1/contract.json", "utf8"));
const tools = { lm: "./literary_lm", export: "./export_literary", quantity: "./quantity_request_eval", check: "scripts/check_zero4_q23.mjs" };
const files = { tokens: path.join(options.data, "quantity-request.tok"), sentinel: path.join(options.data, "quantity-request.sentinel.tsv"), public: path.join(options.data, "quantity-request.public.tsv"), promotion: path.join(options.data, "quantity-request.promotion.tsv"), active: `${options.prefix}-active.ckpt`, reference: `${options.prefix}-reference.ckpt`, attempts: path.join(options.out, "optimizer-attempts.jsonl"), events: path.join(options.out, "events.jsonl"), selected: path.join(options.out, "selected.ckpt"), selectedQ8: path.join(options.out, "selected.litq8") };
const teachers = { zero1: "teachers/zero1-foundation.teacher", zero2: "teachers/zero2-literary.teacher", zero3: "teachers/zero3-balanced-final.teacher" };
const replayData = [
  ["--foundation", "corpus/bpe/zero-foundation.tok", "--sample-weight", "1", "--distill", "0.25,0.05,0.10"],
  ["--text", "corpus/bpe/shakespeare.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--text", "corpus/bpe/blake.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--text", "corpus/bpe/crowley.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--text", "corpus/bpe/bible-kjv.tok", "--sample-weight", "1", "--distill", "0,0.20,0.15"],
  ["--channel", "corpus/channel/literary-dialogue.tok", "--sample-weight", "1", "--distill", "0,0.10,0.20"],
];
const replayEvaluationData = replayData.map((entry) => entry.filter((_, index) => index < entry.indexOf("--distill")));
for (const file of [...Object.values(tools).filter((entry) => entry.startsWith("./")), ...Object.values(teachers), files.tokens, files.sentinel, files.public, files.promotion, "corpus/literary.bpe", "benchmarks/zero4-q23-v1/contract.json"]) assert(fs.existsSync(file), `required file missing: ${file}`);
assert(sha256(path.join(options.data, "manifest.json")) === contract.quantity_corpus.manifest_sha256, "quantity corpus manifest hash changed");
assert(sha256(files.tokens) === contract.quantity_corpus.tokens_sha256, "quantity token corpus hash changed");
assert(sha256(files.sentinel) === contract.quantity_corpus.sentinel_sha256, "quantity sentinel hash changed");
assert(sha256(files.public) === contract.quantity_corpus.public_sha256, "quantity public split hash changed");
assert(sha256(files.promotion) === contract.quantity_corpus.promotion_sha256, "quantity promotion split hash changed");
for (const [id, file] of Object.entries(teachers)) assert(sha256(file) === contract.immutable_teachers[id], `${id} teacher hash changed`);
for (const [file, hash] of Object.entries(contract.replay_corpus)) assert(sha256(file) === hash, `replay corpus changed: ${file}`);
let observerGate = null;
if (options.stage === "guard") {
  assert(fs.existsSync(options.observerResult), `observer gate missing: ${options.observerResult}`);
  observerGate = JSON.parse(fs.readFileSync(options.observerResult, "utf8"));
  assert(observerGate.decision === "pass" && observerGate.learnedStateEquivalent === true && observerGate.promotionAccessed === false, "observer gate did not pass cleanly");
  assert(observerGate.calibration?.hardRelativeIncrease >= contract.guard.hard_relative_increase_floor && observerGate.calibration.hardRelativeIncrease <= contract.guard.hard_relative_increase_cap, "observer guard calibration is outside frozen bounds");
}
const guardBudget = observerGate?.calibration.hardRelativeIncrease ?? contract.guard.hard_relative_increase_floor;
assert(!fs.existsSync(path.join(options.out, "result.json")), `result already exists: ${options.out}`);
fs.mkdirSync(path.join(options.out, "recovery"), { recursive: true });
atomicWrite(files.attempts, ""); atomicWrite(files.events, ""); atomicWrite(path.join(options.out, "training.log"), "");
const events = [];
function event(type, fields) { events.push({ type, at: new Date().toISOString(), ...fields }); atomicWrite(files.events, `${events.map(JSON.stringify).join("\n")}\n`); }
function replayArgs(checkpoint, batches, init = false) { return [init ? "--init" : "--resume", checkpoint, "--eval-only", "--tokenizer", "corpus/literary.bpe", ...replayEvaluationData.flat(), "--validation", String(batches)]; }
function evaluateReplay(checkpoint, batches, init = false) { return replayLoss(run(tools.lm, replayArgs(checkpoint, batches, init), { quiet: true })); }
function evaluateQuantity(checkpoint, tsv, limit) {
  const q8 = `${options.prefix}-working.litq8`; const json = path.join(options.out, ".working-quantity.json");
  run(tools.export, [checkpoint, q8], { quiet: true }); run(tools.quantity, [q8, tsv, "--json", json, "--limit", String(limit)], { quiet: true });
  const metrics = quantityMetrics(JSON.parse(fs.readFileSync(json, "utf8"))); fs.unlinkSync(json); return metrics;
}
function trainingArgs({ checkpoint, first, phase, phaseOffset, phaseTotal, attempts, requestWeight, reference = false }) {
  const learningRate = phase === "acquisition" ? contract.budget.acquisition_learning_rate : contract.budget.consolidation_learning_rate;
  const args = [first ? "--init" : "--resume", first ? teachers.zero3 : checkpoint, "--teacher", teachers.zero2, "--teacher-weight", "0.20", "--teacher", teachers.zero3, "--teacher-weight", "0.20", "--zero1-teacher", teachers.zero1, "--zero1-weight", "0.25", "--tokenizer", "corpus/literary.bpe", ...replayData.flat(), "--hard-channel", files.tokens, "--sample-weight", String(requestWeight), "--steps", String(attempts), "--batch", String(options.batch), "--lr", String(learningRate), "--warmup", phase === "acquisition" ? "100" : "50", "--dropout", phase === "acquisition" ? "0.02" : "0.01", "--cosine", "--schedule-offset", String(phaseOffset), "--schedule-total", String(phaseTotal), "--report", "25", "--validation", "56", "--patience", "0", "--seed", String(options.seed), "--save", checkpoint, "--tokens", "0"];
  if (!reference) args.push("--transaction-mode", options.stage, "--transaction-log", files.attempts, "--transaction-phase", options.stage === "observer" ? "observer" : phase, "--transaction-probe", String(contract.guard.functional_probe_every_attempts), "--transaction-budget", String(guardBudget), "--transaction-max-rejections", String(contract.guard.maximum_consecutive_rejections));
  return args;
}

const baselineSentinel = evaluateReplay(teachers.zero3, options.sentinelReplayBatches, true);
const baselineFull = evaluateReplay(teachers.zero3, options.fullReplayBatches, true);
event("baseline", { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull });
let phase = "acquisition"; let phaseAttempts = 0; let totalAttempts = 0; let committed = 0; let first = true; let referenceFirst = true; let requestWeight = 4; let frontier = []; let stoppedReason = null; let previousFullReplay = baselineFull; let consecutiveReplayViolations = 0; let lastParetoCommitted = 0; let transactionMilliseconds = 0; let referenceMilliseconds = 0;
while (!stoppedReason) {
  const phaseBudget = phase === "acquisition" ? options.steps : options.consolidationSteps;
  if (phaseAttempts >= phaseBudget) {
    if (phase === "acquisition") { phase = "consolidation"; phaseAttempts = 0; requestWeight = 2; event("phase-transition", { phase, committed, totalAttempts, reason: "acquisition attempt budget completed" }); continue; }
    stoppedReason = "consolidation attempt budget completed"; break;
  }
  const nextRecovery = (Math.floor(committed / options.recoveryEvery) + 1) * options.recoveryEvery;
  const requestedAttempts = Math.min(nextRecovery - committed, phaseBudget - phaseAttempts);
  const offset = phaseAttempts;
  const transactionStarted = Date.now();
  const output = run(tools.lm, trainingArgs({ checkpoint: files.active, first, phase, phaseOffset: offset, phaseTotal: phaseBudget, attempts: requestedAttempts, requestWeight }));
  transactionMilliseconds += Date.now() - transactionStarted;
  fs.appendFileSync(path.join(options.out, "training.log"), output); first = false;
  const progress = checkpointProgress(files.active); const executedAttempts = progress.attempts - totalAttempts;
  assert(executedAttempts > 0 && executedAttempts <= requestedAttempts, "invalid checkpoint attempt progress");
  phaseAttempts += executedAttempts; totalAttempts = progress.attempts; committed = progress.committed;
  if (options.stage === "observer") {
    const referenceStarted = Date.now();
    run(tools.lm, trainingArgs({ checkpoint: files.reference, first: referenceFirst, phase, phaseOffset: offset, phaseTotal: phaseBudget, attempts: executedAttempts, requestWeight, reference: true }), { quiet: true });
    referenceMilliseconds += Date.now() - referenceStarted;
    referenceFirst = false;
    assert(learnedStateEqual(files.active, files.reference), `observer changed learned state at attempt ${totalAttempts}`);
  }
  event("recovery", { phase, committed, totalAttempts, consecutiveRejections: progress.consecutiveRejections });
  if (committed === nextRecovery) {
    fs.copyFileSync(files.active, path.join(options.out, "recovery", `u${String(committed).padStart(6, "0")}.ckpt`));
    const sentinelQuantity = evaluateQuantity(files.active, files.sentinel, 64); const sentinelReplay = evaluateReplay(files.active, options.sentinelReplayBatches);
    event("sentinel", { phase, committed, totalAttempts, quantityPass: sentinelQuantity.quantityPass, minimumFacultyMargin: sentinelQuantity.minimumFacultyMargin, replayLoss: sentinelReplay, replayRegression: (sentinelReplay - baselineSentinel) / baselineSentinel });
  }
  if (committed > 0 && committed % options.fullEvery === 0 && !frontier.some((entry) => entry.committed === committed)) {
    const quantity = evaluateQuantity(files.active, files.public, 500); const replay = evaluateReplay(files.active, options.fullReplayBatches); const replayRegression = (replay - baselineFull) / baselineFull;
    const candidate = { committed, totalAttempts, phase, quantityPass: quantity.quantityPass, minimumFacultyMargin: quantity.minimumFacultyMargin, replayLoss: replay, replayRegression, feasible: quantity.quantityPass && replayRegression <= THRESHOLDS.replay_regression, rates: quantity.rates, gates: quantity.gates, checkpoint: path.join(options.out, "recovery", `u${String(committed).padStart(6, "0")}.ckpt`) };
    const changed = updateFrontier(frontier, candidate); frontier = changed.frontier; if (changed.added) lastParetoCommitted = committed;
    event("full-evaluation", { ...candidate, paretoAdded: changed.added }); atomicWrite(path.join(options.out, "frontier.json"), `${JSON.stringify({ schema: "zero.zero4_q23_frontier.v1", frontier }, null, 2)}\n`);
    consecutiveReplayViolations = replayRegression > THRESHOLDS.replay_regression ? consecutiveReplayViolations + 1 : 0;
    if (consecutiveReplayViolations >= 2) stoppedReason = "replay exceeded 2% on two consecutive full evaluations";
    else if (phase === "acquisition" && quantity.quantityPass && replay > previousFullReplay + 1e-5) { phase = "consolidation"; phaseAttempts = 0; requestWeight = 2; event("phase-transition", { phase, committed, totalAttempts, reason: "quantity passed while replay worsened" }); }
    else if (committed - lastParetoCommitted >= 200) stoppedReason = "no Pareto improvement for 200 committed updates";
    previousFullReplay = replay;
  }
  if (executedAttempts < requestedAttempts || progress.consecutiveRejections >= contract.guard.maximum_consecutive_rejections) stoppedReason = "transaction rejection fallback ended the phase";
}
run("node", [tools.check, "benchmarks/zero4-q23-v1/contract.json", files.attempts], { quiet: true });
const recordedAttempts = fs.readFileSync(files.attempts, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const guardDiagnostics = options.stage === "guard" ? {
  accepted: recordedAttempts.filter((attempt) => attempt.decision === "accept").length,
  rejected: recordedAttempts.filter((attempt) => attempt.decision === "reject").length,
  warningRelativeIncrease: observerGate.calibration.warningRelativeIncrease,
  hardRelativeIncrease: guardBudget,
  warningExceedances: recordedAttempts.filter((attempt) => attempt.relative_probe_change > observerGate.calibration.warningRelativeIncrease).length,
  hardExceedances: recordedAttempts.filter((attempt) => attempt.relative_probe_change > guardBudget).length,
  maxRelativeProbeIncrease: Math.max(...recordedAttempts.map((attempt) => attempt.relative_probe_change)),
  minRelativeProbeChange: Math.min(...recordedAttempts.map((attempt) => attempt.relative_probe_change)),
} : null;
if (options.stage === "observer") {
  const observedAttempts = recordedAttempts;
  const positiveChanges = observedAttempts.map((attempt) => attempt.relative_probe_change).filter((value) => typeof value === "number" && value > 0);
  const warningRelativeIncrease = Math.max(contract.guard.warning_relative_increase_floor, quantile(positiveChanges, contract.guard.calibration.warning_quantile));
  const hardRelativeIncrease = Math.min(contract.guard.hard_relative_increase_cap, Math.max(contract.guard.hard_relative_increase_floor, quantile(positiveChanges, contract.guard.calibration.hard_quantile) + contract.guard.calibration.hard_margin));
  let previousSentinelCommitted = 0;
  const predictivePairs = events.filter((entry) => entry.type === "sentinel").map((sentinel) => {
    const predicted = observedAttempts.filter((attempt) => attempt.committed_update > previousSentinelCommitted && attempt.committed_update <= sentinel.committed).reduce((sum, attempt) => sum + attempt.predicted_replay_drift, 0);
    previousSentinelCommitted = sentinel.committed;
    return { committed: sentinel.committed, x: predicted, y: sentinel.replayRegression };
  });
  const result = { schema: "zero.zero4_q23_observer_result.v1", seed: 2, decision: "pass", stoppedReason, attempts: totalAttempts, committed, learnedStateEquivalent: learnedStateEqual(files.active, files.reference), promotionAccessed: false, contractSha256: sha256("benchmarks/zero4-q23-v1/contract.json"), calibration: { positiveProbeChanges: positiveChanges.length, warningRelativeIncrease, hardRelativeIncrease, rule: contract.guard.calibration }, predictiveValidity: { pairs: predictivePairs, pearson: pearson(predictivePairs) }, performance: { observerSeconds: transactionMilliseconds / 1000, referenceSeconds: referenceMilliseconds / 1000, runtimeOverheadRatio: referenceMilliseconds > 0 ? transactionMilliseconds / referenceMilliseconds : null, preallocatedDiagnosticBytes: 6 * contract.student.parameters * 4 + contract.parameter_groups.length * 3 * 8 + 512 }, frontier };
  writeResultArtifacts({ ...result, stage: "observer", guardBudget: null, promotion: { evaluatedOnceAtEnd: false, reason: "observer stage never accesses promotion" } }); event("complete", result); console.log(`Q2.3 observer pass: ${totalAttempts} attempts, ${committed} byte-identical committed updates`); process.exit(0);
}
const feasible = frontier.filter((entry) => entry.feasible).sort((a, b) => b.minimumFacultyMargin - a.minimumFacultyMargin || a.replayLoss - b.replayLoss || a.committed - b.committed);
if (!feasible.length) {
  const result = { schema: "zero.zero4_q23_result.v1", seed: 2, stage: "guard", decision: "no-go", stoppedReason, attempts: totalAttempts, committed, guardBudget, guardDiagnostics, contractSha256: sha256("benchmarks/zero4-q23-v1/contract.json"), immutable_teachers: contract.immutable_teachers, quantity_corpus: contract.quantity_corpus, frontier, selected: null, promotion: { evaluatedOnceAtEnd: false, reason: "no jointly feasible public checkpoint" } };
  writeResultArtifacts(result); event("complete", { decision: "no-go", stoppedReason }); console.error("Q2.3 seed 2 no-go; promotion remained sealed"); process.exit(0);
}
const selected = feasible[0]; fs.copyFileSync(selected.checkpoint, files.selected); run(tools.export, [files.selected, files.selectedQ8], { quiet: true });
const promotionJson = path.join(options.out, "seed2-promotion.json"); run(tools.quantity, [files.selectedQ8, files.promotion, "--json", promotionJson, "--limit", "500"], { quiet: true }); const promotion = quantityMetrics(JSON.parse(fs.readFileSync(promotionJson, "utf8")));
const result = { schema: "zero.zero4_q23_result.v1", seed: 2, stage: "guard", decision: promotion.quantityPass ? "go" : "no-go", stoppedReason, attempts: totalAttempts, committed, guardBudget, guardDiagnostics, contractSha256: sha256("benchmarks/zero4-q23-v1/contract.json"), immutable_teachers: contract.immutable_teachers, quantity_corpus: contract.quantity_corpus, selected, frontier, promotion: { evaluatedOnceAtEnd: true, quantityPass: promotion.quantityPass, rates: promotion.rates, gates: promotion.gates }, artifacts: { checkpoint: files.selected, checkpointSha256: sha256(files.selected), quantized: files.selectedQ8, quantizedSha256: sha256(files.selectedQ8) } };
writeResultArtifacts(result); event("complete", { decision: result.decision, selectedCommitted: selected.committed, promotionQuantityPass: promotion.quantityPass }); console.log(`Q2.3 seed 2 ${result.decision}; promotion evaluated exactly once`);

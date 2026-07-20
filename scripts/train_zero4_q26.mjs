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
  const options = { prefix: "/tmp/zero4-q26-seed2", out: "benchmarks/zero4-q26-v1/seed2", data: "corpus/faculty/q22", replicationContract: null, steps: 1000, consolidationSteps: 400, batch: 2, seed: 2, recoveryEvery: 25, fullEvery: 100, sentinelReplayBatches: 12, fullReplayBatches: 48 };
  const strings = new Set(["prefix", "out", "data", "replicationContract"]);
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!option.startsWith("--") || index + 1 >= argv.length) fail(`unknown or incomplete option ${option}`);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!Object.hasOwn(options, key)) fail(`unknown option ${option}`);
    const value = argv[++index];
    options[key] = strings.has(key) ? value : Number(value);
  }
  const diagnostic = options.seed === 2 && options.replicationContract === null;
  const replication = [1, 3].includes(options.seed) && options.replicationContract === "benchmarks/zero4-q26r-v1/contract.json";
  assert(diagnostic || replication, "Q2.6 permits diagnostic seed 2 or prospectively authorized Q2.6-R seeds 1 and 3 only");
  for (const key of ["steps", "consolidationSteps", "batch", "recoveryEvery", "fullEvery", "sentinelReplayBatches", "fullReplayBatches"]) assert(Number.isInteger(options[key]) && options[key] > 0, `${key} must be a positive integer`);
  assert(options.recoveryEvery === 25 && options.fullEvery === 100, "Q2.6 recovery/full cadences are frozen at 25/100 committed updates");
  return options;
}
function checkpointProgress(file) {
  const data = fs.readFileSync(file);
  assert(data.length >= 80 && data.toString("ascii", 0, 8) === "ZEROLM2\0", `invalid checkpoint ${file}`);
  assert(data.readUInt32LE(8) === 4, `Q2.6 requires checkpoint v4: ${file}`);
  return { committed: Number(data.readBigUInt64LE(48)), attempts: Number(data.readBigUInt64LE(64)), consecutiveRejections: data.readUInt32LE(72), transactionMode: data.readUInt32LE(76) };
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
  if (frontier.some((entry) => dominates(entry, candidate))) return { frontier, added: false };
  return { frontier: [...frontier.filter((entry) => !dominates(candidate, entry)), candidate], added: true };
}
function resultMarkdown(result) {
  const rows = (result.frontier ?? []).map((entry) => `| ${entry.committed} | ${entry.totalAttempts} | ${entry.phase} | ${entry.quantityPass ? "yes" : "no"} | ${(100 * entry.minimumFacultyMargin).toFixed(3)}% | ${(100 * entry.replayRegression).toFixed(3)}% | ${entry.feasible ? "yes" : "no"} |`).join("\n");
  const promotion = result.promotion?.evaluatedOnceAtEnd ? `Promotion was evaluated exactly once; quantity pass: ${result.promotion.quantityPass ? "yes" : "no"}.` : `Promotion remained sealed: ${result.promotion?.reason}.`;
  const modelHash = result.decision === "go" ? `\nModel SHA-256: \`${result.artifacts.quantizedSha256}\`.\n` : "";
  const diagnostics = result.guardDiagnostics ? `\nTangent decisions: ${result.guardDiagnostics.projectedTrials} projected trials and ${result.guardDiagnostics.projectedAccepted} projected commits; ${result.guardDiagnostics.fullScaleAccepted} full-scale commits, ${result.guardDiagnostics.backtrackedAccepted} scaled commits, and ${result.guardDiagnostics.exhausted} exhausted outer attempts across ${result.guardDiagnostics.trialEvaluations} candidate trials. The minimum accepted scale was ${result.guardDiagnostics.minAcceptedScale}; the maximum committed composite replay increase was ${(100 * result.guardDiagnostics.maxCommittedRelativeIncrease).toFixed(3)}%.\n` : "";
  return `# ZERO.4-Q2.6 seed ${result.seed} cumulative tangent projection\n\nDecision: **${result.decision}**. Stop: ${result.stoppedReason}.\n\n${promotion}${modelHash}${diagnostics}\n| Committed | Attempts | Phase | Quantity pass | Minimum gate margin | Replay regression | Feasible |\n| ---: | ---: | --- | :---: | ---: | ---: | :---: |\n${rows || "| — | — | — | — | — | — | — |"}\n`;
}
function writeResultArtifacts(result) {
  atomicWrite(path.join(options.out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
  atomicWrite(path.join(options.out, "selection.json"), `${JSON.stringify({ schema: "zero.zero4_q26_selection.v1", seed: result.seed, stage: result.stage, decision: result.decision, stoppedReason: result.stoppedReason, attempts: result.attempts, committed: result.committed, guardBudget: result.guardBudget, guardDiagnostics: result.guardDiagnostics, frontier: result.frontier, selected: result.selected ?? null, promotion: result.promotion }, null, 2)}\n`);
  atomicWrite(path.join(options.out, "RESULTS.md"), resultMarkdown(result));
}
function selfTest() {
  const buffer = Buffer.alloc(80); buffer.write("ZEROLM2\0", 0, "ascii"); buffer.writeUInt32LE(4, 8); buffer.writeBigUInt64LE(7n, 48); buffer.writeBigUInt64LE(9n, 64); buffer.writeUInt32LE(2, 72); buffer.writeUInt32LE(5, 76);
  const file = "/tmp/zero4-q26-driver-self-test.ckpt"; fs.writeFileSync(file, buffer);
  const progress = checkpointProgress(file);
  assert(progress.committed === 7 && progress.attempts === 9 && progress.consecutiveRejections === 2 && progress.transactionMode === 5, "checkpoint progress self-test failed");
  const feasible = { feasible: true, minimumFacultyMargin: 0, replayLoss: 1.02 };
  const infeasible = { feasible: false, minimumFacultyMargin: 0.1, replayLoss: 1.01 };
  assert(updateFrontier([feasible], infeasible).frontier.length === 2, "feasibility frontier self-test failed");
  let rejected = false; try { parseArgs(["node", "script", "--seed", "1"]); } catch { rejected = true; }
  assert(rejected, "unregistered replication seed self-test failed");
  const replication = parseArgs(["node", "script", "--seed", "1", "--replication-contract", "benchmarks/zero4-q26r-v1/contract.json"]);
  assert(replication.seed === 1 && replication.replicationContract, "registered replication seed self-test failed");
  console.log("Q2.6 driver self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) { selfTest(); process.exit(0); }
const diagnosticContractPath = "benchmarks/zero4-q26-v1/contract.json";
const contract = JSON.parse(fs.readFileSync(diagnosticContractPath, "utf8"));
let replicationContract = null;
if (options.replicationContract) {
  replicationContract = JSON.parse(fs.readFileSync(options.replicationContract, "utf8"));
  const diagnosticResultPath = "benchmarks/zero4-q26-v1/seed2/result.json";
  const diagnosticModelPath = "benchmarks/zero4-q26-v1/seed2/selected.litq8";
  assert(replicationContract.schema === "zero.zero4_q26_replication_contract.v1" && replicationContract.status === "preregistered", "Q2.6-R contract identity drifted");
  assert(JSON.stringify(replicationContract.authorized_seeds) === "[1,3]" && replicationContract.authorized_seeds.includes(options.seed), "Q2.6-R seed is not authorized");
  assert(replicationContract.design_lock.diagnostic_contract_sha256 === sha256(diagnosticContractPath), "Q2.6-R diagnostic contract drifted");
  assert(replicationContract.design_lock.diagnostic_result_sha256 === sha256(diagnosticResultPath), "Q2.6-R diagnostic result drifted");
  assert(replicationContract.design_lock.diagnostic_model_sha256 === sha256(diagnosticModelPath), "Q2.6-R diagnostic model drifted");
  const diagnosticResult = JSON.parse(fs.readFileSync(diagnosticResultPath, "utf8"));
  assert(diagnosticResult.seed === 2 && diagnosticResult.decision === "go" && diagnosticResult.promotion?.quantityPass === true, "Q2.6-R authorization lacks the seed-2 go");
}
const resultContractFields = replicationContract ? { replicationContractSha256: sha256(options.replicationContract), diagnosticContractSha256: sha256(diagnosticContractPath) } : { contractSha256: sha256(diagnosticContractPath) };
const tools = { lm: "./literary_lm", export: "./export_literary", quantity: "./quantity_request_eval", check: "scripts/check_zero4_q26.mjs" };
const files = { tokens: path.join(options.data, "quantity-request.tok"), sentinel: path.join(options.data, "quantity-request.sentinel.tsv"), public: path.join(options.data, "quantity-request.public.tsv"), promotion: path.join(options.data, "quantity-request.promotion.tsv"), active: `${options.prefix}-active.ckpt`, attempts: path.join(options.out, "optimizer-attempts.jsonl"), events: path.join(options.out, "events.jsonl"), selected: path.join(options.out, "selected.ckpt"), selectedQ8: path.join(options.out, "selected.litq8") };
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
for (const file of [...Object.values(tools).filter((entry) => entry.startsWith("./")), ...Object.values(teachers), files.tokens, files.sentinel, files.public, files.promotion, "corpus/literary.bpe", "benchmarks/zero4-q26-v1/contract.json"]) assert(fs.existsSync(file), `required file missing: ${file}`);
assert(sha256(path.join(options.data, "manifest.json")) === contract.quantity_corpus.manifest_sha256, "quantity corpus manifest hash changed");
assert(sha256(files.tokens) === contract.quantity_corpus.tokens_sha256, "quantity token corpus hash changed");
assert(sha256(files.sentinel) === contract.quantity_corpus.sentinel_sha256, "quantity sentinel hash changed");
assert(sha256(files.public) === contract.quantity_corpus.public_sha256, "quantity public split hash changed");
assert(sha256(files.promotion) === contract.quantity_corpus.promotion_sha256, "quantity promotion split hash changed");
for (const [id, file] of Object.entries(teachers)) assert(sha256(file) === contract.immutable_teachers[id], `${id} teacher hash changed`);
for (const [file, hash] of Object.entries(contract.replay_corpus)) assert(sha256(file) === hash, `replay corpus changed: ${file}`);
const guardBudget = contract.guard.hard_relative_increase;
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
function trainingArgs({ checkpoint, first, phase, phaseOffset, phaseTotal, attempts, requestWeight }) {
  const learningRate = phase === "acquisition" ? contract.budget.acquisition_learning_rate : contract.budget.consolidation_learning_rate;
  return [first ? "--init" : "--resume", first ? teachers.zero3 : checkpoint, "--teacher", teachers.zero2, "--teacher-weight", "0.20", "--teacher", teachers.zero3, "--teacher-weight", "0.20", "--zero1-teacher", teachers.zero1, "--zero1-weight", "0.25", "--tokenizer", "corpus/literary.bpe", ...replayData.flat(), "--hard-channel", files.tokens, "--sample-weight", String(requestWeight), "--steps", String(attempts), "--batch", String(options.batch), "--lr", String(learningRate), "--warmup", phase === "acquisition" ? "100" : "50", "--dropout", phase === "acquisition" ? "0.02" : "0.01", "--cosine", "--schedule-offset", String(phaseOffset), "--schedule-total", String(phaseTotal), "--report", "25", "--validation", "56", "--patience", "0", "--seed", String(options.seed), "--save", checkpoint, "--tokens", "0", "--transaction-mode", "cumulative-tangent", "--transaction-log", files.attempts, "--transaction-phase", phase, "--transaction-probe", String(contract.guard.probe_every_attempts), "--transaction-budget", String(guardBudget), "--transaction-max-rejections", String(contract.guard.maximum_consecutive_exhausted_attempts)];
}

const baselineSentinel = evaluateReplay(teachers.zero3, options.sentinelReplayBatches, true);
const baselineFull = evaluateReplay(teachers.zero3, options.fullReplayBatches, true);
event("baseline", { sentinelReplayLoss: baselineSentinel, fullReplayLoss: baselineFull });
let phase = "acquisition"; let phaseAttempts = 0; let totalAttempts = 0; let committed = 0; let first = true; let requestWeight = 4; let frontier = []; let stoppedReason = null; let previousFullReplay = baselineFull; let consecutiveReplayViolations = 0; let lastParetoCommitted = 0; let transactionMilliseconds = 0;
while (!stoppedReason) {
  const phaseBudget = phase === "acquisition" ? options.steps : options.consolidationSteps;
  if (phaseAttempts >= phaseBudget) {
    if (phase === "acquisition") { phase = "consolidation"; phaseAttempts = 0; requestWeight = 2; event("phase-transition", { phase, committed, totalAttempts, reason: "acquisition attempt budget completed" }); continue; }
    stoppedReason = "consolidation attempt budget completed"; break;
  }
  const nextRecovery = (Math.floor(committed / options.recoveryEvery) + 1) * options.recoveryEvery;
  const requestedAttempts = Math.min(nextRecovery - committed, phaseBudget - phaseAttempts);
  const transactionStarted = Date.now();
  const output = run(tools.lm, trainingArgs({ checkpoint: files.active, first, phase, phaseOffset: phaseAttempts, phaseTotal: phaseBudget, attempts: requestedAttempts, requestWeight }));
  transactionMilliseconds += Date.now() - transactionStarted;
  fs.appendFileSync(path.join(options.out, "training.log"), output); first = false;
  const progress = checkpointProgress(files.active); const executedAttempts = progress.attempts - totalAttempts;
  assert(progress.transactionMode === 5, "Q2.6 checkpoint transaction mode drifted");
  assert(executedAttempts > 0 && executedAttempts <= requestedAttempts, "invalid checkpoint attempt progress");
  phaseAttempts += executedAttempts; totalAttempts = progress.attempts; committed = progress.committed;
  event("recovery", { phase, committed, totalAttempts, consecutiveExhaustedAttempts: progress.consecutiveRejections });
  if (committed === nextRecovery) {
    fs.copyFileSync(files.active, path.join(options.out, "recovery", `u${String(committed).padStart(6, "0")}.ckpt`));
    const sentinelQuantity = evaluateQuantity(files.active, files.sentinel, 64); const sentinelReplay = evaluateReplay(files.active, options.sentinelReplayBatches);
    event("sentinel", { phase, committed, totalAttempts, quantityPass: sentinelQuantity.quantityPass, minimumFacultyMargin: sentinelQuantity.minimumFacultyMargin, replayLoss: sentinelReplay, replayRegression: (sentinelReplay - baselineSentinel) / baselineSentinel });
  }
  if (committed > 0 && committed % options.fullEvery === 0 && !frontier.some((entry) => entry.committed === committed)) {
    const quantity = evaluateQuantity(files.active, files.public, 500); const replay = evaluateReplay(files.active, options.fullReplayBatches); const replayRegression = (replay - baselineFull) / baselineFull;
    const candidate = { committed, totalAttempts, phase, quantityPass: quantity.quantityPass, minimumFacultyMargin: quantity.minimumFacultyMargin, replayLoss: replay, replayRegression, feasible: quantity.quantityPass && replayRegression <= THRESHOLDS.replay_regression, rates: quantity.rates, gates: quantity.gates, checkpoint: path.join(options.out, "recovery", `u${String(committed).padStart(6, "0")}.ckpt`) };
    const changed = updateFrontier(frontier, candidate); frontier = changed.frontier; if (changed.added) lastParetoCommitted = committed;
    event("full-evaluation", { ...candidate, paretoAdded: changed.added }); atomicWrite(path.join(options.out, "frontier.json"), `${JSON.stringify({ schema: "zero.zero4_q26_frontier.v1", frontier }, null, 2)}\n`);
    consecutiveReplayViolations = replayRegression > THRESHOLDS.replay_regression ? consecutiveReplayViolations + 1 : 0;
    if (consecutiveReplayViolations >= 2) stoppedReason = "replay exceeded 2% on two consecutive full evaluations";
    else if (phase === "acquisition" && quantity.quantityPass && replay > previousFullReplay + 1e-5) { phase = "consolidation"; phaseAttempts = 0; requestWeight = 2; event("phase-transition", { phase, committed, totalAttempts, reason: "quantity passed while replay worsened" }); }
    else if (committed - lastParetoCommitted >= 200) stoppedReason = "no Pareto improvement for 200 committed updates";
    previousFullReplay = replay;
  }
  if (executedAttempts < requestedAttempts || progress.consecutiveRejections >= contract.guard.maximum_consecutive_exhausted_attempts) stoppedReason = "tangent-projected backtracking exhaustion ended the phase";
}
run("node", [tools.check, "benchmarks/zero4-q26-v1/contract.json", files.attempts], { quiet: true });
const recordedAttempts = fs.readFileSync(files.attempts, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const acceptedAttempts = recordedAttempts.filter((attempt) => attempt.decision === "accept");
const trials = recordedAttempts.flatMap((attempt) => attempt.backtrack_trials);
const finiteTrialChanges = trials.map((trial) => trial.relative_change).filter(Number.isFinite);
const finiteCommittedChanges = acceptedAttempts.map((attempt) => attempt.cumulative_relative_change).filter(Number.isFinite);
const projectedTrials = trials.filter((trial) => trial.projection_applied);
const projectedAccepted = acceptedAttempts.filter((attempt) => attempt.projection_applied);
const guardDiagnostics = {
  fullScaleAccepted: acceptedAttempts.filter((attempt) => attempt.accepted_scale === 1).length,
  backtrackedAccepted: acceptedAttempts.filter((attempt) => attempt.accepted_scale < 1).length,
  exhausted: recordedAttempts.filter((attempt) => attempt.decision === "reject").length,
  trialEvaluations: trials.length,
  maxTrialsUsed: Math.max(...recordedAttempts.map((attempt) => attempt.backtrack_trial_count)),
  minAcceptedScale: acceptedAttempts.length ? Math.min(...acceptedAttempts.map((attempt) => attempt.accepted_scale)) : null,
  warningTrialExceedances: trials.filter((trial) => !Number.isFinite(trial.relative_change) || trial.relative_change > contract.guard.warning_relative_increase).length,
  hardTrialExceedances: trials.filter((trial) => !Number.isFinite(trial.relative_change) || trial.relative_change > guardBudget).length,
  maxTrialRelativeIncrease: finiteTrialChanges.length ? Math.max(...finiteTrialChanges) : null,
  maxCommittedRelativeIncrease: finiteCommittedChanges.length ? Math.max(...finiteCommittedChanges) : null,
  projectedTrials: projectedTrials.length,
  projectedAccepted: projectedAccepted.length,
  unprojectedTrials: trials.length - projectedTrials.length,
  maxProjectionRemovedFraction: projectedTrials.length ? Math.max(...projectedTrials.map((trial) => trial.projection_removed_fraction)) : 0,
  meanProjectionRemovedFraction: projectedTrials.length ? projectedTrials.reduce((sum, trial) => sum + trial.projection_removed_fraction, 0) / projectedTrials.length : 0,
  maxProjectionPreDot: projectedTrials.length ? Math.max(...projectedTrials.map((trial) => trial.projection_pre_dot)) : 0,
  maxAbsoluteProjectionPostDot: projectedTrials.length ? Math.max(...projectedTrials.map((trial) => Math.abs(trial.projection_post_dot))) : 0,
  transactionSeconds: transactionMilliseconds / 1000,
};
const feasible = frontier.filter((entry) => entry.feasible).sort((a, b) => b.minimumFacultyMargin - a.minimumFacultyMargin || a.replayLoss - b.replayLoss || a.committed - b.committed);
if (!feasible.length) {
  const result = { schema: "zero.zero4_q26_result.v1", seed: options.seed, stage: "cumulative-tangent", decision: "no-go", stoppedReason, attempts: totalAttempts, committed, guardBudget, guardDiagnostics, ...resultContractFields, immutable_teachers: contract.immutable_teachers, quantity_corpus: contract.quantity_corpus, frontier, selected: null, promotion: { evaluatedOnceAtEnd: false, reason: "no jointly feasible public checkpoint" } };
  writeResultArtifacts(result); event("complete", { decision: "no-go", stoppedReason }); console.error(`Q2.6 seed ${options.seed} no-go; promotion remained sealed`); process.exit(0);
}
const selected = feasible[0]; fs.copyFileSync(selected.checkpoint, files.selected); run(tools.export, [files.selected, files.selectedQ8], { quiet: true });
const promotionJson = path.join(options.out, `seed${options.seed}-promotion.json`); run(tools.quantity, [files.selectedQ8, files.promotion, "--json", promotionJson, "--limit", "500"], { quiet: true }); const promotion = quantityMetrics(JSON.parse(fs.readFileSync(promotionJson, "utf8")));
const result = { schema: "zero.zero4_q26_result.v1", seed: options.seed, stage: "cumulative-tangent", decision: promotion.quantityPass ? "go" : "no-go", stoppedReason, attempts: totalAttempts, committed, guardBudget, guardDiagnostics, ...resultContractFields, immutable_teachers: contract.immutable_teachers, quantity_corpus: contract.quantity_corpus, selected, frontier, promotion: { evaluatedOnceAtEnd: true, quantityPass: promotion.quantityPass, rates: promotion.rates, gates: promotion.gates }, artifacts: { checkpoint: files.selected, checkpointSha256: sha256(files.selected), quantized: files.selectedQ8, quantizedSha256: sha256(files.selectedQ8) } };
writeResultArtifacts(result); event("complete", { decision: result.decision, selectedCommitted: selected.committed, promotionQuantityPass: promotion.quantityPass }); console.log(`Q2.6 seed ${options.seed} ${result.decision}; promotion evaluated exactly once`);

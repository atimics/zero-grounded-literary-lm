// ZERO.5 S1 scale-control runner: two training stages plus frozen evaluation.
// Stage A: C2 Atlas recipe at 5x parameters (fresh init, sequential).
// Stage B: C4.3 grouped packs initialized from stage A.
// Evaluation: the frozen C4.3 evaluator against the hash-locked C2 baseline.

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined) fail(`missing value for ${name}`);
  return value;
}

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function requireArtifact(file, expected, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  if (!expected) return;
  if (sha256(file) !== expected.sha256) fail(`${label} changed`);
  if (expected.bytes !== undefined &&
      fs.statSync(file).size !== expected.bytes) fail(`${label} changed`);
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${program} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

async function runStreaming(program, args, environment, logPath, maxSeconds) {
  const child = spawn(program, args, {
    env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  const write = (chunk) => {
    stdout += chunk;
    fs.appendFileSync(logPath, chunk);
    process.stdout.write(chunk);
    return chunk;
  };
  child.stdout.on("data", write);
  child.stderr.on("data", write);
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10000);
  }, maxSeconds * 1000);
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        reject(new Error(`${program} failed: ${(stdout).trim().slice(-4000)}`));
      } else resolve(stdout);
    });
  });
  return stdout;
}

function parseAccounting(log) {
  const match = log.match(
    /sampling sequences=(\d+) compute-token-exposures=(\d+) active-targets=(\d+) answer-targets=(\d+)(?: claim-answer-targets=(\d+) cloze-answer-targets=(\d+) retrieval-answer-targets=(\d+))? padding-targets=(\d+) wraps=(\d+)/u);
  if (!match) return null;
  return {
    sequences: Number(match[1]),
    compute_token_exposures: Number(match[2]),
    active_targets: Number(match[3]),
    answer_targets: Number(match[4]),
    claim_answer_targets: match[5] === undefined ? null : Number(match[5]),
    cloze_answer_targets: match[6] === undefined ? null : Number(match[6]),
    retrieval_answer_targets: match[7] === undefined ? null : Number(match[7]),
    padding_targets: Number(match[8]),
    wraps: Number(match[9]),
  };
}

async function selfTest() {
  const parsed = parseAccounting(
    "update 1 train 6.25 val 6.24 grad 5.4 lr 3e-06 tok/s 3500\n" +
    "packed sampling sequences=37768 compute-token-exposures=19337216 " +
    "active-targets=14850534 answer-targets=2843431 " +
    "claim-answer-targets=942560 cloze-answer-targets=430769 " +
    "retrieval-answer-targets=1470102 padding-targets=4486682 wraps=0\n");
  if (parsed.compute_token_exposures !== 19337216 ||
      parsed.claim_answer_targets !== 942560 || parsed.wraps !== 0) {
    fail("self-test accounting parse failed");
  }
  process.stdout.write("S1 runner self-test passed\n");
  process.exit(0);
}
if (process.argv.includes("--self-test")) selfTest();

const contractPath = path.resolve(option("--contract",
  "benchmarks/zero5-s1-scale-v1/contract.json"));
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const contractSha256 = sha256(contractPath);

const importDirectory = path.resolve(option("--c43-import",
  "build/zero5-c43-v1/import-final"));
const c0Directory = path.resolve(option("--c0-dir",
  "build/zero5-c0-v1/corpus-one"));
const c2Directory = path.resolve(option("--c2-dir", "build/zero5-c2-v1/run"));
const c2ImportDirectory = path.resolve(option("--c2-import-dir",
  "build/zero5-c2-v1/import-final"));
const out = path.resolve(option("--out", "build/zero5-s1-scale-v1/run"));
const binary = path.resolve(option("--trainer", "./zero5_c32_lm_vector_math"));
const preflightOnly = process.argv.includes("--preflight-only");
const resumeRun = process.argv.includes("--resume-run");

if (contract.schema !== "zero.s1_scale_contract.v1" ||
    contract.status !== "authorized-unrun-aws" ||
    contract.authorized !== true)
  fail("S1 contract is not an authorized, unrun registration");
if (contract.execution.venue !== "aws us-east-1 c6i.4xlarge on-demand" ||
    contract.execution.spot_instances !== false ||
    contract.execution.gpu !== false ||
    contract.execution.automatic_termination !== true)
  fail("S1 execution venue bounds changed");
if (contract.test.metrics_opened !== false)
  fail("sealed-test policy changed");

requireArtifact(contract.implementation.trainer,
  { sha256: contract.implementation.trainer_sha256 }, "frozen trainer");
requireArtifact(contract.evaluation.evaluator,
  { sha256: contract.evaluation.evaluator_sha256 }, "frozen evaluator");
const c43Contract = JSON.parse(fs.readFileSync(
  path.resolve(contract.stage_b.contract)));
if (sha256(path.resolve(contract.stage_b.contract)) !==
    contract.stage_b.contract_sha256) fail("C4.3 contract hash drifted");

const files = {
  tokenizer: path.join(c0Directory, "byte-bpe512.sero"),
  atlasTrain: path.join(c2ImportDirectory, "atlas.train.byte-bpe512.tok"),
  atlasValidation: path.join(c2ImportDirectory, "atlas.validation.byte-bpe512.tok"),
  anchorTrain: path.join(c0Directory, "train.byte-bpe512.tok"),
  anchorValidation: path.join(c0Directory, "validation.byte-bpe512.tok"),
  baseline: path.join(c2Directory, "best.ckpt"),
  trainB: path.join(importDirectory, "train.primary.grouped.z5pack"),
  validationB: path.join(importDirectory, "frozen-validation", "validation.z5pack"),
};
requireArtifact(files.tokenizer,
  { sha256: c43Contract.model.tokenizer_sha256 }, "tokenizer");
requireArtifact(files.atlasTrain,
  { sha256: contract.stage_a.train_sha256 }, "atlas train");
requireArtifact(files.atlasValidation,
  { sha256: contract.stage_a.validation_sha256 }, "atlas validation");
requireArtifact(files.trainB, { sha256: contract.stage_b.train_sha256 },
  "C4.3 primary packs");
requireArtifact(files.validationB,
  { sha256: contract.stage_b.validation_sha256 }, "frozen validation packs");
requireArtifact(files.baseline, { sha256:
  c43Contract.initialization.checkpoint_sha256 }, "C2 baseline");
if (!fs.existsSync(binary)) fail("trainer binary is missing");

fs.mkdirSync(out, { recursive: true });
const stageADir = path.join(out, "stageA");
const stageBDir = path.join(out, "stageB");
const environment = {
  LITERARY_BACKEND: "openblas",
  OPENBLAS_DYNAMIC: "0",
  OPENBLAS_NUM_THREADS: String(contract.execution.openblas_threads),
  OMP_NUM_THREADS: String(contract.execution.openblas_threads),
  VECLIB_MAXIMUM_THREADS: String(contract.execution.openblas_threads),
};

if (preflightOnly) {
  process.stdout.write(JSON.stringify({
    schema: "zero.s1_scale_training_preflight.v1",
    contract_sha256: contractSha256,
    parameters: contract.model.parameters,
    stage_a_updates: contract.stage_a.updates,
    stage_b_updates: contract.stage_b.updates,
    paid_compute_authorized: true,
    test_metrics_opened: false,
  }) + "\n");
  process.exit(0);
}

const budgetRemaining = () => Math.max(0,
  contract.execution.maximum_execution_seconds -
  Math.round(Date.now() / 1000 -
    Number(process.env.S1_LAUNCH_EPOCH || Date.now() / 1000)));

// ---------------- Stage A: Atlas pretrain (fresh, sequential) ----------------
const stageABest = path.join(stageADir, "best.ckpt");
fs.mkdirSync(stageADir, { recursive: true });
if (!fs.existsSync(stageABest)) {
  const a = contract.stage_a;
  const logA = path.join(stageADir, "training.log");
  fs.writeFileSync(logA, "");
  await runStreaming(binary, [
    "--preset", "literary",
    "--dim", String(contract.model.dim),
    "--heads", String(contract.model.heads),
    "--layers", String(contract.model.layers),
    "--ff", String(contract.model.ff),
    "--vocab", String(contract.model.vocab),
    "--context", String(contract.model.context),
    "--tokenizer", files.tokenizer,
    "--text", files.atlasTrain,
    "--validation-text", files.atlasValidation,
    "--sequential",
    "--steps", String(a.updates),
    "--schedule-total", String(a.updates),
    "--batch", String(a.batch),
    "--lr", String(a.peak_learning_rate),
    "--weight-decay", String(a.weight_decay),
    "--clip", String(a.gradient_clip),
    "--warmup", String(a.warmup_updates),
    "--cosine",
    "--dropout", String(a.residual_dropout),
    "--report", String(a.report_every_updates),
    "--validation", String(a.selection_validation_windows),
    "--best", stageABest,
    "--seed", String(a.seed),
    "--tokens", "0",
  ], environment, logA, Math.min(budgetRemaining(), 36000));
  const logAText = fs.readFileSync(logA, "utf8");
  const modelMatch = logAText.match(/parameters=(\d+)/);
  if (!modelMatch || Number(modelMatch[1]) !== contract.model.parameters) {
    fail(`stage A model size mismatch: ${modelMatch?.[1]}`);
  }
  const finalA = logAText.match(/^update\s+(\d+)\s/mu);
  const reports = [...logAText.matchAll(/^update\s+(\d+)/gmu)].map(m => Number(m[1]));
  if (reports.at(-1) !== a.updates) fail("stage A did not complete its updates");
} else {
  process.stdout.write("stage A already complete; skipping\n");
}

// ---------------- Stage B: C4.3 packs from stage A ----------------
const stageBBest = path.join(stageBDir, "best.ckpt");
fs.mkdirSync(stageBDir, { recursive: true });
const training = c43Contract.training;
if (!fs.existsSync(path.join(stageBDir, "result.json"))) {
  const resuming = fs.existsSync(path.join(stageBDir, "active.ckpt"));
  if (resuming && !resumeRun) fail("partial stage B requires --resume-run");
  const logB = path.join(stageBDir, "training.log");
  if (!resuming) fs.writeFileSync(logB, "");
  await runStreaming(binary, [
    resuming ? "--resume" : "--init",
    resuming ? path.join(stageBDir, "active.ckpt") : stageABest,
    "--tokenizer", files.tokenizer,
    "--packed-train", files.trainB,
    "--packed-validation", files.validationB,
    "--steps", String(training.update_groups),
    "--schedule-total", String(training.update_groups),
    "--batch", String(training.maximum_batch_sequences),
    "--parallel-batch", String(contract.execution.parallel_workers),
    "--lr", String(training.peak_learning_rate),
    "--weight-decay", String(training.weight_decay),
    "--clip", String(training.gradient_clip),
    "--warmup", String(training.warmup_updates),
    "--cosine",
    "--dropout", String(training.residual_dropout),
    "--report", String(training.report_every_updates),
    "--validation", String(training.selection_validation_packs),
    "--best", stageBBest,
    "--seed", String(training.seed),
    "--save", path.join(stageBDir, "active.ckpt"),
    "--save-every", String(contract.execution.checkpoint_every_updates),
    "--claim-answer-weight", String(training.answer_weights.claim),
    "--cloze-answer-weight", String(training.answer_weights.cloze),
    "--retrieval-answer-weight", String(training.answer_weights.retrieval),
    "--tokens", "0",
  ], environment, logB, Math.max(budgetRemaining(), 600));
  const logBText = fs.readFileSync(logB, "utf8");
  const reports = [...logBText.matchAll(/^update\s+(\d+)/gmu)].map(m => Number(m[1]));
  if (reports.at(-1) !== training.update_groups) {
    fail("stage B did not reach its final update");
  }
  const accounting = parseAccounting(logBText);
  const expected = c43Contract.verified_import.primary;
  if (!accounting || accounting.sequences !== expected.packs ||
      accounting.compute_token_exposures !== expected.compute_token_exposures ||
      accounting.active_targets !== expected.active_targets ||
      accounting.wraps !== 0) {
    fail("stage B accounting does not match the frozen C4.3 expectations");
  }
  fs.writeFileSync(path.join(stageBDir, "accounting.json"),
    JSON.stringify(accounting, null, 2) + "\n");
} else {
  process.stdout.write("stage B already complete; skipping\n");
}

// ---------------- Evaluation: frozen C4.3 evaluator ----------------
const resultPath = path.join(out, "result.json");
if (!fs.existsSync(resultPath)) {
  const evalOutput = run("node", [
    contract.evaluation.evaluator,
    "--contract", contract.stage_b.contract,
    "--trainer", binary,
    "--checkpoint", stageBBest,
    "--baseline-checkpoint", files.baseline,
    "--tokenizer", files.tokenizer,
    "--atlas-train", files.atlasTrain,
    "--atlas-validation", files.atlasValidation,
    "--anchor-train", files.anchorTrain,
    "--anchor-validation", files.anchorValidation,
    "--import-dir", importDirectory,
  ]);
  const evaluation = JSON.parse(evalOutput);
  const candidate = evaluation.candidate ?? evaluation.validation?.candidate;
  if (!candidate) fail("evaluator returned no candidate metrics");
  const claim = candidate.choice.claim;
  const retrieval = candidate.choice.retrieval;
  const gates = {
    retrieval_choice_accuracy:
      retrieval.choice_accuracy >= contract.gates.retrieval_choice_accuracy_minimum,
    claim_choice_accuracy:
      claim.choice_accuracy >= contract.gates.claim_choice_accuracy_minimum,
    retrieval_orientation_gap:
      Math.abs(retrieval.position_0_accuracy - retrieval.position_1_accuracy) <=
        contract.gates.retrieval_orientation_gap_maximum,
    retrieval_position_floor:
      retrieval.position_0_accuracy >= contract.gates.retrieval_position_floor &&
      retrieval.position_1_accuracy >= contract.gates.retrieval_position_floor,
    swap_consistency:
      claim.swap_consistency_accuracy >= contract.gates.swap_consistency_minimum &&
      retrieval.swap_consistency_accuracy >= contract.gates.swap_consistency_minimum,
    combined_nats:
      candidate.combined_nats_per_token <= contract.gates.combined_nats_maximum,
    finite_metrics: Number.isFinite(candidate.combined_nats_per_token) &&
      Number.isFinite(retrieval.choice_accuracy) &&
      Number.isFinite(claim.choice_accuracy),
    test_metrics_opened: false,
  };
  const allPass = Object.entries(gates).every(([key, value]) =>
    key === "test_metrics_opened" ? value === false : value === true);
  const result = {
    schema: "zero.s1_scale_result.v1",
    experiment: "zero5-s1-scale-v1",
    contract_sha256: contractSha256,
    status: allPass ? "complete-pass" : "complete-no-go",
    model: { parameters: contract.model.parameters,
             scale_factor: contract.model.scale_factor },
    validation: { candidate, baseline: evaluation.baseline ??
      evaluation.validation?.baseline ?? null,
      derived: evaluation.derived ?? evaluation.validation?.derived ?? null },
    gates,
    decision: {
      replication_eligible: false,
      promotion_eligible: false,
      capacity_control_reading: allPass
        ? "retrieval clears the gate at 5x parameters: capacity was binding at fixed data"
        : "see frozen decision rules in SPEC.md",
      test_metrics_opened: false,
    },
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
}
const finalResult = JSON.parse(fs.readFileSync(resultPath, "utf8"));
process.stdout.write(JSON.stringify({
  status: finalResult.status,
  gates: finalResult.gates,
  retrieval_choice_accuracy:
    finalResult.validation.candidate.choice.retrieval.choice_accuracy,
  claim_choice_accuracy:
    finalResult.validation.candidate.choice.claim.choice_accuracy,
}) + "\n");

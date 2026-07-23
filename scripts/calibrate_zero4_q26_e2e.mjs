#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateBudget } from "./check_q26_e2e_calibration_budget.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function atomicWrite(file, data) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    fail(`${command} exited ${result.status}: ${args.join(" ")}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = {
    prefix: "/tmp/zero4-q26-e2e-seed89",
    out: "/tmp/zero4-q26-e2e",
    data: "corpus/faculty/q22",
    budget: "benchmarks/openblas-e2e-calibration-v1/budget.json",
  };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!option.startsWith("--") || index + 1 >= argv.length) {
      fail(`unknown or incomplete option ${option}`);
    }
    const key = option.slice(2);
    assert(Object.hasOwn(options, key), `unknown option ${option}`);
    options[key] = argv[++index];
  }
  return options;
}

function checkpointProgress(file) {
  const data = fs.readFileSync(file);
  assert(
    data.length >= 80 && data.toString("ascii", 0, 8) === "ZEROLM2\0",
    `invalid checkpoint ${file}`,
  );
  assert(data.readUInt32LE(8) === 4, `Q2.6 requires checkpoint v4: ${file}`);
  return {
    committed: Number(data.readBigUInt64LE(48)),
    attempts: Number(data.readBigUInt64LE(64)),
    consecutiveRejections: data.readUInt32LE(72),
    transactionMode: data.readUInt32LE(76),
  };
}

function replayLoss(output) {
  const matches = [
    ...output.matchAll(/evaluation-only val ([0-9]+(?:\.[0-9]+)?)/g),
  ];
  assert(matches.length > 0, "replay evaluation emitted no validation loss");
  return Number(matches.at(-1)[1]);
}

function selfTest() {
  const options = parseArgs([
    "node",
    "script",
    "--out",
    "/tmp/result",
    "--prefix",
    "/tmp/model",
  ]);
  assert(options.out === "/tmp/result", "argument parser self-test failed");
  assert(options.prefix === "/tmp/model", "prefix parser self-test failed");

  const buffer = Buffer.alloc(80);
  buffer.write("ZEROLM2\0", 0, "ascii");
  buffer.writeUInt32LE(4, 8);
  buffer.writeBigUInt64LE(25n, 48);
  buffer.writeBigUInt64LE(27n, 64);
  buffer.writeUInt32LE(2, 72);
  buffer.writeUInt32LE(5, 76);
  const file = "/tmp/zero4-q26-e2e-driver-self-test.ckpt";
  fs.writeFileSync(file, buffer);
  const progress = checkpointProgress(file);
  assert(
    progress.committed === 25
      && progress.attempts === 27
      && progress.consecutiveRejections === 2
      && progress.transactionMode === 5,
    "checkpoint parser self-test failed",
  );
  fs.unlinkSync(file);

  assert(
    replayLoss("ignored\nevaluation-only val 1.2345\n") === 1.2345,
    "replay parser self-test failed",
  );
  console.log("Q2.6 end-to-end calibration driver self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) {
  selfTest();
  process.exit(0);
}

const budget = JSON.parse(fs.readFileSync(options.budget, "utf8"));
validateBudget(budget);
const contract = JSON.parse(fs.readFileSync(
  budget.source_driver_lock.scientific_contract_path,
  "utf8",
));
const workload = budget.workload;
const tools = {
  lm: "./literary_lm",
  export: "./export_literary",
  quantity: "./quantity_request_eval",
  check: "scripts/check_zero4_q26.mjs",
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
const replayEvaluationData = replayData.map((entry) => (
  entry.filter((_, index) => index < entry.indexOf("--distill"))
));
const files = {
  tokens: path.join(options.data, "quantity-request.tok"),
  sentinel: path.join(options.data, "quantity-request.sentinel.tsv"),
  public: path.join(options.data, "quantity-request.public.tsv"),
  promotion: path.join(options.data, "quantity-request.promotion.tsv"),
  active: `${options.prefix}-active.ckpt`,
  workingQ8: `${options.prefix}-working.litq8`,
  attempts: path.join(options.out, "optimizer-attempts.jsonl"),
  events: path.join(options.out, "events.jsonl"),
  training: path.join(options.out, "training.log"),
  measurement: path.join(options.out, "driver-measurement.json"),
};

for (const file of [
  ...Object.values(tools).filter((entry) => entry.startsWith("./")),
  ...Object.values(teachers),
  files.tokens,
  files.sentinel,
  files.public,
  files.promotion,
  "corpus/literary.bpe",
  budget.source_driver_lock.driver_path,
  budget.source_driver_lock.scientific_contract_path,
]) {
  assert(fs.existsSync(file), `required file missing: ${file}`);
}
assert(
  sha256(budget.source_driver_lock.driver_path)
    === budget.source_driver_lock.driver_sha256,
  "frozen Q2.6 driver changed",
);
assert(
  sha256(budget.source_driver_lock.scientific_contract_path)
    === budget.source_driver_lock.scientific_contract_sha256,
  "frozen Q2.6 contract changed",
);
assert(
  sha256(path.join(options.data, "manifest.json"))
    === contract.quantity_corpus.manifest_sha256,
  "quantity corpus manifest hash changed",
);
for (const [file, expected] of [
  [files.tokens, contract.quantity_corpus.tokens_sha256],
  [files.sentinel, contract.quantity_corpus.sentinel_sha256],
  [files.public, contract.quantity_corpus.public_sha256],
  [files.promotion, contract.quantity_corpus.promotion_sha256],
]) {
  assert(sha256(file) === expected, `quantity corpus hash changed: ${file}`);
}
for (const [id, file] of Object.entries(teachers)) {
  assert(sha256(file) === contract.immutable_teachers[id], `${id} teacher hash changed`);
}
for (const [file, expected] of Object.entries(contract.replay_corpus)) {
  assert(sha256(file) === expected, `replay corpus changed: ${file}`);
}

assert(workload.seed === 89, "end-to-end calibration must use seed 89");
assert(workload.maximum_optimizer_attempts === 100, "attempt cap drifted");
assert(workload.recovery_every_committed_updates === 25, "recovery cadence drifted");
assert(workload.full_every_committed_updates === 100, "full cadence drifted");
assert(workload.promotion_evaluations === 0, "promotion must remain sealed");
assert(!fs.existsSync(files.measurement), `measurement already exists: ${files.measurement}`);

fs.mkdirSync(path.join(options.out, "recovery"), { recursive: true });
atomicWrite(files.attempts, "");
atomicWrite(files.events, "");
atomicWrite(files.training, "");

const events = [];
const driverStarted = Date.now();
function record(type, started, fields = {}) {
  const finished = Date.now();
  const event = {
    type,
    started_at: new Date(started).toISOString(),
    finished_at: new Date(finished).toISOString(),
    elapsed_seconds: (finished - started) / 1000,
    ...fields,
  };
  events.push(event);
  atomicWrite(files.events, `${events.map(JSON.stringify).join("\n")}\n`);
  return event;
}

function timed(type, fields, operation) {
  const started = Date.now();
  const value = operation();
  const event = record(type, started, fields);
  return { value, event };
}

function replayArgs(checkpoint, batches, init = false) {
  return [
    init ? "--init" : "--resume",
    checkpoint,
    "--eval-only",
    "--tokenizer",
    "corpus/literary.bpe",
    ...replayEvaluationData.flat(),
    "--validation",
    String(batches),
  ];
}

function evaluateReplay(checkpoint, batches, init = false) {
  return replayLoss(run(tools.lm, replayArgs(checkpoint, batches, init), {
    quiet: true,
  }));
}

function evaluateQuantity(checkpoint, tsv, limit) {
  run(tools.export, [checkpoint, files.workingQ8], { quiet: true });
  const json = path.join(options.out, ".working-quantity.json");
  run(tools.quantity, [
    files.workingQ8,
    tsv,
    "--json",
    json,
    "--limit",
    String(limit),
  ], { quiet: true });
  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  fs.unlinkSync(json);
  return {
    cases: report.quantity.cases,
    closed: report.quantity.closed,
    exact_request: report.quantity.exact_request,
    committed: report.quantity.committed,
    exact_artifact: report.quantity.exact_artifact,
  };
}

function trainingArgs({ first, phaseOffset, attempts }) {
  return [
    first ? "--init" : "--resume",
    first ? teachers.zero3 : files.active,
    "--teacher",
    teachers.zero2,
    "--teacher-weight",
    "0.20",
    "--teacher",
    teachers.zero3,
    "--teacher-weight",
    "0.20",
    "--zero1-teacher",
    teachers.zero1,
    "--zero1-weight",
    "0.25",
    "--tokenizer",
    "corpus/literary.bpe",
    ...replayData.flat(),
    "--hard-channel",
    files.tokens,
    "--sample-weight",
    "4",
    "--steps",
    String(attempts),
    "--batch",
    String(workload.batch),
    "--lr",
    String(contract.budget.acquisition_learning_rate),
    "--warmup",
    "100",
    "--dropout",
    "0.02",
    "--cosine",
    "--schedule-offset",
    String(phaseOffset),
    "--schedule-total",
    String(contract.budget.acquisition_attempts),
    "--report",
    "25",
    "--validation",
    "56",
    "--patience",
    "0",
    "--seed",
    String(workload.seed),
    "--save",
    files.active,
    "--tokens",
    "0",
    "--transaction-mode",
    "cumulative-tangent",
    "--transaction-log",
    files.attempts,
    "--transaction-phase",
    "acquisition",
    "--transaction-probe",
    String(contract.guard.probe_every_attempts),
    "--transaction-budget",
    String(contract.guard.hard_relative_increase),
    "--transaction-max-rejections",
    String(contract.guard.maximum_consecutive_exhausted_attempts),
  ];
}

const baselineSentinel = timed(
  "baseline-sentinel-replay",
  { batches: workload.sentinel_replay_batches },
  () => evaluateReplay(teachers.zero3, workload.sentinel_replay_batches, true),
);
const baselineFull = timed(
  "baseline-full-replay",
  { batches: workload.full_replay_batches },
  () => evaluateReplay(teachers.zero3, workload.full_replay_batches, true),
);

let totalAttempts = 0;
let committed = 0;
let first = true;
let consecutiveRejections = 0;
while (totalAttempts < workload.maximum_optimizer_attempts) {
  const nextRecovery = (
    Math.floor(committed / workload.recovery_every_committed_updates) + 1
  ) * workload.recovery_every_committed_updates;
  const requestedAttempts = Math.min(
    nextRecovery - committed,
    workload.maximum_optimizer_attempts - totalAttempts,
  );
  const transaction = timed(
    "optimizer-transaction",
    {
      phase: "acquisition",
      phase_offset: totalAttempts,
      requested_attempts: requestedAttempts,
      next_recovery_committed_update: nextRecovery,
    },
    () => run(tools.lm, trainingArgs({
      first,
      phaseOffset: totalAttempts,
      attempts: requestedAttempts,
    })),
  );
  fs.appendFileSync(files.training, transaction.value);
  first = false;

  const previousAttempts = totalAttempts;
  const progress = checkpointProgress(files.active);
  const executedAttempts = progress.attempts - previousAttempts;
  assert(progress.transactionMode === 5, "checkpoint transaction mode drifted");
  assert(
    executedAttempts > 0 && executedAttempts <= requestedAttempts,
    "invalid checkpoint attempt progress",
  );
  totalAttempts = progress.attempts;
  committed = progress.committed;
  consecutiveRejections = progress.consecutiveRejections;
  Object.assign(transaction.event, {
    executed_attempts: executedAttempts,
    total_attempts: totalAttempts,
    committed_updates: committed,
    consecutive_rejections: consecutiveRejections,
  });
  atomicWrite(files.events, `${events.map(JSON.stringify).join("\n")}\n`);

  if (committed === nextRecovery) {
    const checkpoint = path.join(
      options.out,
      "recovery",
      `u${String(committed).padStart(6, "0")}.ckpt`,
    );
    timed(
      "recovery-checkpoint",
      { committed_updates: committed },
      () => fs.copyFileSync(files.active, checkpoint),
    );
    timed(
      "sentinel-quantity",
      { committed_updates: committed, limit: 64 },
      () => evaluateQuantity(files.active, files.sentinel, 64),
    );
    timed(
      "sentinel-replay",
      {
        committed_updates: committed,
        batches: workload.sentinel_replay_batches,
      },
      () => evaluateReplay(
        files.active,
        workload.sentinel_replay_batches,
      ),
    );
  }

  if (
    committed > 0
      && committed % workload.full_every_committed_updates === 0
      && !events.some((event) => (
        event.type === "full-quantity"
          && event.committed_updates === committed
      ))
  ) {
    timed(
      "full-quantity",
      { committed_updates: committed, limit: 500 },
      () => evaluateQuantity(files.active, files.public, 500),
    );
    timed(
      "full-replay",
      {
        committed_updates: committed,
        batches: workload.full_replay_batches,
      },
      () => evaluateReplay(files.active, workload.full_replay_batches),
    );
  }

  if (
    executedAttempts < requestedAttempts
      || consecutiveRejections >= contract.guard.maximum_consecutive_exhausted_attempts
  ) {
    break;
  }
}

timed(
  "attempt-log-verification",
  { completed_attempts: totalAttempts },
  () => run("node", [
    tools.check,
    budget.source_driver_lock.scientific_contract_path,
    files.attempts,
  ], { quiet: true }),
);

const count = (type) => events.filter((event) => event.type === type).length;
const sum = (type) => events
  .filter((event) => event.type === type)
  .reduce((total, event) => total + event.elapsed_seconds, 0);
const sentinelEvaluations = count("sentinel-quantity");
const fullEvaluations = count("full-quantity");
const complete = (
  totalAttempts === workload.maximum_optimizer_attempts
    && committed >= workload.full_every_committed_updates
    && sentinelEvaluations === workload.maximum_sentinel_evaluations
    && fullEvaluations === workload.maximum_full_evaluations
);
const measurement = {
  schema: "zero.q26_e2e_driver_measurement.v1",
  id: budget.id,
  status: complete ? "complete" : "insufficient-cadence",
  scientific_inference_allowed: false,
  seed: workload.seed,
  attempted_scientific_driver_invocation: false,
  promotion_evaluations: 0,
  attempt_cap: workload.maximum_optimizer_attempts,
  completed_optimizer_attempts: totalAttempts,
  completed_committed_updates: committed,
  acceptance_rate: totalAttempts ? committed / totalAttempts : null,
  recovery_every_committed_updates: workload.recovery_every_committed_updates,
  full_every_committed_updates: workload.full_every_committed_updates,
  sentinel_evaluations: sentinelEvaluations,
  full_evaluations: fullEvaluations,
  baseline: {
    sentinel_replay_loss: baselineSentinel.value,
    full_replay_loss: baselineFull.value,
  },
  timing_seconds: {
    driver_total: (Date.now() - driverStarted) / 1000,
    baseline_sentinel_replay: sum("baseline-sentinel-replay"),
    baseline_full_replay: sum("baseline-full-replay"),
    optimizer_transactions: sum("optimizer-transaction"),
    recovery_checkpoints: sum("recovery-checkpoint"),
    sentinel_quantity: sum("sentinel-quantity"),
    sentinel_replay: sum("sentinel-replay"),
    full_quantity: sum("full-quantity"),
    full_replay: sum("full-replay"),
    attempt_log_verification: sum("attempt-log-verification"),
  },
  event_count: events.length,
};
atomicWrite(files.measurement, `${JSON.stringify(measurement, null, 2)}\n`);
console.log(
  `Q2.6 end-to-end calibration ${measurement.status}: `
    + `${totalAttempts} attempts, ${committed} commits, `
    + `${sentinelEvaluations} sentinel evaluations, ${fullEvaluations} full evaluations`,
);

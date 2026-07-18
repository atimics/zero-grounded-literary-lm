#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || index + 1 >= argv.length) fail(`invalid argument ${argv[index] ?? "<missing>"}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ["requests", "baseline", "replay", "model", "steps", "seed", "out"]) if (!options[key]) fail(`--${key} is required`);
  return options;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function replayLoss(file) {
  const matches = [...fs.readFileSync(file, "utf8").matchAll(/evaluation-only val ([0-9]+(?:\.[0-9]+)?)/g)];
  if (!matches.length) fail(`no validation loss in ${file}`);
  return Number(matches.at(-1)[1]);
}
function ratio(value, total) { return total ? value / total : 0; }
function percent(value) { return `${(value * 100).toFixed(1)}%`; }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }

const options = parseArgs(process.argv);
const requestEvaluation = readJson(options.requests);
const quantity = requestEvaluation.quantity;
const requestMode = options.mode ?? requestEvaluation.request_mode ?? "full";
const experiment = options.experiment ?? "q2";
const experimentLabel = experiment === "q21" ? "Q2.1" : experiment === "q22" ? "Q2.2" : experiment === "q22r" ? "Q2.2-R" : experiment === "q23" ? "Q2.3" : experiment.toUpperCase();
const selection = options.selection ? readJson(options.selection) : null;
const requestShare = Number(options["request-share"] ?? 0.60);
const consolidationShare = options["consolidation-share"] === undefined
  ? null : Number(options["consolidation-share"]);
if (!["full", "operation"].includes(requestMode) ||
    !Number.isFinite(requestShare) ||
    (consolidationShare !== null && !Number.isFinite(consolidationShare))) fail("invalid request mode or share");
const operationOnly = requestMode === "operation";
const replayRepair = selection?.schema === "zero.zero4_q22r_selection.v1";
const sampling = replayRepair
  ? [{ phase: "replay-repair", quantity_requests: 0, historical_replay: 1, optimizer: "fresh", source_updates: selection.policy.sources }]
  : selection
  ? [
      { phase: "acquisition-initial", quantity_requests: 0.40, historical_replay: 0.60 },
      { phase: "acquisition-replay-pressure", quantity_requests: [1 / 3, 0.25], historical_replay: [2 / 3, 0.75], conditional: "sentinel replay regression above 1.5%" },
      { phase: "consolidation", quantity_requests: 0.25, historical_replay: 0.75, conditional: "quantity passes while replay worsens or acquisition budget completes" },
    ]
  : consolidationShare === null
    ? [{ phase: "main", quantity_requests: requestShare, historical_replay: 1 - requestShare }]
    : [
        { phase: "main", quantity_requests: requestShare, historical_replay: 1 - requestShare },
        { phase: "consolidation", quantity_requests: consolidationShare, historical_replay: 1 - consolidationShare },
      ];
const baselineLoss = replayLoss(options.baseline), studentLoss = replayLoss(options.replay);
const replayRegression = (studentLoss - baselineLoss) / baselineLoss;
const rates = {
  closed: ratio(quantity.closed, quantity.cases),
  syntax: ratio(quantity.syntax, quantity.cases),
  operation: ratio(quantity.operation, quantity.cases),
  arguments: ratio(quantity.arguments, quantity.cases),
  exact_request: ratio(quantity.exact_request, quantity.cases),
  oracle_arithmetic: ratio(quantity.oracle_arithmetic, quantity.cases),
  committed: ratio(quantity.committed, quantity.cases),
  exact_artifact: ratio(quantity.exact_artifact, quantity.cases)
};
const thresholds = {
  closed_minimum: 0.99,
  syntax_minimum: 0.99,
  operation_minimum: 0.95,
  arguments_minimum: 0.95,
  exact_request_minimum: 0.95,
  oracle_arithmetic_minimum: 1.0,
  committed_minimum: 0.95,
  exact_artifact_minimum: 0.95,
  rejected_state_mutations_maximum: 0,
  replay_relative_regression_maximum: 0.02
};
const gates = {
  closed: rates.closed >= thresholds.closed_minimum,
  syntax: rates.syntax >= thresholds.syntax_minimum,
  operation: rates.operation >= thresholds.operation_minimum,
  arguments: rates.arguments >= thresholds.arguments_minimum,
  exact_request: rates.exact_request >= thresholds.exact_request_minimum,
  oracle_arithmetic: rates.oracle_arithmetic >= thresholds.oracle_arithmetic_minimum,
  committed: rates.committed >= thresholds.committed_minimum,
  exact_artifact: rates.exact_artifact >= thresholds.exact_artifact_minimum,
  rejected_state_mutations: quantity.rejected_state_mutations <= thresholds.rejected_state_mutations_maximum,
  replay: replayRegression <= thresholds.replay_relative_regression_maximum
};
const decision = Object.values(gates).every(Boolean) ? "go" : "no-go";
const model = fs.readFileSync(options.model);
if (model.subarray(0, 8).toString("binary") !== "LITQ8V1\0") fail("model is not LITQ8V1");
const relativeModelPath = path.relative(options.out, options.model);
const reportedModelPath = relativeModelPath && !relativeModelPath.startsWith("..")
  ? relativeModelPath
  : options.model;
const report = {
  schema: `zero.zero4_${experiment}_result.v1`,
  id: `zero4-${experiment}-seed${options.seed}`,
  decision,
  promotion_eligible: false,
  promotion_blocker: `${experimentLabel} must pass all three declared seeds before ZERO.4 promotion`,
  design: {
    objective: operationOnly
      ? "model selects a typed quantity operation; controller binds arguments from the parsed source; deterministic kernel computes and atomically commits the artifact"
      : "model emits a typed, input-bound quantity request; deterministic kernel computes and atomically commits the artifact",
    request_mode: requestMode,
    neural_arithmetic_claimed: false,
    initialization: replayRepair
      ? `retained Q2.2 source update ${selection.selected?.sourceUpdate} weights with fresh optimizer and RNG for replay repair`
      : "immutable ZERO.3 weights with fresh optimizer and RNG",
    teacher_router: {
      cardinality: 3,
      zero1: "foundation only",
      zero2: "literary replay only",
      zero3: "foundation, literary, and participation replay",
      request_channel: "hard-only",
      structured_protocol_tags: "hard-only",
      exact_artifacts: "kernel-only"
    },
    sampling,
    optimizer_updates_executed: selection?.selected?.repairUpdate ?? selection?.updates?.total ?? Number(options.steps),
    seed: Number(options.seed)
  },
  immutable_teachers: {
    zero1: sha256("teachers/zero1-foundation.teacher"),
    zero2: sha256("teachers/zero2-literary.teacher"),
    zero3: sha256("teachers/zero3-balanced-final.teacher")
  },
  model: { path: reportedModelPath, update: Number(model.readBigUInt64LE(40)), bytes: model.length, sha256: sha256(options.model) },
  checkpoint_selection: selection ? {
    policy: selection.policy,
    stopped_reason: selection.stoppedReason,
    selected_update: selection.selected?.update,
    selected_source_update: selection.selected?.sourceUpdate,
    selected_repair_update: selection.selected?.repairUpdate,
    selected_minimum_faculty_gate_margin: selection.selected?.minimumFacultyMargin,
    public_validation_feasible: selection.selected?.feasible,
    frontier_size: selection.frontier?.length,
    promotion_evaluated_once_at_end: selection.promotion?.evaluatedOnceAtEnd,
  } : undefined,
  quantity,
  rates,
  replay: { baseline_loss: baselineLoss, student_loss: studentLoss, relative_regression: replayRegression },
  thresholds,
  gates
};
const rows = [
  ["Natural close", rates.closed, thresholds.closed_minimum, gates.closed],
  ["Request syntax", rates.syntax, thresholds.syntax_minimum, gates.syntax],
  ["Operation extraction", rates.operation, thresholds.operation_minimum, gates.operation],
  [operationOnly ? "Controller source-argument binding" : "Argument extraction", rates.arguments, thresholds.arguments_minimum, gates.arguments],
  [operationOnly ? "Exact model operation request" : "Exact bound request", rates.exact_request, thresholds.exact_request_minimum, gates.exact_request],
  ["Oracle arithmetic", rates.oracle_arithmetic, thresholds.oracle_arithmetic_minimum, gates.oracle_arithmetic],
  ["Atomic commit", rates.committed, thresholds.committed_minimum, gates.committed],
  ["Exact committed artifact", rates.exact_artifact, thresholds.exact_artifact_minimum, gates.exact_artifact]
];
const boundary = operationOnly
  ? "The model emits only a typed operation. The controller independently parses and binds arguments from the source task, rejects a mismatched operation without mutation, and passes the canonical request to the deterministic kernel. Controller binding and kernel arithmetic are not credited to the model."
  : "The model emits a typed request bound to the source input. The controller rejects changed operations or arguments without mutating state. A deterministic quantity kernel—not the model—computes the committed artifact.";
const markdown = `# ZERO.4-${experimentLabel} seed ${options.seed}\n\nDecision: **${decision}** for this seed; not promotion-eligible until all three seeds pass.\n\n${boundary}\n\n| Gate | Result | Required | Pass |\n| --- | ---: | ---: | :---: |\n${rows.map(([name, value, threshold, passed]) => `| ${name} | ${percent(value)} | ${percent(threshold)} | ${passed ? "yes" : "no"} |`).join("\n")}\n| Rejected state mutations | ${quantity.rejected_state_mutations} | 0 | ${gates.rejected_state_mutations ? "yes" : "no"} |\n| Historical replay loss | ${studentLoss.toFixed(4)} (${percent(replayRegression)} vs ${baselineLoss.toFixed(4)}) | <= ${percent(thresholds.replay_relative_regression_maximum)} regression | ${gates.replay ? "yes" : "no"} |\n\nTeacher hashes remain unchanged. ZERO.1 is routed only to foundation, ZERO.2 to literary replay, ZERO.3 to compatible replay and initialization, while executable requests and protocol tags remain hard-supervised.\n\nModel update: ${report.model.update}; SHA-256: \`${report.model.sha256}\`.\n`;
fs.mkdirSync(options.out, { recursive: true });
atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
atomicWrite(path.join(options.out, "RESULTS.md"), markdown);
console.log(`ZERO.4-${experimentLabel} decision: ${decision}`);
for (const [gate, passed] of Object.entries(gates)) console.log(`${passed ? "PASS" : "FAIL"} ${gate}`);

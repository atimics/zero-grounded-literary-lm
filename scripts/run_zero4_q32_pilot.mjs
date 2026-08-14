#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q32-v1/contract.json";
const PRIVATE_HOLDOUT =
  "benchmarks/zero4-q31-v1/results/private-holdout.tsv";
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const MEASUREMENT_UPDATES = Object.freeze([0, 25, 50, 100]);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(command, args, quiet = false) {
  const result = spawnSync(command, args, { encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
  return result.stdout;
}
function runAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve({ stdout, stderr }) :
      reject(new Error(`${command} exited ${status}\n${stderr}`)));
  });
}

export function validateContract(contract) {
  assert.equal(contract.schema,
    "zero.zero4_q32_deployment_exact_head_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.architecture.base_trainable_parameters, 0);
  assert.equal(contract.architecture.feature_dimension, 1536);
  assert.equal(contract.architecture.head_parameters, 7685);
  assert.equal(contract.pilot.training_pool_records, 9000);
  assert.equal(contract.pilot.private_holdout_records, 500);
  assert.equal(contract.pilot.maximum_optimizer_updates, 100);
  assert.deepEqual(contract.pilot.measurement_updates, MEASUREMENT_UPDATES);
  assert.equal(contract.selection.packaged_runtime_overall_minimum, 0.99);
  assert.equal(contract.selection.packaged_runtime_per_class_minimum, 0.98);
  for (const binding of [
    ...Object.values(contract.lineage), ...Object.values(contract.inputs),
  ]) assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} source lock drifted`);
}

export function validateAuthorization(budget, sourceCommit, contractHash) {
  assert.equal(budget.schema,
    "zero.q32_deployment_exact_head_pilot_budget.v1");
  assert.equal(budget.id, "zero4-q32-seed2-pilot-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.diagnostic_seed, 2);
  assert.equal(budget.proposed.head_parameters, 7685);
  assert.equal(budget.proposed.feature_records, 9500);
  assert.equal(budget.proposed.maximum_optimizer_updates, 100);
  assert.equal(budget.proposed.maximum_compute_usd, 0.1);
  const authorization = budget.authorization;
  assert.equal(authorization.authorized, true);
  assert.equal(authorization.one_execution_only, true);
  assert.match(authorization.approval_id, /^q32-[a-z0-9-]+$/);
  assert.equal(authorization.source_commit, sourceCommit);
  assert.equal(authorization.contract_sha256, contractHash);
  assert.equal(authorization.maximum_optimizer_updates, 100);
  assert.equal(authorization.maximum_compute_usd, 0.1);
  assert.equal(authorization.packaged_runtime_private_gate_authorized, true);
  for (const key of ["public_quantity_authorized", "language_gate_authorized",
    "promotion_authorized", "deployment_authorized"])
    assert.equal(authorization[key], false);
}

export function selectFeatureCheckpoint(measurements) {
  assert(measurements.length >= 2 &&
    measurements.length <= MEASUREMENT_UPDATES.length);
  assert.deepEqual(measurements.map(({ update }) => update),
    MEASUREMENT_UPDATES.slice(0, measurements.length));
  return measurements.slice(1).find((measurement) =>
    measurement.holdout_accuracy >= 0.99 &&
    measurement.per_class_accuracy.every((value) => value >= 0.98)) ?? null;
}

export function packagedRuntimePasses(classAudits, nonQIdentity) {
  assert.equal(classAudits.length, 5);
  const totals = {};
  for (const audit of classAudits) {
    assert.equal(audit.quantity.cases, 100);
    for (const [key, value] of Object.entries(audit.quantity))
      if (Number.isInteger(value)) totals[key] = (totals[key] ?? 0) + value;
  }
  const structural = ["closed", "syntax", "arguments", "oracle_arithmetic"];
  const exactStructural = structural.every((key) => totals[key] === 500) &&
    totals.rejected_state_mutations === 0;
  const perClass = classAudits.map(({ quantity }) => quantity.operation / 100);
  const overall = totals.operation / 500;
  const passed = exactStructural && overall >= 0.99 &&
    perClass.every((value) => value >= 0.98) && nonQIdentity;
  return { passed, overall_accuracy: overall, per_class_accuracy: perClass,
    totals, exact_structural: exactStructural, non_q_probability_identity:
      nonQIdentity };
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null,
    mechanics: "./runtime_operation_head_pilot" };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  assert(options.authorization && options.out,
    "pilot requires --authorization and --out");
  return options;
}

function selfTest() {
  const counts = [100, 100, 100, 100, 100];
  assert.equal(selectFeatureCheckpoint([
    { update: 0, holdout_accuracy: 0.2,
      per_class_accuracy: [1, 0, 0, 0, 0], per_class_count: counts },
    { update: 25, holdout_accuracy: 0.992,
      per_class_accuracy: [1, 1, 0.98, 0.98, 1], per_class_count: counts },
  ]).update, 25);
  const audit = (operation = 100) => ({ quantity: { cases: 100, closed: 100,
    syntax: 100, operation, arguments: 100, exact_request: operation,
    oracle_arithmetic: 100, committed: operation, exact_artifact: operation,
    rejected: 100 - operation, rejected_state_mutations: 0 } });
  assert.equal(packagedRuntimePasses([audit(), audit(), audit(), audit(),
    audit(98)], true).passed, true);
  assert.equal(packagedRuntimePasses([audit(), audit(), audit(), audit(),
    audit(97)], true).passed, false);
  assert.equal(packagedRuntimePasses([audit(), audit(), audit(), audit(),
    audit()], false).passed, false);
  console.log("Q3.2 packaged-runtime selector self-test passed");
}

function nonQIdentity(packagePath) {
  const probes = [["D", "hello"], ["H", "a quiet room"],
    ["Z", "state remains unchanged"]];
  return probes.every(([style, prompt]) => {
    const base = spawnSync("./base_probability_infer",
      ["docs/model.litq8", "--chat", style, prompt], { encoding: "utf8" });
    const routed = spawnSync("./operation_head_infer",
      [packagePath, "--chat", style, prompt], { encoding: "utf8" });
    assert.equal(base.status, 0); assert.equal(routed.status, 0);
    return base.stdout === routed.stdout;
  });
}

async function runtimeAudit(packagePath, out) {
  const lines = fs.readFileSync(PRIVATE_HOLDOUT, "utf8").trimEnd().split("\n");
  const header = lines.shift();
  assert.equal(lines.length, 500);
  const jobs = CLASSES.map(async (name, classIndex) => {
    const tsv = path.join(out, `runtime-private-${name}.tsv`);
    const json = path.join(out, `runtime-private-${name}.json`);
    const selected = lines.filter((_, index) => index % 5 === classIndex);
    assert.equal(selected.length, 100);
    fs.writeFileSync(tsv, `${header}\n${selected.join("\n")}\n`, { flag: "wx" });
    await runAsync("./operation_head_request_eval", [packagePath, tsv,
      "--json", json, "--limit", "100", "--jobs", "2"]);
    fs.rmSync(tsv);
    return readJson(json);
  });
  const classAudits = await Promise.all(jobs);
  return { classes: Object.fromEntries(CLASSES.map((name, index) =>
      [name, classAudits[index]])),
    gate: packagedRuntimePasses(classAudits, nonQIdentity(packagePath)) };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  const contract = readJson(CONTRACT); validateContract(contract);
  const sourceCommit = run("git", ["rev-parse", "HEAD"], true).trim();
  const contractHash = sha256(CONTRACT);
  const budget = readJson(options.authorization);
  validateAuthorization(budget, sourceCommit, contractHash);
  assert(!fs.existsSync(options.out), "pilot output already exists");
  const authorizationHash = sha256(options.authorization);
  const consumption = `${options.authorization}.consumed`;
  fs.writeFileSync(consumption, `${JSON.stringify({
    schema: "zero.q32_pilot_authorization_consumption.v1",
    authorization_sha256: authorizationHash, source_commit: sourceCommit,
    output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  fs.mkdirSync(options.out, { recursive: false });
  const eventsPath = path.join(options.out, "events.jsonl");
  run(options.mechanics, ["--out-prefix", path.join(options.out, "checkpoint"),
    "--events", eventsPath, "--authorization-sha256", authorizationHash]);
  const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n")
    .map(JSON.parse);
  assert(events.every(({ schema }) => schema ===
    "zero.zero4_q32_runtime_head_event.v1"));
  const start = events.find(({ type }) => type === "start");
  const complete = events.find(({ type }) => type === "complete");
  assert(start && complete); assert.equal(start.feature_records, 9500);
  assert.equal(start.feature_source, "deployment-exact-quantized-streaming");
  for (const key of ["public_quantity_run", "language_gate_run",
    "promotion_run"]) assert.equal(complete[key], false);
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, holdout_cross_entropy, holdout_accuracy,
      per_class_accuracy, per_class_count, base_runtime_digest }) => ({ update,
      holdout_cross_entropy, holdout_accuracy, per_class_accuracy,
      per_class_count, base_runtime_digest }));
  assert.equal(complete.updates_committed, measurements.at(-1).update);
  const featureSelection = selectFeatureCheckpoint(measurements);
  assert.equal(Boolean(featureSelection),
    complete.runtime_feature_checkpoint_available);
  let packagedRuntime = null;
  let selected = null;
  let selectedCheckpoint = null;
  let selectedPackage = null;
  if (featureSelection) {
    selectedCheckpoint = path.join(options.out,
      `checkpoint-u${String(featureSelection.update).padStart(6, "0")}.q32`);
    const diagnostic = path.join(options.out, "runtime-gate-candidate.litqhead");
    run("./package_runtime_operation_head",
      ["docs/model.litq8", selectedCheckpoint, diagnostic]);
    packagedRuntime = await runtimeAudit(diagnostic, options.out);
    fs.writeFileSync(path.join(options.out, "packaged-runtime-audit.json"),
      `${JSON.stringify(packagedRuntime, null, 2)}\n`, { flag: "wx" });
    if (packagedRuntime.gate.passed) {
      selected = featureSelection; selectedPackage = path.join(options.out,
        "candidate.litqhead"); fs.renameSync(diagnostic, selectedPackage);
    } else {
      fs.renameSync(diagnostic,
        path.join(options.out, "runtime-rejected.litqhead"));
    }
  }
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify({
      schema: "zero.zero4_q32_pilot_result.v1", source_commit: sourceCommit,
      authorization_sha256: authorizationHash, contract_sha256: contractHash,
      measurements, runtime_feature_selection: featureSelection,
      packaged_runtime: packagedRuntime?.gate ?? null, selected,
      selected_checkpoint: selected ? selectedCheckpoint : null,
      selected_package: selectedPackage, public_quantity_run: false,
      language_gate_run: false, promotion_run: false,
      deployment_run: false,
    }, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(consumption,
    path.join(options.out, "authorization-consumption.json"),
    fs.constants.COPYFILE_EXCL);
  console.log(selected ? `Q3.2 runtime-qualified candidate frozen at update ${selected.update}` :
    "Q3.2 ended with no runtime-qualified candidate");
}

await main();

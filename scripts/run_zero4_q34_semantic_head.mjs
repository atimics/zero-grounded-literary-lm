#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = "benchmarks/zero4-q34-semantic-head-v1";
const CONTRACT_PATH = `${ROOT}/contract.json`;
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const STRATA = ["lexical", "implicit"];
const UPDATES = [0, 25, 50, 100];

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
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve() :
      reject(new Error(`${command} exited ${status}\n${stderr}`)));
  });
}
function addValues(target, source, keys) {
  for (const key of keys) target[key] = (target[key] ?? 0) + source[key];
}

export function semanticDecision(totals, classAccuracy, stratumAccuracy,
  nonQIdentity) {
  const gates = {
    overall: totals.operation / totals.cases >= 0.8,
    per_class: Object.values(classAccuracy).every((value) => value >= 0.6),
    lexical: stratumAccuracy.lexical >= 0.75,
    implicit: stratumAccuracy.implicit >= 0.65,
    canonical_binding: totals.canonical_binding === totals.cases,
    oracle_arithmetic: totals.oracle_arithmetic === totals.cases,
    committed: totals.committed === totals.operation,
    exact_artifact: totals.exact_artifact === totals.operation,
    rejected_state_mutations: totals.rejected_state_mutations === 0,
    non_q_probability_identity: nonQIdentity,
  };
  return { passed: Object.values(gates).every(Boolean), gates };
}

export function featureSelection(measurements) {
  return measurements.slice(1).find((measurement) =>
    measurement.holdout_accuracy >= 0.8 &&
    measurement.per_class_accuracy.every((value) => value >= 0.6)) ?? null;
}

export function canonicalDecision(totals, perClass, nonQIdentity) {
  const gates = {
    overall: totals.operation / totals.cases >= 0.99,
    per_class: perClass.every((value) => value >= 0.98),
    closed: totals.closed === totals.cases,
    syntax: totals.syntax === totals.cases,
    arguments: totals.arguments === totals.cases,
    oracle_arithmetic: totals.oracle_arithmetic === totals.cases,
    rejected_state_mutations: totals.rejected_state_mutations === 0,
    non_q_probability_identity: nonQIdentity,
  };
  return { passed: Object.values(gates).every(Boolean), gates,
    accuracy: totals.operation / totals.cases, per_class_accuracy: perClass };
}

function validateContract(contract) {
  assert.equal(contract.schema, "zero.zero4_q34_semantic_head_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.architecture.base_trainable_parameters, 0);
  assert.equal(contract.architecture.head_parameters, 7685);
  assert.equal(contract.pilot.maximum_optimizer_updates, 100);
  assert.deepEqual(contract.pilot.measurement_updates, UPDATES);
  for (const binding of [contract.lineage.q33_result,
    contract.lineage.runtime_base, ...Object.values(contract.data)])
    assert.equal(sha256(binding.path), binding.sha256,
      `${binding.path} binding drifted`);
  for (const [file, digest] of Object.entries(contract.mechanics))
    assert.equal(sha256(file), digest, `${file} mechanics drifted`);
  const q33 = readJson(contract.lineage.q33_result.path);
  assert.equal(q33.scientific_decision, contract.lineage.q33_result.required_decision);
  assert.equal(q33.totals.operation / q33.totals.cases,
    contract.lineage.q33_result.observed_semantic_accuracy);
}

function validateAuthorization(budget, sourceCommit, contractHash) {
  assert.equal(budget.schema, "zero.q34_semantic_head_budget.v1");
  assert.equal(budget.id, "zero4-q34-seed2-semantic-head-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.source_commit, sourceCommit);
  assert.equal(budget.proposed.diagnostic_seed, 2);
  assert.equal(budget.proposed.base_trainable_parameters, 0);
  assert.equal(budget.proposed.head_parameters, 7685);
  assert.equal(budget.proposed.maximum_optimizer_updates, 100);
  const auth = budget.authorization;
  assert.equal(auth.authorized, true); assert.equal(auth.one_execution_only, true);
  assert.match(auth.approval_id, /^q34-[a-z0-9-]+$/);
  assert.equal(auth.source_commit, sourceCommit);
  assert.equal(auth.contract_sha256, contractHash);
  assert.equal(auth.maximum_optimizer_updates, 100);
  assert.equal(auth.maximum_semantic_evaluation_records, 1000);
  assert.equal(auth.maximum_canonical_evaluation_records, 1500);
  assert.equal(auth.maximum_compute_usd, 0.15);
  for (const key of ["training_authorized", "private_gate_authorized",
    "confirmation_gate_authorized", "canonical_regression_authorized"])
    assert.equal(auth[key], true);
  for (const key of ["language_gate_authorized", "deployment_authorized",
    "additional_seed_authorized"]) assert.equal(auth[key], false);
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null,
    mechanics: "./semantic_runtime_head_pilot" };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  assert(options.authorization && options.out,
    "Q3.4 requires --authorization and --out");
  return options;
}

function selfTest() {
  const base = { update: 0, holdout_accuracy: 0.2,
    per_class_accuracy: [1, 0, 0, 0, 0] };
  const pass = { update: 25, holdout_accuracy: 0.8,
    per_class_accuracy: [0.6, 0.8, 0.8, 0.8, 1] };
  assert.equal(featureSelection([base, pass]).update, 25);
  assert.equal(featureSelection([base, { ...pass,
    per_class_accuracy: [0.59, 1, 1, 1, 1] }]), null);
  const totals = { cases: 500, operation: 400, canonical_binding: 500,
    oracle_arithmetic: 500, committed: 400, exact_artifact: 400,
    rejected_state_mutations: 0 };
  assert.equal(semanticDecision(totals,
    Object.fromEntries(CLASSES.map((name) => [name, 0.8])),
    { lexical: 0.8, implicit: 0.8 }, true).passed, true);
  const canonical = { cases: 500, operation: 495, closed: 500, syntax: 500,
    arguments: 500, oracle_arithmetic: 500, rejected_state_mutations: 0 };
  assert.equal(canonicalDecision(canonical, [0.98, 0.99, 0.99, 0.99, 1],
    true).passed, true);
  console.log("Q3.4 runner selectors self-test passed");
}

function nonQIdentity(candidate) {
  return [["D", "hello"], ["H", "a quiet room"],
    ["Z", "state remains unchanged"]].every(([style, prompt]) => {
    const base = spawnSync("./base_probability_infer",
      ["docs/model.litq8", "--chat", style, prompt], { encoding: "utf8" });
    const routed = spawnSync("./operation_head_infer",
      [candidate, "--chat", style, prompt], { encoding: "utf8" });
    assert.equal(base.status, 0); assert.equal(routed.status, 0);
    return base.stdout === routed.stdout;
  });
}

async function semanticAudit(candidate, dataset, out, prefix) {
  const lines = fs.readFileSync(dataset, "utf8").trimEnd().split("\n");
  const header = lines.shift(); const names = header.split("\t");
  const column = Object.fromEntries(names.map((name, index) => [name, index]));
  assert.equal(lines.length, 500);
  const cells = await Promise.all(CLASSES.flatMap((operation) =>
    STRATA.map(async (stratum) => {
      const selected = lines.filter((line) => {
        const fields = line.split("\t");
        return fields[column.model_request] === `quantity.${operation}` &&
          fields[column.stratum] === stratum;
      });
      assert.equal(selected.length, 50);
      const temporary = path.join(out, `.${prefix}-${operation}-${stratum}.tsv`);
      const json = path.join(out, `${prefix}-${operation}-${stratum}.json`);
      fs.writeFileSync(temporary, `${header}\n${selected.join("\n")}\n`,
        { flag: "wx" });
      await runAsync("./semantic_operation_eval", [candidate, temporary,
        "--json", json]);
      fs.rmSync(temporary);
      return { operation, stratum, result: readJson(json) };
    })));
  const keys = ["cases", "closed", "syntax", "operation",
    "canonical_binding", "oracle_arithmetic", "committed", "exact_artifact",
    "rejected", "rejected_state_mutations"];
  const totals = {}, classes = {}, strata = {}, confusion = {};
  for (const operation of CLASSES) {
    const summary = {}; const matching = cells.filter((x) => x.operation === operation);
    for (const cell of matching) addValues(summary, cell.result, keys);
    classes[operation] = { ...summary, accuracy: summary.operation / summary.cases };
    confusion[operation] = Array(5).fill(0);
    for (const cell of matching) cell.result.predicted_counts.forEach(
      (value, index) => { confusion[operation][index] += value; });
  }
  for (const stratum of STRATA) {
    const summary = {};
    for (const cell of cells.filter((x) => x.stratum === stratum))
      addValues(summary, cell.result, keys);
    strata[stratum] = { ...summary, accuracy: summary.operation / summary.cases };
  }
  for (const cell of cells) addValues(totals, cell.result, keys);
  const classAccuracy = Object.fromEntries(CLASSES.map((name) =>
    [name, classes[name].accuracy]));
  const stratumAccuracy = Object.fromEntries(STRATA.map((name) =>
    [name, strata[name].accuracy]));
  const nonQ = nonQIdentity(candidate);
  return { dataset, totals, classes, strata, confusion_labels: CLASSES,
    confusion_matrix: confusion, non_q_probability_identity: nonQ,
    decision: semanticDecision(totals, classAccuracy, stratumAccuracy, nonQ) };
}

async function canonicalAudit(candidate, dataset, out, prefix) {
  const lines = fs.readFileSync(dataset, "utf8").trimEnd().split("\n");
  const header = lines.shift(); assert.equal(lines.length, 500);
  const audits = await Promise.all(CLASSES.map(async (operation, classIndex) => {
    const selected = lines.filter((_, index) => index % 5 === classIndex);
    assert.equal(selected.length, 100);
    const temporary = path.join(out, `.${prefix}-${operation}.tsv`);
    const json = path.join(out, `${prefix}-${operation}.json`);
    fs.writeFileSync(temporary, `${header}\n${selected.join("\n")}\n`,
      { flag: "wx" });
    await runAsync("./operation_head_request_eval", [candidate, temporary,
      "--json", json, "--limit", "100", "--jobs", "2"]);
    fs.rmSync(temporary); return readJson(json).quantity;
  }));
  const keys = ["cases", "closed", "syntax", "operation", "arguments",
    "exact_request", "oracle_arithmetic", "committed", "exact_artifact",
    "rejected", "rejected_state_mutations"];
  const totals = {};
  for (const audit of audits) addValues(totals, audit, keys);
  const perClass = audits.map((audit) => audit.operation / audit.cases);
  const nonQ = nonQIdentity(candidate);
  return { dataset, totals,
    classes: Object.fromEntries(CLASSES.map((name, index) => [name, audits[index]])),
    decision: canonicalDecision(totals, perClass, nonQ) };
}

function combineCanonical(first, second) {
  const totals = {};
  const keys = Object.keys(first.totals);
  addValues(totals, first.totals, keys); addValues(totals, second.totals, keys);
  const perClass = CLASSES.map((name) =>
    (first.classes[name].operation + second.classes[name].operation) /
    (first.classes[name].cases + second.classes[name].cases));
  return { totals, decision: canonicalDecision(totals, perClass,
    first.decision.gates.non_q_probability_identity &&
    second.decision.gates.non_q_probability_identity) };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  const contract = readJson(CONTRACT_PATH); validateContract(contract);
  const sourceCommit = run("git", ["rev-parse", "HEAD"], true).trim();
  const contractHash = sha256(CONTRACT_PATH);
  const budget = readJson(options.authorization);
  validateAuthorization(budget, sourceCommit, contractHash);
  assert(!fs.existsSync(options.out), "Q3.4 output already exists");
  const authorizationHash = sha256(options.authorization);
  const consumption = `${options.authorization}.consumed`;
  fs.writeFileSync(consumption, `${JSON.stringify({
    schema: "zero.q34_authorization_consumption.v1",
    authorization_sha256: authorizationHash, source_commit: sourceCommit,
    output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  fs.mkdirSync(options.out, { recursive: false });
  const eventsPath = path.join(options.out, "events.jsonl");
  run(options.mechanics, ["--out-prefix", path.join(options.out, "checkpoint"),
    "--events", eventsPath, "--authorization-sha256", authorizationHash]);
  const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
  const measurements = events.filter(({ type }) => type === "measurement")
    .map(({ update, holdout_cross_entropy, holdout_accuracy,
      per_class_accuracy, per_class_count, base_runtime_digest }) => ({ update,
      holdout_cross_entropy, holdout_accuracy, per_class_accuracy,
      per_class_count, base_runtime_digest }));
  assert.deepEqual(measurements.map(({ update }) => update),
    UPDATES.slice(0, measurements.length));
  const selected = featureSelection(measurements);
  let candidate = null, privateSemantic = null, privateCanonical = null;
  let confirmationSemantic = null, publicCanonical = null;
  let promotionCanonical = null, combinedCanonical = null;
  if (selected) {
    const checkpoint = path.join(options.out,
      `checkpoint-u${String(selected.update).padStart(6, "0")}.q32`);
    const diagnostic = path.join(options.out, "gate-candidate.litqhead");
    run("./package_runtime_operation_head", ["docs/model.litq8", checkpoint,
      diagnostic]);
    privateSemantic = await semanticAudit(diagnostic,
      contract.data.semantic_private.path, options.out, "private-semantic");
    privateCanonical = await canonicalAudit(diagnostic,
      contract.data.canonical_private.path, options.out, "private-canonical");
    if (privateSemantic.decision.passed && privateCanonical.decision.passed) {
      confirmationSemantic = await semanticAudit(diagnostic,
        contract.data.semantic_confirmation.path, options.out,
        "confirmation-semantic");
      publicCanonical = await canonicalAudit(diagnostic,
        contract.data.canonical_public.path, options.out, "public-canonical");
      promotionCanonical = await canonicalAudit(diagnostic,
        contract.data.canonical_promotion.path, options.out, "promotion-canonical");
      combinedCanonical = combineCanonical(publicCanonical, promotionCanonical);
    }
    if (confirmationSemantic?.decision.passed && combinedCanonical?.decision.passed) {
      candidate = path.join(options.out, "candidate.litqhead");
      fs.renameSync(diagnostic, candidate);
    } else fs.renameSync(diagnostic,
      path.join(options.out, "rejected-candidate.litqhead"));
  }
  const result = {
    schema: "zero.zero4_q34_semantic_head_result.v1",
    source_commit: sourceCommit, contract_sha256: contractHash,
    authorization_sha256: authorizationHash, measurements,
    selected_feature_checkpoint: selected, private_semantic: privateSemantic,
    private_canonical: privateCanonical,
    confirmation_semantic: confirmationSemantic,
    public_canonical: publicCanonical, promotion_canonical: promotionCanonical,
    combined_public_promotion_canonical: combinedCanonical,
    candidate: candidate ? { path: candidate, sha256: sha256(candidate),
      selected_update: selected.update } : null,
    scientific_decision: candidate ? "go" : "no-go",
    base_trainable_parameters: 0, head_trainable_parameters: 7685,
    language_gate: { authorized: false, executed: false },
    deployment: { authorized: false, executed: false },
    additional_seeds: { authorized: false, executed: false },
  };
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(consumption, path.join(options.out,
    "authorization-consumption.json"), fs.constants.COPYFILE_EXCL);
  console.log(candidate ? "Q3.4 semantic-head confirmation passed" :
    "Q3.4 ended with no confirmed candidate");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = "benchmarks/zero4-q33-semantic-v1";
const CONTRACT_PATH = `${ROOT}/contract.json`;
const DATASET = `${ROOT}/semantic-eval.tsv`;
const CANDIDATE = "benchmarks/zero4-q32-v1/results/candidate.litqhead";
const PROMOTION_RESULT =
  "benchmarks/zero4-q32-promotion-v1/results/result.json";
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const STRATA = ["lexical", "implicit"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function runAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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

export function validateDataset(contract) {
  const lines = fs.readFileSync(contract.dataset.path, "utf8")
    .trimEnd().split("\n");
  const header = lines.shift().split("\t");
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  const visible = new Set(), cells = {};
  assert.equal(lines.length, contract.dataset.records);
  for (const line of lines) {
    const fields = line.split("\t");
    const operation = fields[column.model_request].slice("quantity.".length);
    const stratum = fields[column.stratum];
    const template = Number(fields[column.template_id]);
    const modelInput = fields[column.model_input];
    assert(CLASSES.includes(operation)); assert(STRATA.includes(stratum));
    assert(Number.isInteger(template) && template >= 0 && template < 5);
    assert(!/\b(?:add|multiply|convert|solve|quantity)\b/i.test(modelInput));
    assert(!visible.has(modelInput)); visible.add(modelInput);
    const key = `${operation}/${stratum}/${template}`;
    cells[key] = (cells[key] ?? 0) + 1;
  }
  assert.equal(visible.size, contract.dataset.unique_model_inputs);
  assert.equal(Object.keys(cells).length, 50);
  assert(Object.values(cells).every((count) => count === 10));
}

export function validateContract(contract) {
  assert.equal(contract.schema,
    "zero.zero4_q33_semantic_routing_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.evaluation_allowed, false);
  assert.equal(sha256(contract.eligibility.promotion_result.path),
    contract.eligibility.promotion_result.sha256);
  const promotion = readJson(contract.eligibility.promotion_result.path);
  assert.equal(promotion.scientific_decision,
    contract.eligibility.promotion_result.required_decision);
  assert.equal(promotion.totals.exact_request,
    contract.eligibility.promotion_result.observed_exact_requests);
  assert.equal(sha256(contract.candidate.path), contract.candidate.sha256);
  assert.equal(fs.statSync(contract.candidate.path).size,
    contract.candidate.bytes);
  assert.equal(sha256(contract.dataset.path), contract.dataset.sha256);
  assert.equal(sha256(contract.dataset.source.path),
    contract.dataset.source.sha256);
  assert.equal(sha256(contract.dataset.generator.path),
    contract.dataset.generator.sha256);
  assert.equal(sha256(contract.mechanics.semantic_evaluator.path),
    contract.mechanics.semantic_evaluator.sha256);
  for (const [file, digest] of Object.entries(contract.mechanics.runtime_sources))
    assert.equal(sha256(file), digest, `${file} runtime binding drifted`);
  assert.equal(contract.mechanics.training_updates, 0);
  assert.equal(contract.mechanics.chance_accuracy, 0.2);
  assert.equal(contract.budget.maximum_semantic_records, 500);
  validateDataset(contract);
  for (const value of Object.values(contract.downstream))
    assert.equal(value, false);
}

export function validateAuthorization(budget, sourceCommit, contractHash) {
  assert.equal(budget.schema, "zero.q33_semantic_routing_budget.v1");
  assert.equal(budget.id, "zero4-q33-seed2-semantic-routing-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.source_commit, sourceCommit);
  assert.equal(budget.proposed.candidate_sha256, sha256(CANDIDATE));
  assert.equal(budget.proposed.promotion_result_sha256,
    sha256(PROMOTION_RESULT));
  assert.equal(budget.proposed.semantic_dataset_sha256, sha256(DATASET));
  assert.equal(budget.proposed.semantic_records, 500);
  assert.equal(budget.proposed.training_updates, 0);
  const auth = budget.authorization;
  assert.equal(auth.authorized, true); assert.equal(auth.one_execution_only, true);
  assert.match(auth.approval_id, /^q33-semantic-[a-z0-9-]+$/);
  assert.equal(auth.source_commit, sourceCommit);
  assert.equal(auth.contract_sha256, contractHash);
  assert.equal(auth.candidate_sha256, sha256(CANDIDATE));
  assert.equal(auth.promotion_result_sha256, sha256(PROMOTION_RESULT));
  assert.equal(auth.semantic_dataset_sha256, sha256(DATASET));
  assert.equal(auth.maximum_semantic_records, 500);
  assert.equal(auth.maximum_compute_usd, 0.1);
  assert.equal(auth.training_updates, 0);
  for (const key of ["retraining_authorized", "language_gate_authorized",
    "deployment_authorized", "additional_seed_authorized"])
    assert.equal(auth[key], false);
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

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { authorization: null, out: null };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  assert(options.authorization && options.out,
    "semantic evaluation requires --authorization and --out");
  return options;
}

function selfTest() {
  const totals = { cases: 500, operation: 400, canonical_binding: 500,
    oracle_arithmetic: 500, committed: 400, exact_artifact: 400,
    rejected_state_mutations: 0 };
  const classes = Object.fromEntries(CLASSES.map((name) => [name, 0.8]));
  assert.equal(semanticDecision(totals, classes,
    { lexical: 0.8, implicit: 0.8 }, true).passed, true);
  classes.add = 0.59;
  assert.equal(semanticDecision(totals, classes,
    { lexical: 0.8, implicit: 0.8 }, true).passed, false);
  console.log("Q3.3 semantic decision self-test passed");
}

function nonQIdentity() {
  return [["D", "hello"], ["H", "a quiet room"],
    ["Z", "state remains unchanged"]].every(([style, prompt]) => {
    const base = spawnSync("./base_probability_infer",
      ["docs/model.litq8", "--chat", style, prompt], { encoding: "utf8" });
    const routed = spawnSync("./operation_head_infer",
      [CANDIDATE, "--chat", style, prompt], { encoding: "utf8" });
    assert.equal(base.status, 0); assert.equal(routed.status, 0);
    return base.stdout === routed.stdout;
  });
}

async function evaluate(out) {
  const lines = fs.readFileSync(DATASET, "utf8").trimEnd().split("\n");
  const header = lines.shift(); const columns = header.split("\t");
  const column = Object.fromEntries(columns.map((name, index) => [name, index]));
  const cells = await Promise.all(CLASSES.flatMap((operation, classIndex) =>
    STRATA.map(async (stratum) => {
      const selected = lines.filter((line) => {
        const fields = line.split("\t");
        return fields[column.model_request] === `quantity.${operation}` &&
          fields[column.stratum] === stratum;
      });
      assert.equal(selected.length, 50);
      const tsv = path.join(out, `.semantic-${operation}-${stratum}.tsv`);
      const json = path.join(out, `semantic-${operation}-${stratum}.json`);
      fs.writeFileSync(tsv, `${header}\n${selected.join("\n")}\n`,
        { flag: "wx" });
      await runAsync("./semantic_operation_eval",
        [CANDIDATE, tsv, "--json", json]);
      fs.rmSync(tsv);
      return { operation, classIndex, stratum, result: readJson(json) };
    })));
  const scalarKeys = ["cases", "closed", "syntax", "operation",
    "canonical_binding", "oracle_arithmetic", "committed", "exact_artifact",
    "rejected", "rejected_state_mutations"];
  const totals = {}, classes = {}, strata = {}, confusion = {}, templates = {};
  for (const operation of CLASSES) {
    const matching = cells.filter((cell) => cell.operation === operation);
    const summary = {};
    for (const cell of matching) addValues(summary, cell.result, scalarKeys);
    classes[operation] = { ...summary,
      accuracy: summary.operation / summary.cases };
    confusion[operation] = Array(5).fill(0);
    for (const cell of matching)
      cell.result.predicted_counts.forEach((value, index) =>
        { confusion[operation][index] += value; });
  }
  for (const stratum of STRATA) {
    const matching = cells.filter((cell) => cell.stratum === stratum);
    const summary = {};
    for (const cell of matching) addValues(summary, cell.result, scalarKeys);
    strata[stratum] = { ...summary,
      accuracy: summary.operation / summary.cases };
  }
  for (const cell of cells) {
    addValues(totals, cell.result, scalarKeys);
    templates[`${cell.operation}/${cell.stratum}`] =
      cell.result.template_cases.map((cases, index) => ({ template: index,
        cases, correct: cell.result.template_correct[index],
        accuracy: cell.result.template_correct[index] / cases }));
  }
  const classAccuracy = Object.fromEntries(CLASSES.map((name) =>
    [name, classes[name].accuracy]));
  const stratumAccuracy = Object.fromEntries(STRATA.map((name) =>
    [name, strata[name].accuracy]));
  const nonQ = nonQIdentity();
  return { totals, classes, strata, confusion_labels: CLASSES,
    confusion_matrix: confusion, template_cells: templates,
    chance_accuracy: 0.2, non_q_probability_identity: nonQ,
    decision: semanticDecision(totals, classAccuracy, stratumAccuracy, nonQ) };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  const contract = readJson(CONTRACT_PATH); validateContract(contract);
  const sourceCommit = spawnSync("git", ["rev-parse", "HEAD"],
    { encoding: "utf8" }).stdout.trim();
  const contractHash = sha256(CONTRACT_PATH);
  const budget = readJson(options.authorization);
  validateAuthorization(budget, sourceCommit, contractHash);
  assert(!fs.existsSync(options.out), "semantic output already exists");
  const authorizationHash = sha256(options.authorization);
  const consumption = `${options.authorization}.consumed`;
  fs.writeFileSync(consumption, `${JSON.stringify({
    schema: "zero.q33_semantic_authorization_consumption.v1",
    authorization_sha256: authorizationHash, source_commit: sourceCommit,
    candidate_sha256: sha256(CANDIDATE), dataset_sha256: sha256(DATASET),
    semantic_records: 500, output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  fs.mkdirSync(options.out, { recursive: false });
  const evaluation = await evaluate(options.out);
  const result = {
    schema: "zero.zero4_q33_semantic_routing_result.v1",
    source_commit: sourceCommit, contract_sha256: contractHash,
    authorization_sha256: authorizationHash,
    candidate: { path: CANDIDATE, sha256: sha256(CANDIDATE), update: 100 },
    dataset: { path: DATASET, sha256: sha256(DATASET), records: 500 },
    training_updates: 0, ...evaluation,
    scientific_decision: evaluation.decision.passed ? "strong-go" : "no-go",
    retraining: { authorized: false, executed: false },
    language_gate: { authorized: false, executed: false },
    deployment: { authorized: false, executed: false },
    additional_seeds: { authorized: false, executed: false },
  };
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(consumption,
    path.join(options.out, "authorization-consumption.json"),
    fs.constants.COPYFILE_EXCL);
  console.log(result.scientific_decision === "strong-go" ?
    "Q3.3 strong semantic-routing gate passed" :
    "Q3.3 strong semantic-routing gate did not pass");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();

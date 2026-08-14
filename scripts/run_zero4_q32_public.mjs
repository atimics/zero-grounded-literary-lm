#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = "benchmarks/zero4-q32-public-v1";
const CONTRACT_PATH = `${ROOT}/contract.json`;
const CANDIDATE = "benchmarks/zero4-q32-v1/results/candidate.litqhead";
const PUBLIC = "corpus/faculty/q22/quantity-request.public.tsv";
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const SOURCE_HASHES = Object.freeze({
  "quantity_request_eval.c": "1627c00a2a49846170b8ee49160ac55ae02e1f4f687397f3e46641e271537902",
  "operation_head_infer.c": "98b82eb442b68391a257c96a49f7ccef9dd66b24aee59b2631634e60d81d5d7a",
  "faculty_controller.c": "42681a75a11660aba6d9b274398abbc1ddc51f35f324302e01b994ea1e0627d9",
  "quantity_oracle.c": "7f55a9ff1a5f31d6cb8ec894c590c6239e7063fa578fe1badba123ff74f95467",
  "base_probability_infer.c": "00a343a8a1c96fe4bba4c809ff1ee506169486752e5593fbe711b3fe31de10cb",
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
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
    "zero.zero4_q32_public_quantity_contract.v1");
  assert.equal(contract.status, "implementation_staged_run_not_authorized");
  assert.equal(contract.evaluation_allowed, false);
  assert.equal(contract.candidate.sha256, sha256(contract.candidate.path));
  assert.equal(fs.statSync(contract.candidate.path).size,
    contract.candidate.bytes);
  assert.equal(contract.candidate.training_result.sha256,
    sha256(contract.candidate.training_result.path));
  assert.equal(contract.public_split.sha256,
    sha256(contract.public_split.path));
  assert.equal(contract.public_split.records, 500);
  assert.equal(contract.public_split.records_per_class, 100);
  assert.deepEqual(contract.mechanics.evaluator_sources, SOURCE_HASHES);
  for (const [file, digest] of Object.entries(SOURCE_HASHES))
    assert.equal(sha256(file), digest, `${file} evaluator binding drifted`);
  assert.equal(contract.mechanics.training_updates, 0);
  assert.equal(contract.budget.maximum_public_records, 500);
  assert.equal(contract.budget.maximum_compute_usd, 0.1);
  for (const value of Object.values(contract.downstream))
    assert.equal(value, false);
}

export function validateAuthorization(budget, sourceCommit, contractHash) {
  assert.equal(budget.schema, "zero.q32_public_quantity_budget.v1");
  assert.equal(budget.id, "zero4-q32-seed2-public-quantity-v1");
  assert.equal(budget.status, "run_authorized");
  assert.equal(budget.proposed.source_commit, sourceCommit);
  assert.equal(budget.proposed.candidate_sha256, sha256(CANDIDATE));
  assert.equal(budget.proposed.public_records, 500);
  assert.equal(budget.proposed.training_updates, 0);
  const auth = budget.authorization;
  assert.equal(auth.authorized, true);
  assert.equal(auth.one_execution_only, true);
  assert.match(auth.approval_id, /^q32-public-[a-z0-9-]+$/);
  assert.equal(auth.source_commit, sourceCommit);
  assert.equal(auth.contract_sha256, contractHash);
  assert.equal(auth.candidate_sha256, sha256(CANDIDATE));
  assert.equal(auth.maximum_public_records, 500);
  assert.equal(auth.maximum_compute_usd, 0.1);
  assert.equal(auth.training_updates, 0);
  for (const key of ["promotion_authorized", "language_gate_authorized",
    "deployment_authorized", "additional_seed_authorized"])
    assert.equal(auth[key], false);
}

export function quantityDecision(totals, nonQIdentity) {
  assert.equal(totals.cases, 500);
  const rates = {};
  for (const key of ["closed", "syntax", "operation", "arguments",
    "exact_request", "oracle_arithmetic", "committed", "exact_artifact"])
    rates[key] = totals[key] / totals.cases;
  const gates = {
    closed: rates.closed >= 0.99,
    syntax: rates.syntax >= 0.99,
    operation: rates.operation >= 0.95,
    arguments: rates.arguments >= 0.95,
    exact_request: rates.exact_request >= 0.95,
    oracle_arithmetic: rates.oracle_arithmetic === 1,
    committed: rates.committed >= 0.95,
    exact_artifact: rates.exact_artifact >= 0.95,
    rejected_state_mutations: totals.rejected_state_mutations === 0,
    non_q_probability_identity: nonQIdentity,
  };
  return { passed: Object.values(gates).every(Boolean), rates, gates };
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
    "public gate requires --authorization and --out");
  return options;
}

function selfTest() {
  const exact = { cases: 500, closed: 500, syntax: 500, operation: 475,
    arguments: 475, exact_request: 475, oracle_arithmetic: 500,
    committed: 475, exact_artifact: 475, rejected: 25,
    rejected_state_mutations: 0 };
  assert.equal(quantityDecision(exact, true).passed, true);
  assert.equal(quantityDecision({ ...exact, operation: 474 }, true).passed,
    false);
  assert.equal(quantityDecision(exact, false).passed, false);
  console.log("Q3.2 public quantity decision self-test passed");
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

async function evaluatePublic(out) {
  const rows = fs.readFileSync(PUBLIC, "utf8").trimEnd().split("\n");
  const header = rows.shift(); const columns = header.split("\t");
  const requestIndex = columns.indexOf("model_request");
  assert.equal(rows.length, 500); assert(requestIndex >= 0);
  const jobs = CLASSES.map(async (name) => {
    const selected = rows.filter((row) =>
      row.split("\t")[requestIndex] === `quantity.${name}`);
    assert.equal(selected.length, 100);
    const tsv = path.join(out, `.public-${name}.tsv`);
    const json = path.join(out, `public-${name}.json`);
    fs.writeFileSync(tsv, `${header}\n${selected.join("\n")}\n`, { flag: "wx" });
    await runAsync("./operation_head_request_eval", [CANDIDATE, tsv,
      "--json", json, "--limit", "100", "--jobs", "2"]);
    fs.rmSync(tsv);
    return readJson(json);
  });
  const classAudits = await Promise.all(jobs);
  const totals = {};
  for (const audit of classAudits)
    for (const [key, value] of Object.entries(audit.quantity))
      if (Number.isInteger(value)) totals[key] = (totals[key] ?? 0) + value;
  const nonQ = nonQIdentity();
  return {
    classes: Object.fromEntries(CLASSES.map((name, index) =>
      [name, classAudits[index].quantity])),
    totals, non_q_probability_identity: nonQ,
    decision: quantityDecision(totals, nonQ),
  };
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
  assert(!fs.existsSync(options.out), "public output already exists");
  const authorizationHash = sha256(options.authorization);
  const consumption = `${options.authorization}.consumed`;
  fs.writeFileSync(consumption, `${JSON.stringify({
    schema: "zero.q32_public_authorization_consumption.v1",
    authorization_sha256: authorizationHash, source_commit: sourceCommit,
    candidate_sha256: sha256(CANDIDATE), public_records: 500,
    output: options.out,
  }, null, 2)}\n`, { flag: "wx" });
  fs.mkdirSync(options.out, { recursive: false });
  const evaluation = await evaluatePublic(options.out);
  const result = {
    schema: "zero.zero4_q32_public_quantity_result.v1",
    source_commit: sourceCommit, contract_sha256: contractHash,
    authorization_sha256: authorizationHash,
    candidate: { path: CANDIDATE, sha256: sha256(CANDIDATE), update: 100 },
    public_split: { path: PUBLIC, sha256: sha256(PUBLIC), records: 500,
      records_per_class: 100 },
    training_updates: 0, ...evaluation,
    scientific_decision: evaluation.decision.passed ? "go" : "no-go",
    promotion: { authorized: false, executed: false },
    language_gate: { authorized: false, executed: false },
    deployment: { authorized: false, executed: false },
    additional_seeds: { authorized: false, executed: false },
  };
  fs.writeFileSync(path.join(options.out, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  fs.copyFileSync(consumption,
    path.join(options.out, "authorization-consumption.json"),
    fs.constants.COPYFILE_EXCL);
  console.log(result.scientific_decision === "go" ?
    "Q3.2 public quantity gate passed" : "Q3.2 public quantity gate failed");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();

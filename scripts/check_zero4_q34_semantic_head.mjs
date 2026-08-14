#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "benchmarks/zero4-q34-semantic-head-v1";
const CONTRACT_PATH = `${ROOT}/contract.json`;
const BUDGET_PATH = `${ROOT}/budget-template.json`;
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
}
function rejected(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
}

function validateSemanticTsv(file, globalVisible) {
  const [header, ...lines] = fs.readFileSync(file, "utf8").trimEnd().split("\n");
  const names = header.split("\t");
  const column = Object.fromEntries(names.map((name, index) => [name, index]));
  const cells = {}, lengthCells = {};
  assert.equal(lines.length, 500);
  for (const line of lines) {
    const fields = line.split("\t");
    const operation = fields[column.model_request].slice("quantity.".length);
    const stratum = fields[column.stratum];
    const visible = fields[column.model_input];
    assert(CLASSES.includes(operation));
    assert(["lexical", "implicit"].includes(stratum));
    assert(!/\b(?:add|multiply|convert|solve|quantity)\b/i.test(visible));
    assert(!globalVisible.has(visible), "semantic model input was reused");
    globalVisible.add(visible);
    cells[`${operation}/${stratum}`] =
      (cells[`${operation}/${stratum}`] ?? 0) + 1;
    lengthCells[`${operation}/${visible.length}`] =
      (lengthCells[`${operation}/${visible.length}`] ?? 0) + 1;
  }
  for (const operation of CLASSES) {
    assert.equal(cells[`${operation}/lexical`], 50);
    assert.equal(cells[`${operation}/implicit`], 50);
  }
  const reference = Object.entries(lengthCells).filter(([key]) =>
    key.startsWith("add/")).map(([key, value]) =>
      [key.slice("add/".length), value]);
  for (const operation of CLASSES.slice(1))
    assert.deepEqual(Object.entries(lengthCells).filter(([key]) =>
      key.startsWith(`${operation}/`)).map(([key, value]) =>
        [key.slice(operation.length + 1), value]), reference,
      `${operation} length distribution differs`);
}

function decode(tokens) {
  return String.fromCharCode(...tokens);
}

function validateTokens(contract) {
  const bytes = fs.readFileSync(contract.data.training_tokens.path);
  assert.equal(bytes.length % 2, 0);
  const tokens = Array.from({ length: bytes.length / 2 }, (_, index) =>
    bytes.readUInt16LE(index * 2));
  const starts = [];
  tokens.forEach((token, index) => { if (token === 1) starts.push(index); });
  assert.equal(starts.length, 10000);
  const counts = { canonical: Array(5).fill(0), semantic: Array(5).fill(0),
    private: Array(5).fill(0), confirmation: Array(5).fill(0) };
  for (let record = 0; record < starts.length; ++record) {
    const part = tokens.slice(starts[record], starts[record + 1] ?? tokens.length);
    assert.deepEqual(part.slice(0, 3), [1, 81, 7]);
    const inputStart = part.findIndex((value, index) =>
      value === 2 && part[index + 1] === 85) + 2;
    const inputEnd = part.indexOf(4, inputStart);
    const targetStart = part.findIndex((value, index) =>
      value === 3 && part[index + 1] === 85 && part[index + 2] === 6) + 3;
    const targetEnd = part.indexOf(4, targetStart);
    assert(inputStart > 1 && inputEnd > inputStart && targetStart > inputEnd &&
      targetEnd > targetStart);
    const input = decode(part.slice(inputStart, inputEnd));
    const target = decode(part.slice(targetStart, targetEnd));
    const match = /^@request quantity\.(add|multiply|add-rational|convert|solve-linear) @close$/.exec(target);
    assert(match); const classIndex = CLASSES.indexOf(match[1]);
    assert.equal(classIndex, record % 5);
    if (record < 9000) {
      const group = Math.floor(record / 5);
      const semantic = group % 2 === 1;
      counts[semantic ? "semantic" : "canonical"][classIndex]++;
      if (semantic) {
        assert(!/\b(?:add|multiply|convert|solve|quantity)\b/i.test(input));
        assert(contract.data.manifest.path && [160,176,192,208,224].includes(input.length));
      }
    } else if (record < 9500) counts.private[classIndex]++;
    else counts.confirmation[classIndex]++;
  }
  for (let index = 0; index < 5; ++index) {
    assert.equal(counts.canonical[index], 900);
    assert.equal(counts.semantic[index], 900);
    assert.equal(counts.private[index], 100);
    assert.equal(counts.confirmation[index], 100);
  }
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
assert.equal(contract.schema, "zero.zero4_q34_semantic_head_contract.v1");
assert.equal(contract.status, "implementation_staged_run_not_authorized");
assert.equal(contract.training_allowed, false);
assert.equal(contract.architecture.base_trainable_parameters, 0);
assert.equal(contract.architecture.head_parameters, 7685);
assert.equal(contract.data.training_tokens.total_channel_records, 10000);
assert.equal(contract.data.training_tokens.records, 9000);
assert.equal(contract.data.training_tokens.canonical_records, 4500);
assert.equal(contract.data.training_tokens.semantic_records, 4500);
assert.equal(contract.pilot.maximum_optimizer_updates, 100);
assert.deepEqual(contract.pilot.measurement_updates, [0, 25, 50, 100]);
for (const binding of [contract.lineage.q33_result,
  contract.lineage.runtime_base, ...Object.values(contract.data)])
  assert.equal(sha256(binding.path), binding.sha256,
    `${binding.path} binding drifted`);
for (const [file, digest] of Object.entries(contract.mechanics))
  assert.equal(sha256(file), digest, `${file} mechanics drifted`);

const manifest = JSON.parse(fs.readFileSync(contract.data.manifest.path, "utf8"));
assert.equal(manifest.records.training, 9000);
assert.equal(manifest.records.canonical_training, 4500);
assert.equal(manifest.records.semantic_training, 4500);
for (const [name, digest] of Object.entries(manifest.files))
  assert.equal(sha256(`${ROOT}/${name}`), digest);
const visible = new Set();
validateSemanticTsv(contract.data.semantic_private.path, visible);
validateSemanticTsv(contract.data.semantic_confirmation.path, visible);
validateTokens(contract);

const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, "utf8"));
assert.equal(budget.status, "implementation_staged_run_not_authorized");
assert.equal(budget.authorization.authorized, false);
assert.equal(budget.authorization.maximum_optimizer_updates, 0);
assert.equal(budget.authorization.maximum_compute_usd, 0);
const pilot = fs.readFileSync("semantic_runtime_head_pilot.c", "utf8");
for (const forbidden of ["--seed", "--resume", "--base", "--public",
  "--promotion", "--language", "--deploy"])
  assert(!pilot.includes(`strcmp(argv[index], \"${forbidden}\")`));
const makefile = fs.readFileSync("Makefile", "utf8");
assert(!/^zero4-q34-(?:train|run):/m.test(makefile));

run("node", ["scripts/materialize_q34_budget.mjs", "--self-test"]);
run("node", ["scripts/run_zero4_q34_semantic_head.mjs", "--self-test"]);
run("./semantic_runtime_head_pilot", ["--self-test"]);
const out = `/tmp/zero-q34-unauthorized-${process.pid}`;
rejected("node", ["scripts/run_zero4_q34_semantic_head.mjs", "--authorization",
  BUDGET_PATH, "--out", out]);
assert.equal(fs.existsSync(out), false,
  "unauthorized Q3.4 runner created output");
console.log("Q3.4 semantic-head implementation contract passed");

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULT_CONTRACT = "benchmarks/zero-language-gate-v1/contract.json";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256(file) {
  return sha256Bytes(fs.readFileSync(file));
}

export function validateBudget(budget, contractHash, model) {
  assert(budget?.schema === "zero.language_preservation_gate_budget.v1",
    "budget schema drifted");
  assert(budget.status === "authorized", "budget is not authorized");
  assert(
    budget.contract.id === "zero-language-gate-v1" &&
      budget.contract.sha256 === contractHash,
    "budget contract binding drifted",
  );
  assert(
    budget.candidate.id === model.id &&
      budget.candidate.sha256 === model.sha256 &&
      budget.candidate.bytes === model.bytes,
    "budget candidate binding drifted",
  );
  assert(
    budget.venue.provider === "aws" &&
      budget.venue.region === "us-east-1" &&
      budget.venue.instance_type === "c6i.4xlarge",
    "budget venue drifted",
  );
  assert(
    Number.isInteger(budget.caps.max_instance_seconds) &&
      budget.caps.max_instance_seconds > 0 &&
      budget.caps.max_instance_seconds <= 600 &&
      Number.isFinite(budget.caps.max_compute_usd) &&
      budget.caps.max_compute_usd > 0 &&
      budget.caps.max_compute_usd <= 0.12,
    "budget exceeds the gate ceiling",
  );
  assert(
    budget.authorization.explicit_manual_authorization === true &&
      budget.authorization.authorized_for_execution === true &&
      budget.authorization.one_execution_only === true,
    "budget authorization is incomplete",
  );
  return true;
}

function spawnWorker(executable, model, cases, output, index, count) {
  const args = [
    model,
    cases,
    "--jsonl",
    output,
    "--shard-index",
    String(index),
    "--shard-count",
    String(count),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker ${index} exited ${code}: ${error}`));
    });
  });
}

function readPartials(partials) {
  const results = [];
  for (const partial of partials) {
    const text = fs.readFileSync(partial, "utf8").trim();
    if (text) {
      for (const line of text.split("\n")) results.push(JSON.parse(line));
    }
  }
  results.sort((left, right) => left.ordinal - right.ordinal);
  for (let index = 0; index < results.length; ++index) {
    assert(results[index].ordinal === index, `case coverage gap at ${index}`);
  }
  assert(results.length > 0, "evaluation produced no cases");
  return results;
}

export function packBits(bits) {
  const packed = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((value, index) => {
    if (value) packed[Math.floor(index / 8)] |= 1 << (index % 8);
  });
  return packed;
}

function bitTrace(bits) {
  const packed = packBits(bits);
  return {
    encoding: "base64-packed-lsb-first-v1",
    cases: bits.length,
    bytes: packed.length,
    sha256: sha256Bytes(packed),
    data: packed.toString("base64"),
  };
}

export function encodeRollingTrace(results) {
  const text = results.map((item) => {
    const score = item.scores[item.gold];
    assert(Number.isFinite(score.bits), `case ${item.ordinal} has invalid target bits`);
    assert(Number.isInteger(score.bytes) && score.bytes > 0,
      `case ${item.ordinal} has invalid target bytes`);
    return `${item.ordinal}\t${score.bits.toString()}\t${score.bytes}\n`;
  }).join("");
  const bytes = Buffer.from(text, "utf8");
  return {
    encoding: "base64-utf8-tsv-ordinal-bits-bytes-v1",
    cases: results.length,
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
    data: bytes.toString("base64"),
  };
}

function aggregateGroups(results, kind) {
  const groups = {};
  for (const item of results) {
    const group = groups[item.group] ??= {
      cases: 0,
      raw_correct: 0,
      normalized_correct: 0,
      target_bits: 0,
      target_bytes: 0,
    };
    const score = item.scores[item.gold];
    group.cases += 1;
    group.raw_correct += Number(item.raw_prediction === item.gold);
    group.normalized_correct += Number(item.normalized_prediction === item.gold);
    group.target_bits += score.bits;
    group.target_bytes += score.bytes;
  }
  return Object.fromEntries(
    Object.entries(groups)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => {
        const metrics = {
          cases: item.cases,
          bits_per_byte: item.target_bits / item.target_bytes,
        };
        if (kind === "pair") {
          metrics.raw_accuracy = item.raw_correct / item.cases;
          metrics.normalized_accuracy = item.normalized_correct / item.cases;
        }
        return [name, metrics];
      }),
  );
}

function aggregateTask(casesPath, results, expectedBenchmark, expectedKind) {
  assert(
    results.every((item) =>
      item.benchmark === expectedBenchmark && item.kind === expectedKind),
    `${expectedBenchmark} result kind or benchmark drifted`,
  );
  const canonical = Buffer.from(
    `${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
    "utf8",
  );
  let totalBits = 0;
  let totalBytes = 0;
  let rawCorrect = 0;
  let normalizedCorrect = 0;
  for (const item of results) {
    const score = item.scores[item.gold];
    totalBits += score.bits;
    totalBytes += score.bytes;
    rawCorrect += Number(item.raw_prediction === item.gold);
    normalizedCorrect += Number(item.normalized_prediction === item.gold);
  }
  const metrics = {
    bits_per_byte: totalBits / totalBytes,
    total_target_bytes: totalBytes,
  };
  const trace = {};
  if (expectedKind === "pair") {
    metrics.raw_accuracy = rawCorrect / results.length;
    metrics.normalized_accuracy = normalizedCorrect / results.length;
    trace.raw_correct = bitTrace(
      results.map((item) => item.raw_prediction === item.gold),
    );
    trace.normalized_correct = bitTrace(
      results.map((item) => item.normalized_prediction === item.gold),
    );
  } else {
    trace.target_scores = encodeRollingTrace(results);
  }
  return {
    cases_path: casesPath,
    cases_sha256: sha256(casesPath),
    cases: results.length,
    benchmark: expectedBenchmark,
    kind: expectedKind,
    case_results_sha256: sha256Bytes(canonical),
    metrics,
    groups: aggregateGroups(results, expectedKind),
    paired_trace: trace,
  };
}

async function runTask(options, task, temporary) {
  const taskStarted = performance.now();
  const partials = Array.from(
    { length: options.jobs },
    (_, index) => path.join(
      temporary,
      `${task.id}-part-${String(index).padStart(2, "0")}.jsonl`,
    ),
  );
  await Promise.all(partials.map((output, index) => spawnWorker(
    options.executable,
    options.model,
    task.cases,
    output,
    index,
    options.jobs,
  )));
  const results = readPartials(partials);
  return {
    elapsed_seconds: (performance.now() - taskStarted) / 1000,
    ...aggregateTask(task.cases, results, task.benchmark, task.kind),
  };
}

export function decide(contract, tasks) {
  const blimp = tasks.blimp.metrics.raw_accuracy;
  const tinystories = tasks.tinystories.metrics.bits_per_byte;
  const checks = {
    blimp_raw_accuracy: {
      value: blimp,
      comparator: ">=",
      threshold: contract.decision_rule.blimp.minimum_raw_accuracy,
      pass: blimp >= contract.decision_rule.blimp.minimum_raw_accuracy,
    },
    tinystories_bits_per_byte: {
      value: tinystories,
      comparator: "<=",
      threshold: contract.decision_rule.tinystories.maximum_bits_per_byte,
      pass: tinystories <=
        contract.decision_rule.tinystories.maximum_bits_per_byte,
    },
  };
  return {
    rule: "all checks are conjunctive",
    checks,
    pass: Object.values(checks).every((check) => check.pass),
  };
}

export async function run(options) {
  const contract = JSON.parse(fs.readFileSync(options.contract, "utf8"));
  assert(contract.schema === "zero.language_preservation_gate_contract.v1",
    "contract schema drifted");
  assert(contract.execution.authorized_for_execution === false,
    "base contract authorization drifted");
  const contractHash = sha256(options.contract);
  const model = {
    id: options.modelId,
    path: options.model,
    sha256: sha256(options.model),
    bytes: fs.statSync(options.model).size,
  };
  let execution;
  if (options.mechanicsOnly) {
    assert(!options.budget, "mechanics-only runs must not consume a budget");
    execution = { mode: "mechanics_only", scientific_inference_allowed: false };
  } else {
    assert(options.budget, "scientific scoring requires --budget");
    const budget = JSON.parse(fs.readFileSync(options.budget, "utf8"));
    validateBudget(budget, contractHash, model);
    execution = {
      mode: "authorized_aws",
      scientific_inference_allowed: true,
      budget: {
        id: budget.id,
        path: options.budget,
        sha256: sha256(options.budget),
      },
    };
  }
  const tasks = [
    { id: "blimp", cases: options.blimp, benchmark: "blimp", kind: "pair" },
    {
      id: "tinystories",
      cases: options.tinystories,
      benchmark: "tinystories",
      kind: "rolling",
    },
  ];
  if (options.mechanicsOnly) {
    for (const task of tasks) {
      const rows = fs.readFileSync(task.cases, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      assert(rows.length >= 2 && rows.length - 1 <= 16,
        `${task.id} mechanics-only inputs must contain from 1 to 16 cases`);
    }
  } else {
    for (const task of tasks) {
      assert(
        sha256(task.cases) === contract.reference.tasks[task.id].cases_sha256,
        `${task.id} cases do not match the frozen gate`,
      );
    }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-language-gate-"));
  const started = performance.now();
  try {
    const taskResults = {};
    for (const task of tasks) {
      taskResults[task.id] = await runTask(options, task, temporary);
    }
    const output = {
      schema: "zero.language_preservation_gate_result.v1",
      contract: {
        id: contract.id,
        path: options.contract,
        sha256: contractHash,
      },
      model,
      evaluator: {
        path: options.executable,
        sha256: sha256(options.executable),
        jobs: options.jobs,
      },
      execution,
      training_updates: 0,
      elapsed_seconds: (performance.now() - started) / 1000,
      tasks: taskResults,
      decision: decide(contract, taskResults),
    };
    fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
    return output;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const options = {
    executable: "./external_eval",
    contract: DEFAULT_CONTRACT,
    jobs: 16,
    mechanicsOnly: false,
  };
  for (let index = 0; index < args.length; ++index) {
    const key = args[index];
    if (key === "--mechanics-only") {
      options.mechanicsOnly = true;
      continue;
    }
    const value = args[++index];
    if (value === undefined) fail(`missing value for ${key}`);
    if (key === "--executable") options.executable = value;
    else if (key === "--contract") options.contract = value;
    else if (key === "--model") options.model = value;
    else if (key === "--model-id") options.modelId = value;
    else if (key === "--blimp") options.blimp = value;
    else if (key === "--tinystories") options.tinystories = value;
    else if (key === "--output") options.output = value;
    else if (key === "--jobs") options.jobs = Number(value);
    else if (key === "--budget") options.budget = value;
    else fail(`unknown argument ${key}`);
  }
  assert(
    options.model && options.modelId && options.blimp &&
      options.tinystories && options.output,
    "--model, --model-id, --blimp, --tinystories, and --output are required",
  );
  assert(Number.isInteger(options.jobs) && options.jobs >= 1 && options.jobs <= 32,
    "--jobs must be from 1 to 32");
  return options;
}

function selfTest() {
  const packed = packBits([true, false, true, false, false, false, false, true, true]);
  assert(packed.equals(Buffer.from([0x85, 0x01])), "bit packing drifted");
  const rolling = encodeRollingTrace([
    { ordinal: 0, gold: 0, scores: [{ bits: 1.25, bytes: 2 }] },
    { ordinal: 1, gold: 0, scores: [{ bits: 3.5, bytes: 1 }] },
  ]);
  assert(
    Buffer.from(rolling.data, "base64").toString("utf8") ===
      "0\t1.25\t2\n1\t3.5\t1\n",
    "rolling trace encoding drifted",
  );
  const contract = {
    decision_rule: {
      blimp: { minimum_raw_accuracy: 0.522 },
      tinystories: { maximum_bits_per_byte: 2.553139779957201 },
    },
  };
  assert(decide(contract, {
    blimp: { metrics: { raw_accuracy: 0.53 } },
    tinystories: { metrics: { bits_per_byte: 2.54 } },
  }).pass, "passing decision failed");
  assert(!decide(contract, {
    blimp: { metrics: { raw_accuracy: 0.521 } },
    tinystories: { metrics: { bits_per_byte: 2.54 } },
  }).pass, "failing decision passed");
  const budget = {
    schema: "zero.language_preservation_gate_budget.v1",
    id: "test-budget",
    status: "authorized",
    contract: { id: "zero-language-gate-v1", sha256: "a".repeat(64) },
    candidate: { id: "candidate", sha256: "b".repeat(64), bytes: 123 },
    venue: {
      provider: "aws",
      region: "us-east-1",
      instance_type: "c6i.4xlarge",
    },
    caps: { max_instance_seconds: 600, max_compute_usd: 0.12 },
    authorization: {
      explicit_manual_authorization: true,
      authorized_for_execution: true,
      one_execution_only: true,
    },
  };
  validateBudget(budget, "a".repeat(64), {
    id: "candidate",
    sha256: "b".repeat(64),
    bytes: 123,
  });
  const invalid = structuredClone(budget);
  invalid.caps.max_compute_usd = 0.13;
  let rejected = false;
  try {
    validateBudget(invalid, "a".repeat(64), {
      id: "candidate",
      sha256: "b".repeat(64),
      bytes: 123,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "over-cap budget passed");
  console.log("ZERO language gate runner self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    run(parseArguments(process.argv.slice(2)))
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
      });
  }
}

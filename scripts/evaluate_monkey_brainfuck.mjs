#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    model: "infinite-monkey-v1-final.litq8",
    corpus: "corpus/brainfuck/brainfuck.txt",
    infer: "./literary_infer",
    checker: "./brainfuck_corpus",
    limit: 40,
    split: "validation",
    json: null,
  };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (["--model", "--corpus", "--infer", "--checker", "--limit", "--split", "--json"].includes(option) && index + 1 < argv.length) {
      const key = option.slice(2);
      options[key] = key === "limit" ? Number(argv[++index]) : argv[++index];
    } else {
      fail(`unknown or incomplete option ${option}`);
    }
  }
  if (!Number.isInteger(options.limit) || options.limit < 4) fail("--limit must be an integer >= 4");
  if (!["train", "validation"].includes(options.split)) fail("--split must be train or validation");
  return options;
}

function parseCorpus(path) {
  const records = [];
  let record = null;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const header = /^@brainfuck (bf[12])$/.exec(line);
    if (header) {
      if (record) fail("nested corpus record");
      record = { version: header[1] };
      continue;
    }
    if (!record || line === "") continue;
    if (line === "@end") {
      records.push(record);
      record = null;
      continue;
    }
    const match = /^@(\w+) (.*)$/.exec(line);
    if (!match) fail(`invalid corpus line ${line}`);
    record[match[1]] = match[2];
  }
  if (record) fail("unterminated corpus record");
  return records;
}

function promptFor(record) {
  if (record.version === "bf2") return record.prompt;
  if (record.task === "synthesize") {
    return `synthesize ${record.prompt} input ${record.input} required-output ${record.expect}`;
  }
  if (record.task === "repair") {
    return `repair program ${record.program} input ${record.input} required-output ${record.expect}`;
  }
  return `${record.task} program ${record.program} input ${record.input}`;
}

function balancedSelection(records, split, limit) {
  const version = records.find((record) => record.split === split)?.version;
  const tasks = version === "bf2"
    ? ["transition", "block", "complete", "execute", "trace", "synthesize", "repair"]
    : ["execute", "trace", "synthesize", "repair"];
  const buckets = Object.fromEntries(tasks.map((task) => [task, []]));
  for (const record of records) {
    if (record.split === split && buckets[record.task]) buckets[record.task].push(record);
  }
  const selected = [];
  for (let index = 0; selected.length < limit; ++index) {
    let added = false;
    for (const task of tasks) {
      if (selected.length === limit) break;
      if (index < buckets[task].length) {
        selected.push(buckets[task][index]);
        added = true;
      }
    }
    if (!added) break;
  }
  if (selected.length !== limit) fail(`only ${selected.length} balanced validation records available`);
  return { selected, tasks, version };
}

function generatedReply(output) {
  const marker = "\nZ: ";
  const start = output.indexOf(marker);
  if (start < 0) return { artifact: null, summary: null };
  const completion = output.slice(start + marker.length).trim();
  if (!completion.startsWith("@artifact ")) return { artifact: null, summary: null };
  const summaryMarker = " @summary ";
  const summary = completion.indexOf(summaryMarker);
  const close = completion.indexOf(" @close");
  const end = summary >= 0 ? summary : close >= 0 ? close : completion.length;
  return {
    artifact: completion.slice("@artifact ".length, end).trim(),
    summary: summary >= 0
      ? completion.slice(summary + summaryMarker.length, close >= 0 ? close : completion.length).trim()
      : null,
  };
}

function semanticPass(record, reply, options) {
  const { artifact, summary } = reply;
  if (!artifact) return { pass: false, reason: "missing-artifact" };
  if (["transition", "block", "complete", "execute", "trace"].includes(record.task)) {
    if (artifact !== record.artifact) return { pass: false, reason: "artifact-mismatch" };
    if (record.version === "bf2" && summary !== record.summary) return { pass: false, reason: "summary-mismatch" };
    return { pass: true, reason: "exact-state-and-summary" };
  }
  if (!artifact.startsWith("program ")) return { pass: false, reason: "missing-program" };
  const program = artifact.slice("program ".length);
  try {
    const checked = execFileSync(options.checker, ["--check", program, "--input", record.input], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = /^output (\S+)/m.exec(checked)?.[1];
    return { pass: output === record.expect, reason: output === record.expect ? "semantic" : "wrong-output" };
  } catch {
    return { pass: false, reason: "invalid-program" };
  }
}

const STATE_FIELDS = ["step", "ip", "op", "ptr", "cells", "in", "out", "halt"];

function machineStateFields(text) {
  const match = /(?:^state |^bf2 )step (\d+) ip (\d+) op (.) ptr (-?\d+) cells (\S+) in (\d+) out (\S+) halt ([01])$/.exec(text ?? "");
  if (!match) return null;
  return Object.fromEntries(STATE_FIELDS.map((field, index) => [field, match[index + 1]]));
}

const options = parseArgs(process.argv);
const selection = balancedSelection(parseCorpus(options.corpus), options.split, options.limit);
const { selected, tasks, version } = selection;
const taskMetrics = Object.fromEntries(tasks.map((task) => [task, { passed: 0, total: 0 }]));
const stateFieldMetrics = Object.fromEntries(STATE_FIELDS.map((field) => [field, { matched: 0, total: 0 }]));
const cases = [];

for (let index = 0; index < selected.length; ++index) {
  const record = selected[index];
  const prompt = promptFor(record);
  const inferArgs = record.version === "bf2"
    ? [options.model, "--channel", "K", record.memory, prompt, "300"]
    : [options.model, "--chat", "K", prompt, "300"];
  const output = execFileSync(options.infer, inferArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const reply = generatedReply(output);
  const verdict = semanticPass(record, reply, options);
  taskMetrics[record.task].total += 1;
  if (verdict.pass) taskMetrics[record.task].passed += 1;
  if (record.version === "bf2" && ["transition", "block", "complete", "execute", "trace"].includes(record.task)) {
    const useArtifact = ["transition", "block", "trace"].includes(record.task);
    const expectedState = machineStateFields(useArtifact ? record.artifact : record.summary);
    const generatedState = machineStateFields(useArtifact ? reply.artifact : reply.summary);
    for (const field of STATE_FIELDS) {
      stateFieldMetrics[field].total += 1;
      if (expectedState && generatedState && expectedState[field] === generatedState[field]) stateFieldMetrics[field].matched += 1;
    }
  }
  cases.push({ index, task: record.task, prompt, expected: record.artifact, expectedSummary: record.summary ?? null, generated: reply.artifact, generatedSummary: reply.summary, pass: verdict.pass, reason: verdict.reason });
  process.stdout.write(`${String(index + 1).padStart(3, " ")}/${selected.length} ${record.task.padEnd(10)} ${verdict.pass ? "PASS" : "FAIL"} ${verdict.reason}\n`);
}

const passed = cases.filter((item) => item.pass).length;
const report = {
  schema: `infinite-monkey.brainfuck-eval.${version === "bf2" ? "v2" : "v1"}`,
  model: options.model,
  corpus: options.corpus,
  split: options.split,
  selection: options.split === "validation"
    ? "balanced validation records by task; instruction primitives are familiar but program compositions are held out"
    : "balanced first training records by task; measures learned-template retention",
  passed,
  total: cases.length,
  accuracy: passed / cases.length,
  tasks: taskMetrics,
  machineStateFields: stateFieldMetrics,
  cases,
};
console.log(`brainfuck semantic evaluation: ${passed}/${cases.length} (${(100 * report.accuracy).toFixed(1)}%)`);
for (const [task, metric] of Object.entries(taskMetrics)) console.log(`  ${task}: ${metric.passed}/${metric.total}`);
if (version === "bf2") {
  const matched = Object.values(stateFieldMetrics).reduce((sum, metric) => sum + metric.matched, 0);
  const total = Object.values(stateFieldMetrics).reduce((sum, metric) => sum + metric.total, 0);
  console.log(`  machine-state fields: ${matched}/${total}`);
}
if (options.json) fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);

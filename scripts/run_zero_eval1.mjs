#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function spawnWorker(executable, model, cases, output, index, count, limit) {
  const args = [
    model, cases, "--jsonl", output,
    "--shard-index", String(index), "--shard-count", String(count),
  ];
  if (limit !== null) args.push("--limit", String(limit));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(error);
      else reject(new Error(`worker ${index} exited ${code}: ${error}`));
    });
  });
}

function aggregate(casesPath, partials, timingOnly) {
  const results = [];
  for (const partial of partials) {
    const text = fs.readFileSync(partial, "utf8").trim();
    if (text) {
      for (const line of text.split("\n")) results.push(JSON.parse(line));
    }
  }
  results.sort((left, right) => left.ordinal - right.ordinal);
  for (let index = 0; index < results.length; ++index) {
    if (results[index].ordinal !== index) fail(`case coverage gap at ${index}`);
  }
  const kind = results[0]?.kind;
  const benchmark = results[0]?.benchmark;
  if (!kind || !benchmark ||
      results.some((item) => item.kind !== kind || item.benchmark !== benchmark)) {
    fail("one cases file must contain exactly one benchmark and scoring kind");
  }
  const canonical = `${results.map((result) => JSON.stringify(result)).join("\n")}\n`;
  const result = {
    cases_path: casesPath,
    cases_sha256: sha256(casesPath),
    cases: results.length,
    benchmark,
    kind,
    case_results_sha256: crypto.createHash("sha256").update(canonical).digest("hex"),
  };
  if (timingOnly) return result;

  const groups = {};
  let totalBits = 0;
  let totalBytes = 0;
  let rawCorrect = 0;
  let normalizedCorrect = 0;
  let greedyExact = 0;
  for (const item of results) {
    const group = groups[item.group] ??= {
      cases: 0,
      raw_correct: 0,
      normalized_correct: 0,
      greedy_exact: 0,
      target_bits: 0,
      target_bytes: 0,
    };
    group.cases += 1;
    if (item.raw_prediction === item.gold) {
      rawCorrect += 1;
      group.raw_correct += 1;
    }
    if (item.normalized_prediction === item.gold) {
      normalizedCorrect += 1;
      group.normalized_correct += 1;
    }
    if (item.scores[item.gold].greedy_exact) {
      greedyExact += 1;
      group.greedy_exact += 1;
    }
    totalBits += item.scores[item.gold].bits;
    totalBytes += item.scores[item.gold].bytes;
    group.target_bits += item.scores[item.gold].bits;
    group.target_bytes += item.scores[item.gold].bytes;
  }
  const finalize = (item) => {
    const metrics = {
      cases: item.cases,
      bits_per_byte: item.target_bits / item.target_bytes,
    };
    if (kind === "pair" || kind === "multiple_choice") {
      metrics.raw_accuracy = item.raw_correct / item.cases;
      metrics.normalized_accuracy = item.normalized_correct / item.cases;
    } else if (kind === "cloze") {
      metrics.greedy_exact_accuracy = item.greedy_exact / item.cases;
    }
    return metrics;
  };
  result.metrics = {
    bits_per_byte: totalBits / totalBytes,
    total_target_bytes: totalBytes,
  };
  if (kind === "pair" || kind === "multiple_choice") {
    result.metrics.raw_accuracy = rawCorrect / results.length;
    result.metrics.normalized_accuracy = normalizedCorrect / results.length;
  } else if (kind === "cloze") {
    result.metrics.greedy_exact_accuracy = greedyExact / results.length;
  }
  result.groups = Object.fromEntries(
    Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => [name, finalize(item)]),
  );
  return result;
}

export async function run(options) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-eval1-"));
  const started = performance.now();
  try {
    const partials = Array.from(
      { length: options.jobs },
      (_, index) => path.join(temporary, `part-${String(index).padStart(2, "0")}.jsonl`),
    );
    await Promise.all(partials.map((output, index) => spawnWorker(
      options.executable,
      options.model,
      options.cases,
      output,
      index,
      options.jobs,
      options.limit,
    )));
    const aggregateResult = aggregate(options.cases, partials, options.timingOnly);
    const output = {
      schema: options.timingOnly
        ? "zero.external_eval_timing.v1"
        : "zero.external_eval_result.v1",
      model: {
        id: options.modelId,
        path: options.model,
        sha256: sha256(options.model),
        bytes: fs.statSync(options.model).size,
      },
      evaluator: {
        path: options.executable,
        sha256: sha256(options.executable),
        jobs: options.jobs,
      },
      timing_only: options.timingOnly,
      elapsed_seconds: (performance.now() - started) / 1000,
      ...aggregateResult,
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
    jobs: 1,
    limit: null,
    timingOnly: false,
  };
  for (let index = 0; index < args.length; ++index) {
    const key = args[index];
    if (key === "--timing-only") {
      options.timingOnly = true;
      continue;
    }
    const value = args[++index];
    if (value === undefined) fail(`missing value for ${key}`);
    if (key === "--executable") options.executable = value;
    else if (key === "--model") options.model = value;
    else if (key === "--model-id") options.modelId = value;
    else if (key === "--cases") options.cases = value;
    else if (key === "--output") options.output = value;
    else if (key === "--jobs") options.jobs = Number(value);
    else if (key === "--limit") options.limit = Number(value);
    else fail(`unknown argument ${key}`);
  }
  if (!options.model || !options.modelId || !options.cases || !options.output) {
    fail("--model, --model-id, --cases, and --output are required");
  }
  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 32) {
    fail("--jobs must be from 1 to 32");
  }
  if (options.limit !== null &&
      (!Number.isInteger(options.limit) || options.limit < 1)) {
    fail("--limit must be positive");
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArguments(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack ?? error.message);
      process.exitCode = 1;
    });
}

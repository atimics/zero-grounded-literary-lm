#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run, validateBudget } from "./run_zero_language_gate.mjs";

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

function approximately(left, right) {
  return Math.abs(left - right) <=
    1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}

export function validateContract(contract) {
  assert(contract?.schema === "zero.language_preservation_gate_contract.v1",
    "contract schema drifted");
  assert(contract.id === "zero-language-gate-v1", "contract id drifted");
  assert(contract.status === "preregistered_not_authorized", "contract status drifted");
  assert(contract.training_allowed === false, "contract permits training");
  assert(
    contract.execution.authorized_for_execution === false &&
      contract.execution.requires_separate_budget_and_manual_authorization === true,
    "gate became authorized",
  );
  assert(
    contract.execution.venue === "AWS EC2 only" &&
      contract.execution.instance_type === "c6i.4xlarge" &&
      contract.execution.jobs === 16,
    "execution venue drifted",
  );
  assert(
    contract.execution.expected_candidate_seconds === 304.644213155 &&
      contract.execution.proposed_max_instance_seconds === 600 &&
      contract.execution.proposed_max_compute_usd === 0.12,
    "runtime or budget proposal drifted",
  );
  assert(
    contract.execution.required_budget_schema ===
      "zero.language_preservation_gate_budget.v1",
    "required budget schema drifted",
  );

  const reference = contract.reference;
  assert(fs.existsSync(reference.result_path), "reference result missing");
  assert(sha256(reference.result_path) === reference.result_sha256,
    "reference result hash mismatch");
  const result = JSON.parse(fs.readFileSync(reference.result_path, "utf8"));
  assert(result.status === "complete", "reference result is incomplete");
  const model = result.models.zero3;
  assert(model.model_sha256 === reference.model.sha256, "reference model hash drifted");
  assert(model.model_bytes === reference.model.bytes, "reference model size drifted");
  for (const id of ["blimp", "tinystories"]) {
    const task = reference.tasks[id];
    const measured = model.tasks[id];
    assert(task.cases === measured.cases, `${id} reference case count drifted`);
    assert(task.cases_sha256 === measured.cases_sha256,
      `${id} reference cases hash drifted`);
    assert(task.case_results_sha256 === measured.case_results_sha256,
      `${id} reference result hash drifted`);
    assert(task.elapsed_seconds === measured.elapsed_seconds,
      `${id} reference timing drifted`);
  }
  assert(reference.tasks.blimp.raw_accuracy === model.tasks.blimp.metrics.raw_accuracy,
    "BLiMP reference drifted");
  assert(
    reference.tasks.tinystories.bits_per_byte ===
      model.tasks.tinystories.metrics.bits_per_byte,
    "TinyStories reference drifted",
  );

  const rule = contract.decision_rule;
  assert(rule.combination === "conjunctive", "gate is no longer conjunctive");
  assert(rule.blimp.max_absolute_regression === 0.01,
    "BLiMP tolerance drifted");
  assert(approximately(
    rule.blimp.minimum_raw_accuracy,
    reference.tasks.blimp.raw_accuracy - rule.blimp.max_absolute_regression,
  ), "BLiMP threshold does not reconcile");
  assert(rule.tinystories.max_relative_regression === 0.01,
    "TinyStories tolerance drifted");
  assert(approximately(
    rule.tinystories.maximum_bits_per_byte,
    reference.tasks.tinystories.bits_per_byte *
      (1 + rule.tinystories.max_relative_regression),
  ), "TinyStories threshold does not reconcile");
  assert(
    contract.output_policy.blimp_correctness_bits ===
      "base64-packed-lsb-first-v1" &&
      contract.output_policy.tinystories_case_scores ===
      "base64-utf8-tsv-ordinal-bits-bytes-v1",
    "paired-output contract drifted",
  );
  assert(
    contract.output_policy.contains_case_text === false &&
      contract.output_policy.first_comparison_is_aggregate_only === true,
    "output or historical inference policy drifted",
  );
  assert(fs.existsSync(contract.runner.path), "language-gate runner missing");
  assert(sha256(contract.runner.path) === contract.runner.sha256,
    "language-gate runner hash drifted");
  return true;
}

function countBits(buffer, cases) {
  let total = 0;
  for (let index = 0; index < cases; ++index) {
    total += (buffer[Math.floor(index / 8)] >> (index % 8)) & 1;
  }
  return total;
}

function validateTrace(trace, encoding, cases) {
  assert(trace.encoding === encoding, "trace encoding drifted");
  assert(trace.cases === cases, "trace case count drifted");
  const bytes = Buffer.from(trace.data, "base64");
  assert(bytes.length === trace.bytes, "trace byte count drifted");
  assert(sha256Bytes(bytes) === trace.sha256, "trace hash mismatch");
  return bytes;
}

export function validateResult(result, contract) {
  assert(result?.schema === "zero.language_preservation_gate_result.v1",
    "result schema drifted");
  assert(result.contract.id === contract.id, "result contract id drifted");
  assert(result.contract.sha256 === sha256(DEFAULT_CONTRACT),
    "result contract hash drifted");
  assert(
    result.execution.mode === "authorized_aws" &&
      result.execution.scientific_inference_allowed === true,
    "result is not an authorized AWS execution",
  );
  assert(fs.existsSync(result.execution.budget.path), "result budget missing");
  assert(sha256(result.execution.budget.path) === result.execution.budget.sha256,
    "result budget hash mismatch");
  const budget = JSON.parse(fs.readFileSync(result.execution.budget.path, "utf8"));
  assert(budget.id === result.execution.budget.id, "result budget id drifted");
  validateBudget(budget, result.contract.sha256, result.model);
  assert(result.training_updates === 0, "result includes training");
  assert(result.evaluator.jobs === contract.execution.jobs, "result jobs drifted");
  for (const id of ["blimp", "tinystories"]) {
    assert(
      result.tasks[id].cases_sha256 === contract.reference.tasks[id].cases_sha256,
      `${id} cases hash drifted`,
    );
    assert(result.tasks[id].cases === contract.reference.tasks[id].cases,
      `${id} case count drifted`);
  }
  const blimp = result.tasks.blimp;
  const raw = validateTrace(
    blimp.paired_trace.raw_correct,
    contract.output_policy.blimp_correctness_bits,
    blimp.cases,
  );
  const normalized = validateTrace(
    blimp.paired_trace.normalized_correct,
    contract.output_policy.blimp_correctness_bits,
    blimp.cases,
  );
  assert(approximately(
    countBits(raw, blimp.cases) / blimp.cases,
    blimp.metrics.raw_accuracy,
  ), "raw correctness trace does not reconcile");
  assert(approximately(
    countBits(normalized, blimp.cases) / blimp.cases,
    blimp.metrics.normalized_accuracy,
  ), "normalized correctness trace does not reconcile");

  const tiny = result.tasks.tinystories;
  const trace = validateTrace(
    tiny.paired_trace.target_scores,
    contract.output_policy.tinystories_case_scores,
    tiny.cases,
  ).toString("utf8").trim().split("\n");
  assert(trace.length === tiny.cases, "TinyStories trace row count drifted");
  let bits = 0;
  let bytes = 0;
  trace.forEach((line, ordinal) => {
    const fields = line.split("\t");
    assert(fields.length === 3 && Number(fields[0]) === ordinal,
      `TinyStories trace ordinal drifted at ${ordinal}`);
    bits += Number(fields[1]);
    bytes += Number(fields[2]);
  });
  assert(bytes === tiny.metrics.total_target_bytes,
    "TinyStories trace byte total drifted");
  assert(approximately(bits / bytes, tiny.metrics.bits_per_byte),
    "TinyStories trace BPB does not reconcile");

  const expectedBlimp =
    blimp.metrics.raw_accuracy >= contract.decision_rule.blimp.minimum_raw_accuracy;
  const expectedTiny =
    tiny.metrics.bits_per_byte <=
      contract.decision_rule.tinystories.maximum_bits_per_byte;
  assert(result.decision.checks.blimp_raw_accuracy.pass === expectedBlimp,
    "BLiMP decision drifted");
  assert(result.decision.checks.tinystories_bits_per_byte.pass === expectedTiny,
    "TinyStories decision drifted");
  assert(result.decision.pass === (expectedBlimp && expectedTiny),
    "conjunctive decision drifted");
  return true;
}

function selfTest() {
  const contract = JSON.parse(fs.readFileSync(DEFAULT_CONTRACT, "utf8"));
  validateContract(contract);
  for (const [name, mutate] of [
    ["authorization", (copy) => {
      copy.execution.authorized_for_execution = true;
    }],
    ["BLiMP tolerance", (copy) => {
      copy.decision_rule.blimp.max_absolute_regression = 0.02;
    }],
    ["TinyStories threshold", (copy) => {
      copy.decision_rule.tinystories.maximum_bits_per_byte += 0.01;
    }],
    ["case text", (copy) => {
      copy.output_policy.contains_case_text = true;
    }],
  ]) {
    const invalid = structuredClone(contract);
    mutate(invalid);
    let rejected = false;
    try {
      validateContract(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  console.log("ZERO language gate contract self-test passed");
}

async function mechanics(contract, executable) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-language-gate-check-"));
  const header = [
    "id", "benchmark", "group", "kind", "gold", "context",
    "choice0", "choice1", "choice2", "choice3",
  ].join("\t");
  const blimp = path.join(temporary, "blimp.tsv");
  const tinystories = path.join(temporary, "tinystories.tsv");
  fs.writeFileSync(blimp, `${header}\n${[
    ["fixture/0", "blimp", "pairs", "pair", "0", "", " the cat sleeps", " the cat sleep", "", ""],
    ["fixture/1", "blimp", "pairs", "pair", "0", "", " these birds sing", " these birds sings", "", ""],
    ["fixture/2", "blimp", "pairs", "pair", "0", "", " a king speaks", " a king speak", "", ""],
    ["fixture/3", "blimp", "pairs", "pair", "0", "", " we walk home", " we walks home", "", ""],
  ].map((fields) => fields.join("\t")).join("\n")}\n`);
  fs.writeFileSync(tinystories, `${header}\n${[
    ["fixture/0", "tinystories", "stories", "rolling", "0", "", "Once upon a time.", "", "", ""],
    ["fixture/1", "tinystories", "stories", "rolling", "0", "", "A bird flew home.", "", "", ""],
  ].map((fields) => fields.join("\t")).join("\n")}\n`);
  const common = {
    executable,
    contract: DEFAULT_CONTRACT,
    model: contract.reference.model.path,
    modelId: "mechanics-only",
    blimp,
    tinystories,
  };
  try {
    const serial = await run({
      ...common,
      jobs: 1,
      mechanicsOnly: true,
      output: path.join(temporary, "serial.json"),
    });
    const parallel = await run({
      ...common,
      jobs: 2,
      mechanicsOnly: true,
      output: path.join(temporary, "parallel.json"),
    });
    for (const id of ["blimp", "tinystories"]) {
      assert(
        serial.tasks[id].case_results_sha256 ===
          parallel.tasks[id].case_results_sha256,
        `${id} serial and parallel mechanics results differ`,
      );
      assert(
        JSON.stringify(serial.tasks[id].paired_trace) ===
          JSON.stringify(parallel.tasks[id].paired_trace),
        `${id} serial and parallel traces differ`,
      );
    }
    assert(serial.tasks.blimp.cases === 4, "BLiMP mechanics count drifted");
    assert(serial.tasks.tinystories.cases === 2,
      "TinyStories mechanics count drifted");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log("ZERO language gate native mechanics passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const contractPath = process.argv[2] && !process.argv[2].startsWith("--")
      ? process.argv[2]
      : DEFAULT_CONTRACT;
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    validateContract(contract);
    const resultIndex = process.argv.indexOf("--result");
    if (resultIndex >= 0) {
      const resultPath = process.argv[resultIndex + 1];
      assert(resultPath, "--result requires a path");
      validateResult(JSON.parse(fs.readFileSync(resultPath, "utf8")), contract);
      console.log(`OK ZERO language gate result: ${resultPath}`);
    } else {
      console.log(`OK ZERO language gate contract: ${contractPath}`);
    }
    const mechanicsIndex = process.argv.indexOf("--mechanics");
    if (mechanicsIndex >= 0) {
      await mechanics(contract, process.argv[mechanicsIndex + 1]);
    }
  }
}

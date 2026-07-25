#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

const DEFAULT_CONTRACT = "benchmarks/zero4-q27-v1/contract.json";
const DEFAULT_BUDGET = "benchmarks/zero4-q27-v1/aws-v1/budget.json";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateResult(
  result,
  {
    contractPath = DEFAULT_CONTRACT,
    budgetPath = DEFAULT_BUDGET,
    artifactRoot = null,
  } = {},
) {
  const contract = readJson(contractPath);
  const budget = readJson(budgetPath);
  assert(
    result?.schema === "zero.zero4_q27_quantity_stage_result.v1",
    "wrong Q2.7 result schema",
  );
  assert(result.seed === 2, "Q2.7 result is not diagnostic seed 2");
  assert(
    result.stage === "top-ffn-quantity-replay-promotion",
    "Q2.7 result stage drifted",
  );
  assert(["candidate-ready", "no-go"].includes(result.decision),
    "invalid Q2.7 quantity-stage decision");
  assert(result.contractSha256 === sha256(contractPath),
    "Q2.7 contract binding drifted");
  assert(result.inheritedQ26ContractSha256 ===
    contract.lineage.q26_contract_sha256,
  "Q2.7 inherited contract binding drifted");
  assert(result.budgetSha256 === sha256(budgetPath),
    "Q2.7 budget binding drifted");
  assert(
    result.trainableScope === "top-ffn" &&
      result.trainableParameters === 541184,
    "Q2.7 trainable scope drifted",
  );
  assert(
    Number.isInteger(result.attempts) &&
      result.attempts >= 0 &&
      result.attempts <= budget.workload.maximum_optimizer_attempts,
    "Q2.7 optimizer attempt count exceeds the budget",
  );
  assert(
    Number.isInteger(result.committed) &&
      result.committed >= 0 &&
      result.committed <= result.attempts,
    "Q2.7 committed-update count is invalid",
  );
  assert(Array.isArray(result.frontier), "Q2.7 frontier is missing");
  for (const entry of result.frontier) {
    assert(
      Number.isInteger(entry.committed) &&
        Number.isInteger(entry.totalAttempts) &&
        typeof entry.quantityPass === "boolean" &&
        typeof entry.replayRegression === "number" &&
        typeof entry.feasible === "boolean",
      "invalid Q2.7 frontier entry",
    );
    assert(
      entry.feasible ===
        (entry.quantityPass && entry.replayRegression <= 0.02),
      "Q2.7 feasibility rule drifted",
    );
  }
  assert(result.languageGate?.authorized === false,
    "Q2.7 quantity run authorized the language gate");
  assert(result.languageGate.evaluated === false,
    "Q2.7 quantity run opened the language gate");

  if (result.decision === "candidate-ready") {
    assert(result.selected?.feasible === true,
      "candidate-ready lacks a feasible selected checkpoint");
    assert(result.selected.replayRegression <= 0.02,
      "selected candidate exceeds the replay ceiling");
    assert(
      result.promotion?.evaluatedOnceAtEnd === true &&
        result.promotion.quantityPass === true,
      "candidate-ready lacks the exactly-once promotion pass",
    );
    assert(result.artifacts, "candidate-ready lacks artifact bindings");
    if (artifactRoot) {
      const checkpoint = `${artifactRoot}/selected.ckpt`;
      const quantized = `${artifactRoot}/selected.litq8`;
      assert(fs.existsSync(checkpoint) && fs.existsSync(quantized),
        "candidate artifacts are unavailable");
      assert(sha256(checkpoint) === result.artifacts.checkpointSha256,
        "candidate checkpoint hash drifted");
      assert(sha256(quantized) === result.artifacts.quantizedSha256,
        "candidate quantized hash drifted");
      assert(fs.statSync(quantized).size === result.artifacts.quantizedBytes,
        "candidate quantized size drifted");
    }
  } else if (result.promotion.evaluatedOnceAtEnd) {
    assert(result.promotion.quantityPass === false,
      "no-go promotion record unexpectedly passed");
  } else {
    assert(
      result.selected === null &&
        !result.frontier.some((entry) => entry.feasible),
      "no-go sealed promotion despite a feasible checkpoint",
    );
  }
  assert(
    same(result.immutable_teachers, readJson(
      contract.lineage.q26_contract_path,
    ).immutable_teachers),
    "Q2.7 teacher lineage drifted",
  );
  return true;
}

const isMain = process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const resultPath = process.argv[2];
  if (!resultPath) fail(
    "usage: check_zero4_q27_result.mjs RESULT [CONTRACT] [BUDGET] [ARTIFACT_ROOT]",
  );
  validateResult(readJson(resultPath), {
    contractPath: process.argv[3] ?? DEFAULT_CONTRACT,
    budgetPath: process.argv[4] ?? DEFAULT_BUDGET,
    artifactRoot: process.argv[5] ?? null,
  });
  console.log("Q2.7 quantity-stage result passed");
}

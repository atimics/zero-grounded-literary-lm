#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const DEFAULT_CONTRACT = "benchmarks/zero4-q26r-v1/contract.json";
const BASE_CONTRACT = "benchmarks/zero4-q26-v1/contract.json";
const BASE_RESULT = "benchmarks/zero4-q26-v1/seed2/result.json";
const BASE_MODEL = "benchmarks/zero4-q26-v1/seed2/selected.litq8";

function checkContract(contractPath) {
  const contract = readJson(contractPath);
  assert(contract.schema === "zero.zero4_q26_replication_contract.v1", "wrong Q2.6-R contract schema");
  assert(contract.id === "zero4-q26r-v1" && contract.status === "preregistered", "Q2.6-R contract is not preregistered");
  assert(JSON.stringify(contract.authorized_seeds) === "[1,3]", "Q2.6-R must authorize exactly seeds 1 and 3");
  assert(JSON.stringify(contract.declared_family_seeds) === "[1,2,3]", "Q2.6-R family seeds drifted");
  assert(contract.execution_policy.independent_runs === true, "replication runs are not independent");
  assert(contract.execution_policy.execute_both_authorized_seeds === true && contract.execution_policy.abort_after_first_no_go === false, "Q2.6-R permits optional stopping");
  assert(contract.execution_policy.duplicate_execution_forbidden === true, "Q2.6-R permits duplicate execution");
  assert(contract.design_lock.diagnostic_contract_sha256 === sha256(BASE_CONTRACT), "diagnostic contract hash drifted");
  assert(contract.design_lock.diagnostic_result_sha256 === sha256(BASE_RESULT), "diagnostic result hash drifted");
  assert(contract.design_lock.diagnostic_model_sha256 === sha256(BASE_MODEL), "diagnostic model hash drifted");
  assert(contract.design_lock.diagnostic_checker_sha256 === sha256("scripts/check_zero4_q26.mjs"), "diagnostic checker hash drifted");
  const diagnostic = readJson(BASE_RESULT);
  assert(diagnostic.seed === 2 && diagnostic.decision === "go", "Q2.6-R lacks a seed-2 go authorization");
  assert(diagnostic.selected?.feasible === true && diagnostic.promotion?.evaluatedOnceAtEnd === true && diagnostic.promotion?.quantityPass === true, "seed-2 conjunctive evidence drifted");
  assert(diagnostic.artifacts?.quantizedSha256 === contract.design_lock.diagnostic_model_sha256, "seed-2 selected model drifted");
  assert(contract.family_rule.decision === "go if and only if seeds 1, 2, and 3 each resolve go; otherwise no-go after all three declared results exist", "family decision rule drifted");
  assert(contract.family_rule.promoted_model_sha256 === contract.design_lock.diagnostic_model_sha256, "promotion candidate drifted");
  return contract;
}

function checkResult(contractPath, attemptsPath, resultPath) {
  const contract = checkContract(contractPath);
  const result = readJson(resultPath);
  assert(result.schema === "zero.zero4_q26_result.v1" && contract.authorized_seeds.includes(result.seed), "Q2.6-R result identity drifted");
  assert(["go", "no-go"].includes(result.decision) && result.stage === "cumulative-tangent", "Q2.6-R result decision drifted");
  assert(result.replicationContractSha256 === sha256(contractPath), "Q2.6-R result contract hash drifted");
  assert(result.diagnosticContractSha256 === sha256(BASE_CONTRACT), "Q2.6-R base contract hash drifted");
  const attempts = fs.readFileSync(attemptsPath, "utf8").trim().split("\n").filter(Boolean);
  assert(attempts.length > 0 && attempts.length === result.attempts, "Q2.6-R attempt log is incomplete");
  const baseCheck = spawnSync(process.execPath, ["scripts/check_zero4_q26.mjs", BASE_CONTRACT, attemptsPath], { encoding: "utf8" });
  if (baseCheck.error) throw baseCheck.error;
  if (baseCheck.status !== 0) fail(`base Q2.6 checker failed: ${baseCheck.stderr || baseCheck.stdout}`);
  if (result.decision === "go") {
    assert(result.selected?.feasible === true, "Q2.6-R go lacks a feasible public checkpoint");
    assert(result.promotion?.evaluatedOnceAtEnd === true && result.promotion?.quantityPass === true, "Q2.6-R go lacks a promotion pass");
    assert(/^[0-9a-f]{64}$/.test(result.artifacts?.quantizedSha256 ?? ""), "Q2.6-R go lacks a model hash");
  } else if (result.selected === null) {
    assert(result.promotion?.evaluatedOnceAtEnd === false, "Q2.6-R no-go opened promotion without public feasibility");
  } else {
    assert(result.promotion?.evaluatedOnceAtEnd === true && result.promotion?.quantityPass === false, "Q2.6-R no-go has an invalid promotion settlement");
  }
  console.log(`Q2.6-R check: seed ${result.seed} ${result.decision}; ${attempts.length} attempts passed`);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  checkContract(DEFAULT_CONTRACT);
  console.log("Q2.6-R authorization and family contract self-test passed");
  process.exit(0);
}
const [contractPath = DEFAULT_CONTRACT, attemptsPath, resultPath] = args;
if ((attemptsPath && !resultPath) || (!attemptsPath && resultPath)) fail("Q2.6-R checker requires both attempts and result paths");
if (attemptsPath) checkResult(contractPath, attemptsPath, resultPath);
else { checkContract(contractPath); console.log("Q2.6-R contract passed"); }

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateResult } from "./check_zero4_q27_result.mjs";

const DEFAULT_ENVELOPE =
  "benchmarks/zero4-q27-v1/aws-v1/conditional-language-gate.json";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateEnvelope(envelope, bindings) {
  assert(
    envelope?.schema ===
      "zero.q27_conditional_language_gate_authorization.v1",
    "unsupported conditional language-gate authorization",
  );
  assert(envelope.status === "authorized_if_candidate_ready",
    "conditional language gate is not authorized");
  assert(
    envelope.quantity_stage.experiment === "zero4-q27-aws-v1" &&
      envelope.quantity_stage.seed === 2 &&
      envelope.quantity_stage.maximum_compute_usd === 1.17 &&
      envelope.quantity_stage.required_result_schema ===
        "zero.zero4_q27_quantity_stage_result.v1" &&
      envelope.quantity_stage.required_decision === "candidate-ready",
    "quantity-stage trigger drifted",
  );
  assert(
    envelope.quantity_stage.result_checker_sha256 ===
      bindings.resultCheckerSha256,
    "quantity result checker binding drifted",
  );
  assert(
    envelope.candidate_binding.id === "zero4-q27-seed2-selected" &&
      envelope.candidate_binding.artifact === "selected.litq8" &&
      envelope.candidate_binding.sha256_field ===
        "artifacts.quantizedSha256" &&
      envelope.candidate_binding.bytes_field ===
        "artifacts.quantizedBytes" &&
      envelope.candidate_binding.requires_artifact_hash_and_size_match === true,
    "deterministic candidate binding drifted",
  );
  assert(
    envelope.language_gate.contract_id === "zero-language-gate-v1" &&
      envelope.language_gate.contract_sha256 === bindings.contractSha256 &&
      envelope.language_gate.runner_sha256 === bindings.runnerSha256,
    "language-gate science binding drifted",
  );
  assert(
    envelope.language_gate.venue.provider === "aws" &&
      envelope.language_gate.venue.region === "us-east-1" &&
      envelope.language_gate.venue.instance_type === "c6i.4xlarge",
    "conditional language-gate venue drifted",
  );
  assert(
    envelope.language_gate.caps.max_instance_seconds === 600 &&
      envelope.language_gate.caps.max_compute_usd === 0.12,
    "conditional language-gate cap drifted",
  );
  assert(
    envelope.all_in_envelope.quantity_stage_max_compute_usd === 1.17 &&
      envelope.all_in_envelope.conditional_language_gate_max_compute_usd ===
        0.12 &&
      envelope.all_in_envelope.maximum_compute_usd === 1.29,
    "all-in Q2.7 cost envelope drifted",
  );
  const authorization = envelope.authorization;
  assert(
    authorization.explicit_manual_authorization === true &&
      authorization.authorized_for_materialization === true &&
      authorization.authorized_for_execution_if_candidate_ready === true &&
      authorization.one_execution_only === true &&
      /^\d{4}-\d{2}-\d{2}$/.test(authorization.authorized_at),
    "conditional language-gate authorization is incomplete",
  );
  return true;
}

export function materialize(envelope, result, provenance) {
  assert(
    result?.schema === envelope.quantity_stage.required_result_schema,
    "Q2.7 result schema cannot open the language gate",
  );
  assert(result.seed === envelope.quantity_stage.seed,
    "Q2.7 result seed cannot open the language gate");
  assert(result.decision === envelope.quantity_stage.required_decision,
    "only candidate-ready can open the language gate");
  assert(
    result.languageGate?.authorized === false &&
      result.languageGate?.evaluated === false,
    "Q2.7 result already opened the language gate",
  );
  assert(
    typeof result.artifacts?.quantizedSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(result.artifacts.quantizedSha256) &&
      Number.isInteger(result.artifacts.quantizedBytes) &&
      result.artifacts.quantizedBytes > 0,
    "Q2.7 result lacks a deterministic candidate binding",
  );
  return {
    schema: "zero.language_preservation_gate_budget.v1",
    id: envelope.id,
    status: "authorized",
    contract: {
      id: envelope.language_gate.contract_id,
      sha256: envelope.language_gate.contract_sha256,
    },
    candidate: {
      id: envelope.candidate_binding.id,
      sha256: result.artifacts.quantizedSha256,
      bytes: result.artifacts.quantizedBytes,
    },
    venue: envelope.language_gate.venue,
    caps: envelope.language_gate.caps,
    authorization: {
      explicit_manual_authorization: true,
      authorized_for_execution: true,
      one_execution_only: true,
      authorized_at: envelope.authorization.authorized_at,
      conditional_authorization_id: envelope.id,
    },
    provenance: {
      conditional_authorization_sha256:
        provenance.conditionalAuthorizationSha256,
      quantity_result_sha256: provenance.quantityResultSha256,
      quantity_budget_sha256: provenance.quantityBudgetSha256,
      candidate_artifact: envelope.candidate_binding.artifact,
      all_in_max_compute_usd:
        envelope.all_in_envelope.maximum_compute_usd,
    },
  };
}

function selfTest() {
  const envelope = readJson(DEFAULT_ENVELOPE);
  validateEnvelope(envelope, {
    resultCheckerSha256: sha256(envelope.quantity_stage.result_checker_path),
    contractSha256: sha256(envelope.language_gate.contract_path),
    runnerSha256: sha256(envelope.language_gate.runner_path),
  });
  const candidate = {
    schema: "zero.zero4_q27_quantity_stage_result.v1",
    seed: 2,
    decision: "candidate-ready",
    languageGate: { authorized: false, evaluated: false },
    artifacts: {
      quantizedSha256: "a".repeat(64),
      quantizedBytes: 4920400,
    },
  };
  const budget = materialize(envelope, candidate, {
    conditionalAuthorizationSha256: "b".repeat(64),
    quantityResultSha256: "c".repeat(64),
    quantityBudgetSha256: "d".repeat(64),
  });
  assert(budget.candidate.sha256 === candidate.artifacts.quantizedSha256,
    "candidate hash was not materialized deterministically");
  assert(budget.candidate.bytes === candidate.artifacts.quantizedBytes,
    "candidate size was not materialized deterministically");
  assert(budget.provenance.all_in_max_compute_usd === 1.29,
    "materialized budget lost the all-in ceiling");
  let rejected = false;
  try {
    materialize(envelope, { ...candidate, decision: "no-go" }, {});
  } catch {
    rejected = true;
  }
  assert(rejected, "no-go opened the conditional language gate");
  console.log("Q2.7 conditional language-gate materializer self-test passed");
}

function parseArguments(argv) {
  const options = { envelope: DEFAULT_ENVELOPE };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--envelope") options.envelope = value;
    else if (key === "--result") options.result = value;
    else if (key === "--artifacts") options.artifacts = value;
    else if (key === "--out") options.out = value;
    else fail(`unknown or incomplete argument ${key}`);
  }
  assert(options.result && options.artifacts && options.out,
    "--result, --artifacts, and --out are required");
  return options;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const options = parseArguments(process.argv.slice(2));
    const envelope = readJson(options.envelope);
    validateEnvelope(envelope, {
      resultCheckerSha256: sha256(
        envelope.quantity_stage.result_checker_path,
      ),
      contractSha256: sha256(envelope.language_gate.contract_path),
      runnerSha256: sha256(envelope.language_gate.runner_path),
    });
    const quantityBudget = readJson(envelope.quantity_stage.budget_path);
    assert(
      quantityBudget.authorization?.authorized_for_execution === true &&
        quantityBudget.execution?.max_compute_usd === 1.17,
      "quantity-stage budget is not authorized inside the envelope",
    );
    const result = readJson(options.result);
    validateResult(result, {
      contractPath: "benchmarks/zero4-q27-v1/contract.json",
      budgetPath: envelope.quantity_stage.budget_path,
      artifactRoot: options.artifacts,
    });
    const output = materialize(envelope, result, {
      conditionalAuthorizationSha256: sha256(options.envelope),
      quantityResultSha256: sha256(options.result),
      quantityBudgetSha256: sha256(envelope.quantity_stage.budget_path),
    });
    fs.writeFileSync(options.out, `${JSON.stringify(output, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(`Materialized candidate-bound language budget at ${options.out}`);
  }
}

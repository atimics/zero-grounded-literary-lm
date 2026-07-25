#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validateContract,
  validatePublished,
} from "./check_zero_eval1_screen.mjs";

const CONTRACT_PATH = "benchmarks/zero-eval-1/screen/contract.json";

function fail(message) {
  throw new Error(message);
}
function assert(value, message) {
  if (!value) fail(message);
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function hash(value) {
  return /^[0-9a-f]{64}$/u.test(value ?? "");
}

export function normalizeFrozenLambadaIdentifier(result) {
  const copy = structuredClone(result);
  assert(
    JSON.stringify(Object.keys(copy.models ?? {})) ===
      JSON.stringify(["zero3", "zero4"]),
    "compatibility result model grid drifted",
  );
  for (const model of ["zero3", "zero4"]) {
    const tasks = copy.models[model]?.tasks;
    assert(
      JSON.stringify(Object.keys(tasks ?? {})) ===
        JSON.stringify(["blimp", "tinystories", "hellaswag", "lambada"]),
      `${model} compatibility task grid drifted`,
    );
    for (const task of ["blimp", "tinystories", "hellaswag"]) {
      assert(tasks[task].benchmark === task, `${model}:${task} unexpectedly needs compatibility`);
    }
    assert(
      tasks.lambada.benchmark === "lambada_openai",
      `${model}:lambada is not the frozen identifier mismatch`,
    );
    tasks.lambada.benchmark = "lambada";
  }
  return copy;
}

export function validateCompatiblePublished(
  contract,
  launch,
  status,
  originalResult,
  expected,
) {
  const normalized = normalizeFrozenLambadaIdentifier(originalResult);
  validatePublished(contract, launch, status, normalized, expected);
}

export function validateCompatibleCompletion(contract, completion) {
  assert(
    completion?.schema === "zero.external_eval_screen_completion.v1",
    "completion schema drifted",
  );
  assert(completion.id === contract.id && completion.status === "complete",
    "screen completion is incomplete");
  assert(completion.authorization_consumed === true, "authorization is not consumed");
  assert(completion.training_updates === 0, "completion trained");
  assert(completion.instance_state === "terminated", "instance is not terminal");
  assert(/^[0-9]+$/u.test(completion.source_run_id), "source run id invalid");
  for (const [name, file, digest] of [
    ["contract", completion.contract_path, completion.contract_sha256],
    ["budget", completion.budget_path, completion.budget_sha256],
    ["launch", completion.launch_path, completion.launch_sha256],
    ["status", completion.status_path, completion.status_sha256],
    ["terminal observation", completion.terminal_path, completion.terminal_sha256],
    ["result", completion.result_path, completion.result_sha256],
    ["report", completion.report_path, completion.report_sha256],
    ["validation repair", completion.validation_repair_path,
      completion.validation_repair_sha256],
  ]) {
    assert(typeof file === "string" && fs.existsSync(file), `${name} record unavailable`);
    assert(hash(digest) && sha256(file) === digest, `${name} record hash drifted`);
  }

  const launch = JSON.parse(fs.readFileSync(completion.launch_path, "utf8"));
  const status = JSON.parse(fs.readFileSync(completion.status_path, "utf8"));
  const terminal = JSON.parse(fs.readFileSync(completion.terminal_path, "utf8"));
  const result = JSON.parse(fs.readFileSync(completion.result_path, "utf8"));
  const repair = JSON.parse(fs.readFileSync(completion.validation_repair_path, "utf8"));
  validateCompatiblePublished(contract, launch, status, result, {
    commit: completion.git_commit,
    budgetSha256: completion.budget_sha256,
    maxInstanceSeconds: 3600,
    maxComputeUsd: 0.68,
    resultPath: completion.result_path,
  });
  assert(launch.ci_run_id === completion.source_run_id, "completion run id drifted");
  assert(launch.instance_id === completion.instance_id, "completion instance drifted");
  assert(terminal?.schema === "zero.aws_terminal_observation.v1" &&
    terminal.experiment === contract.id &&
    terminal.instance_id === completion.instance_id &&
    terminal.state === "terminated", "terminal observation drifted");
  assert(repair?.schema === "zero.external_eval_validation_repair.v1" &&
    repair.experiment === contract.id &&
    repair.source_run_id === completion.source_run_id &&
    repair.original_result_sha256 === completion.result_sha256 &&
    repair.frozen_identifier === "lambada_openai" &&
    repair.contract_identifier === "lambada" &&
    repair.scientific_values_changed === false &&
    repair.compute_restarted === false, "validation repair drifted");
  assert(
    repair.compatibility_checker_sha256 === sha256(fileURLToPath(import.meta.url)),
    "compatibility checker provenance drifted",
  );
  assert(
    repair.recovery_workflow_sha256 ===
      sha256(".github/workflows/zero-eval1-screen-collect-recovery.yml"),
    "recovery workflow provenance drifted",
  );
  assert(
    repair.recovery_script_sha256 ===
      sha256("scripts/aws/zero-eval1-screen-collect-recovery.sh"),
    "recovery script provenance drifted",
  );
}

function value(args, name) {
  const index = args.indexOf(name);
  assert(index >= 0 && args[index + 1] !== undefined, `${name} missing`);
  return args[index + 1];
}

function selfTest() {
  const fixture = {
    models: {
      zero3: {
        tasks: {
          blimp: { benchmark: "blimp" },
          tinystories: { benchmark: "tinystories" },
          hellaswag: { benchmark: "hellaswag" },
          lambada: { benchmark: "lambada_openai" },
        },
      },
      zero4: {
        tasks: {
          blimp: { benchmark: "blimp" },
          tinystories: { benchmark: "tinystories" },
          hellaswag: { benchmark: "hellaswag" },
          lambada: { benchmark: "lambada_openai" },
        },
      },
    },
  };
  const normalized = normalizeFrozenLambadaIdentifier(fixture);
  assert(normalized.models.zero3.tasks.lambada.benchmark === "lambada",
    "compatibility normalization failed");
  assert(fixture.models.zero3.tasks.lambada.benchmark === "lambada_openai",
    "compatibility normalization mutated the frozen result");
  const invalid = structuredClone(fixture);
  invalid.models.zero4.tasks.lambada.benchmark = "lambada";
  let rejected = false;
  try { normalizeFrozenLambadaIdentifier(invalid); } catch { rejected = true; }
  assert(rejected, "compatibility checker accepted a non-exact mismatch");
  console.log("ZERO-EVAL-1 LAMBADA identifier compatibility self-test passed");
}

function main(args) {
  if (args.includes("--self-test")) return selfTest();
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  validateContract(contract);
  const published = args.indexOf("--published");
  if (published >= 0) {
    const launchPath = args[published + 1];
    const statusPath = args[published + 2];
    const resultPath = args[published + 3];
    validateCompatiblePublished(
      contract,
      JSON.parse(fs.readFileSync(launchPath, "utf8")),
      JSON.parse(fs.readFileSync(statusPath, "utf8")),
      JSON.parse(fs.readFileSync(resultPath, "utf8")),
      {
        commit: value(args, "--commit"),
        budgetSha256: value(args, "--budget-sha256"),
        maxInstanceSeconds: 3600,
        maxComputeUsd: 0.68,
        resultPath,
      },
    );
  }
  const completion = args.indexOf("--completion");
  if (completion >= 0) {
    validateCompatibleCompletion(
      contract,
      JSON.parse(fs.readFileSync(args[completion + 1], "utf8")),
    );
  }
  console.log("OK ZERO-EVAL-1 frozen LAMBADA identifier compatibility");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}

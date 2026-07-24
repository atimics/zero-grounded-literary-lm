#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "./run_zero_eval1.mjs";

const CONTRACT_PATH = "benchmarks/zero-eval-1/contract.json";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateContract(contract) {
  assert(contract?.schema === "zero.external_eval_contract.v1", "unsupported contract schema");
  assert(contract.id === "zero-eval-1", "unexpected contract id");
  assert(
    contract.status === "preregistered_evaluation_only",
    "contract must remain preregistered and evaluation-only",
  );
  assert(contract.training_allowed === false, "training must be forbidden");
  assert(contract.model_scope === "bare quantized generative core only", "model scope drifted");
  assert(contract.controller_or_kernel_allowed === false, "controller/kernel must be forbidden");

  assert(same(contract.models?.map((model) => model.id), ["zero3", "zero4"]), "model order drifted");
  for (const model of contract.models) {
    assert(fs.existsSync(model.path), `${model.id} model is unavailable`);
    assert(sha256(model.path) === model.sha256, `${model.id} model hash mismatch`);
    assert(fs.statSync(model.path).size === model.bytes, `${model.id} model size mismatch`);
  }
  assert(
    contract.harness_reference?.commit === "f4d4b3de3ee6741a7151a9fe74945ee515262f4c",
    "harness reference drifted",
  );
  assert(
    same(contract.sources?.map((source) => source.id), [
      "blimp_zip",
      "hellaswag_validation",
      "lambada_openai_test",
      "tinystories_validation",
    ]),
    "source order drifted",
  );
  for (const source of contract.sources) {
    assert(/^[0-9a-f]{40}$/u.test(source.revision), `${source.id} revision is not frozen`);
    assert(/^[0-9a-f]{64}$/u.test(source.sha256), `${source.id} hash is not frozen`);
    assert(source.url.includes(source.revision), `${source.id} URL does not pin its revision`);
    assert(typeof source.license === "string" && source.license.length > 0, `${source.id} license missing`);
  }

  assert(contract.context_policy?.model_context_characters === 512, "context changed");
  assert(
    contract.context_policy?.maximum_prepared_context_characters === 511,
    "prepared context limit changed",
  );
  assert(
    same(contract.scoring_policy, {
      likelihood:
        "negative base-2 log probability from the frozen native float-softmax API; exact zero underflow is bounded at FLT_MIN",
      greedy_token:
        "temperature-zero argmax from the frozen deployed generation API over printable ASCII, newline, and message-end tokens",
      argmax_ties: "generation API order",
      choice_ties: "lowest choice index",
      length_normalization:
        "sum of continuation bits divided by continuation bytes",
    }),
    "scoring policy drifted",
  );
  assert(
    same(contract.tasks?.map((task) => [task.id, task.cases]), [
      ["blimp", 67000],
      ["hellaswag", 10042],
      ["lambada", 5153],
      ["tinystories", 1000],
    ]),
    "task grid drifted",
  );

  const prepared = contract.prepared_bundle;
  assert(prepared?.status === "frozen", "prepared bundle is not frozen");
  assert(
    same(Object.keys(prepared.datasets ?? {}), ["blimp", "hellaswag", "lambada", "tinystories"]),
    "prepared dataset order drifted",
  );
  for (const [id, dataset] of Object.entries(prepared.datasets)) {
    const task = contract.tasks.find((candidate) => candidate.id === id);
    assert(dataset.cases === task.cases, `${id} prepared case count drifted`);
    assert(/^[0-9a-f]{64}$/u.test(dataset.sha256), `${id} prepared hash missing`);
    assert(dataset.bytes > 0 && dataset.groups > 0, `${id} prepared metadata invalid`);
  }
  assert(
    same(prepared.normalization_stats, {
      non_ascii_replaced: 259,
      combining_marks_removed: 132,
      contexts_truncated: 54,
      context_bytes_removed: 3467,
    }),
    "normalization statistics drifted",
  );

  const execution = contract.execution_policy;
  assert(execution?.venue === "AWS EC2 only for reportable measurements", "venue drifted");
  assert(execution.instance_type === "c6i.4xlarge", "instance type drifted");
  assert(execution.region === "us-east-1", "region drifted");
  assert(execution.jobs === 16 && execution.repetitions === 1, "execution multiplicity drifted");
  assert(execution.calibration_may_not_publish_metrics === true, "calibration score seal drifted");
  assert(execution.full_execution_requires_separate_frozen_budget === true, "budget gate drifted");
  assert(execution.full_execution_authorized === false, "full execution must not be authorized yet");
  return true;
}

export function validateBundle(contract, bundlePath) {
  const manifestPath = path.join(bundlePath, "manifest.json");
  assert(fs.existsSync(manifestPath), "bundle manifest missing");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.schema === "zero.external_eval_bundle.v1", "bundle schema drifted");
  assert(manifest.id === contract.id, "bundle id drifted");
  assert(manifest.contract_sha256 === sha256(CONTRACT_PATH), "bundle contract hash drifted");
  assert(same(manifest.sources, contract.sources), "bundle sources drifted");
  assert(same(manifest.normalization, contract.normalization), "bundle normalization drifted");
  assert(
    same(manifest.normalization_stats, contract.prepared_bundle.normalization_stats),
    "bundle normalization statistics drifted",
  );
  for (const [id, expected] of Object.entries(contract.prepared_bundle.datasets)) {
    const actual = manifest.datasets?.[id];
    const file = path.join(bundlePath, expected.path);
    assert(same(actual, expected), `${id} bundle metadata drifted`);
    assert(fs.existsSync(file), `${id} bundle file missing`);
    assert(sha256(file) === expected.sha256, `${id} bundle hash mismatch`);
    assert(fs.statSync(file).size === expected.bytes, `${id} bundle size mismatch`);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert(lines.length - 1 === expected.cases, `${id} bundle case count mismatch`);
  }
  return true;
}

export function validateResult(contract, result) {
  assert(result?.schema === "zero.external_eval_result.v1", "result schema drifted");
  assert(result.timing_only === false, "scientific result cannot be timing-only");
  const model = contract.models.find((candidate) => candidate.id === result.model?.id);
  assert(model, "result model is outside the contract");
  assert(result.model.sha256 === model.sha256, "result model hash drifted");
  assert(result.model.bytes === model.bytes, "result model size drifted");
  const expected = contract.prepared_bundle.datasets[result.benchmark];
  assert(expected, "result benchmark is outside the contract");
  assert(result.cases_sha256 === expected.sha256, "result cases hash drifted");
  assert(result.cases === expected.cases, "result case count drifted");
  assert(result.evaluator?.jobs === contract.execution_policy.jobs, "result job count drifted");
  assert(/^[0-9a-f]{64}$/u.test(result.case_results_sha256), "case result hash missing");
  assert(result.metrics?.bits_per_byte > 0, "bits-per-byte metric missing");
  if (result.kind === "pair" || result.kind === "multiple_choice") {
    assert(
      result.metrics.raw_accuracy >= 0 && result.metrics.raw_accuracy <= 1 &&
      result.metrics.normalized_accuracy >= 0 && result.metrics.normalized_accuracy <= 1,
      "choice accuracy is invalid",
    );
  } else if (result.kind === "cloze") {
    assert(
      result.metrics.greedy_exact_accuracy >= 0 &&
      result.metrics.greedy_exact_accuracy <= 1,
      "cloze accuracy is invalid",
    );
  } else {
    assert(result.kind === "rolling", "result scoring kind is invalid");
  }
  return true;
}

function selfTest(contract) {
  validateContract(contract);
  for (const [name, mutate] of [
    ["training", (copy) => { copy.training_allowed = true; }],
    ["model hash", (copy) => { copy.models[1].sha256 = "0".repeat(64); }],
    ["source revision", (copy) => { copy.sources[0].revision = "0".repeat(40); }],
    ["task count", (copy) => { copy.tasks[0].cases -= 1; }],
    ["full authorization", (copy) => { copy.execution_policy.full_execution_authorized = true; }],
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
  console.log("ZERO-EVAL-1 contract self-test passed");
}

async function mechanics(contract, executable) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "zero-eval1-check-"));
  const cases = path.join(temporary, "cases.tsv");
  const serial = path.join(temporary, "serial.json");
  const parallel = path.join(temporary, "parallel.json");
  const scientific = path.join(temporary, "scientific.json");
  const header = [
    "id", "benchmark", "group", "kind", "gold", "context",
    "choice0", "choice1", "choice2", "choice3",
  ].join("\t");
  const rows = [
    ["fixture/0", "fixture", "pairs", "pair", "0", "", " the cat sleeps", " the cat sleep", "", ""],
    ["fixture/1", "fixture", "pairs", "pair", "0", "", " these birds sing", " these birds sings", "", ""],
    ["fixture/2", "fixture", "pairs", "pair", "0", "", " a king speaks", " a king speak", "", ""],
    ["fixture/3", "fixture", "pairs", "pair", "0", "", " we walk home", " we walks home", "", ""],
  ].map((fields) => fields.join("\t"));
  fs.writeFileSync(cases, `${header}\n${rows.join("\n")}\n`);
  try {
    const common = {
      executable,
      model: contract.models[0].path,
      modelId: contract.models[0].id,
      cases,
      limit: null,
      timingOnly: true,
    };
    const first = await run({ ...common, jobs: 1, output: serial });
    const second = await run({ ...common, jobs: 2, output: parallel });
    assert(first.cases === 4 && second.cases === 4, "mechanics case count drifted");
    assert(
      first.case_results_sha256 === second.case_results_sha256,
      "serial and parallel mechanics outputs differ",
    );
    const scored = await run({
      ...common,
      jobs: 2,
      output: scientific,
      timingOnly: false,
    });
    assert(scored.metrics.raw_accuracy >= 0, "pair raw accuracy missing");
    assert(scored.metrics.normalized_accuracy >= 0, "pair normalized accuracy missing");
    assert(scored.groups.pairs.bits_per_byte > 0, "pair group metric missing");

    for (const fixture of [
      {
        kind: "multiple_choice",
        fields: [
          "fixture/mc", "fixture_mc", "choices", "multiple_choice", "2",
          "the king", " speaks", " sleep", " walks", " fly",
        ],
        metric: "normalized_accuracy",
      },
      {
        kind: "cloze",
        fields: [
          "fixture/cloze", "fixture_cloze", "test", "cloze", "0",
          "the king", " speaks", "", "", "",
        ],
        metric: "greedy_exact_accuracy",
      },
      {
        kind: "rolling",
        fields: [
          "fixture/rolling", "fixture_rolling", "test", "rolling", "0",
          "", "Once upon a time.", "", "", "",
        ],
        metric: "bits_per_byte",
      },
    ]) {
      const shapeCases = path.join(temporary, `${fixture.kind}.tsv`);
      const shapeOutput = path.join(temporary, `${fixture.kind}.json`);
      fs.writeFileSync(shapeCases, `${header}\n${fixture.fields.join("\t")}\n`);
      const shape = await run({
        ...common,
        cases: shapeCases,
        output: shapeOutput,
        jobs: 1,
        timingOnly: false,
      });
      assert(shape.kind === fixture.kind, `${fixture.kind} kind drifted`);
      assert(
        Number.isFinite(shape.metrics[fixture.metric]),
        `${fixture.kind} metric missing`,
      );
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log("ZERO-EVAL-1 native evaluator mechanics passed");
}

async function main(args) {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  if (args.includes("--self-test")) {
    selfTest(contract);
    return;
  }
  validateContract(contract);
  const bundleIndex = args.indexOf("--bundle");
  if (bundleIndex >= 0) validateBundle(contract, args[bundleIndex + 1]);
  const resultIndex = args.indexOf("--result");
  if (resultIndex >= 0) {
    validateResult(contract, JSON.parse(fs.readFileSync(args[resultIndex + 1], "utf8")));
  }
  const mechanicsIndex = args.indexOf("--mechanics");
  if (mechanicsIndex >= 0) await mechanics(contract, args[mechanicsIndex + 1]);
  console.log("OK ZERO-EVAL-1");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

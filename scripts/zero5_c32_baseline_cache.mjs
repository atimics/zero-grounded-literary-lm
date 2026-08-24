#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert, parseNamedArgs, sha256, sha256File, stableJson, writeJson,
} from "./zero_data_lib.mjs";

const contractPath = "benchmarks/zero5-c32-v1/contract.json";
const importPath = "benchmarks/zero5-c32-v1/import.json";
const c0ResultPath = "benchmarks/zero5-c0-v1/result.json";
const c2ContractPath = "benchmarks/zero5-c2-v1/contract.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function finite(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
}

function close(observed, expected, tolerance) {
  finite(observed, "cached metric");
  return Math.abs(observed - expected) <= tolerance;
}

export function validateBaseline(baseline, contract, imported) {
  assert(baseline && typeof baseline === "object", "baseline is missing");
  for (const metric of ["combined_selection_nats_per_token",
    "combined_final_nats_per_token", "atlas_nats_per_token",
    "anchor_nats_per_token"]) {
    assert(close(baseline[metric], contract.baselines[metric], 0.0001),
      `baseline ${metric} changed`);
  }
  for (const task of ["claim", "cloze", "retrieval"]) {
    assert(close(baseline.members?.[task],
      contract.baselines.members[task].nats_per_token, 0.0001),
    `baseline ${task} member metric changed`);
    const completion = baseline.completion?.[task];
    const expected = contract.baselines.completion[task];
    assert(completion?.schema === "zero.c3_completion_eval.v1",
      `baseline ${task} completion schema changed`);
    assert(completion.records ===
      imported.outputs.completion_validation[task].records,
    `baseline ${task} completion record count changed`);
    assert(completion.target_tokens ===
      imported.outputs.completion_validation[task].target_tokens,
    `baseline ${task} completion target count changed`);
    for (const metric of ["nats_per_target_token", "top1_token_accuracy",
      "teacher_forced_exact_accuracy", "last_target_token_accuracy"]) {
      assert(close(completion[metric], expected[metric], 1e-7),
        `baseline ${task} completion ${metric} changed`);
    }
  }
  for (const task of ["claim", "retrieval"]) {
    const paired = baseline.paired?.[task];
    const expected = contract.baselines.paired[task];
    assert(paired?.schema === "zero.c32_paired_choice_eval.v1",
      `baseline ${task} paired schema changed`);
    assert(paired.pairs === imported.outputs.paired_validation[task].pairs,
      `baseline ${task} pair count changed`);
    assert(paired.records === imported.outputs.paired_validation[task].records,
      `baseline ${task} paired record count changed`);
    assert(paired.target_tokens ===
      imported.outputs.paired_validation[task].target_tokens,
    `baseline ${task} paired target count changed`);
    for (const metric of ["forced_choice_nats", "choice_accuracy",
      "position_a_accuracy", "position_b_accuracy",
      "swap_consistency_accuracy", "pair_exact_accuracy"]) {
      assert(close(paired[metric], expected[metric], 1e-7),
        `baseline ${task} paired ${metric} changed`);
    }
    for (const metric of ["nats_per_target_token", "top1_token_accuracy",
      "teacher_forced_exact_accuracy"]) {
      finite(paired[metric], `baseline ${task} paired ${metric}`);
    }
  }
}

function measuredArtifact(file, expectedSha256, label) {
  assert(fs.existsSync(file), `${label} is missing: ${file}`);
  const observed = sha256File(file);
  assert(observed === expectedSha256, `${label} drifted`);
  return { sha256: observed, bytes: fs.statSync(file).size };
}

function bindingFor(options, contract, imported) {
  const c0Result = readJson(c0ResultPath);
  const c2Contract = readJson(c2ContractPath);
  const importDirectory = path.resolve(options.import_dir);
  const c0Directory = path.resolve(options.c0_dir);
  const c2Directory = path.resolve(options.c2_dir);
  const c2ImportDirectory = path.resolve(options.c2_import_dir);
  const files = {
    tokenizer: [path.join(c0Directory, "byte-bpe512.sero"),
      contract.input.tokenizer_sha256],
    initial_checkpoint: [path.join(c2Directory, "best.ckpt"),
      contract.initialization.checkpoint_sha256],
    validation_interleaved: [path.join(importDirectory,
      "validation.interleaved.z5pack"),
    imported.outputs.validation_interleaved.sha256],
    claim_validation: [path.join(importDirectory,
      "claim.validation.z5pack"),
    imported.outputs.validation_tasks.claim.sha256],
    cloze_validation: [path.join(importDirectory,
      "cloze.validation.z5pack"),
    imported.outputs.validation_tasks.cloze.sha256],
    retrieval_validation: [path.join(importDirectory,
      "retrieval.validation.z5pack"),
    imported.outputs.validation_tasks.retrieval.sha256],
    claim_completion: [path.join(importDirectory,
      "claim.validation.completion-eval.bin"),
    imported.outputs.completion_validation.claim.sha256],
    cloze_completion: [path.join(importDirectory,
      "cloze.validation.completion-eval.bin"),
    imported.outputs.completion_validation.cloze.sha256],
    retrieval_completion: [path.join(importDirectory,
      "retrieval.validation.completion-eval.bin"),
    imported.outputs.completion_validation.retrieval.sha256],
    claim_paired: [path.join(importDirectory,
      "claim.validation.paired-eval.bin"),
    imported.outputs.paired_validation.claim.sha256],
    retrieval_paired: [path.join(importDirectory,
      "retrieval.validation.paired-eval.bin"),
    imported.outputs.paired_validation.retrieval.sha256],
    atlas_train: [path.join(c2ImportDirectory,
      "atlas.train.byte-bpe512.tok"),
    c2Contract.input.atlas_train.tokens_sha256],
    atlas_validation: [path.join(c2ImportDirectory,
      "atlas.validation.byte-bpe512.tok"),
    c2Contract.input.atlas_validation.tokens_sha256],
    anchor_train: [path.join(c0Directory, "train.byte-bpe512.tok"),
      c0Result.artifacts.byte_bpe512_train_tokens.sha256],
    anchor_validation: [path.join(c0Directory,
      "validation.byte-bpe512.tok"),
    c0Result.artifacts.byte_bpe512_validation_tokens.sha256],
  };
  const artifacts = Object.fromEntries(Object.entries(files).map(
    ([name, [file, expected]]) =>
      [name, measuredArtifact(file, expected, name.replaceAll("_", " "))]));
  const implementation = Object.fromEntries([
    ["trainer", contract.implementation.trainer_sha256],
    ["importer", contract.implementation.importer_sha256],
    ["runner", contract.implementation.runner_sha256],
  ].map(([name, expected]) => {
    const file = contract.implementation[name];
    return [name, measuredArtifact(file, expected, `${name} implementation`)];
  }));
  return {
    schema: "zero.c32_baseline_binding.v1",
    experiment: contract.experiment,
    contract_sha256: sha256File(contractPath),
    backend: options.backend,
    implementation,
    import_manifest_sha256: sha256File(importPath),
    evaluation_sha256: sha256(stableJson(contract.evaluation, 0)),
    artifacts,
  };
}

export function createCacheObject({ baseline, binding, sourceRunId }) {
  const baselineSha256 = sha256(stableJson(baseline, 0));
  const bindingSha256 = sha256(stableJson(binding, 0));
  const cacheId = sha256(stableJson({ baseline_sha256: baselineSha256,
    binding_sha256: bindingSha256, source_run_id: sourceRunId }, 0));
  return {
    schema: "zero.c32_baseline_cache.v1",
    contract_sha256: binding.contract_sha256,
    provenance: {
      schema: "zero.c32_baseline_cache_provenance.v1",
      cache_id: cacheId,
      baseline_sha256: baselineSha256,
      binding_sha256: bindingSha256,
      source_run_id: sourceRunId,
      binding,
    },
    baseline,
  };
}

export function verifyCacheObject(cache, expectedBinding, contract, imported) {
  assert(cache?.schema === "zero.c32_baseline_cache.v1",
    "baseline cache schema changed");
  assert(cache.contract_sha256 === expectedBinding.contract_sha256,
    "baseline cache contract changed");
  const provenance = cache.provenance;
  assert(provenance?.schema === "zero.c32_baseline_cache_provenance.v1",
    "baseline cache provenance is missing");
  assert(provenance.binding_sha256 ===
    sha256(stableJson(provenance.binding, 0)), "baseline binding hash changed");
  assert(provenance.baseline_sha256 ===
    sha256(stableJson(cache.baseline, 0)), "baseline payload hash changed");
  assert(stableJson(provenance.binding, 0) ===
    stableJson(expectedBinding, 0), "baseline cache binding does not match");
  const expectedId = sha256(stableJson({
    baseline_sha256: provenance.baseline_sha256,
    binding_sha256: provenance.binding_sha256,
    source_run_id: provenance.source_run_id,
  }, 0));
  assert(provenance.cache_id === expectedId, "baseline cache ID changed");
  assert(typeof provenance.source_run_id === "string" &&
    provenance.source_run_id.length > 0, "baseline source run is missing");
  validateBaseline(cache.baseline, contract, imported);
  return { cache_id: expectedId, baseline_sha256: provenance.baseline_sha256,
    binding_sha256: provenance.binding_sha256 };
}

function main() {
  const options = parseNamedArgs(process.argv, {
    mode: "verify", input: "", output: "", source_run_id: "unknown",
    backend: "openblas",
    import_dir: "build/zero5-c32-v1/import-final",
    c0_dir: "build/zero5-c0-v1/corpus-one",
    c2_dir: "build/zero5-c2-v1/run",
    c2_import_dir: "build/zero5-c2-v1/import-final",
  });
  assert(["create", "verify", "install"].includes(options.mode),
    "mode must be create, verify, or install");
  assert(options.input, "--input is required");
  assert(["openblas", "accelerate", "portable-c"].includes(options.backend),
    "unsupported baseline backend");
  const contract = readJson(contractPath);
  const imported = readJson(importPath);
  assert(sha256File(importPath) === contract.input.import_manifest_sha256,
    "C3.2 import manifest drifted");
  const binding = bindingFor(options, contract, imported);
  if (options.mode === "create") {
    assert(options.output, "--output is required for create");
    const source = readJson(options.input);
    assert(source.schema === "zero.c32_baseline_cache.v1" &&
      source.contract_sha256 === binding.contract_sha256,
    "source baseline does not match C3.2");
    validateBaseline(source.baseline, contract, imported);
    const cache = createCacheObject({ baseline: source.baseline, binding,
      sourceRunId: options.source_run_id });
    writeJson(path.resolve(options.output), cache);
    process.stdout.write(stableJson({ schema: "zero.c32_baseline_cache_receipt.v1",
      ...verifyCacheObject(cache, binding, contract, imported),
      file_sha256: sha256File(path.resolve(options.output)) }));
    return;
  }
  const cache = readJson(options.input);
  const receipt = verifyCacheObject(cache, binding, contract, imported);
  if (options.mode === "install") {
    assert(options.output, "--output is required for install");
    const destination = path.resolve(options.output);
    if (fs.existsSync(destination)) {
      const existing = readJson(destination);
      assert(sha256(stableJson(existing.baseline, 0)) ===
        receipt.baseline_sha256,
      "installed baseline conflicts with the verified cache");
    }
    writeJson(destination, cache);
  }
  process.stdout.write(stableJson({ schema: "zero.c32_baseline_cache_receipt.v1",
    ...receipt, file_sha256: sha256File(options.input),
    installed: options.mode === "install" }));
}

if (process.argv[1] && path.resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(1);
  }
}

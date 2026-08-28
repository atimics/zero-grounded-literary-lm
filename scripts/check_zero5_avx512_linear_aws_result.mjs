#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-avx512-linear-v1";
const readJson = name => JSON.parse(fs.readFileSync(`${directory}/${name}`));
const sha256 = name => crypto.createHash("sha256")
  .update(fs.readFileSync(`${directory}/${name}`)).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) /
  values.length;

const contract = readJson("aws-contract.json");
const launch = readJson("launch.json");
const status = readJson("status.json");
const result = readJson("result.json");

assert.equal(launch.schema, "zero.aws_avx512_linear_launch.v1");
assert.equal(status.schema, "zero.aws_avx512_linear_status.v1");
assert.equal(result.schema, "zero.avx512_linear_benchmark.v1");
assert.equal(launch.run_id, status.run_id);
assert.equal(launch.instance_id, status.instance_id);
assert.equal(launch.source_commit, contract.source.git_commit);
assert.equal(launch.source_commit, status.git_commit);
assert.equal(launch.source_sha256, contract.source.archive_sha256);
assert.equal(launch.asset_sha256, contract.assets.archive_sha256);
assert.equal(launch.contract_sha256, sha256("aws-contract.json"));
assert.equal(launch.approval_id, contract.authorization.approval_id);
assert.equal(status.approval_id, contract.authorization.approval_id);
assert.equal(status.status, "complete");
assert.equal(status.phase, "complete");
assert.equal(status.exit_code, 0);
assert.ok(status.elapsed_instance_seconds <=
  contract.execution.maximum_instance_seconds);
assert.ok(status.estimated_ec2_usd <=
  contract.execution.proposed_maximum_ec2_usd);
assert.equal(status.result_sha256, sha256("result.json"));
assert.equal(status.result_key,
  `experiments/zero5-avx512-linear-v1/${status.run_id}/result.json`);

assert.equal(result.platform.os, "linux");
assert.equal(result.platform.architecture, "x64");
assert.match(result.platform.cpu, /Intel\(R\) Xeon\(R\) Platinum 8375C/);
assert.equal(result.workload.updates, contract.workload.updates_per_run);
assert.equal(result.workload.repetitions, contract.workload.repetitions);
assert.equal(result.workload.parallel_workers,
  contract.workload.parallel_workers);
assert.equal(result.workload.blas_threads_per_worker,
  contract.workload.openblas_threads_per_worker);
assert.equal(result.workload.dynamic_threading,
  contract.workload.dynamic_threading);

for (const name of contract.workload.variants) {
  const runs = result.variants[name].runs;
  assert.equal(runs.length, contract.workload.repetitions);
  assert.equal(result.variants[name].mean_tokens_per_second,
    mean(runs.map(run => run.tokens_per_second)));
  assert.equal(new Set(runs.map(run => run.checkpoint_sha256)).size, 1);
  for (const run of runs) {
    assert.equal(run.update, contract.workload.updates_per_run);
    assert.equal(run.checkpoint_version, 6);
  }
}

const openblas = result.variants.openblas;
const avx512 = result.variants.avx512;
assert.equal(openblas.runs[0].linear_backend, "cblas-sgemm");
assert.equal(avx512.runs[0].linear_backend, "avx512-f32");
assert.equal(result.comparison.throughput_change,
  avx512.mean_tokens_per_second / openblas.mean_tokens_per_second - 1);
assert.ok(result.comparison.throughput_change < 0);
assert.equal(result.correctness.metrics_within_tolerance, true);
assert.equal(result.correctness.deterministic_checkpoints_per_backend, true);
assert.equal(result.correctness.cross_backend_checkpoint_bit_identical, false);
assert.equal(result.correctness.checkpoint_version, 6);
assert.equal(result.claim_boundary.scientific_replication, false);
assert.equal(result.claim_boundary.test_metrics_opened, false);

for (let index = 0; index < contract.workload.repetitions; ++index) {
  const baseline = openblas.runs[index];
  const candidate = avx512.runs[index];
  assert.ok(Math.abs(candidate.train_loss - baseline.train_loss) <=
    contract.workload.metric_tolerance.train_loss);
  assert.ok(Math.abs(candidate.validation_loss - baseline.validation_loss) <=
    contract.workload.metric_tolerance.validation_loss);
  assert.ok(Math.abs(candidate.gradient_norm - baseline.gradient_norm) <=
    contract.workload.metric_tolerance.gradient_norm);
}

process.stdout.write("ZERO.5 AVX-512 linear AWS result verified; no-go\n");

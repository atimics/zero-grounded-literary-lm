#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const digest = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const contract = JSON.parse(fs.readFileSync(
  "benchmarks/zero5-c33-parallel-v1/contract.json"));
const parent = JSON.parse(fs.readFileSync(contract.parent.contract));
const imported = JSON.parse(fs.readFileSync(contract.input.import_manifest));

assert.equal(contract.schema, "zero.c33_parallel_replay.v1");
assert.equal(contract.status, "preregistered-unrun");
assert.equal(digest(contract.parent.contract), contract.parent.contract_sha256);
assert.equal(parent.experiment, "zero5-c33-v1");
assert.equal(digest(contract.implementation.trainer),
  contract.implementation.trainer_sha256);
assert.equal(digest(contract.implementation.runner),
  contract.implementation.runner_sha256);
assert.equal(digest(contract.input.import_manifest),
  contract.input.import_manifest_sha256);
assert.equal(imported.release.id, contract.input.release_id);
assert.equal(imported.outputs.train_interleaved.sha256,
  contract.input.train_packs_sha256);
assert.equal(imported.outputs.validation_interleaved.sha256,
  contract.input.validation_packs_sha256);
assert.equal(imported.paired_training.optimizer_batches,
  contract.training.updates);
assert.equal(imported.paired_training.pair_cross_batch_leakage, 0);
assert.equal(contract.training.batch_sequences, 4);
assert.equal(contract.training.pack_sequences,
  contract.training.updates * contract.training.batch_sequences);
assert.equal(contract.training.compute_token_exposures,
  contract.training.pack_sequences * 512);
assert.deepEqual(contract.calibration.candidates, [
  { parallel_workers: 4, blas_threads: 1 },
  { parallel_workers: 4, blas_threads: 2 },
  { parallel_workers: 2, blas_threads: 4 },
]);
for (const candidate of contract.calibration.candidates) {
  assert(candidate.parallel_workers * candidate.blas_threads <= 8);
  assert(candidate.parallel_workers <= contract.training.batch_sequences);
}
assert.equal(contract.execution.maximum_total_ec2_usd, 1.2);
assert(contract.execution.maximum_instance_seconds *
  contract.execution.on_demand_usd_per_hour / 3600 <= 1.2);
for (const name of ["stage_script", "launcher", "user_data"]) {
  assert.equal(digest(contract.execution[name]),
    contract.execution[`${name}_sha256`]);
}
assert.equal(contract.evaluation.test_metrics_opened, false);
assert.match(fs.readFileSync(contract.implementation.trainer, "utf8"),
  /--parallel-batch/);
assert.match(fs.readFileSync(contract.implementation.runner, "utf8"),
  /deterministic_merge_order/);
if (contract.authorized) {
  assert.equal(contract.authorization.status, "authorized");
  assert.match(contract.authorization.approval_id, /^[a-z0-9-]+$/);
  assert.match(contract.authorization.approved_by, /^[A-Za-z0-9_.-]+$/);
  assert.match(contract.authorization.approved_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
} else {
  assert.equal(contract.authorization.status,
    "awaiting-explicit-dollar-cap-approval");
  assert.equal(contract.authorization.approval_id, null);
}

process.stdout.write("ZERO.5 C3.3 parallel replay contract verified\n");

#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const directory = "benchmarks/zero5-c32-throughput-v1";
const contract = JSON.parse(fs.readFileSync(`${directory}/contract.json`));
const parentBytes = fs.readFileSync("benchmarks/zero5-c32-v1/contract.json");
assert.equal(contract.schema, "zero.c32_throughput_contract.v1");
assert.equal(contract.status, "authorized-unrun");
assert.equal(contract.diagnostic_only, true);
assert.equal(contract.scientific_inference_allowed, false);
assert.equal(sha256(parentBytes), contract.parent.contract_sha256);
assert.equal(contract.parent.update, 3000);
assert.match(contract.parent.active_checkpoint_sha256, /^[0-9a-f]{64}$/);
assert.equal(sha256(fs.readFileSync(contract.source.user_data)),
  contract.source.user_data_sha256);
assert.equal(spawnSync("bash", ["-n", contract.source.user_data]).status, 0);
assert.ok((fs.statSync(contract.source.user_data).mode & 0o111) !== 0);
assert.ok(contract.venue.maximum_instance_seconds *
  contract.venue.hourly_usd / 3600 <= contract.venue.maximum_compute_usd);
assert.equal(contract.venue.maximum_compute_usd, 0.14);
assert.equal(contract.replay.compute_token_exposures,
  contract.replay.updates * contract.replay.batch_sequences * 512);
assert.equal(contract.candidates.length, 9);
assert.equal(new Set(contract.candidates.map(candidate => candidate.name)).size,
  contract.candidates.length);
assert.ok(contract.candidates.some(candidate => candidate.name ===
  contract.reference.name));
assert.ok(contract.candidates.some(candidate => candidate.name ===
  contract.reference.repeat));
assert.equal(contract.decision.continuation_approval, false);
assert.equal(contract.decision.test_metrics_opened, false);

const resultPath = `${directory}/result.json`;
if (fs.existsSync(resultPath)) {
  const result = JSON.parse(fs.readFileSync(resultPath));
  assert.equal(result.schema, "zero.c32_throughput_result.v1");
  assert.equal(result.status, "complete");
  assert.equal(result.diagnostic_only, true);
  assert.equal(result.input_checkpoint_sha256,
    contract.parent.active_checkpoint_sha256);
  assert.ok(result.compute_usd <= contract.venue.maximum_compute_usd);
  assert.equal(result.candidates.length, contract.candidates.length);
  assert.deepEqual(result.candidates.map(candidate => candidate.name),
    contract.candidates.map(candidate => candidate.name));
  const reference = result.candidates.find(candidate =>
    candidate.name === contract.reference.name);
  const repeat = result.candidates.find(candidate =>
    candidate.name === contract.reference.repeat);
  assert.equal(reference.byte_identical_to_reference, true);
  assert.equal(repeat.byte_identical_to_reference, true);
  assert.ok(Math.abs(reference.tokens_per_second - repeat.tokens_per_second) /
    reference.tokens_per_second <=
      contract.decision.reference_repeat_maximum_relative_drift);
  const eligible = result.candidates.filter(candidate =>
    candidate.byte_identical_to_reference);
  const fastest = eligible.reduce((best, candidate) =>
    candidate.tokens_per_second > best.tokens_per_second ? candidate : best);
  assert.deepEqual(result.fastest_byte_identical_candidate, fastest);
}

console.log(fs.existsSync(resultPath)
  ? "ZERO.5-C3.2 throughput result passed"
  : "ZERO.5-C3.2 throughput contract passed");

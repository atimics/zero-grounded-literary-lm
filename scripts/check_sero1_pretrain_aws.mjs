#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const budget = JSON.parse(fs.readFileSync(
  "benchmarks/sero1-pretrain-v1/aws-execution.json", "utf8"));
assert.equal(budget.schema, "sero.pretrain_v1_aws_execution.v1");
assert.equal(budget.region, "us-east-1");
assert.equal(budget.instance_type, "g5.xlarge");
assert.equal(budget.on_demand_usd_per_hour, 1.006);
assert.equal(budget.calibration.maximum_updates, 128);
assert.equal(budget.calibration.validation_byte_limit, 131072);
assert.equal(budget.calibration.maximum_instance_seconds, 1800);
assert.equal(budget.calibration.maximum_ec2_usd, 0.503);
assert.deepEqual(budget.full_runs.seeds, [0, 1, 2]);
assert.equal(budget.full_runs.maximum_instance_seconds_each, 10800);
assert.equal(budget.full_runs.maximum_ec2_usd_each, 3.018);
assert.equal(budget.full_runs.maximum_ec2_usd_total, 9.054);
assert.equal(budget.controls.market, "on-demand");
assert.equal(budget.controls.metadata_tokens, "required");
assert.equal(budget.controls.network_ingress, false);
assert.equal(budget.controls.instance_initiated_shutdown_behavior, "terminate");

for (const file of ["scripts/aws/sero1-pretrain-user-data.sh",
  "scripts/aws/sero1-pretrain-run-instances.sh"]) {
  const check = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
}
const userData = fs.readFileSync("scripts/aws/sero1-pretrain-user-data.sh", "utf8");
const launcher = fs.readFileSync("scripts/aws/sero1-pretrain-run-instances.sh", "utf8");
const requirements = fs.readFileSync("experiments/sero1-pretrain/requirements.txt", "utf8");
for (const pin of ["numpy==2.2.6", "tokenizers==0.23.1", "torch==2.13.0"])
  assert.ok(requirements.includes(pin), `runtime omits exact pin ${pin}`);
for (const required of ["shutdown -h now", "X-aws-ec2-metadata-token-ttl-seconds",
  "scripts/verify_zero_dataset.py", "experiments/sero1-pretrain/tests.py", "--device cuda",
  "timeout --signal=TERM", "--mode calibration", "--mode full"])
  assert.ok(userData.includes(required), `user data omits ${required}`);
for (const required of ["g5.xlarge", "HttpTokens=required",
  "--instance-initiated-shutdown-behavior terminate", "AssociatePublicIpAddress=true",
  "VolumeSize\":100", "--dry-run", "sero1-pretrain-user-data.sh"])
  assert.ok(launcher.includes(required), `launcher omits ${required}`);
assert.ok(!launcher.includes("request-spot-instances") &&
  !launcher.includes("--instance-market-options"));

console.log("Sero 1 AWS execution contract passed");

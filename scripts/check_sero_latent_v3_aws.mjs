#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const budget = JSON.parse(fs.readFileSync(
  "benchmarks/sero-latent-v3/aws-execution.json", "utf8"));
assert.equal(budget.schema, "sero.latent_v3_aws_execution.v1");
assert.equal(budget.instance_type, "g5.xlarge");
assert.equal(budget.on_demand_usd_per_hour, 1.006);
assert.equal(budget.calibration.maximum_instance_seconds, 3600);
assert.equal(budget.promotion_run.maximum_instance_seconds_each, 25_200);
assert.equal(budget.promotion_run.maximum_ec2_usd_total, 21.126);
assert.deepEqual(budget.promotion_run.seeds, [0, 1, 2]);
assert.equal(budget.controls.instance_initiated_shutdown_behavior, "terminate");
assert.equal(budget.controls.metadata_tokens, "required");

for (const file of ["scripts/aws/sero-latent-v3-user-data.sh",
  "scripts/aws/sero-latent-v3-run-instances.sh"]) {
  const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
const userData = fs.readFileSync("scripts/aws/sero-latent-v3-user-data.sh", "utf8");
const launcher = fs.readFileSync("scripts/aws/sero-latent-v3-run-instances.sh", "utf8");
const requirements = fs.readFileSync("experiments/sero-latent-v3/requirements.txt", "utf8");
for (const pin of ["numpy==2.2.6", "tokenizers==0.23.1", "torch==2.13.0"])
  assert(requirements.includes(pin), `runtime omits exact pin ${pin}`);
for (const required of ["shutdown -h now", "X-aws-ec2-metadata-token-ttl-seconds",
  "scripts/verify_zero_dataset.py", "--device cuda", "timeout --signal=TERM"])
  assert(userData.includes(required), `user data omits ${required}`);
for (const required of ["g5.xlarge", "HttpTokens=required",
  "--instance-initiated-shutdown-behavior terminate",
  "AssociatePublicIpAddress=true", "VolumeSize\":100", "--dry-run"])
  assert(launcher.includes(required), `launcher omits ${required}`);
assert(!launcher.includes("request-spot-instances") && !launcher.includes("--instance-market-options"));
console.log("Sero Latent V3 AWS execution contract passed");

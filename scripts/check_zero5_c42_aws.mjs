#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const digest = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const contract = JSON.parse(fs.readFileSync(
  "benchmarks/zero5-c42-v1/contract.json"));

assert.equal(contract.schema, "zero.c42_experiment_contract.v1");
assert.equal(contract.status, "authorized-unrun");
assert.equal(contract.authorized, true);
assert.equal(contract.authorization.status, "authorized");
assert.equal(contract.authorization.approval_id,
  "zero5-c42-aws-2026-08-28-v1");
assert.equal(contract.authorization.approved_statement,
  "Approve the $1.50 ceiling.");
assert.match(contract.authorization.approved_at,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);

const execution = contract.execution;
assert.equal(execution.venue, "aws-ec2");
assert.equal(execution.region, "us-east-1");
assert.equal(execution.instance_type, "c6i.4xlarge");
assert.equal(execution.instance_count, 1);
assert.equal(execution.purchase_option, "on-demand");
assert.equal(execution.on_demand_usd_per_hour, 0.68);
assert.equal(execution.maximum_instance_seconds, 7941);
assert.equal(execution.maximum_total_ec2_usd, 1.5);
assert.equal(execution.automatic_termination, true);
assert.equal(execution.durable_state_sync, true);
assert.equal(execution.single_execution_lock, true);
assert(execution.maximum_instance_seconds *
  execution.on_demand_usd_per_hour / 3600 <=
  execution.maximum_total_ec2_usd);
assert((execution.maximum_instance_seconds + 1) *
  execution.on_demand_usd_per_hour / 3600 >
  execution.maximum_total_ec2_usd);

for (const name of ["stage_script", "launcher", "user_data"]) {
  assert.equal(digest(execution[name]), execution[name + "_sha256"]);
}
assert.equal(digest(contract.implementation.runner),
  contract.implementation.runner_sha256);

const runner = fs.readFileSync(contract.implementation.runner, "utf8");
const launcher = fs.readFileSync(execution.launcher, "utf8");
const userData = fs.readFileSync(execution.user_data, "utf8");
assert.match(runner, /--require-math-backend/u);
assert.match(runner, /--require-attention-backend/u);
assert.match(runner, /test_metrics_opened: false/u);
assert.match(launcher, /--dry-run/u);
assert.match(launcher, /--if-none-match '\*'/u);
assert.match(launcher, /instance-initiated-shutdown-behavior terminate/u);
assert.match(userData, /sleep "\$remaining"; shutdown -h now/u);
assert.match(userData, /sync_state/u);
assert.doesNotMatch(runner, /data\/test\.jsonl/u);
assert.doesNotMatch(userData, /data\/test\.jsonl/u);

const result = spawnSync("node", [contract.implementation.runner,
  "--self-test"], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /runner self-test passed/u);

process.stdout.write("ZERO.5 C4.2 AWS contract verified\n");

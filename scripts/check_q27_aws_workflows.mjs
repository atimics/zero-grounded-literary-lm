#!/usr/bin/env node

import fs from "node:fs";

const launchPath = ".github/workflows/q27-aws-launch.yml";
const collectPath = ".github/workflows/q27-aws-collect.yml";
const workloadPath = "scripts/aws/q27-seed2.sh";
const userDataPath = "scripts/aws/q27-seed2-user-data.sh";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function includesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert(text.includes(fragment), `${label} is missing ${fragment}`);
  }
}

const launch = fs.readFileSync(launchPath, "utf8");
const collect = fs.readFileSync(collectPath, "utf8");
const workload = fs.readFileSync(workloadPath, "utf8");
const userData = fs.readFileSync(userDataPath, "utf8");

includesAll(launch, [
  "workflow_dispatch:",
  "dispatch seed 2 and exit",
  "--require-authorized",
  "instance-initiated-shutdown-behavior terminate",
  "MaxInstanceSeconds,Value=${ZERO_MAX_INSTANCE_SECONDS}",
  "WorkloadTimeoutSeconds,Value=${ZERO_WORKLOAD_TIMEOUT_SECONDS}",
  "MaxComputeUsd,Value=${ZERO_MAX_COMPUTE_USD}",
  "experiments/zero4-q27-aws-v1/execution.lock",
  "--if-none-match '*'",
  "max_instance_seconds: 6190",
  "workload_timeout_seconds: 6130",
  "publication_reserve_seconds: 60",
  "max_compute_usd: 1.17",
  "language_gate_authorized: false",
], "Q2.7 launch workflow");
for (const forbidden of [
  "aws ec2 wait",
  "aws ssm wait",
  "while true",
  "sleep 60",
]) {
  assert(!launch.includes(forbidden),
    `Q2.7 launcher waits for compute: ${forbidden}`);
}

includesAll(collect, [
  "workflow_dispatch:",
  "source_run_id:",
  "Read durable records once",
  "Require terminal instance",
  "state\" = terminated",
  "Terminal execution failure; this is not a scientific no-go",
  "language_gate_evaluated == false",
  "experiments/zero4-q27-aws-v1/collector.lock",
], "Q2.7 collector workflow");
for (const forbidden of [
  "run-instances",
  "start-instances",
  "reboot-instances",
  "aws ec2 wait",
  "aws ssm wait",
  "while true",
  "sleep ",
  "timeout ",
]) {
  assert(!collect.includes(forbidden),
    `Q2.7 collector may wait or start compute: ${forbidden}`);
}

includesAll(workload, [
  "OPENBLAS_NUM_THREADS=16",
  "ZERO_QUANTITY_JOBS=16",
  "scripts/train_zero4_q27.mjs",
  "--seed 2",
  "--steps 1000",
  "--consolidation-steps 400",
  "--batch 2",
  "scripts/check_zero4_q27_result.mjs",
  "--exclude 'recovery/*'",
  "--if-none-match '*'",
  "language_gate_evaluated: false",
], "Q2.7 workload");
includesAll(userData, [
  "HARD_INSTANCE_SECONDS=6190",
  "HARD_WORKLOAD_SECONDS=6130",
  "PUBLICATION_RESERVE_SECONDS=60",
  "shutdown -h now",
  "instance-id",
  "ZERO_WORKLOAD_DEADLINE_EPOCH",
  "timeout --signal=TERM",
], "Q2.7 user data");

console.log("Q2.7 launch/collector non-waiting workflow checks passed");

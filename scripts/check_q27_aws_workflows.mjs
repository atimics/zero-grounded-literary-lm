#!/usr/bin/env node

import fs from "node:fs";

const launchPath = ".github/workflows/q27-aws-launch.yml";
const retryPath = ".github/workflows/q27-aws-infrastructure-retry.yml";
const collectPath = ".github/workflows/q27-aws-collect.yml";
const ciPath = ".github/workflows/ci.yml";
const workloadPath = "scripts/aws/q27-seed2.sh";
const userDataPath = "scripts/aws/q27-seed2-user-data.sh";
const preflightPath = "scripts/aws/q27-preflight.sh";
const requestPath = "scripts/aws/q27-run-instances.sh";
const provisionPath = "scripts/aws/provision.sh";
const preflightIamPath = "scripts/aws/apply-q27-preflight-iam.sh";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function includesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert(text.includes(fragment), `${label} is missing ${fragment}`);
  }
}

const launch = fs.readFileSync(launchPath, "utf8");
const retry = fs.readFileSync(retryPath, "utf8");
const collect = fs.readFileSync(collectPath, "utf8");
const ci = fs.readFileSync(ciPath, "utf8");
const workload = fs.readFileSync(workloadPath, "utf8");
const userData = fs.readFileSync(userDataPath, "utf8");
const preflight = fs.readFileSync(preflightPath, "utf8");
const request = fs.readFileSync(requestPath, "utf8");
const provision = fs.readFileSync(provisionPath, "utf8");
const preflightIam = fs.readFileSync(preflightIamPath, "utf8");

includesAll(launch, [
  "workflow_dispatch:",
  "dispatch seed 2 and exit",
  "--require-authorized",
  "experiments/zero4-q27-aws-v1/execution.lock",
  "Preflight exact request, network, assets, and write-once storage",
  "scripts/aws/q27-preflight.sh",
  "scripts/aws/q27-run-instances.sh launch",
  "preflight_sha256: $preflight_sha256",
  "request_builder_sha256: $request_builder_sha256",
  "--if-none-match '*'",
  "max_instance_seconds: 6190",
  "workload_timeout_seconds: 6130",
  "publication_reserve_seconds: 60",
  "max_compute_usd: 1.17",
  "language_gate_authorized: false",
], "Q2.7 launch workflow");
assert(
  launch.indexOf("scripts/aws/q27-preflight.sh") <
    launch.indexOf("experiments/zero4-q27-aws-v1/execution.lock"),
  "Q2.7 execution lock precedes infrastructure preflight",
);
assert(
  launch.indexOf("experiments/zero4-q27-aws-v1/execution.lock") <
    launch.indexOf("scripts/aws/q27-run-instances.sh launch"),
  "Q2.7 compute launch precedes its one-time execution lock",
);
for (const forbidden of [
  "aws ec2 wait",
  "aws ssm wait",
  "while true",
  "sleep 60",
]) {
  assert(!launch.includes(forbidden),
    `Q2.7 launcher waits for compute: ${forbidden}`);
}

includesAll(retry, [
  "workflow_dispatch:",
  "dispatch sole infrastructure retry and exit",
  "Validate immutable retry authority before AWS",
  "scripts/check_q27_aws_retry.mjs",
  "--require-authorized",
  "execution-failure-30199981920.json",
  "infrastructure-retry-1.json",
  "Verify incident evidence, result absence, and terminal instance",
  "experiments/zero4-q27-aws-v1/execution.lock",
  ".provenance.original_execution_lock.sha256",
  "scientific_result_available == false",
  "scientific_decision == null",
  "result_sha256 == null",
  "observed_instance_seconds == 113",
  "result.json",
  "selected.ckpt",
  "selected.litq8",
  "case \"$prior_state\" in",
  "terminated)",
  "None)",
  "prior_state_basis=described-terminated",
  "prior_state_basis=aged-out-after-immutable-termination-evidence",
  "Refusing retry: prior instance state is $prior_state",
  "prior_instance_state=$prior_state",
  "prior_instance_state_basis=$prior_state_basis",
  "Refuse overlapping ZERO compute",
  "Preflight exact retry request before retry lock",
  "scripts/aws/q27-preflight.sh",
  "Acquire sole infrastructure retry lock",
  "zero.aws_infrastructure_retry_lock.v1",
  "retry_ordinal: 1",
  "experiments/zero4-q27-aws-v1/infrastructure-retry-1.lock",
  "--if-none-match '*'",
  "scripts/aws/q27-run-instances.sh launch",
  "execution_failure_record_sha256",
  "original_execution_lock_sha256",
  "max_instance_seconds: 6190",
  "max_compute_usd: 1.17",
  "language_gate_authorized: false",
], "Q2.7 infrastructure retry workflow");
assert(
  retry.indexOf("scripts/check_q27_aws_retry.mjs") <
    retry.indexOf("Configure AWS credentials"),
  "Q2.7 retry configures AWS before local authorization",
);
assert(
  retry.indexOf("Preflight exact retry request before retry lock") <
    retry.indexOf("Acquire sole infrastructure retry lock"),
  "Q2.7 retry lock precedes exact infrastructure preflight",
);
assert(
  retry.indexOf("grep -Eq '404|Not Found'") <
    retry.indexOf("case \"$prior_state\" in"),
  "Q2.7 aged-out instance is accepted before absence checks",
);
assert(
  retry.indexOf("case \"$prior_state\" in") <
    retry.indexOf("Refuse overlapping ZERO compute"),
  "Q2.7 prior-instance check no longer precedes the active-compute guard",
);
assert(
  retry.indexOf("Acquire sole infrastructure retry lock") <
    retry.indexOf("Launch bounded EC2 diagnostic retry"),
  "Q2.7 retry compute launch precedes its write-once lock",
);
assert(
  !retry.includes("--key experiments/zero4-q27-aws-v1/execution.lock"),
  "Q2.7 retry attempts to replace the original execution lock",
);
for (const forbidden of [
  "aws ec2 wait",
  "aws ssm wait",
  "while true",
  "sleep 60",
]) {
  assert(!retry.includes(forbidden),
    `Q2.7 infrastructure retry waits for compute: ${forbidden}`);
}

includesAll(ci, [
  "q27-node18-portability:",
  "Q2.7 infrastructure · Node 18",
  "node-version: '18.19.1'",
  "make zero4-q27-check",
], "Q2.7 Node 18 CI regression job");

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

includesAll(preflight, [
  "describe-images",
  '.[0].OwnerId == "099720109477"',
  '.[0].State == "available"',
  '.[0].Architecture == "x86_64"',
  "describe-subnets",
  '.[0].State == "available"',
  ".AvailableIpAddressCount > 0",
  "describe-security-groups",
  "assets/corpus/bpe/zero-foundation.tok",
  "assets/corpus/bpe/shakespeare.tok",
  "assets/corpus/bpe/blake.tok",
  "assets/corpus/bpe/crowley.tok",
  "assets/corpus/bpe/bible-kjv.tok",
  "assets/corpus/channel/literary-dialogue.tok",
  "PreconditionFailed|412",
  "scripts/aws/q27-run-instances.sh dry-run",
  "iam_pass_role_proved_by_exact_dry_run: true",
  "compute_launched: false",
  "execution_lock_acquired: false",
], "Q2.7 infrastructure preflight");
for (const forbidden of [
  "execution.lock",
  "scripts/aws/q27-run-instances.sh launch",
  "aws ec2 wait",
]) {
  assert(!preflight.includes(forbidden),
    `Q2.7 preflight can lock, launch, or wait: ${forbidden}`);
}

includesAll(request, [
  "dry-run|launch",
  "--image-id \"$ZERO_AMI\"",
  "--instance-type \"$ZERO_INSTANCE_TYPE\"",
  "--iam-instance-profile Name=zero-training-ec2",
  "--security-group-ids \"$ZERO_SECURITY_GROUP_ID\"",
  "--subnet-id \"$ZERO_SUBNET_ID\"",
  "--user-data file://scripts/aws/q27-seed2-user-data.sh",
  "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled",
  "VolumeSize\":32",
  "--instance-initiated-shutdown-behavior terminate",
  "MaxInstanceSeconds,Value=${ZERO_MAX_INSTANCE_SECONDS}",
  "WorkloadTimeoutSeconds,Value=${ZERO_WORKLOAD_TIMEOUT_SECONDS}",
  "MaxComputeUsd,Value=${ZERO_MAX_COMPUTE_USD}",
  "aws ec2 run-instances \"${request[@]}\"",
  "--dry-run",
  "DryRunOperation",
  "UnauthorizedOperation",
  "iam:PassRole",
], "Q2.7 exact EC2 request builder");
assert(
  (request.match(/aws ec2 run-instances/g) ?? []).length === 2,
  "Q2.7 request builder has an unexpected RunInstances path",
);

for (const [text, label] of [
  [provision, "AWS provisioner"],
  [preflightIam, "Q2.7 preflight IAM applier"],
]) {
  includesAll(text, [
    "zero-training-github-actions",
    "zero-training-github",
    "ReadLaunchInfrastructure",
    "ec2:DescribeImages",
    "ec2:DescribeSecurityGroups",
    "ec2:DescribeSubnets",
  ], label);
}
includesAll(preflightIam, [
  "--check|--apply",
  "aws iam get-role-policy",
  "aws iam put-role-policy",
  "Q2.7 preflight IAM read permissions applied and verified",
], "Q2.7 preflight IAM applier");
assert(!preflightIam.includes("iam attach-role-policy"),
  "Q2.7 preflight IAM correction attaches an unbounded managed policy");

console.log("Q2.7 launch/collector non-waiting workflow checks passed");

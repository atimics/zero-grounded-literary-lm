#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function excludes(text, fragments, name) {
  for (const fragment of fragments) {
    assert(!text.includes(fragment), `${name} contains forbidden fragment: ${fragment}`);
  }
}

export function validateWorkflowText({
  launch,
  collect,
  iamPreflight,
  provision,
  budget,
  runner,
  userData,
}) {
  const frozenBudget = JSON.parse(budget);
  assert(launch.includes("workflow_dispatch:"), "v2 launch is not manual");
  assert(
    launch.includes("benchmarks/zero4-q26r-v1/aws-v2/budget.json"),
    "v2 launch budget path drifted",
  );
  assert(
    launch.includes("--require-authorized"),
    "v2 launch does not require explicit authorization",
  );
  assert(launch.includes("zero4-q26r-aws-v2"), "v2 launch identity drifted");
  assert(
    launch.includes("max_instance_seconds_sum: $max_instance_seconds_sum"),
    "v2 launch time cap drifted",
  );
  assert(
    launch.includes("max_compute_usd: $max_compute_usd"),
    "v2 launch cost cap drifted",
  );
  assert(launch.includes("aws ec2 run-instances"), "v2 launch cannot create instances");
  assert(
    launch.includes("zero.aws_q26r_instance_identity.v2")
      && launch.includes("identity_sha256")
      && launch.includes("SourceArchiveSha256")
      && launch.includes("aws-ec2-describe-instances+describe-instance-attribute")
      && launch.includes("aws ec2 describe-instance-attribute")
      && launch.includes(".InstanceInitiatedShutdownBehavior.Value"),
    "v2 launch does not freeze AWS identity",
  );
  assert(
    launch.includes("experiments/zero4-q26r-aws-v2/recovery-1.lock")
      && launch.includes("experiments/zero4-q26r-aws-v2/recovery-2.lock")
      && launch.includes("experiments/zero4-q26r-aws-v2/recovery-3.lock")
      && launch.includes("zero.aws_recovery_execution_lock.v2")
      && launch.includes("ZERO_FAILED_LAUNCH_RUN_ID_1")
      && launch.includes("ZERO_FAILED_LAUNCH_RUN_ID_2")
      && launch.includes("ZERO_FAILED_LAUNCH_RUN_ID_3")
      && launch.includes("original_execution_lock_sha256")
      && launch.includes("recovery_1_lock_sha256")
      && launch.includes("recovery_2_lock_sha256")
      && launch.includes("recovery_3_lock_sha256")
      && launch.includes("bootstrap-failure-30119938666.json")
      && launch.includes('.status == "infrastructure-error"')
      && launch.includes("results/result.json")
      && launch.includes("--client-token"),
    "v2 launch lacks one-time recovery safety",
  );
  assert(
    launch.includes("--dry-run")
      && launch.includes("DryRunOperation")
      && launch.includes("UnauthorizedOperation"),
    "v2 launch lacks zero-compute IAM permission preflight",
  );
  assert(
    (launch.match(/--if-none-match '\*'/g) ?? []).length >= 5,
    "v2 launch lacks write-once S3 records",
  );
  excludes(
    launch,
    [
      "scripts/train_zero4_q26.mjs",
      "zero4-q26r-train",
      "sleep 6190",
      "sleep 6130",
      "$i.InstanceInitiatedShutdownBehavior",
    ],
    "v2 launch",
  );

  assert(collect.includes("workflow_dispatch:"), "v2 collector is not manual");
  assert(
    collect.includes("source_run_id:"),
    "v2 collector lacks immutable source run input",
  );
  assert(
    collect.includes("--verify-seed-provenance"),
    "v2 collector does not verify seed provenance",
  );
  assert(
    collect.includes("original-execution-lock-30117320329.json")
      && collect.includes("recovery-1-lock-30118477546.json")
      && collect.includes("recovery-2-lock-30119938666.json")
      && collect.includes('recovery-3-lock-${ZERO_SOURCE_RUN_ID}.json')
      && collect.includes("zero.aws_recovery_execution_lock.v2"),
    "v2 collector does not freeze recovery locks",
  );
  assert(
    collect.includes("InvalidInstanceID.NotFound")
      && collect.includes("purged-not-found")
      && collect.includes("live-terminal"),
    "v2 collector lacks exact terminal-state policy",
  );
  assert(
    collect.includes("--exclude 'recovery/*'")
      && collect.includes("--exclude '*.ckpt'"),
    "v2 collector may download recovery checkpoints",
  );
  assert(
    collect.includes('live_json="/tmp/q26r-v2-seed${seed}-live.json"')
      && collect.includes('live_error="/tmp/q26r-v2-seed${seed}-live.err"'),
    "v2 collector may retain raw EC2 metadata in artifacts",
  );
  assert(
    collect.includes("node scripts/check_zero4_q26r.mjs")
      && collect.includes("node scripts/aggregate_zero4_q26r.mjs")
      && collect.includes("node scripts/check_q26r_aws_v2_completion.mjs"),
    "v2 collector lacks frozen completion checks",
  );
  excludes(
    collect,
    [
      "aws ec2 run-instances",
      "aws ec2 start-instances",
      "aws ec2 terminate-instances",
      "aws ec2 wait",
      "sleep ",
      "scripts/train_zero4_q26.mjs",
      "timeout --signal",
      'training-diagnostics/seed${seed}-live.json',
      'training-diagnostics/seed${seed}-live.err',
      "$i.InstanceInitiatedShutdownBehavior",
    ],
    "v2 collector",
  );

  assert(iamPreflight.includes("workflow_dispatch:"), "v2 IAM preflight is not manual");
  assert(
    iamPreflight.includes("aws ec2 describe-instance-attribute")
      && iamPreflight.includes("--dry-run")
      && iamPreflight.includes("DryRunOperation")
      && iamPreflight.includes("UnauthorizedOperation"),
    "v2 IAM preflight does not prove DescribeInstanceAttribute authorization",
  );
  excludes(
    iamPreflight,
    [
      "aws ec2 run-instances",
      "aws ec2 start-instances",
      "aws ec2 terminate-instances",
      "aws ec2 wait",
      "sleep ",
    ],
    "v2 IAM preflight",
  );
  assert(
    provision.includes('"ec2:DescribeInstanceAttribute"'),
    "v2 provision policy lacks DescribeInstanceAttribute",
  );

  assert(runner.startsWith("#!/bin/bash"), "v2 runner has no shell identity");
  assert(runner.includes("set -Eeuo pipefail"), "v2 runner is not fail-closed");
  assert(
    runner.includes("zero.aws_q26r_seed_status.v2")
      && runner.includes('"instance_id": os.environ["ZERO_INSTANCE_ID"]'),
    "v2 runner does not bind instance identity",
  );
  assert(
    runner.includes("--if-none-match '*'")
      && runner.includes("--require-authorized")
      && runner.includes("ZERO_SOURCE_SHA256"),
    "v2 runner lacks immutable status or authorization check",
  );
  assert(
    runner.includes("--steps 1000")
      && runner.includes("--consolidation-steps 400")
      && runner.includes("--seed \"$ZERO_SEED\""),
    "v2 runner scientific workload drifted",
  );

  assert(userData.startsWith("#!/bin/bash"), "v2 user data has no shell identity");
  assert(
    userData.includes(
      `HARD_INSTANCE_SECONDS=${frozenBudget.per_seed_execution.max_instance_seconds}`,
    ),
    "v2 watchdog cap differs from the frozen budget",
  );
  assert(
    userData.includes(
      `HARD_WORKLOAD_SECONDS=${frozenBudget.per_seed_execution.workload_timeout_seconds}`,
    ),
    "v2 workload cap differs from the frozen budget",
  );
  assert(
    userData.includes(
      `test "$ZERO_MAX_COMPUTE_USD" = "${frozenBudget.per_seed_execution.max_compute_usd}"`,
    )
      && !userData.includes('test "$ZERO_MAX_COMPUTE_USD" = "1.18"'),
    "v2 bootstrap cost guard differs from the frozen budget",
  );
  assert(
    userData.includes("PUBLICATION_RESERVE_SECONDS=60"),
    "v2 publication reserve drifted",
  );
  assert(
    userData.includes("zero.aws_q26r_shutdown_intent.v2")
      && userData.includes("--if-none-match '*'")
      && userData.includes('"configured_shutdown_behavior": "terminate"'),
    "v2 user data lacks immutable shutdown intent",
  );
  assert(
    userData.includes("shutdown -h now")
      && userData.includes("instance-id"),
    "v2 user data lacks termination or IMDS identity",
  );
  return true;
}

export function validateWorkflowFiles(
  launchPath = ".github/workflows/q26r-aws-v2-launch.yml",
  collectPath = ".github/workflows/q26r-aws-v2-collect.yml",
  iamPreflightPath = ".github/workflows/q26r-aws-v2-iam-preflight.yml",
  provisionPath = "scripts/aws/provision.sh",
  budgetPath = "benchmarks/zero4-q26r-v1/aws-v2/budget.json",
  runnerPath = "scripts/aws/q26r-v2-seed.sh",
  userDataPath = "scripts/aws/q26r-v2-seed-user-data.sh",
) {
  return validateWorkflowText({
    launch: read(launchPath),
    collect: read(collectPath),
    iamPreflight: read(iamPreflightPath),
    provision: read(provisionPath),
    budget: read(budgetPath),
    runner: read(runnerPath),
    userData: read(userDataPath),
  });
}

function selfTest() {
  const fixtures = {
    launch: read(".github/workflows/q26r-aws-v2-launch.yml"),
    collect: read(".github/workflows/q26r-aws-v2-collect.yml"),
    iamPreflight: read(".github/workflows/q26r-aws-v2-iam-preflight.yml"),
    provision: read("scripts/aws/provision.sh"),
    budget: read("benchmarks/zero4-q26r-v1/aws-v2/budget.json"),
    runner: read("scripts/aws/q26r-v2-seed.sh"),
    userData: read("scripts/aws/q26r-v2-seed-user-data.sh"),
  };
  validateWorkflowText(fixtures);
  for (const [name, mutate] of [
    ["collector launch", (copy) => {
      copy.collect += "\naws ec2 run-instances\n";
    }],
    ["collector wait", (copy) => {
      copy.collect += "\nsleep 60\n";
    }],
    ["launch authorization", (copy) => {
      copy.launch = copy.launch.replace("--require-authorized", "--registration-only");
    }],
    ["IAM permission", (copy) => {
      copy.provision = copy.provision.replace(
        '"ec2:DescribeInstanceAttribute",',
        "",
      );
    }],
    ["IAM preflight compute", (copy) => {
      copy.iamPreflight += "\naws ec2 run-instances\n";
    }],
    ["runner instance identity", (copy) => {
      copy.runner = copy.runner.replaceAll(
        '"instance_id": os.environ["ZERO_INSTANCE_ID"]',
        '"instance_id": "unbound"',
      );
    }],
    ["shutdown intent", (copy) => {
      copy.userData = copy.userData.replace(
        "zero.aws_q26r_shutdown_intent.v2",
        "zero.aws_q26r_shutdown_intent.removed",
      );
    }],
    ["bootstrap cost contract", (copy) => {
      copy.userData = copy.userData.replace(
        'test "$ZERO_MAX_COMPUTE_USD" = "1.17"',
        'test "$ZERO_MAX_COMPUTE_USD" = "1.18"',
      );
    }],
  ]) {
    const invalid = structuredClone(fixtures);
    mutate(invalid);
    let rejected = false;
    try {
      validateWorkflowText(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `v2 workflow self-test failed to reject ${name}`);
  }
  console.log("Q2.6-R AWS v2 workflow self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    validateWorkflowFiles();
    console.log("Q2.6-R AWS v2 workflows passed");
  }
}

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
  runner,
  userData,
}) {
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
  assert(launch.includes("max_instance_seconds_sum: 12600"), "v2 launch time cap drifted");
  assert(launch.includes("max_compute_usd: 2.38"), "v2 launch cost cap drifted");
  assert(launch.includes("aws ec2 run-instances"), "v2 launch cannot create instances");
  assert(
    launch.includes("zero.aws_q26r_instance_identity.v2")
      && launch.includes("identity_sha256")
      && launch.includes("SourceArchiveSha256")
      && launch.includes("aws-ec2-describe-instances"),
    "v2 launch does not freeze AWS identity",
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
      "sleep 6300",
      "sleep 6180",
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
    ],
    "v2 collector",
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
  assert(userData.includes("HARD_INSTANCE_SECONDS=6300"), "v2 watchdog cap drifted");
  assert(userData.includes("HARD_WORKLOAD_SECONDS=6180"), "v2 workload cap drifted");
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
  runnerPath = "scripts/aws/q26r-v2-seed.sh",
  userDataPath = "scripts/aws/q26r-v2-seed-user-data.sh",
) {
  return validateWorkflowText({
    launch: read(launchPath),
    collect: read(collectPath),
    runner: read(runnerPath),
    userData: read(userDataPath),
  });
}

function selfTest() {
  const fixtures = {
    launch: read(".github/workflows/q26r-aws-v2-launch.yml"),
    collect: read(".github/workflows/q26r-aws-v2-collect.yml"),
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

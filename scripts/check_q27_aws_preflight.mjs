#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zero-q27-preflight-"));
const bin = path.join(root, "bin");
const log = path.join(root, "aws.jsonl");
const putState = path.join(root, "put-state");
const receipt = path.join(root, "preflight.json");
fs.mkdirSync(bin);

const fakeAws = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ZERO_FAKE_AWS_LOG, JSON.stringify(args) + "\\n");
const is = (...prefix) => prefix.every((value, index) => args[index] === value);
if (is("ec2", "describe-images")) {
  process.stdout.write(JSON.stringify({Images: [{
    ImageId: process.env.ZERO_AMI,
    OwnerId: "099720109477",
    State: "available",
    Architecture: "x86_64",
    VirtualizationType: "hvm",
    RootDeviceType: "ebs",
  }]}));
} else if (is("ec2", "describe-subnets")) {
  process.stdout.write(JSON.stringify({Subnets: [{
    SubnetId: process.env.ZERO_SUBNET_ID,
    State: "available",
    AvailableIpAddressCount: 8,
    VpcId: "vpc-1234abcd",
  }]}));
} else if (is("ec2", "describe-security-groups")) {
  process.stdout.write(JSON.stringify({SecurityGroups: [{
    GroupId: process.env.ZERO_SECURITY_GROUP_ID,
    VpcId: "vpc-1234abcd",
  }]}));
} else if (is("s3api", "head-object")) {
  process.stdout.write(JSON.stringify({ContentLength: 1024, ETag: "\\"fixture\\""}));
} else if (is("s3api", "put-object")) {
  if (fs.existsSync(process.env.ZERO_FAKE_PUT_STATE)) {
    process.stderr.write("PreconditionFailed (412): object already exists\\n");
    process.exit(255);
  }
  fs.writeFileSync(process.env.ZERO_FAKE_PUT_STATE, "written");
  process.stdout.write("{}");
} else if (is("ec2", "run-instances")) {
  if (args.includes("--dry-run")) {
    process.stderr.write("DryRunOperation: request would have succeeded\\n");
    process.exit(255);
  }
  process.stdout.write("i-0123456789abcdef0\\n");
} else {
  process.stderr.write("unexpected fake AWS call: " + args.join(" ") + "\\n");
  process.exit(2);
}
`;
const fakeAwsPath = path.join(bin, "aws");
fs.writeFileSync(fakeAwsPath, fakeAws, { mode: 0o755 });

const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  ZERO_FAKE_AWS_LOG: log,
  ZERO_FAKE_PUT_STATE: putState,
  ZERO_PREFLIGHT_OUTPUT: receipt,
  ZERO_AMI: "ami-1234abcd",
  ZERO_INSTANCE_TYPE: "c6i.4xlarge",
  ZERO_SECURITY_GROUP_ID: "sg-1234abcd",
  ZERO_SUBNET_ID: "subnet-1234abcd",
  ZERO_COMMIT: "765600e218537ac3b7ff320c676cfb7f62dab0ae",
  ZERO_RUN_ID: "51",
  ZERO_BUCKET: "zero-fixture",
  ZERO_REGION: "us-east-1",
  ZERO_BUDGET_FILE: "benchmarks/zero4-q27-v1/aws-v1/budget.json",
  ZERO_BUDGET_SHA256: "a".repeat(64),
  ZERO_WORKLOAD_SHA256: "b".repeat(64),
  ZERO_SOURCE_SHA256: "c".repeat(64),
  ZERO_LAUNCH_EPOCH: "1785000000",
  ZERO_MAX_INSTANCE_SECONDS: "6190",
  ZERO_WORKLOAD_TIMEOUT_SECONDS: "6130",
  ZERO_MAX_COMPUTE_USD: "1.17",
  ZERO_HOURLY_RATE_USD: "0.68",
};

try {
  const preflight = spawnSync("bash", ["scripts/aws/q27-preflight.sh"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);

  const beforeLaunch = fs.readFileSync(log, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line));
  const preflightRunCalls = beforeLaunch.filter(
    (args) => args[0] === "ec2" && args[1] === "run-instances",
  );
  assert.equal(preflightRunCalls.length, 1);
  assert(preflightRunCalls[0].includes("--dry-run"));
  assert(!beforeLaunch.some((args) => args.includes("execution.lock")));

  const record = JSON.parse(fs.readFileSync(receipt, "utf8"));
  assert.equal(record.compute_launched, false);
  assert.equal(record.execution_lock_acquired, false);
  assert.equal(record.ec2.exact_run_instances_dry_run, "DryRunOperation");
  assert.equal(record.ec2.iam_pass_role_proved_by_exact_dry_run, true);
  assert.equal(record.s3.write_once_condition_proved, true);
  assert.equal(record.s3.required_assets.length, 6);

  const launch = spawnSync("bash", ["scripts/aws/q27-run-instances.sh", "launch"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  assert.equal(launch.stdout.trim(), "i-0123456789abcdef0");

  const allCalls = fs.readFileSync(log, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line));
  const runCalls = allCalls.filter(
    (args) => args[0] === "ec2" && args[1] === "run-instances",
  );
  assert.equal(runCalls.length, 2);
  const dryRun = runCalls[0].filter((arg) => arg !== "--dry-run");
  assert.deepEqual(dryRun, runCalls[1],
    "preflight and launch request arguments diverged");
  assert(runCalls[1].includes("Name=zero-training-ec2"));
  assert(runCalls[1].includes("terminate"));
  assert(!runCalls[1].includes("--dry-run"));

  console.log("Q2.7 exact-request infrastructure preflight self-test passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

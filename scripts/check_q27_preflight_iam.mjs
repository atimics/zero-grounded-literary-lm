#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zero-q27-iam-"));
const bin = path.join(root, "bin");
const log = path.join(root, "aws.jsonl");
const state = path.join(root, "applied");
fs.mkdirSync(bin);

const before = {
  Version: "2012-10-17",
  Statement: [{
    Sid: "ReadInstanceState",
    Effect: "Allow",
    Action: ["ec2:DescribeInstances"],
    Resource: "*",
  }],
};
const after = {
  ...before,
  Statement: [...before.Statement, {
    Sid: "ReadLaunchInfrastructure",
    Effect: "Allow",
    Action: [
      "ec2:DescribeImages",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
    ],
    Resource: "*",
  }],
};
const fakeAws = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ZERO_FAKE_AWS_LOG, JSON.stringify(args) + "\\n");
if (args[0] !== "iam") process.exit(2);
if (args[1] === "get-role-policy") {
  const value = fs.existsSync(process.env.ZERO_FAKE_AWS_STATE)
    ? ${JSON.stringify(JSON.stringify(after))}
    : ${JSON.stringify(JSON.stringify(before))};
  process.stdout.write(value);
} else if (args[1] === "put-role-policy") {
  fs.writeFileSync(process.env.ZERO_FAKE_AWS_STATE, "applied");
} else {
  process.exit(2);
}
`;
const fakeAwsPath = path.join(bin, "aws");
fs.writeFileSync(fakeAwsPath, fakeAws, { mode: 0o755 });
const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  ZERO_FAKE_AWS_LOG: log,
  ZERO_FAKE_AWS_STATE: state,
};

try {
  const check = spawnSync(
    "bash",
    ["scripts/aws/apply-q27-preflight-iam.sh", "--check"],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert(check.stdout.includes("ReadLaunchInfrastructure"));
  let calls = fs.readFileSync(log, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.filter((args) => args[1] === "put-role-policy").length, 0,
    "check mode mutated IAM");

  fs.writeFileSync(log, "");
  const apply = spawnSync(
    "bash",
    ["scripts/aws/apply-q27-preflight-iam.sh", "--apply"],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );
  assert.equal(apply.status, 0, apply.stderr || apply.stdout);
  assert(apply.stdout.includes("applied and verified"));
  calls = fs.readFileSync(log, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.filter((args) => args[1] === "put-role-policy").length, 1);
  assert.equal(calls.filter((args) => args[1] === "get-role-policy").length, 2);
  for (const args of calls) {
    assert(args.includes("zero-training-github-actions"));
    assert(args.includes("zero-training-github"));
  }

  console.log("Q2.7 least-privilege preflight IAM self-test passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

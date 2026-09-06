#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const authorizationPath =
  "benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json";
const sha256 = file => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const run = (program, args) => {
  const result = spawnSync(program, args, {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${program} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
const authorization = JSON.parse(fs.readFileSync(authorizationPath, "utf8"));
const paths = authorization.execution;

assert.equal(authorization.authorized, true);
assert.equal(authorization.status, "authorized-launch-path-ready");
for (const name of ["authorized_evaluator", "stage", "launcher", "user_data"]) {
  assert.equal(sha256(paths[name]), paths[`${name}_sha256`], `${name} hash`);
}

const stage = fs.readFileSync(paths.stage, "utf8");
const launcher = fs.readFileSync(paths.launcher, "utf8");
const userData = fs.readFileSync(paths.user_data, "utf8");
const evaluator = fs.readFileSync(paths.authorized_evaluator, "utf8");
for (const source of [stage, launcher, userData, evaluator]) {
  assert.equal(source.includes("/Users/"), false);
  assert.equal(source.includes("/private/"), false);
}
for (const script of [paths.stage, paths.launcher, paths.user_data]) {
  run("bash", ["-n", script]);
}
assert.match(run("bash", [paths.stage, "self-test"]),
  /stage self-test passed/u);
assert.match(run("bash", [paths.launcher, "self-test"]),
  /launch self-test passed/u);
assert.match(run("node", [paths.authorized_evaluator, "--self-test"]),
  /authorized evaluator self-test passed/u);

assert.match(stage, /action.*plan.*upload/u);
assert.match(stage, /scope\.source_upload_authorized/u);
assert.match(stage, /scope\.private_artifact_upload_authorized/u);
assert.match(stage, /--if-none-match '\*'/u);
assert.match(stage, /control\/best\.ckpt/u);
assert.match(stage, /control\/result\.json/u);
assert.match(launcher, /instance-type c6i\.4xlarge/u);
assert.match(launcher, /--client-token/u);
assert.match(launcher, /prior_status.*recoverable/su);
assert.match(launcher, /approval_id.*execution\.lock/su);
assert.match(launcher, /--instance-initiated-shutdown-behavior terminate/u);
assert.equal(launcher.includes("--instance-market-options"), false);
assert.equal(launcher.includes("delete-object"), false);
assert.match(userData, /sleep.*shutdown -h now/u);
assert.match(userData, /MAX_INSTANCE_SECONDS.*9000/su);
assert.match(userData, /MAX_COMPUTE_USD.*1\.7/su);
assert.match(userData, /aws s3 sync.*STATE_PREFIX/su);
for (const phase of ["training", "candidate-tasks", "candidate-depth",
  "control-depth", "result"]) assert(userData.includes(`PHASE=${phase}`));
assert.match(evaluator, /evaluateHT1Gates/u);
assert.match(evaluator, /source_trainer/u);
assert.match(evaluator, /runtime_trainer/u);
assert.match(evaluator, /publication_authorized: false/u);
assert.equal(authorization.execution.state_sync_seconds, 30);
assert.equal(authorization.execution.checkpoint_every_updates, 250);
assert.equal(authorization.launch_readiness.code_ready, true);
assert.equal(authorization.launch_readiness.ready, false);
assert.equal(authorization.scope.source_upload_authorized, false);
assert.equal(authorization.scope.private_artifact_upload_authorized, false);

process.stdout.write("ZERO.5 HT1 AWS checks passed\n");

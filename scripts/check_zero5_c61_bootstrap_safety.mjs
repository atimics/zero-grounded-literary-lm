#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const current = fs.readFileSync(
  "scripts/aws/zero5-c61-evaluation-user-data.sh", "utf8");
const historical = fs.readFileSync(
  "benchmarks/zero5-c61-shared-state-v1/history/evaluation-user-data-v1.sh",
  "utf8");
const mock = [
  "curl() {",
  "  for arg in \"$@\"; do url=\"$arg\"; done",
  "  case \"$url\" in",
  "    */api/token) test \"$SCENARIO\" != token-failure || return 22; echo token ;;",
  "    */RunId) test \"$SCENARIO\" != tag-failure || return 22; echo zero5-c61-smoke-test ;;",
  "    */Commit) echo " + "a".repeat(40) + " ;;",
  "    *Sha256) echo " + "b".repeat(64) + " ;;",
  "    */Region) echo us-east-1 ;;",
  "    */LaunchEpoch) echo 0 ;;",
  "    */MaxInstanceSeconds) echo 9000 ;;",
  "    */MaxComputeUsd) if test \"$SCENARIO\" = invalid-metadata; then echo 9; else echo 1.7; fi ;;",
  "    */HourlyPrice) echo 0.68 ;;",
  "    */ApprovalId) echo zero5-c61-evaluation-recovery-aws-2026-09-01-v1 ;;",
  "    */instance-id) echo i-123456 ;;",
  "    */instance-type) echo c6i.4xlarge ;;",
  "    *) echo mock-value ;;",
  "  esac",
  "}",
  "date() { if test \"$SCENARIO\" = expired-deadline; then echo 10000; else echo 1; fi; }",
  "shutdown() { printf 'SHUTDOWN_CALLED\\n'; }",
  "sleep() { printf 'TIMER_ARMED\\n'; }",
  "aws() { echo UNEXPECTED_AWS_CALL; return 99; }",
].join("\n") + "\n";

function bootstrap(source, scenario) {
  const end = source.indexOf("elapsed_seconds()");
  assert(end > 0, "startup boundary is present");
  const logging = 'exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1';
  assert(source.includes(logging));
  const body = source.slice(0, end).replace(logging,
    scenario === "logging-failure" ? "false" : ":").replace("set -x", ":");
  const result = spawnSync("bash", ["-c", mock + body], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, SCENARIO: scenario },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.includes("UNEXPECTED_AWS_CALL"), false);
  return result;
}

// Confirm the regression fixture preserves the original failing path.
const prior = bootstrap(historical, "token-failure");
assert.equal(prior.status, 22);
assert.equal(prior.stdout.includes("SHUTDOWN_CALLED"), false);

for (const [scenario, status] of [
  ["token-failure", 22],
  ["tag-failure", 22],
  ["invalid-metadata", 1],
  ["expired-deadline", 1],
  ["logging-failure", 1],
]) {
  const result = bootstrap(current, scenario);
  assert.equal(result.status, status, scenario + ": original exit code");
  assert.equal(result.stdout.includes("SHUTDOWN_CALLED"), true,
    scenario + ": shutdown requested");
  assert.equal(result.stdout.includes("TIMER_ARMED"), false,
    scenario + ": shutdown occurs before the normal timer");
}
const ready = bootstrap(current, "ready");
assert.equal(ready.status, 0);
assert.equal(ready.stdout.includes("TIMER_ARMED"), true);
assert.equal(current.match(/--connect-timeout 5 --max-time 15/g)?.length, 2);
assert(current.indexOf("trap bootstrap_finish EXIT") < current.indexOf("BOOT_LOG="));
assert(current.indexOf("trap finish EXIT") > current.indexOf("sleep"));
console.log("C6.1 startup shutdown checks passed");

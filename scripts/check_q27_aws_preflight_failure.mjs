#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_RECORD =
  "benchmarks/zero4-q27-v1/aws-v1/preflight-failure-30189009274.json";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validatePreflightFailure(record) {
  assert(record?.schema === "zero.q27_aws_preflight_failure.v1",
    "unsupported Q2.7 preflight failure schema");
  assert(
    record.experiment === "zero4-q27-aws-v1" &&
      record.ci_run_id === "30189009274" &&
      record.git_commit === "ac6611208f03a662d0b46ff0a17ed3e88ef4529a",
    "Q2.7 preflight failure identity drifted",
  );
  assert(
    record.phase === "preflight-describe-images" &&
      record.classification === "infrastructure-preflight-error" &&
      record.denied_action === "ec2:DescribeImages" &&
      record.principal_role === "zero-training-github-actions" &&
      record.process_exit_code === 254,
    "Q2.7 preflight denial drifted",
  );
  assert(
    record.preflight_completed === false &&
      record.execution_lock_step === "skipped" &&
      record.execution_lock_acquired === false &&
      record.launch_step === "skipped" &&
      record.compute_launched === false &&
      record.observed_compute_usd === 0,
    "Q2.7 preflight failure consumed compute or an execution lock",
  );
  assert(
    record.scientific_attempt_consumed === false &&
      record.scientific_decision === null &&
      record.quantity_authorization_remains_available === true,
    "Q2.7 preflight failure was misclassified as science",
  );
  assert(
    record.remediation.kind === "least-privilege-read-policy" &&
      same(record.remediation.required_actions, [
        "ec2:DescribeImages",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
      ]) &&
      record.remediation.scientific_change_allowed === false &&
      record.remediation.budget_change_allowed === false,
    "Q2.7 preflight remediation scope drifted",
  );
  return true;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const recordPath = process.argv[2] ?? DEFAULT_RECORD;
  validatePreflightFailure(JSON.parse(fs.readFileSync(recordPath, "utf8")));
  console.log("Q2.7 zero-compute preflight failure record passed");
}

#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_RECORD =
  "benchmarks/zero4-q27-v1/aws-v1/execution-failure-30199981920.json";
const LOCK_SHA256 =
  "7def9b3e6a684cfd48f401dda7a9988aeef636f89ba6a7b4eddcb969f529c59a";
const LAUNCH_SHA256 =
  "5798760a21e4766926cb8f25028bfc3b88319c91313672c71e0380cd860b43c1";
const STATUS_SHA256 =
  "2f2dad36934ad2aff3d3294e945cae0866b1dcc4e2a47e0f07745125038ac12e";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

export function validateExecutionFailure(record) {
  assert(record?.schema === "zero.q27_aws_execution_failure.v1",
    "unsupported Q2.7 execution failure schema");
  assert(
    record.experiment === "zero4-q27-aws-v1" &&
      record.ci_run_id === "30199981920" &&
      record.git_commit === "197856f4d0fc727899275195cbadd6582aff27b6",
    "Q2.7 execution failure identity drifted",
  );
  assert(
    record.classification === "infrastructure-build-error" &&
      record.phase === "build" &&
      record.process_exit_code === 2,
    "Q2.7 execution failure classification drifted",
  );
  assert(
    record.instance?.instance_id === "i-095a0fdf736ce98e9" &&
      record.instance.instance_type === "c6i.4xlarge" &&
      record.instance.ami === "ami-052355af2a014bd2c" &&
      record.instance.state === "terminated",
    "Q2.7 failed instance identity or terminal state drifted",
  );
  assert(
    record.evidence?.execution_lock?.sha256 === LOCK_SHA256 &&
      record.evidence.launch?.sha256 === LAUNCH_SHA256 &&
      record.evidence.status?.sha256 === STATUS_SHA256 &&
      record.evidence.preflight?.sha256 ===
        "2d66646f34cc8b9f4ca40856b6ea412c46583d0da3214360a4a743831ab91b7c" &&
      record.evidence.workload_log?.sha256 ===
        "ffe10309a307a3fde80f134c4ce101d15e0e5ed9c95d26ed264b4e6f3d124614",
    "Q2.7 infrastructure failure evidence hashes drifted",
  );
  assert(
    record.terminal_status?.status === "infrastructure-error" &&
      record.terminal_status.phase === "build" &&
      record.terminal_status.exit_code === 2 &&
      record.terminal_status.observed_instance_seconds === 113 &&
      record.terminal_status.scientific_result_available === false &&
      record.terminal_status.scientific_decision === null &&
      record.terminal_status.result_sha256 === null,
    "Q2.7 terminal infrastructure status drifted",
  );
  const exactCost =
    record.cost.observed_instance_seconds *
    record.cost.on_demand_usd_per_hour / 3600;
  assert(
    record.cost.on_demand_usd_per_hour === 0.68 &&
      record.cost.observed_instance_seconds === 113 &&
      Math.abs(record.cost.observed_compute_usd - exactCost) < 1e-15 &&
      record.cost.observed_compute_usd_rounded_up_cents === 0.03 &&
      record.cost.original_max_compute_usd === 1.17,
    "Q2.7 observed infrastructure cost drifted",
  );
  assert(
    record.root_cause?.runtime === "Node.js 18.19.1" &&
      record.root_cause.failing_check ===
        "scripts/check_q27_aws_preflight.mjs" &&
      record.root_cause.mechanism.includes("extensionless") &&
      record.root_cause.mechanism.includes("CommonJS") &&
      record.root_cause.scientific_change_required === false,
    "Q2.7 infrastructure root cause drifted",
  );
  assert(
    record.scientific_scope?.scientific_phase_reached === false &&
      record.scientific_scope.result_head_observation === "404 Not Found" &&
      record.scientific_scope.candidate_artifacts_observed === false &&
      record.scientific_scope.scientific_result_available === false &&
      record.scientific_scope.scientific_decision === null &&
      record.scientific_scope.infrastructure_failure_is_not_scientific_no_go ===
        true,
    "Q2.7 failure was misclassified as scientific evidence",
  );
  assert(
    record.retry_eligibility?.eligible === true &&
      record.retry_eligibility.retry_ordinal === 1 &&
      record.retry_eligibility.maximum_retry_count === 1 &&
      record.retry_eligibility.original_execution_lock_must_remain === true &&
      record.retry_eligibility.separate_write_once_lock_key ===
        "experiments/zero4-q27-aws-v1/infrastructure-retry-1.lock" &&
      record.retry_eligibility.manual_cost_authorization_required === true,
    "Q2.7 retry eligibility drifted",
  );
  return true;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const recordPath = process.argv[2] ?? DEFAULT_RECORD;
  validateExecutionFailure(JSON.parse(fs.readFileSync(recordPath, "utf8")));
  console.log("Q2.7 infrastructure execution failure record passed");
}

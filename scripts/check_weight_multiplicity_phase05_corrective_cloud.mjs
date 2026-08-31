#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const contract = JSON.parse(
  readFileSync(
    "benchmarks/weight-multiplicity-phase05-corrective-cloud-v1/aws-contract.json",
    "utf8",
  ),
);

assert.equal(
  contract.schema,
  "zero.weight_multiplicity_phase05_corrective_aws_contract.v1",
);
assert.equal(
  contract.approval_id,
  "weight-multiplicity-phase05-corrective-cloud-2026-08-30-v1",
);
assert.deepEqual(contract.execution, {
  region: "us-east-1",
  instance_type: "c6i.4xlarge",
  instances: 1,
  maximum_instance_seconds: 2647,
  workload_timeout_seconds: 2100,
  hourly_price_usd: 0.68,
  maximum_ec2_usd: 0.5,
});
assert(
  contract.execution.maximum_instance_seconds *
      contract.execution.hourly_price_usd /
      3600 <=
    contract.execution.maximum_ec2_usd,
);
assert(
  (contract.execution.maximum_instance_seconds + 1) *
      contract.execution.hourly_price_usd /
      3600 >
    contract.execution.maximum_ec2_usd,
);
assert.equal(contract.bindings.prior_cloud_run_id, "33329981839");
assert.equal(
  contract.bindings.oracle_executable_sha256,
  "274d00071b33b9e4d4f495e629b0af96867cea382a8e7c4dc3174d13ca56a621",
);
assert.equal(contract.bindings.ilxyr_commit.length, 40);
assert.equal(contract.bindings.audit_plan_sha256.length, 64);
assert.equal(contract.forbidden.corpus_generation, true);
assert.equal(contract.forbidden.model_training, true);
assert.equal(contract.forbidden.timeout_increase, true);

const paths = [
  "scripts/aws/weight-multiplicity-phase05-corrective-run-instance.sh",
  "scripts/aws/weight-multiplicity-phase05-corrective-user-data.sh",
];
for (const path of paths) {
  const checked = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
}
const launcher = readFileSync(paths[0], "utf8");
const userData = readFileSync(paths[1], "utf8");
const workflow = readFileSync(
  ".github/workflows/weight-multiplicity-phase05-corrective-launch.yml",
  "utf8",
);
assert.match(launcher, /MaxComputeUsd,Value=0\.50/u);
assert.match(launcher, /MaxInstanceSeconds,Value=2647/u);
assert.match(launcher, /instance-initiated-shutdown-behavior terminate/u);
assert.match(userData, /test "\$MAX_COMPUTE_USD" = 0\.50/u);
assert.match(userData, /sleep "\$remaining"; shutdown -h now/u);
assert.match(userData, /run-weight-multiplicity-phase05-allocator-audit\.mjs/u);
assert.doesNotMatch(userData, /corpus|train/u);
assert.match(workflow, /run-weight-multiplicity-lie-cross-check\.mjs/u);
assert.match(workflow, /--if-none-match '\*'/u);
assert.match(workflow, /WM_PRIOR_PACKAGE_SHA256/u);

process.stdout.write(
  "weight-multiplicity Phase 0.5 corrective AWS contract verified\n",
);

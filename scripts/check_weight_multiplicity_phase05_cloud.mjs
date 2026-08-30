#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const digest = (path) => createHash("sha256")
  .update(readFileSync(path)).digest("hex");
const contract = JSON.parse(readFileSync(
  "benchmarks/weight-multiplicity-phase05-cloud-v1/aws-contract.json",
  "utf8",
));

assert.equal(contract.schema, "zero.weight_multiplicity_phase05_aws_contract.v1");
assert.equal(contract.status, "authorized-unrun");
assert.equal(contract.authorized, true);
assert.equal(
  contract.authorization.approval_id,
  "weight-multiplicity-phase05-cloud-2026-08-30-v1",
);
assert.equal(contract.authorization.approved_statement, "ok lets do it");
assert.equal(
  contract.lineage.oracle_source_commit,
  "53eaa6c2fcce514d1183e19445daeaf151e7ec04",
);
assert.equal(
  contract.lineage.ilxyr_controller_commit,
  "4e45ed31f6771a8cc03b00244ba008fb1ca7d0a1",
);
assert.equal(contract.lineage.recursive_weyl_canonicalization, false);

const execution = contract.execution;
assert.equal(execution.region, "us-east-1");
assert.equal(execution.instance_type, "c6i.4xlarge");
assert.equal(execution.instance_count, 1);
assert.equal(execution.planning_usd_per_hour, 0.68);
assert.equal(execution.maximum_instance_seconds, 31764);
assert.equal(execution.workload_timeout_seconds, 30900);
assert.equal(execution.maximum_total_ec2_usd, 6.0);
assert.equal(execution.automatic_termination, true);
assert.equal(execution.single_execution_lock, true);
assert.equal(execution.immutable_package, true);
assert(
  execution.maximum_instance_seconds * execution.planning_usd_per_hour / 3600 <=
    execution.maximum_total_ec2_usd,
);
assert(
  (execution.maximum_instance_seconds + 1) *
    execution.planning_usd_per_hour / 3600 > execution.maximum_total_ec2_usd,
);

for (const name of ["launcher", "user_data", "launch_workflow", "collect_workflow"])
  assert.equal(digest(execution[name]), execution[`${name}_sha256`]);

for (const path of [execution.launcher, execution.user_data]) {
  const checked = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
}

const launcher = readFileSync(execution.launcher, "utf8");
const userData = readFileSync(execution.user_data, "utf8");
const launchWorkflow = readFileSync(execution.launch_workflow, "utf8");
const collectWorkflow = readFileSync(execution.collect_workflow, "utf8");
assert.match(launcher, /--dry-run/u);
assert.match(launcher, /instance-initiated-shutdown-behavior terminate/u);
assert.match(userData, /sleep "\$remaining"; shutdown -h now/u);
assert.match(userData, /PACKAGE-SHA256SUMS/u);
assert.doesNotMatch(userData, /git clone|git pull|make weight_multiplicity/u);
assert.match(launchWorkflow, /--if-none-match '\*'/u);
assert.match(launchWorkflow, /git diff --exit-code/u);
assert.match(collectWorkflow, /same_oracle_executable == true/u);

assert.deepEqual(
  contract.experiments.map((experiment) => experiment.memo_initial_capacity_entries),
  [1024, 8388608],
);
assert.equal(contract.closures.corpus_generation, false);
assert.equal(contract.closures.model_training, false);
assert.equal(contract.closures.promotion, false);

process.stdout.write("weight-multiplicity Phase 0.5 AWS contract verified\n");

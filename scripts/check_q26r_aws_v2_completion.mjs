#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { validateV2Budget } from "./check_q26r_aws_v2_budget.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function hexadecimal(value, length) {
  return typeof value === "string"
    && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function isoTime(value) {
  return typeof value === "string"
    && !Number.isNaN(Date.parse(value));
}

function requireFileRecord(record, expectedPath, name) {
  assert(record?.path === expectedPath, `${name} path drifted`);
  assert(fs.existsSync(record.path), `${name} is missing`);
  assert(record.sha256 === sha256(record.path), `${name} hash drifted`);
  return readJson(record.path);
}

export function validateIdentity(
  identity,
  budget,
  launchRecord,
  sourceCommit,
  sourceRunId,
) {
  const seed = launchRecord.seed;
  assert(
    identity?.schema === "zero.aws_q26r_instance_identity.v2",
    `seed ${seed} identity schema drifted`,
  );
  assert(identity.experiment === budget.id, `seed ${seed} identity experiment drifted`);
  assert(identity.seed === seed, `seed ${seed} identity seed drifted`);
  assert(identity.ci_run_id === sourceRunId, `seed ${seed} identity run id drifted`);
  assert(identity.git_commit === sourceCommit, `seed ${seed} identity commit drifted`);
  assert(
    identity.budget_file === "benchmarks/zero4-q26r-v1/aws-v2/budget.json",
    `seed ${seed} identity budget path drifted`,
  );
  assert(hexadecimal(identity.budget_sha256, 64), `seed ${seed} identity budget hash is invalid`);
  assert(
    identity.source
      === "aws-ec2-describe-instances+describe-instance-attribute",
    `seed ${seed} identity source drifted`,
  );
  assert(isoTime(identity.captured_at), `seed ${seed} identity capture time is invalid`);
  assert(identity.instance_id === launchRecord.instance_id, `seed ${seed} instance id drifted`);
  assert(identity.instance_type === budget.venue.instance_type, `seed ${seed} instance type drifted`);
  assert(/^ami-[0-9a-f]+$/.test(identity.image_id), `seed ${seed} AMI is invalid`);
  assert(isoTime(identity.launch_time), `seed ${seed} launch time is invalid`);
  assert(
    ["pending", "running"].includes(identity.state_at_capture),
    `seed ${seed} identity was not captured at launch`,
  );
  assert(
    identity.region === budget.venue.region
      && identity.availability_zone.startsWith(`${budget.venue.region}`),
    `seed ${seed} region drifted`,
  );
  assert(identity.architecture === "x86_64", `seed ${seed} architecture drifted`);
  assert(identity.root_device_type === "ebs", `seed ${seed} root device drifted`);
  assert(
    identity.instance_initiated_shutdown_behavior === "terminate",
    `seed ${seed} shutdown behavior drifted`,
  );

  const expectedTags = {
    Project: "zero",
    Name: `zero-q26r-v2-seed${seed}`,
    Experiment: budget.id,
    Seed: String(seed),
    Commit: sourceCommit,
    RunId: sourceRunId,
    Region: budget.venue.region,
    BudgetFile: "benchmarks/zero4-q26r-v1/aws-v2/budget.json",
    BudgetSha256: identity.budget_sha256,
    SourceArchiveSha256: identity.tags.SourceArchiveSha256,
    LaunchEpoch: String(launchRecord.launch_epoch),
    MaxInstanceSeconds: String(budget.per_seed_execution.max_instance_seconds),
    WorkloadTimeoutSeconds: String(budget.per_seed_execution.workload_timeout_seconds),
    MaxComputeUsd: String(budget.per_seed_execution.max_compute_usd),
    HourlyRateUsd: String(budget.venue.on_demand_usd_per_hour),
  };
  assert(
    JSON.stringify(identity.tags) === JSON.stringify(expectedTags),
    `seed ${seed} identity tags drifted`,
  );
  assert(
    hexadecimal(identity.tags.SourceArchiveSha256, 64),
    `seed ${seed} source archive hash is invalid`,
  );
  return true;
}

export function validateSeedStatus(
  status,
  budget,
  launchRecord,
  sourceCommit,
  budgetSha256,
) {
  const seed = launchRecord.seed;
  assert(status?.schema === "zero.aws_q26r_seed_status.v2", `seed ${seed} status schema drifted`);
  assert(status.experiment === budget.id, `seed ${seed} status experiment drifted`);
  assert(status.seed === seed, `seed ${seed} status seed drifted`);
  assert(status.instance_id === launchRecord.instance_id, `seed ${seed} status instance drifted`);
  assert(status.status === "complete" && status.exit_code === 0, `seed ${seed} is incomplete`);
  assert(status.phase === "publication", `seed ${seed} did not reach publication`);
  assert(isoTime(status.started_at) && isoTime(status.finished_at), `seed ${seed} times are invalid`);
  assert(status.git_commit === sourceCommit, `seed ${seed} status commit drifted`);
  assert(status.budget_sha256 === budgetSha256, `seed ${seed} status budget drifted`);
  assert(status.scientific_result_available === true, `seed ${seed} has no result`);
  assert(["go", "no-go"].includes(status.decision), `seed ${seed} decision is invalid`);
  assert(hexadecimal(status.result_sha256, 64), `seed ${seed} result hash is invalid`);
  assert(
    Number.isInteger(status.observed_instance_seconds)
      && status.observed_instance_seconds >= 0
      && status.observed_instance_seconds <= budget.per_seed_execution.max_instance_seconds,
    `seed ${seed} exceeded its time cap`,
  );
  assert(
    typeof status.observed_compute_usd === "number"
      && status.observed_compute_usd >= 0
      && status.observed_compute_usd <= budget.per_seed_execution.max_compute_usd,
    `seed ${seed} exceeded its cost cap`,
  );
  assert(
    status.max_instance_seconds === budget.per_seed_execution.max_instance_seconds
      && status.max_compute_usd === budget.per_seed_execution.max_compute_usd,
    `seed ${seed} recorded the wrong cap`,
  );
  assert(
    status.training_backend === "OpenBLAS"
      && status.openblas_threads === budget.venue.openblas_threads
      && status.quantity_evaluator_jobs === budget.venue.quantity_evaluator_jobs,
    `seed ${seed} runtime envelope drifted`,
  );
  return true;
}

export function validateShutdownIntent(
  intent,
  budget,
  launchRecord,
  sourceCommit,
  sourceRunId,
  budgetSha256,
  statusSha256,
) {
  const seed = launchRecord.seed;
  assert(
    intent?.schema === "zero.aws_q26r_shutdown_intent.v2",
    `seed ${seed} shutdown schema drifted`,
  );
  assert(intent.experiment === budget.id, `seed ${seed} shutdown experiment drifted`);
  assert(intent.seed === seed, `seed ${seed} shutdown seed drifted`);
  assert(intent.instance_id === launchRecord.instance_id, `seed ${seed} shutdown instance drifted`);
  assert(intent.ci_run_id === sourceRunId, `seed ${seed} shutdown run drifted`);
  assert(intent.git_commit === sourceCommit, `seed ${seed} shutdown commit drifted`);
  assert(intent.budget_sha256 === budgetSha256, `seed ${seed} shutdown budget drifted`);
  assert(intent.status_sha256 === statusSha256, `seed ${seed} shutdown status hash drifted`);
  assert(isoTime(intent.requested_at), `seed ${seed} shutdown time is invalid`);
  assert(
    intent.action === "instance-initiated-shutdown"
      && intent.configured_shutdown_behavior === "terminate",
    `seed ${seed} shutdown action drifted`,
  );
  return true;
}

export function validateTerminalObservation(
  observation,
  budget,
  launchRecord,
  identitySha256,
) {
  const seed = launchRecord.seed;
  assert(
    observation?.schema === "zero.aws_q26r_terminal_observation.v2",
    `seed ${seed} terminal observation schema drifted`,
  );
  assert(observation.experiment === budget.id, `seed ${seed} terminal experiment drifted`);
  assert(observation.seed === seed, `seed ${seed} terminal seed drifted`);
  assert(
    observation.instance_id === launchRecord.instance_id,
    `seed ${seed} terminal instance drifted`,
  );
  assert(
    observation.identity_sha256 === identitySha256,
    `seed ${seed} terminal identity hash drifted`,
  );
  assert(isoTime(observation.observed_at), `seed ${seed} terminal time is invalid`);
  if (observation.policy === "live-terminal") {
    assert(
      ["stopped", "shutting-down", "terminated"].includes(observation.aws_state),
      `seed ${seed} live state is not terminal`,
    );
    assert(observation.aws_error_code === null, `seed ${seed} live state has an error`);
  } else if (observation.policy === "purged-not-found") {
    assert(observation.aws_state === null, `seed ${seed} purged state is not null`);
    assert(
      observation.aws_error_code === "InvalidInstanceID.NotFound",
      `seed ${seed} purged error is not exact`,
    );
  } else {
    fail(`seed ${seed} terminal policy is invalid`);
  }
  return true;
}

export function validateSeedProvenanceFiles(
  budgetPath,
  launchPath,
  identityPath,
  statusPath,
  intentPath,
  terminalPath,
  seed,
) {
  const budget = readJson(budgetPath);
  validateV2Budget(budget, { requireAuthorized: true });
  const budgetSha256 = sha256(budgetPath);
  const launch = readJson(launchPath);
  assert(launch?.schema === "zero.q26r_aws_launch.v2", "v2 launch schema drifted");
  assert(launch.experiment === budget.id, "v2 launch experiment drifted");
  assert(launch.budget_file === budgetPath, "v2 launch budget path drifted");
  assert(launch.budget_sha256 === budgetSha256, "v2 launch budget hash drifted");
  assert(
    launch.recovery_ordinal === 3
      && JSON.stringify(launch.recovery_of_launch_workflow_run_ids)
        === '["30117320329","30118477546","30119938666"]'
      && launch.original_execution_lock_key
        === "experiments/zero4-q26r-aws-v2/execution.lock"
      && launch.recovery_1_lock_key
        === "experiments/zero4-q26r-aws-v2/recovery-1.lock"
      && launch.recovery_2_lock_key
        === "experiments/zero4-q26r-aws-v2/recovery-2.lock"
      && launch.recovery_3_lock_key
        === "experiments/zero4-q26r-aws-v2/recovery-3.lock"
      && hexadecimal(launch.original_execution_lock_sha256, 64)
      && hexadecimal(launch.recovery_1_lock_sha256, 64)
      && hexadecimal(launch.recovery_2_lock_sha256, 64)
      && hexadecimal(launch.recovery_3_lock_sha256, 64),
    "v2 launch recovery binding drifted",
  );
  assert(hexadecimal(launch.source_archive_sha256, 64), "v2 source archive hash is invalid");
  assert(hexadecimal(launch.seed_runner_sha256, 64), "v2 seed runner hash is invalid");
  assert(hexadecimal(launch.user_data_sha256, 64), "v2 user-data hash is invalid");
  assert(/^[0-9]+$/.test(launch.ci_run_id), "v2 launch run id is invalid");
  assert(hexadecimal(launch.git_commit, 40), "v2 launch commit is invalid");
  const launchRecord = launch.instances?.find((record) => record.seed === seed);
  assert(launchRecord, `seed ${seed} launch record is missing`);

  const identity = readJson(identityPath);
  assert(
    sha256(identityPath) === launchRecord.identity_sha256,
    `seed ${seed} identity hash differs from launch`,
  );
  validateIdentity(
    identity,
    budget,
    launchRecord,
    launch.git_commit,
    launch.ci_run_id,
  );
  assert(identity.budget_sha256 === budgetSha256, `seed ${seed} identity budget drifted`);
  assert(
    identity.tags.SourceArchiveSha256 === launch.source_archive_sha256,
    `seed ${seed} source archive binding drifted`,
  );

  const status = readJson(statusPath);
  validateSeedStatus(
    status,
    budget,
    launchRecord,
    launch.git_commit,
    budgetSha256,
  );
  const intent = readJson(intentPath);
  validateShutdownIntent(
    intent,
    budget,
    launchRecord,
    launch.git_commit,
    launch.ci_run_id,
    budgetSha256,
    sha256(statusPath),
  );
  validateTerminalObservation(
    readJson(terminalPath),
    budget,
    launchRecord,
    sha256(identityPath),
  );
  console.log(`Q2.6-R AWS v2 seed ${seed} provenance passed`);
  return true;
}

export function validateCompletion(
  completionPath = "benchmarks/zero4-q26r-v1/aws-v2/COMPLETED",
  budgetPath = "benchmarks/zero4-q26r-v1/aws-v2/budget.json",
) {
  const budget = readJson(budgetPath);
  validateV2Budget(budget, { requireAuthorized: true });
  const completion = readJson(completionPath);
  assert(completion?.schema === "zero.q26r_aws_completion.v2", "v2 completion schema drifted");
  assert(completion.experiment === budget.id, "v2 completion experiment drifted");
  assert(isoTime(completion.completed_at), "v2 completion time is invalid");
  assert(/^[0-9]+$/.test(completion.source_run_id), "v2 source run id is invalid");
  assert(hexadecimal(completion.source_commit, 40), "v2 source commit is invalid");
  assert(/^[0-9]+$/.test(completion.collector_run_id), "v2 collector run id is invalid");
  assert(hexadecimal(completion.collector_commit, 40), "v2 collector commit is invalid");
  assert(completion.budget_file === budgetPath, "v2 completion budget path drifted");
  assert(completion.budget_sha256 === sha256(budgetPath), "v2 completion budget hash drifted");
  assert(JSON.stringify(completion.seeds) === "[1,3]", "v2 completion seeds drifted");
  assert(completion.new_training_started_by_collector === false, "v2 collector started training");
  assert(completion.collector_waited_for_compute === false, "v2 collector waited for compute");

  const root = "benchmarks/zero4-q26r-v1";
  const executionRoot = `${root}/aws-v2`;
  const launchPath = `${executionRoot}/launch-${completion.source_run_id}.json`;
  const launch = requireFileRecord(completion.launch, launchPath, "v2 launch receipt");
  assert(launch.schema === "zero.q26r_aws_launch.v2", "v2 launch schema drifted");
  assert(launch.experiment === budget.id, "v2 launch experiment drifted");
  assert(launch.git_commit === completion.source_commit, "v2 launch commit drifted");
  assert(launch.ci_run_id === completion.source_run_id, "v2 launch run id drifted");
  assert(launch.budget_file === budgetPath, "v2 launch budget path drifted");
  assert(launch.budget_sha256 === completion.budget_sha256, "v2 launch budget hash drifted");
  assert(
    launch.recovery_ordinal === 3
      && JSON.stringify(launch.recovery_of_launch_workflow_run_ids)
        === '["30117320329","30118477546","30119938666"]'
      && launch.original_execution_lock_key
        === "experiments/zero4-q26r-aws-v2/execution.lock"
      && launch.recovery_1_lock_key
        === "experiments/zero4-q26r-aws-v2/recovery-1.lock"
      && launch.recovery_2_lock_key
        === "experiments/zero4-q26r-aws-v2/recovery-2.lock"
      && launch.recovery_3_lock_key
        === "experiments/zero4-q26r-aws-v2/recovery-3.lock"
      && hexadecimal(launch.original_execution_lock_sha256, 64)
      && hexadecimal(launch.recovery_1_lock_sha256, 64)
      && hexadecimal(launch.recovery_2_lock_sha256, 64)
      && hexadecimal(launch.recovery_3_lock_sha256, 64),
    "v2 completion launch recovery binding drifted",
  );
  assert(hexadecimal(launch.source_archive_sha256, 64), "v2 source archive hash is invalid");
  assert(hexadecimal(launch.seed_runner_sha256, 64), "v2 seed runner hash is invalid");
  assert(hexadecimal(launch.user_data_sha256, 64), "v2 user-data hash is invalid");
  assert(launch.region === budget.venue.region, "v2 launch region drifted");
  assert(launch.instance_type === budget.venue.instance_type, "v2 launch type drifted");
  assert(
    launch.max_instance_seconds_sum === budget.combined_execution.max_instance_seconds_sum
      && launch.max_compute_usd === budget.combined_execution.max_compute_usd,
    "v2 launch combined cap drifted",
  );
  assert(
    JSON.stringify(launch.instances?.map((record) => record.seed)) === "[1,3]",
    "v2 launch seeds drifted",
  );
  assert(
    new Set(launch.instances.map((record) => record.instance_id)).size === 2,
    "v2 launch reused an instance",
  );

  const originalLockPath = `${executionRoot}/original-execution-lock-30117320329.json`;
  const originalLock = requireFileRecord(
    completion.original_execution_lock,
    originalLockPath,
    "v2 original execution lock",
  );
  assert(
    completion.original_execution_lock.sha256
      === launch.original_execution_lock_sha256
      && originalLock.schema === "zero.aws_execution_lock.v2"
      && originalLock.experiment === budget.id
      && JSON.stringify(originalLock.seeds) === "[1,3]"
      && originalLock.ci_run_id === "30117320329"
      && originalLock.git_commit
        === "5949e7bfc8d6f78d3eaef1ef86d7a488454d1243"
      && originalLock.budget_sha256
        === "580a74f1c5ad72e3f205b104d14c1b6d6f4fc0fe2f529a9308e38173925b990e",
    "v2 original execution lock drifted",
  );
  const recovery1LockPath = `${executionRoot}/recovery-1-lock-30118477546.json`;
  const recovery1Lock = requireFileRecord(
    completion.recovery_1_lock,
    recovery1LockPath,
    "v2 recovery-1 lock",
  );
  assert(
    completion.recovery_1_lock.sha256 === launch.recovery_1_lock_sha256
      && recovery1Lock.schema === "zero.aws_recovery_execution_lock.v2"
      && recovery1Lock.experiment === budget.id
      && recovery1Lock.recovery_ordinal === 1
      && JSON.stringify(recovery1Lock.seeds) === "[1,3]"
      && recovery1Lock.ci_run_id === "30118477546"
      && recovery1Lock.git_commit
        === "87a2b2164bc426ae427b8a6434bf9be6477b38a7"
      && recovery1Lock.budget_sha256
        === "69268b595a325fd6e9cbbed752abb5d34cecfa2f5df70ac1b68e5328d7d1ddf8"
      && recovery1Lock.failed_launch_workflow_run_id === "30117320329"
      && recovery1Lock.preflight_failure_sha256
        === budget.recovery_basis.preflight_failure_sha256
      && recovery1Lock.original_execution_lock_sha256
        === completion.original_execution_lock.sha256,
    "v2 recovery-1 lock drifted",
  );
  const recovery2LockPath = `${executionRoot}/recovery-2-lock-30119938666.json`;
  const recovery2Lock = requireFileRecord(
    completion.recovery_2_lock,
    recovery2LockPath,
    "v2 recovery-2 lock",
  );
  assert(
    completion.recovery_2_lock.sha256 === launch.recovery_2_lock_sha256
      && recovery2Lock.schema === "zero.aws_recovery_execution_lock.v2"
      && recovery2Lock.experiment === budget.id
      && recovery2Lock.recovery_ordinal === 2
      && JSON.stringify(recovery2Lock.seeds) === "[1,3]"
      && recovery2Lock.ci_run_id === "30119938666"
      && recovery2Lock.git_commit
        === "a9e263c60d724372e7eca670fb1087d992a4b7ae"
      && recovery2Lock.budget_sha256
        === "81742e40e9bd43309b5c8313003ff0ce79bae1b5441c8273101f44df9f37af0d"
      && JSON.stringify(recovery2Lock.failed_launch_workflow_run_ids)
        === '["30117320329","30118477546"]'
      && JSON.stringify(recovery2Lock.preflight_failure_sha256s)
        === JSON.stringify([
          budget.recovery_basis.preflight_failure_sha256,
          budget.recovery_2_basis.preflight_failure_sha256,
        ])
      && recovery2Lock.original_execution_lock_sha256
        === completion.original_execution_lock.sha256
      && recovery2Lock.recovery_1_lock_sha256
        === completion.recovery_1_lock.sha256,
    "v2 recovery-2 lock drifted",
  );
  const recovery3LockPath = `${executionRoot}/recovery-3-lock-${completion.source_run_id}.json`;
  const recovery3Lock = requireFileRecord(
    completion.recovery_3_lock,
    recovery3LockPath,
    "v2 recovery-3 lock",
  );
  assert(
    completion.recovery_3_lock.sha256 === launch.recovery_3_lock_sha256
      && recovery3Lock.schema === "zero.aws_recovery_execution_lock.v2"
      && recovery3Lock.experiment === budget.id
      && recovery3Lock.recovery_ordinal === 3
      && JSON.stringify(recovery3Lock.seeds) === "[1,3]"
      && recovery3Lock.ci_run_id === completion.source_run_id
      && recovery3Lock.git_commit === completion.source_commit
      && recovery3Lock.budget_sha256 === completion.budget_sha256
      && JSON.stringify(recovery3Lock.failed_launch_workflow_run_ids)
        === '["30117320329","30118477546","30119938666"]'
      && JSON.stringify(recovery3Lock.preflight_failure_sha256s)
        === JSON.stringify([
          budget.recovery_basis.preflight_failure_sha256,
          budget.recovery_2_basis.preflight_failure_sha256,
        ])
      && recovery3Lock.bootstrap_failure_sha256
        === budget.recovery_3_basis.bootstrap_failure_sha256
      && recovery3Lock.original_execution_lock_sha256
        === completion.original_execution_lock.sha256
      && recovery3Lock.recovery_1_lock_sha256
        === completion.recovery_1_lock.sha256
      && recovery3Lock.recovery_2_lock_sha256
        === completion.recovery_2_lock.sha256,
    "v2 recovery-3 lock drifted",
  );

  for (const launchRecord of launch.instances) {
    const seed = launchRecord.seed;
    const records = completion.records?.[String(seed)];
    assert(records, `seed ${seed} completion records are missing`);
    assert(/^i-[0-9a-f]+$/.test(launchRecord.instance_id), `seed ${seed} instance id is invalid`);
    assert(Number.isInteger(launchRecord.launch_epoch), `seed ${seed} launch epoch is invalid`);
    assert(
      launchRecord.max_instance_seconds === budget.per_seed_execution.max_instance_seconds
        && launchRecord.max_compute_usd === budget.per_seed_execution.max_compute_usd,
      `seed ${seed} launch cap drifted`,
    );

    const identityPath = `${executionRoot}/seed${seed}-identity-${completion.source_run_id}.json`;
    const identity = requireFileRecord(records.identity, identityPath, `seed ${seed} identity`);
    assert(
      launchRecord.identity_key
        === `jobs/${completion.source_run_id}/identity/seed${seed}.json`,
      `seed ${seed} identity key drifted`,
    );
    assert(
      launchRecord.identity_sha256 === records.identity.sha256,
      `seed ${seed} launch identity hash drifted`,
    );
    validateIdentity(
      identity,
      budget,
      launchRecord,
      completion.source_commit,
      completion.source_run_id,
    );
    assert(identity.budget_sha256 === completion.budget_sha256, `seed ${seed} identity budget drifted`);
    assert(
      identity.tags.SourceArchiveSha256 === launch.source_archive_sha256,
      `seed ${seed} source archive binding drifted`,
    );

    const statusPath = `${executionRoot}/seed${seed}-status-${completion.source_run_id}.json`;
    const status = requireFileRecord(records.status, statusPath, `seed ${seed} status`);
    validateSeedStatus(
      status,
      budget,
      launchRecord,
      completion.source_commit,
      completion.budget_sha256,
    );

    const intentPath = `${executionRoot}/seed${seed}-shutdown-intent-${completion.source_run_id}.json`;
    const intent = requireFileRecord(records.shutdown_intent, intentPath, `seed ${seed} shutdown intent`);
    validateShutdownIntent(
      intent,
      budget,
      launchRecord,
      completion.source_commit,
      completion.source_run_id,
      completion.budget_sha256,
      records.status.sha256,
    );

    const terminalPath = `${executionRoot}/seed${seed}-terminal-${completion.source_run_id}.json`;
    const terminal = requireFileRecord(records.terminal, terminalPath, `seed ${seed} terminal observation`);
    validateTerminalObservation(terminal, budget, launchRecord, records.identity.sha256);

    const seedRoot = `${root}/seed${seed}`;
    const resultPath = `${seedRoot}/result.json`;
    const attemptsPath = `${seedRoot}/optimizer-attempts.jsonl`;
    assert(fs.existsSync(resultPath), `seed ${seed} result is missing`);
    assert(fs.existsSync(attemptsPath), `seed ${seed} attempts are missing`);
    assert(sha256(resultPath) === status.result_sha256, `seed ${seed} result hash drifted`);
    execFileSync(
      process.execPath,
      [
        "scripts/check_zero4_q26r.mjs",
        "benchmarks/zero4-q26r-v1/contract.json",
        attemptsPath,
        resultPath,
      ],
      { stdio: "inherit" },
    );
  }

  const aggregatePath = `${root}/aggregate.json`;
  assert(fs.existsSync(aggregatePath), "v2 family aggregate is missing");
  const aggregate = readJson(aggregatePath);
  assert(
    aggregate.schema === "zero.zero4_q26_multiseed.v1"
      && aggregate.id === "zero4-q26-multiseed"
      && ["go", "no-go"].includes(aggregate.decision),
    "v2 family aggregate drifted",
  );
  console.log(`Q2.6-R AWS v2 completion passed: family ${aggregate.decision}`);
  return true;
}

function selfTest() {
  const budgetPath = new URL(
    "../benchmarks/zero4-q26r-v1/aws-v2/budget.json",
    import.meta.url,
  );
  const budget = readJson(budgetPath);
  const approved = structuredClone(budget);
  approved.authorization.manual_approval_observed = true;
  approved.authorization.authorized_for_execution = true;
  approved.authorization.authorized_at = "2026-07-24";
  const launchRecord = {
    seed: 1,
    instance_id: "i-0123456789abcdef0",
    launch_epoch: 1784880000,
    max_instance_seconds: 6190,
    max_compute_usd: 1.17,
  };
  const sourceCommit = "a".repeat(40);
  const sourceRunId = "30000000000";
  const budgetSha256 = "b".repeat(64);
  const identity = {
    schema: "zero.aws_q26r_instance_identity.v2",
    experiment: approved.id,
    seed: 1,
    ci_run_id: sourceRunId,
    git_commit: sourceCommit,
    budget_file: "benchmarks/zero4-q26r-v1/aws-v2/budget.json",
    budget_sha256: budgetSha256,
    captured_at: "2026-07-24T08:00:00Z",
    source: "aws-ec2-describe-instances+describe-instance-attribute",
    instance_id: launchRecord.instance_id,
    instance_type: "c6i.4xlarge",
    image_id: "ami-0123456789abcdef0",
    launch_time: "2026-07-24T08:00:00Z",
    state_at_capture: "pending",
    availability_zone: "us-east-1a",
    region: "us-east-1",
    architecture: "x86_64",
    root_device_type: "ebs",
    instance_initiated_shutdown_behavior: "terminate",
    tags: {
      Project: "zero",
      Name: "zero-q26r-v2-seed1",
      Experiment: approved.id,
      Seed: "1",
      Commit: sourceCommit,
      RunId: sourceRunId,
      Region: "us-east-1",
      BudgetFile: "benchmarks/zero4-q26r-v1/aws-v2/budget.json",
      BudgetSha256: budgetSha256,
      SourceArchiveSha256: "f".repeat(64),
      LaunchEpoch: String(launchRecord.launch_epoch),
      MaxInstanceSeconds: "6190",
      WorkloadTimeoutSeconds: "6130",
      MaxComputeUsd: "1.17",
      HourlyRateUsd: "0.68",
    },
  };
  validateIdentity(identity, approved, launchRecord, sourceCommit, sourceRunId);

  const status = {
    schema: "zero.aws_q26r_seed_status.v2",
    experiment: approved.id,
    seed: 1,
    instance_id: launchRecord.instance_id,
    status: "complete",
    phase: "publication",
    exit_code: 0,
    started_at: "2026-07-24T08:00:10Z",
    finished_at: "2026-07-24T09:25:00Z",
    git_commit: sourceCommit,
    budget_sha256: budgetSha256,
    scientific_result_available: true,
    decision: "go",
    result_sha256: "c".repeat(64),
    observed_instance_seconds: 5100,
    observed_compute_usd: 0.9633333333333334,
    max_instance_seconds: 6190,
    max_compute_usd: 1.17,
    training_backend: "OpenBLAS",
    openblas_threads: 16,
    quantity_evaluator_jobs: 16,
  };
  validateSeedStatus(status, approved, launchRecord, sourceCommit, budgetSha256);
  const statusSha256 = "d".repeat(64);
  const intent = {
    schema: "zero.aws_q26r_shutdown_intent.v2",
    experiment: approved.id,
    seed: 1,
    instance_id: launchRecord.instance_id,
    ci_run_id: sourceRunId,
    git_commit: sourceCommit,
    budget_sha256: budgetSha256,
    status_sha256: statusSha256,
    requested_at: "2026-07-24T09:25:01Z",
    action: "instance-initiated-shutdown",
    configured_shutdown_behavior: "terminate",
  };
  validateShutdownIntent(
    intent,
    approved,
    launchRecord,
    sourceCommit,
    sourceRunId,
    budgetSha256,
    statusSha256,
  );
  const terminal = {
    schema: "zero.aws_q26r_terminal_observation.v2",
    experiment: approved.id,
    seed: 1,
    instance_id: launchRecord.instance_id,
    identity_sha256: "e".repeat(64),
    observed_at: "2026-07-24T10:00:00Z",
    policy: "purged-not-found",
    aws_state: null,
    aws_error_code: "InvalidInstanceID.NotFound",
  };
  validateTerminalObservation(terminal, approved, launchRecord, terminal.identity_sha256);

  const invalid = structuredClone(terminal);
  invalid.aws_error_code = "AccessDenied";
  let rejected = false;
  try {
    validateTerminalObservation(invalid, approved, launchRecord, terminal.identity_sha256);
  } catch {
    rejected = true;
  }
  assert(rejected, "completion self-test accepted a non-not-found AWS error");
  console.log("Q2.6-R AWS v2 completion self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
  } else if (args[0] === "--verify-seed-provenance") {
    assert(
      args.length === 8,
      "--verify-seed-provenance requires budget, launch, identity, status, intent, terminal, and seed",
    );
    validateSeedProvenanceFiles(
      args[1],
      args[2],
      args[3],
      args[4],
      args[5],
      args[6],
      Number(args[7]),
    );
  } else {
    validateCompletion(args[0], args[1]);
  }
}

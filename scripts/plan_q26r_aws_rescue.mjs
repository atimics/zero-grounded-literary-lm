#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SEEDS = [1, 3];
const EXPERIMENT = "zero4-q26r-aws-v1";
const INSTANCE_TYPE = "c6i.4xlarge";
const BUDGET_FILE = "benchmarks/zero4-q26r-v1/aws-v1/budget.json";
const MAX_INSTANCE_SECONDS = 13620;
const WORKLOAD_TIMEOUT_SECONDS = 13500;
const MAX_COMPUTE_USD = 2.58;
const HOURLY_RATE_USD = 0.68;
const ACTIVE_STATES = new Set(["pending", "running", "stopping"]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function tagMap(instance) {
  return Object.fromEntries(
    (instance?.Tags ?? []).map(({ Key, Value }) => [Key, Value]),
  );
}

function flattenInstances(description) {
  return (description?.Reservations ?? [])
    .flatMap((reservation) => reservation.Instances ?? []);
}

function assessSeedEvidence({
  seed,
  status,
  result,
  overdue,
  sourceCommit,
  budgetSha256,
}) {
  if (!status) {
    return {
      seed,
      status: "missing",
      classification: overdue ? "execution-failure" : "pending",
      reasons: [overdue
        ? "status-missing-after-instance-deadline"
        : "status-not-yet-published"],
      result_present: result.exists,
    };
  }
  if (status.__invalid_json) {
    return {
      seed,
      status: "invalid",
      classification: "execution-failure",
      reasons: ["status-invalid-json"],
      result_present: result.exists,
    };
  }

  const reasons = [];
  const expect = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  expect(status.schema === "zero.aws_q26r_seed_status.v1", "status-schema-mismatch");
  expect(status.experiment === EXPERIMENT, "status-experiment-mismatch");
  expect(status.seed === seed, "status-seed-mismatch");
  expect(status.git_commit === sourceCommit, "status-commit-mismatch");
  expect(status.budget_sha256 === budgetSha256, "status-budget-mismatch");

  if (status.status === "complete") {
    expect(status.exit_code === 0, "complete-status-nonzero-exit");
    expect(status.scientific_result_available === true, "scientific-result-unavailable");
    expect(["go", "no-go"].includes(status.decision), "invalid-scientific-decision");
    expect(
      Number.isInteger(status.observed_instance_seconds)
        && status.observed_instance_seconds <= MAX_INSTANCE_SECONDS,
      "observed-instance-budget-exceeded",
    );
    expect(status.max_instance_seconds === MAX_INSTANCE_SECONDS, "instance-cap-mismatch");
    expect(status.max_compute_usd === MAX_COMPUTE_USD, "compute-cap-mismatch");
    expect(status.training_backend === "OpenBLAS", "training-backend-mismatch");
    expect(status.openblas_threads === 16, "openblas-thread-count-mismatch");
    expect(status.quantity_evaluator_jobs === 16, "quantity-evaluator-job-count-mismatch");
    expect(result.exists, "result-json-missing");
    expect(
      /^[0-9a-f]{64}$/.test(status.result_sha256 ?? ""),
      "result-sha256-missing",
    );
    if (result.exists && /^[0-9a-f]{64}$/.test(status.result_sha256 ?? "")) {
      expect(result.sha256 === status.result_sha256, "result-sha256-mismatch");
    }
    return {
      seed,
      status: status.status,
      decision: status.decision ?? null,
      classification: reasons.length === 0
        ? "scientific-candidate"
        : "execution-failure",
      reasons,
      result_present: result.exists,
      result_sha256: result.sha256 ?? null,
      observed_instance_seconds: status.observed_instance_seconds ?? null,
    };
  }

  if (["budget-exhausted", "infrastructure-error"].includes(status.status)) {
    reasons.push(`structured-${status.status}`);
    return {
      seed,
      status: status.status,
      classification: "execution-failure",
      reasons,
      result_present: result.exists,
      exit_code: status.exit_code ?? null,
      phase: status.phase ?? null,
    };
  }

  reasons.push(`unsupported-status-${status.status ?? "missing"}`);
  return {
    seed,
    status: status.status ?? "invalid",
    classification: overdue ? "execution-failure" : "pending",
    reasons,
    result_present: result.exists,
  };
}

export function buildRescuePlan({
  launch,
  ec2BySeed,
  statusesBySeed,
  resultsBySeed,
  sourceRunId,
  sourceCommit,
  budgetSha256,
  nowEpoch,
}) {
  assert(launch?.schema === "zero.q26r_aws_launch.v1", "launch schema mismatch");
  assert(launch.experiment === EXPERIMENT, "launch experiment mismatch");
  assert(String(launch.ci_run_id) === sourceRunId, "launch run ID mismatch");
  assert(launch.git_commit === sourceCommit, "launch commit mismatch");
  assert(launch.budget_sha256 === budgetSha256, "launch budget mismatch");
  assert(launch.budget_file === BUDGET_FILE, "launch budget file mismatch");
  assert(launch.region === "us-east-1", "launch region mismatch");
  assert(launch.instance_type === INSTANCE_TYPE, "launch instance type mismatch");
  assert(Array.isArray(launch.instances), "launch instances missing");
  assert(
    JSON.stringify(launch.instances.map(({ seed }) => seed)) === "[1,3]",
    "launch seed order mismatch",
  );
  assert(Number.isInteger(nowEpoch) && nowEpoch > 0, "invalid observation epoch");

  const instances = [];
  const evidence = [];
  for (const seed of REQUIRED_SEEDS) {
    const receipt = launch.instances.find((candidate) => candidate.seed === seed);
    assert(receipt, `seed ${seed} launch receipt missing`);
    assert(/^i-[0-9a-f]+$/.test(receipt.instance_id), `seed ${seed} instance ID invalid`);
    assert(
      receipt.max_instance_seconds === MAX_INSTANCE_SECONDS,
      `seed ${seed} instance cap mismatch`,
    );
    assert(
      receipt.max_compute_usd === MAX_COMPUTE_USD,
      `seed ${seed} compute cap mismatch`,
    );

    const records = flattenInstances(ec2BySeed[String(seed)]);
    const instance = records.find(
      (candidate) => candidate.InstanceId === receipt.instance_id,
    ) ?? null;
    const tags = tagMap(instance);
    const expectedTags = {
      Project: "zero",
      Experiment: EXPERIMENT,
      Seed: String(seed),
      Commit: sourceCommit,
      RunId: sourceRunId,
      BudgetSha256: budgetSha256,
      Name: `zero-q26r-seed${seed}`,
      Region: launch.region,
      BudgetFile: launch.budget_file,
      LaunchEpoch: String(receipt.launch_epoch),
      MaxInstanceSeconds: String(MAX_INSTANCE_SECONDS),
      WorkloadTimeoutSeconds: String(WORKLOAD_TIMEOUT_SECONDS),
      MaxComputeUsd: String(MAX_COMPUTE_USD),
      HourlyRateUsd: String(HOURLY_RATE_USD),
    };
    const identityMismatches = [];
    if (!instance) {
      identityMismatches.push("instance-record-missing");
    } else {
      if (instance.InstanceType !== INSTANCE_TYPE) {
        identityMismatches.push(
          `instance-type:${instance.InstanceType ?? "missing"}!=${INSTANCE_TYPE}`,
        );
      }
      for (const [key, expected] of Object.entries(expectedTags)) {
        if (tags[key] !== expected) {
          identityMismatches.push(`tag-${key}:${tags[key] ?? "missing"}!=${expected}`);
        }
      }
    }

    const deadlineEpoch = receipt.launch_epoch + receipt.max_instance_seconds;
    const overdue = nowEpoch >= deadlineEpoch;
    const state = instance?.State?.Name ?? "not-found";
    const identityVerified = identityMismatches.length === 0;
    const terminationAction = overdue
      && identityVerified
      && ACTIVE_STATES.has(state)
      ? "request"
      : "none";

    instances.push({
      seed,
      instance_id: receipt.instance_id,
      state,
      instance_type: instance?.InstanceType ?? null,
      launch_epoch: receipt.launch_epoch,
      deadline_epoch: deadlineEpoch,
      observed_epoch: nowEpoch,
      overdue,
      identity_verified: identityVerified,
      identity_mismatches: identityMismatches,
      expected_tags: expectedTags,
      observed_tags: tags,
      termination_action: terminationAction,
    });

    evidence.push(assessSeedEvidence({
      seed,
      status: statusesBySeed[String(seed)] ?? null,
      result: resultsBySeed[String(seed)] ?? { exists: false },
      overdue,
      sourceCommit,
      budgetSha256,
    }));
  }

  let classification = "pending";
  if (evidence.some((item) => item.classification === "execution-failure")) {
    classification = "execution-failure";
  } else if (evidence.every((item) => item.classification === "scientific-candidate")) {
    classification = "scientific-candidate";
  }

  return {
    schema: "zero.q26r_aws_rescue_plan.v1",
    experiment: EXPERIMENT,
    source_run_id: sourceRunId,
    source_commit: sourceCommit,
    budget_sha256: budgetSha256,
    observed_at: new Date(nowEpoch * 1000).toISOString(),
    observed_epoch: nowEpoch,
    new_training_started_by_rescue: false,
    rescue_waits_for_compute: false,
    instances,
    termination_requests: instances
      .filter(({ termination_action: action }) => action === "request")
      .map(({ seed, instance_id: instanceId }) => ({ seed, instance_id: instanceId })),
    seed_evidence: evidence,
    classification: {
      status: classification,
      scientific_verdict: null,
      frozen_collector_required: classification === "scientific-candidate",
      note: classification === "scientific-candidate"
        ? "Both seeds are candidates only; the frozen collector must verify them."
        : "Rescue classification is execution-only and never a scientific no-go.",
    },
  };
}

export function validateRescueWorkflow(source) {
  const required = [
    "permissions:",
    "contents: read",
    "aws ec2 describe-instances",
    "aws ec2 terminate-instances",
    "aws s3 cp",
    "aws s3 sync",
    "scripts/plan_q26r_aws_rescue.mjs",
    "Termination requested; rescue will not wait",
  ];
  for (const fragment of required) {
    assert(source.includes(fragment), `rescue workflow missing: ${fragment}`);
  }
  const forbidden = [
    [/\brun-instances\b/, "rescue workflow may not launch instances"],
    [/\bstart-instances\b/, "rescue workflow may not start instances"],
    [/\baws ec2 wait\b/, "rescue workflow may not wait for EC2"],
    [/\bsleep\s+[0-9]/, "rescue workflow may not sleep"],
    [/train_zero4_q26/, "rescue workflow may not invoke training"],
    [/q26r-seed\.sh/, "rescue workflow may not invoke the seed workload"],
    [/contents:\s*write/, "rescue workflow may not write repository contents"],
  ];
  for (const [pattern, message] of forbidden) {
    assert(!pattern.test(source), message);
  }
}

function fixtureLaunch() {
  return {
    schema: "zero.q26r_aws_launch.v1",
    experiment: EXPERIMENT,
    ci_run_id: "30047634061",
    git_commit: "a".repeat(40),
    budget_sha256: "b".repeat(64),
    budget_file: BUDGET_FILE,
    region: "us-east-1",
    instance_type: INSTANCE_TYPE,
    instances: REQUIRED_SEEDS.map((seed) => ({
      seed,
      instance_id: `i-${String(seed).repeat(8)}`,
      launch_epoch: 1000 + seed,
      max_instance_seconds: MAX_INSTANCE_SECONDS,
      max_compute_usd: MAX_COMPUTE_USD,
    })),
  };
}

function fixtureEc2(launch) {
  return Object.fromEntries(launch.instances.map((receipt) => [
    String(receipt.seed),
    {
      Reservations: [{
        Instances: [{
          InstanceId: receipt.instance_id,
          InstanceType: INSTANCE_TYPE,
          State: { Name: "running" },
          Tags: Object.entries({
            Project: "zero",
            Experiment: EXPERIMENT,
            Seed: String(receipt.seed),
            Commit: launch.git_commit,
            RunId: String(launch.ci_run_id),
            BudgetSha256: launch.budget_sha256,
            Name: `zero-q26r-seed${receipt.seed}`,
            Region: launch.region,
            BudgetFile: launch.budget_file,
            LaunchEpoch: String(receipt.launch_epoch),
            MaxInstanceSeconds: String(MAX_INSTANCE_SECONDS),
            WorkloadTimeoutSeconds: String(WORKLOAD_TIMEOUT_SECONDS),
            MaxComputeUsd: String(MAX_COMPUTE_USD),
            HourlyRateUsd: String(HOURLY_RATE_USD),
          }).map(([Key, Value]) => ({ Key, Value })),
        }],
      }],
    },
  ]));
}

function fixtureStatuses(launch) {
  return Object.fromEntries(REQUIRED_SEEDS.map((seed) => [
    String(seed),
    {
      schema: "zero.aws_q26r_seed_status.v1",
      experiment: EXPERIMENT,
      seed,
      status: "complete",
      exit_code: 0,
      git_commit: launch.git_commit,
      budget_sha256: launch.budget_sha256,
      scientific_result_available: true,
      decision: seed === 1 ? "go" : "no-go",
      max_instance_seconds: MAX_INSTANCE_SECONDS,
      max_compute_usd: MAX_COMPUTE_USD,
      observed_instance_seconds: 12000,
      training_backend: "OpenBLAS",
      openblas_threads: 16,
      quantity_evaluator_jobs: 16,
      result_sha256: "c".repeat(64),
    },
  ]));
}

function selfTest() {
  const launch = fixtureLaunch();
  const ec2 = fixtureEc2(launch);
  const statuses = fixtureStatuses(launch);
  const results = {
    "1": { exists: true, sha256: "c".repeat(64) },
    "3": { exists: true, sha256: "c".repeat(64) },
  };
  const base = {
    launch,
    ec2BySeed: ec2,
    statusesBySeed: statuses,
    resultsBySeed: results,
    sourceRunId: String(launch.ci_run_id),
    sourceCommit: launch.git_commit,
    budgetSha256: launch.budget_sha256,
    nowEpoch: 20000,
  };

  const candidate = buildRescuePlan(base);
  assert(candidate.classification.status === "scientific-candidate", "candidate failed");
  assert(candidate.termination_requests.length === 2, "overdue instances not selected");

  const mismatchedEc2 = structuredClone(ec2);
  mismatchedEc2["1"].Reservations[0].Instances[0].Tags
    .find(({ Key }) => Key === "Project").Value = "other";
  const mismatch = buildRescuePlan({ ...base, ec2BySeed: mismatchedEc2 });
  assert(
    mismatch.termination_requests.every(({ seed }) => seed !== 1),
    "identity mismatch allowed termination",
  );

  const exhaustedStatuses = structuredClone(statuses);
  exhaustedStatuses["3"].status = "budget-exhausted";
  exhaustedStatuses["3"].exit_code = 124;
  exhaustedStatuses["3"].scientific_result_available = false;
  const exhausted = buildRescuePlan({
    ...base,
    statusesBySeed: exhaustedStatuses,
  });
  assert(exhausted.classification.status === "execution-failure", "timeout misclassified");

  const missing = buildRescuePlan({
    ...base,
    statusesBySeed: { "1": statuses["1"] },
  });
  assert(missing.classification.status === "execution-failure", "missing status accepted");

  const invalid = buildRescuePlan({
    ...base,
    statusesBySeed: { ...statuses, "3": { __invalid_json: true } },
  });
  assert(invalid.classification.status === "execution-failure", "invalid status accepted");

  const pending = buildRescuePlan({
    ...base,
    statusesBySeed: {},
    nowEpoch: 1100,
  });
  assert(pending.classification.status === "pending", "pre-deadline status misclassified");
  assert(pending.termination_requests.length === 0, "pre-deadline termination selected");

  const workflowFixture = `
permissions:
  contents: read
run: |
  aws ec2 describe-instances
  aws ec2 terminate-instances
  aws s3 cp
  aws s3 sync
  node scripts/plan_q26r_aws_rescue.mjs
  echo "Termination requested; rescue will not wait"
`;
  validateRescueWorkflow(workflowFixture);
  let forbiddenLaunchRejected = false;
  try {
    validateRescueWorkflow(`${workflowFixture}\nrun-instances\n`);
  } catch {
    forbiddenLaunchRejected = true;
  }
  assert(forbiddenLaunchRejected, "launching workflow passed static policy");

  console.log("Q2.6-R AWS rescue planner self-test passed");
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(key?.startsWith("--") && value !== undefined, `invalid argument ${key ?? ""}`);
    values[key.slice(2)] = value;
  }
  return values;
}

function readJsonIfPresent(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { __invalid_json: true };
  }
}

function main(argv) {
  if (argv.length === 1 && argv[0] === "--self-test") {
    selfTest();
    return;
  }
  if (argv.length === 2 && argv[0] === "--check-workflow") {
    validateRescueWorkflow(fs.readFileSync(argv[1], "utf8"));
    console.log(`OK Q2.6-R AWS rescue workflow: ${argv[1]}`);
    return;
  }
  const args = parseArgs(argv);
  for (const required of [
    "launch",
    "ec2-dir",
    "evidence-dir",
    "out",
    "source-run-id",
    "source-commit",
    "budget-sha256",
    "now-epoch",
  ]) {
    assert(args[required], `missing --${required}`);
  }
  assert(/^[0-9]+$/.test(args["source-run-id"]), "invalid source run ID");
  assert(/^[0-9a-f]{40}$/.test(args["source-commit"]), "invalid source commit");
  assert(/^[0-9a-f]{64}$/.test(args["budget-sha256"]), "invalid budget hash");

  const ec2BySeed = {};
  const statusesBySeed = {};
  const resultsBySeed = {};
  for (const seed of REQUIRED_SEEDS) {
    ec2BySeed[String(seed)] = JSON.parse(fs.readFileSync(
      path.join(args["ec2-dir"], `seed${seed}-ec2.json`),
      "utf8",
    ));
    statusesBySeed[String(seed)] = readJsonIfPresent(
      path.join(args["evidence-dir"], `seed${seed}-status.json`),
    );
    const resultFile = path.join(
      args["evidence-dir"],
      `seed${seed}-results`,
      "result.json",
    );
    resultsBySeed[String(seed)] = fs.existsSync(resultFile)
      ? { exists: true, sha256: sha256(resultFile) }
      : { exists: false };
  }

  const plan = buildRescuePlan({
    launch: JSON.parse(fs.readFileSync(args.launch, "utf8")),
    ec2BySeed,
    statusesBySeed,
    resultsBySeed,
    sourceRunId: args["source-run-id"],
    sourceCommit: args["source-commit"],
    budgetSha256: args["budget-sha256"],
    nowEpoch: Number(args["now-epoch"]),
  });
  fs.writeFileSync(args.out, `${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

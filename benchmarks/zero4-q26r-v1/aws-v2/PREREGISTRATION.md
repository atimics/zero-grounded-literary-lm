# Q2.6-R AWS replacement preregistration

## Status

Frozen recovery design, **authorized once for launch** on 2026-07-24.

The first v2 control-plane attempt, workflow run `30117320329`, failed before
training because the launch checked an EC2 shutdown attribute in the wrong AWS
API response. It acquired the original execution lock, created only the seed 1
instance, and terminated that instance immediately after identity capture
failed. Seed 3 was never created. No launch receipt, identity receipt, worker
status, candidate result, or scientific observation was published. The
immutable [`preflight failure record`](preflight-failure-30117320329.json)
records that boundary.

One reviewed recovery is authorized. It must validate the original lock and
the absence of all failed-run receipts, then acquire the write-once
`recovery-1.lock`. No subsequent recovery is authorized.

## Why a replacement is admissible

The prior route produced two candidate outputs, but neither became a scientific
observation: its frozen collector could not reproduce mandatory EC2 identity
checks after AWS purged the terminated instance records. The durable
[`execution failure record`](../aws-v1/execution-failure-30047634061.json)
sets `scientific_result_observed` and `scientific_result_accepted` to false and
leaves family inference null.

The candidate decisions are disclosed as seed 1 `go` and seed 3 `go`. They
cannot change the intervention, seeds, stopping rules, thresholds, checker,
aggregation rule, or promotion candidate. Their artifacts are forbidden as
inputs to the replacement execution. Only their launch-relative runtimes and
costs inform the new execution cap.

This is a replacement for failed execution, not a duplicate accepted
observation. It is permitted only while no accepted result exists for either
replication seed.

## Frozen science

The scientific contract remains
[`zero4-q26r-v1`](../contract.json), byte-locked through the original
`aws-v1/budget.json`. Seeds remain exactly 1 and 3 on independent instances.
Both execute regardless of the first decision. The Q2.6 intervention,
initialization, teachers, corpora, optimizer, attempt budgets, cadence,
authorities, thresholds, exactly-once promotion split, frozen checker, and
three-seed family conjunction are unchanged.

## Budget

The slower prior candidate completed in 5,143 launch-relative seconds. A 20%
contingency requires 6,171.6 seconds. The original v2 authorization allowed
6,300 seconds and $1.19 per seed, or 12,600 seconds and $2.38 combined.

The failed preflight reserves AWS's 60-second billing minimum, or
$0.011333333333333334 at $0.68/hour. The recovery deducts more than that amount
while preserving the 6,180-second workload timeout:

- per recovery seed: 6,240 instance-seconds and $1.18;
- recovery combined: 12,480 instance-seconds and $2.36;
- all-in maximum including failed preflight: 12,540 seconds and
  $2.3713333333333333;
- maximum concurrency: two `c6i.4xlarge` instances;
- no budget transfer between seeds.

The remaining 60 seconds per recovery seed are reserved for publication. Each
instance retains a local launch-relative watchdog and terminates itself.

## Durable provenance

The launch control plane must capture a canonical identity receipt for each
seed immediately after creation. Instance identity and tags come from
`DescribeInstances`; configured shutdown behavior comes from
`DescribeInstanceAttribute(instanceInitiatedShutdownBehavior)`. Each receipt
contains the instance ID, type, AMI, launch time, state, selected identity
tags, shutdown behavior, and source/budget bindings. It is written once to S3
and its SHA-256 is bound into the immutable launch receipt.

Each worker binds its instance ID into its structured status and publishes a
write-once shutdown intent before requesting instance-initiated termination.
The collector never waits and never starts compute. It accepts either:

1. a live AWS terminal state whose identity still matches the receipt; or
2. an exact `InvalidInstanceID.NotFound` response after the immutable launch
   identity, shutdown intent, status, and result hashes all validate.

Permission errors, network errors, empty or malformed evidence, live
`pending`/`running` state, and identity drift fail closed as execution
failures—not scientific no-go results.

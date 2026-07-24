# Q2.6-R AWS replacement preregistration

## Status

Frozen execution design, **not authorized for launch**.

This registration defines one possible replacement execution for the failed
`zero4-q26r-aws-v1` route. It does not launch compute. A later, reviewable
authorization change must set both approval fields in `budget.json` before the
launch workflow can pass its fail-closed budget check.

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
contingency requires 6,171.6 seconds; the new independent per-seed cap rounds
up to 6,300 seconds with a 120-second publication reserve:

- per seed: 6,300 instance-seconds and $1.19;
- combined: 12,600 instance-seconds and $2.38;
- maximum concurrency: two `c6i.4xlarge` instances;
- no budget transfer between seeds.

The workload timeout is 6,180 seconds. Each instance retains a local
launch-relative watchdog and terminates itself.

## Durable provenance

The launch control plane must capture a canonical AWS `DescribeInstances`
identity receipt for each seed immediately after creation. Each receipt
contains the instance ID, type, AMI, launch time, state, selected identity
tags, and source/budget bindings. It is written once to S3 and its SHA-256 is
bound into the immutable launch receipt.

Each worker binds its instance ID into its structured status and publishes a
write-once shutdown intent before requesting instance-initiated termination.
The collector never waits and never starts compute. It accepts either:

1. a live AWS terminal state whose identity still matches the receipt; or
2. an exact `InvalidInstanceID.NotFound` response after the immutable launch
   identity, shutdown intent, status, and result hashes all validate.

Permission errors, network errors, empty or malformed evidence, live
`pending`/`running` state, and identity drift fail closed as execution
failures—not scientific no-go results.

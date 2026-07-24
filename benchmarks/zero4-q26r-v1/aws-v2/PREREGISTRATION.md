# Q2.6-R AWS replacement preregistration

## Status

Frozen corrective recovery-3 design, **authorized once for launch** on
2026-07-24.

The first v2 control-plane attempt, workflow run `30117320329`, failed before
training because the launch checked an EC2 shutdown attribute in the wrong AWS
API response. It acquired the original execution lock, created only the seed 1
instance, and terminated that instance immediately after identity capture
failed. Seed 3 was never created. No launch receipt, identity receipt, worker
status, candidate result, or scientific observation was published. The
immutable [`preflight failure record`](preflight-failure-30117320329.json)
records that boundary.

Recovery workflow run `30118477546` then failed before training because the
GitHub Actions role lacked `ec2:DescribeInstanceAttribute`. It validated the
original lock, acquired `recovery-1.lock`, created only seed 1 instance
`i-093224aa4a67fb5d7`, and terminated it immediately when AWS returned
`UnauthorizedOperation`. Seed 3 was never created, and no launch, identity,
status, shutdown, candidate, or scientific record was published. The immutable
[`second preflight failure record`](preflight-failure-30118477546.json) freezes
that boundary.

Recovery-2 workflow run `30119938666` passed the IAM preflight, acquired
`recovery-2.lock`, and froze both AWS identities. Both workers then failed
before training because the bootstrap retained a stale literal assertion for
the former `$1.18` cost cap after the frozen budget changed to `$1.17`. The
instances terminated after 80 and 87 launch-relative seconds with immutable
`infrastructure-error` statuses and shutdown intents. No candidate or
scientific result was published. The immutable
[`bootstrap failure record`](bootstrap-failure-30119938666.json) freezes the
receipts, hashes, classification, and billing.

One corrective recovery-3 is authorized. It must execute a regression check
that binds every bootstrap cap guard to `budget.json`, validate all three prior
locks and the recovery-2 failure receipts, prove both prior result objects are
absent, and acquire write-once `recovery-3.lock`. No subsequent recovery is
authorized.

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

The two failed preflights reserve 120 seconds and $0.02266666666666667. The
failed recovery-2 workers add 167 observed seconds and
$0.031544444444444444. Cumulative failed execution is therefore 287 seconds
and $0.05421111111111111. Recovery-3 keeps the existing per-seed cap:

- per recovery seed: 6,190 instance-seconds and $1.17;
- workload timeout per seed: 6,130 seconds;
- recovery combined: 12,380 instance-seconds and $2.34;
- all-in maximum including all three failed launches: 12,667 seconds and
  $2.394211111111111;
- explicitly approved expansion above the original envelope: 67 seconds and
  $0.014211111111111241;
- maximum concurrency: two `c6i.4xlarge` instances;
- no budget transfer between seeds.

The final 60 seconds per recovery seed are reserved for publication. Each
instance retains a local launch-relative watchdog and terminates itself.

## Durable provenance

The launch control plane must capture a canonical identity receipt for each
seed immediately after creation. Instance identity and tags come from
`DescribeInstances`; configured shutdown behavior comes from
`DescribeInstanceAttribute(instanceInitiatedShutdownBehavior)`. Each receipt
contains the instance ID, type, AMI, launch time, state, selected identity
tags, shutdown behavior, and source/budget bindings. It is written once to S3
and its SHA-256 is bound into the immutable launch receipt.

The IAM policy adds only `ec2:DescribeInstanceAttribute`. A dedicated manual
workflow and the launcher both require `DryRunOperation` from the attribute
API before the launcher may publish inputs, acquire `recovery-3.lock`, or call
`RunInstances`. The executable workflow checker also rejects any bootstrap
cost guard that differs from the frozen `$1.17` budget value.

Each worker binds its instance ID into its structured status and publishes a
write-once shutdown intent before requesting instance-initiated termination.
The collector never waits and never starts compute. It accepts either:

1. a live AWS terminal state whose identity still matches the receipt; or
2. an exact `InvalidInstanceID.NotFound` response after the immutable launch
   identity, shutdown intent, status, and result hashes all validate.

Permission errors, network errors, empty or malformed evidence, live
`pending`/`running` state, and identity drift fail closed as execution
failures—not scientific no-go results.

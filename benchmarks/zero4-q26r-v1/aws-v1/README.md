# Q2.6-R bounded AWS execution

Status: **authorization consumed; execution/provenance failure**, 2026-07-24.

This addendum supersedes only the cancelled execution route described in
`../AWS-EXECUTION.md`. It does not change the preregistered Q2.6-R scientific
contract, driver, checker, seed identities, stop rules, gates, or family rule.

The authorization covers one combined launch of seeds 1 and 3. Each seed runs
on its own ephemeral AWS `c6i.4xlarge` instance and has an independent hard
limit of 13,620 instance-seconds (3h47m) and $2.58. The two instances may run
concurrently. Their combined hard ceiling is 27,240 instance-seconds (7h34m)
and $5.16. Unused capacity from one seed cannot extend the other.

GitHub Actions is the short-lived control plane only: it validates the
immutable budget, acquires a one-time S3 lock, publishes the source archive,
and launches both instances. The long computation runs entirely on AWS.
Each instance enforces its own launch-relative watchdog, publishes a
structured status and results to S3, and terminates itself.

The runtime envelope differs from the frozen science source only by using the
measured OpenBLAS training path and the deterministic 16-process quantity
evaluator. The calibration demonstrated byte-identical serial and parallel
JSON and projected 11,347.597 seconds per seed. The hard cap adds 20 percent
contingency.

Both seeds must execute even if the first resolves no-go. A valid no-go is a
scientific result; timeout, missing output, source drift, duplicate execution,
or infrastructure failure is not.

## Rescue path

Launch workflow run `30047634061` consumed the authorization. Its original
collector could not get past an opaque EC2 validation gate after the instance
deadlines, so repeated collection retries were stopped.

The manual `q26r-aws-rescue.yml` workflow is execution recovery only. It reads
the immutable launch receipt, prints exact EC2 state and identity evidence,
recovers S3 statuses and result files before remediation, and requests
termination only for active instances that are both overdue and an exact match
for the receipt's type and identity tags. It never starts training and never
waits for compute.

The rescue planner may classify the evidence as `execution-failure`, `pending`,
or `scientific-candidate`. It never emits a scientific verdict. Candidate
results still require the frozen collector, both seed checks, completion
validation, the family aggregate, and green CI before merge.

Rescue run
[`30074006670`](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/30074006670)
recovered complete, in-budget `go` candidates for both seeds: seed 1 used
4,993 seconds/$0.9431 and seed 3 used 5,143 seconds/$0.9715. No training was
started and no termination was needed because both EC2 records were already
absent.

Frozen collector run
[`30074369466`](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/30074369466)
then failed closed. AWS had already purged the terminated instance records, so
the collector could no longer reproduce the mandatory instance-type,
terminal-state, and identity-tag checks. The scientific acceptance rule will
not be weakened after observing the candidate decisions. Both candidates
therefore remain unaccepted, no family inference is made, and this is
explicitly not a scientific no-go. See the durable
[`execution failure record`](execution-failure-30047634061.json).

The one-time authorization is consumed. Any new Q2.6-R execution requires a
new preregistration and budget with provenance captured before ephemeral EC2
records expire.

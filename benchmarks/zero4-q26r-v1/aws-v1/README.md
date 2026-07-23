# Q2.6-R bounded AWS execution

Status: **authorized, not yet consumed**, 2026-07-23.

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

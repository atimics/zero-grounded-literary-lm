# Q2.6-R execution-venue addendum

Status: **frozen before a valid seed-1 or seed-3 result is observed**.

The scientific source remains commit
`3ee802c29ddf47982477a6b6dd635eaedede7bb7`. Its contract, trainer, checker,
budgets, seeds, authorities, gates, and family rule are unchanged.

Valid Q2.6-R replication evidence must be produced by the repository AWS
workflow, one seed per dispatch and one ephemeral `c6i.4xlarge` CPU instance
per seed. The workflow assumes the
repository's AWS role through GitHub OIDC, restores hash-verified private
assets from S3, archives the frozen science commit, records the AWS instance
and workflow provenance, uploads results before shutdown, and terminates the
instance. The orchestration commit is recorded separately from the science
commit.

Two laptop attempts on 2026-07-19 are quarantined as infrastructure incidents:

- seed 1 failed before training when the macOS sandbox denied Clang a temporary
  file;
- seed 3 was interrupted during training as soon as the venue error was
  identified.

Neither attempt is a valid Q2.6-R observation, neither enters the family
aggregate, and neither authorizes a result claim. Seeds 1 and 3 remain
unobserved until their AWS executions complete.

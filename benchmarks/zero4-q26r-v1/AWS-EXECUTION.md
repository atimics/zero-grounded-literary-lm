# Q2.6-R execution-venue addendum

Status: **execution cancelled before a valid seed-1 or seed-3 result was
observed**, 2026-07-23.

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
aggregate, and neither authorizes a result claim. Seeds 1 and 3 remained
unobserved; their final execution disposition is recorded below.

## Seed-1 observer recovery freeze

GitHub Actions run `29781044890` launched seed 1 on instance
`i-091c1816db3c758a4` from orchestration commit
`b6ee1a1ec20bb06ec37a92d073c3bbd970484387`. At 2026-07-20 22:40:25 UTC,
the Actions observer's default one-hour OIDC session expired while the EC2
instance was still running. At the time this recovery rule was frozen, S3
contained only the immutable source archive and training script: no status,
metric, decision, or result artifact had been observed.

At that point seed 1 could not be rerun. After that exact instance reached a
terminal state, a short collection workflow could read its source-run prefix,
but first had to verify the instance's Project, Experiment, Seeds, Commit, and
RunId tags. It could accept the computation only if the instance uploaded a
successful structured status, the frozen Q2.6-R checker accepted the seed
result, and provenance recorded both the failed dispatch observer and
collection workflow. Collection started no training and never waited on a
running instance. Any remote failure, missing artifact, tag mismatch, or
checker failure resolved as an execution failure rather than scientific go or
no-go evidence.

## Final execution outcome

A corrected dispatch, GitHub Actions run `29837585360`, launched seed 1 on
instance `i-01ea4ddc5f8238ef2`. The frozen science source built the portable C
Linux path because commit `3ee802c` predates OpenBLAS support. The instance
reached its independent 11-hour limit at 2026-07-22 01:07:57 UTC before
publishing a structured seed result and then shut down. The later collection
attempt could recover console diagnostics but no valid scientific artifact.

The exact failure is frozen in
`execution-failure-29837585360.json`. It leaves seed 1 scientifically
unobserved. Seed 3 was not launched.

On 2026-07-23 the remaining Q2.6-R execution was cancelled for cost. The
unbudgeted long-run workflow was retired. Further scientific execution now
requires measured OpenBLAS throughput and a separately authorized budget; the
only executable next stage is the five-minute diagnostic calibration in
`benchmarks/openblas-calibration-v1/budget.json`.

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

## Seed-1 observer recovery freeze

GitHub Actions run `29781044890` launched seed 1 on instance
`i-091c1816db3c758a4` from orchestration commit
`b6ee1a1ec20bb06ec37a92d073c3bbd970484387`. At 2026-07-20 22:40:25 UTC,
the Actions observer's default one-hour OIDC session expired while the EC2
instance was still running. At the time this recovery rule was frozen, S3
contained only the immutable source archive and training script: no status,
metric, decision, or result artifact had been observed.

Seed 1 must not be rerun. A recovery collector may wait on that exact instance
and source run, but it must verify the instance's Project, Experiment, Seeds,
Commit, and RunId tags before reading artifacts. It may accept the computation
only if the instance uploads a successful structured status, the frozen Q2.6-R
checker accepts the seed result, and provenance records both the failed
observer and recovery collector. The collector starts no training. Any remote
failure, missing artifact, tag mismatch, or checker failure resolves as an
execution failure rather than scientific go or no-go evidence.

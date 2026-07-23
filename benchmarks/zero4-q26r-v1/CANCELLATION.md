# Q2.6-R execution cancellation

Status: **historical execution route cancelled for cost before any valid
replication result**,
2026-07-23.

AWS seed 1 ran the frozen science commit on `c6i.4xlarge` instance
`i-01ea4ddc5f8238ef2` and reached the runner's 11-hour wall-clock limit. The
frozen commit used the portable C Linux backend, not OpenBLAS, and produced no
structured seed result before shutdown. This is an execution failure, not
scientific evidence for go or no-go.

Seed 3 was never launched. Seed 1 remains scientifically unobserved. The
all-three-seeds family conjunction therefore remains unresolved and ZERO.3
remains current.

The long unbudgeted dispatch workflow is retired. No Q2.6-R seed may be
launched through it. The subsequent diagnostic calibrations completed without
making a scientific claim. Their measured throughput supports the separately
approved [`zero4-q26r-aws-v1`](aws-v1/README.md) combined budget, which
supersedes only this failed execution route and leaves the frozen scientific
contract unchanged.

The machine-readable execution record is
[`execution-failure-29837585360.json`](execution-failure-29837585360.json).

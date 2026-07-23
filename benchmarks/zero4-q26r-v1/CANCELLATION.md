# Q2.6-R execution cancellation

Status: **cancelled for cost before any valid replication result**,
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
launched through it. The diagnostic calibration completed, and the next
executable experiment is the diagnostic-only
[`openblas-pilot-v1`](../openblas-pilot-v1/README.md), capped at 15 EC2 minutes,
100 optimizer attempts, and $0.17. A full replication requires a new,
explicitly approved budget after that pilot publishes sustained throughput.

The machine-readable execution record is
[`execution-failure-29837585360.json`](execution-failure-29837585360.json).

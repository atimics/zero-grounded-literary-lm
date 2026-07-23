# OpenBLAS calibration v1

Status: **calibration complete; execution authorization consumed**.

This is the bounded performance experiment that must run before any further
ZERO.4 replication. It asks whether the current Linux OpenBLAS build can
execute the real Q2.6 cumulative-tangent optimizer cheaply enough to justify a
larger AWS budget. It cannot produce a scientific go, no-go, replication, or
promotion decision.

The original calibration authorization is frozen in [`budget.json`](budget.json):

| Stage | EC2 wall cap | Compute cap | Executable now |
| --- | ---: | ---: | :---: |
| CI | 0 seconds | $0.00 | yes |
| calibration | 5 minutes | $0.06 | yes |
| pilot | 15 minutes | $0.17 | no — manual authorization required |
| full | 2 hours | $1.36 | no — manual authorization required |

The calibration uses one `c6i.4xlarge` in `us-east-1`, OpenBLAS with 16
threads, seed 89, batch 2, and at most eight real Q2.6 acquisition attempts.
Seed 89 makes the run diagnostic rather than a Q2.6-R replication. The result
reports cold-start time, completed attempt count, measured attempt throughput,
and projected 1,400-attempt time and compute cost when enough work completes.

The first charged execution, GitHub Actions run `30003225539`, reached
OpenBLAS but failed before an optimizer attempt because the runner supplied
the unsupported transaction phase `calibration`. Its immutable
[`execution failure record`](execution-failure-30003225539.json) charges the
full 107 seconds from launch request to termination against this calibration.
It is an infrastructure failure, not a scientific result.

The one authorized retry is frozen in
[`retry-1-budget.json`](retry-1-budget.json). It corrects the phase to
`acquisition` and preserves the original cumulative authorization:

| Charge window | Instance ceiling | Raw compute at $0.68/hour |
| --- | ---: | ---: |
| consumed by run 30003225539 | 107 seconds | $0.020211 |
| retry-1 maximum | 190 seconds | $0.035889 |
| cumulative maximum | 297 seconds | $0.056100 |
| original authorization | 300 seconds | $0.06 declared cap |

GitHub Actions run
[`30003995100`](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/30003995100)
consumed that retry. The immutable
[`launch`](launch-30003995100.json),
[`status`](status-30003995100.json), and
[`result`](result-30003995100.json) records show:

| Measurement | Observed |
| --- | ---: |
| backend | OpenBLAS, 16 threads |
| cold start | 96 seconds |
| optimizer attempts | 8 of 8 |
| measured training wall | 59 seconds |
| throughput | 0.135593 attempts/second |
| projected 1,400-attempt wall | 10,325 seconds (2h 52m 5s) |
| projected 1,400-attempt compute | $1.9503 |

The `budget-exhausted` status is the expected bounded outcome: all eight
diagnostic attempts completed, and the measurement process was stopped at its
publication deadline. AWS reported OpenBLAS, the result verifier passed, and
the instance was terminated. These figures exclude cold start from the
1,400-attempt projection and cannot support scientific inference.

The workflow now refuses another launch when the committed result record is
present. A pilot or full run requires a new explicit budget and authorization.

Run the local contract check with:

```sh
make experiment-budget-check
```

The AWS workflow is `.github/workflows/openblas-calibration.yml`. It performs
only short orchestration and observation in GitHub Actions; all measured
computation runs on EC2.

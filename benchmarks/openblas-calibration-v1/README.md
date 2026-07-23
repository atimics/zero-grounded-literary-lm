# OpenBLAS calibration v1

Status: **preregistered; bounded retry only**.

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

The only executable retry is frozen in
[`retry-1-budget.json`](retry-1-budget.json). It corrects the phase to
`acquisition` and preserves the original cumulative authorization:

| Charge window | Instance ceiling | Raw compute at $0.68/hour |
| --- | ---: | ---: |
| consumed by run 30003225539 | 107 seconds | $0.020211 |
| retry-1 maximum | 190 seconds | $0.035889 |
| cumulative maximum | 297 seconds | $0.056100 |
| original authorization | 300 seconds | $0.06 declared cap |

Three independent limits protect the retry:

1. the GitHub observer terminates the instance 190 seconds after the launch
   request began;
2. EC2 user data starts a local 190-second shutdown watchdog; and
3. the workload gets at most 130 seconds, reserving the balance for result
   publication and shutdown.

If bootstrap consumes the whole budget, that is a valid calibration outcome:
the cold-start path is too expensive for this calibration and should
be replaced by a baked AMI before requesting a pilot.

Run the local contract check with:

```sh
make experiment-budget-check
```

The AWS workflow is `.github/workflows/openblas-calibration.yml`. It performs
only short orchestration and observation in GitHub Actions; all measured
computation runs on EC2.

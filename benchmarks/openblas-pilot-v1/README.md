# OpenBLAS pilot v1

Status: **preregistered; one AWS execution authorized**.

This pilot tests whether the short OpenBLAS calibration extrapolates over a
longer diagnostic window. It runs the real Q2.6 cumulative-tangent acquisition
path for at most 100 optimizer attempts on one `c6i.4xlarge` in `us-east-1`.
Seed 89 and `scientific_inference_allowed: false` prevent the output from being
treated as a Q2.6-R replication or promotion result.

The immutable [`budget.json`](budget.json) authorizes:

| Bound | Maximum |
| --- | ---: |
| EC2 launch-to-termination window | 900 seconds |
| workload window | 840 seconds |
| compute charge at $0.68/hour | $0.17 |
| optimizer attempts | 100 |
| OpenBLAS threads | 16 |

The calibration completed eight attempts in 59 seconds after a 96-second cold
start. Linear extrapolation predicts 737.5 seconds of training and 833.5
seconds total for this pilot, leaving 66.5 seconds under the absolute instance
cap. The workflow and EC2 bootstrap independently enforce the 900-second cap;
the workload keeps a separate publication reserve. An atomic S3 execution
lock is acquired before EC2 launch, so duplicate dispatches cannot spend the
one-time authorization twice.

A complete or budget-exhausted pilot is a valid diagnostic outcome. Neither
outcome authorizes the 1,400-attempt run. That requires a new explicit budget,
manual authorization, and scientific preregistration.

Run the local contract checks with:

```sh
make experiment-budget-check
```

# Q2.6 end-to-end OpenBLAS calibration v1

Status: **preregistered and authorized for one diagnostic AWS execution**.

The optimizer-only pilot established sustained OpenBLAS throughput, but it did
not run the Q2.6 driver's baseline, recovery, and full evaluations. This
calibration measures those costs before any Q2.6-R scientific compute is
authorized.

The workload is deliberately separate from
`scripts/train_zero4_q26.mjs`. It locks that file and the Q2.6 scientific
contract by SHA-256, reuses the same commands and frozen inputs, runs only
diagnostic seed 89, and cannot emit a Q2.6 scientific result.

The immutable [`budget.json`](budget.json) authorizes:

| Bound | Maximum |
| --- | ---: |
| EC2 launch-to-termination window | 1,500 seconds |
| workload window | 1,440 seconds |
| compute charge at $0.68/hour | $0.29 |
| acquisition optimizer attempts | 100 |
| recovery cadence | every 25 committed updates |
| full evaluation cadence | update 100 |
| promotion evaluations | 0 |
| OpenBLAS threads | 16 |

One baseline sentinel replay and one baseline full replay run before training.
At committed updates 25, 50, 75, and 100, the calibration performs the same
sentinel quantity and replay operations as Q2.6. At update 100 it additionally
performs the same public quantity and full replay operations. If rejected
optimizer attempts prevent a cadence boundary from being reached, the
structured result records that fact and cannot claim a complete calibration.

The workflow and the EC2 bootstrap independently enforce the 1,500-second
instance cap. The workload reserves time for result publication. An atomic S3
execution lock prevents the one-time authorization from being spent twice.

This execution cannot support scientific inference or seed selection. Its only
output is a component-level runtime and cost projection for budgeting both
prospectively authorized Q2.6-R seeds together.

Validate the authorization locally without running the workload:

```sh
node scripts/check_q26_e2e_calibration_budget.mjs \
  benchmarks/openblas-e2e-calibration-v1/budget.json
```

# Q2.6 end-to-end OpenBLAS calibration v1

Status: **calibration complete; execution authorization consumed**.

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

GitHub Actions run
[`30023119249`](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/30023119249)
consumed the authorization. Its immutable
[`launch`](launch-30023119249.json),
[`status`](status-30023119249.json), and
[`result`](result-30023119249.json) records show:

| Measurement | Observed |
| --- | ---: |
| backend | OpenBLAS, 16 threads |
| cold start, assets, and build | 92 seconds |
| optimizer attempts/commits | 100/100 |
| optimizer transactions | 705.382 seconds |
| four recovery checkpoints | 0.536 seconds |
| four 64-case sentinel quantity evaluations | 407.543 seconds |
| four sentinel replay evaluations | 11.104 seconds |
| full 500-case evaluations completed | 0 |
| total observed instance time | 1,465 seconds |
| bounded outcome | budget exhausted |

The optimizer completed with stable 25-attempt transaction times, but the
quantity evaluator averaged 101.886 seconds per 64-case sentinel evaluation.
The update-100 500-case public evaluation began but did not finish before the
workload deadline. This is the calibration's central result: evaluation, not
OpenBLAS training, now dominates the projected Q2.6-R budget.

The evaluator processes cases serially. Scaling the measured 64-case time to
the frozen 500-case public split gives an estimated 795.982 seconds per public
quantity evaluation. Combining the observed components with the frozen
1,400-attempt, 56-sentinel, and 14-full-evaluation maximum gives a planning
estimate of approximately 27,934 seconds (7h45m34s) and $5.28 per seed, or
15h31m08s and $10.55 for both seeds, before contingency. This estimate is for
budget planning only because the full evaluation did not complete.

The workflow verified the bounded result, requested termination within the
authorization, AWS confirmed instance `i-0f132bf708d66708f` terminated, and a
post-run audit found no active ZERO instances. The `COMPLETED` sentinel and S3
execution lock close the one-time launch path.

This execution cannot support scientific inference or seed selection. The
next engineering target is the serial quantity evaluator. Q2.6-R must remain
unauthorized until evaluation throughput is improved or an explicit combined
two-seed budget with contingency is approved.

Validate the budget and immutable result locally without running the workload:

```sh
node scripts/check_q26_e2e_calibration_budget.mjs \
  benchmarks/openblas-e2e-calibration-v1/budget.json
```

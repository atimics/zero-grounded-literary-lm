# Parallel quantity-evaluator calibration v1

Status: **complete; execution authorization consumed**.

The Q2.6 end-to-end calibration isolated serial quantity evaluation as the
remaining execution bottleneck. This diagnostic calibration measures the new
deterministic process-parallel evaluator on the same AWS instance type before
any Q2.6-R scientific compute is budgeted.

The immutable [`budget.json`](budget.json) authorized one execution:

| Bound | Maximum |
| --- | ---: |
| EC2 launch-to-termination window | 1,500 seconds |
| workload window | 1,440 seconds |
| compute charge at $0.68/hour | $0.29 |
| optimizer attempts | 0 |
| promotion evaluations | 0 |

The workload generates the frozen Q2.2 operation-request corpus and evaluates
the tracked Q2.6 seed-2 quantized model in this fixed order:

| Measurement | Cases | Jobs |
| --- | ---: | ---: |
| sentinel serial | 64 | 1 |
| sentinel parallel | 64 | 16 |
| public serial | 500 | 1 |
| public parallel | 500 | 16 |

One untimed serial case warms the executable first. Each measured invocation
loads the same model independently. Completion requires the serial and parallel
JSON files for both splits to be byte-identical. The result records wall time,
speedup, throughput, output hashes, cold-start/build time, and an updated
two-seed Q2.6-R planning estimate using the earlier optimizer and replay
measurements.

The workflow and EC2 bootstrap independently enforce the launch-relative
1,500-second cap. A workload timeout reserves publication time, an atomic S3
lock prevents a second execution, and the instance terminates even if the
observer fails. Slow package installation consumes the fixed budget rather
than extending it.

This calibration cannot produce scientific evidence, inspect a promotion
split, or authorize Q2.6-R. A complete result only supplies the timing evidence
needed to draft a separate combined two-seed budget.

GitHub Actions run
[`30044123890`](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/30044123890)
consumed the authorization on merged commit
`f849fe8c8c1a448dcb6b24783e7edfdf56a5e92b`. The immutable
[`launch`](launch-30044123890.json),
[`status`](status-30044123890.json), and
[`result`](result-30044123890.json) records show:

| Measurement | Serial | Parallel | Speedup |
| --- | ---: | ---: | ---: |
| 64-case sentinel | 78.359 s | 5.798 s | 13.515× |
| 500-case public | 612.343 s | 44.954 s | 13.621× |

Both serial/parallel JSON pairs are byte-identical. Parallel throughput was
11.04–11.12 cases/second versus 0.817 serial, reaching about 85% of ideal
16-worker scaling. The 500-case serial observation also validates the prior
linear planning estimate: 612.343 observed versus 795.982 seconds allowed.

Cold start, build, corpus generation, and warmup consumed 93 seconds. The
structured result published after 838 instance-seconds, approximately $0.16 at
the frozen hourly rate and below both hard caps. GitHub requested termination,
AWS confirmed the instance terminated, and the final audit found no active
ZERO instances.

Substituting the measured parallel timings into the earlier Q2.6 component
measurements gives this planning estimate:

| Scope | Base estimate | With 20% contingency |
| --- | ---: | ---: |
| one seed | 3h09m08s / $2.14 | 3h47m / $2.58 |
| seeds 1 and 3 | 6h18m15s / $4.29 | 7h34m / $5.16 |

The optimizer remains the dominant component at about 2h44m35s per seed. These
figures are execution-planning evidence only. Q2.6-R remains unauthorized until
a separate combined two-seed budget is reviewed and manually approved.

Validate the consumed authorization and immutable result locally:

```sh
node scripts/check_parallel_quantity_eval_budget.mjs \
  benchmarks/parallel-quantity-eval-calibration-v1/budget.json
node scripts/check_parallel_quantity_eval_result.mjs \
  benchmarks/parallel-quantity-eval-calibration-v1/budget.json \
  benchmarks/parallel-quantity-eval-calibration-v1/result-30044123890.json \
  benchmarks/parallel-quantity-eval-calibration-v1/status-30044123890.json
```

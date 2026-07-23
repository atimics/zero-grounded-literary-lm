# Parallel quantity-evaluator calibration v1

Status: **preregistered and authorized; not yet executed**.

The Q2.6 end-to-end calibration isolated serial quantity evaluation as the
remaining execution bottleneck. This diagnostic calibration measures the new
deterministic process-parallel evaluator on the same AWS instance type before
any Q2.6-R scientific compute is budgeted.

The immutable [`budget.json`](budget.json) authorizes one execution:

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

Validate the authorization locally without launching compute:

```sh
node scripts/check_parallel_quantity_eval_budget.mjs \
  benchmarks/parallel-quantity-eval-calibration-v1/budget.json
```

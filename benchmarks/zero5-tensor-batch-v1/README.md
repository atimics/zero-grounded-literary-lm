# Zero C3.3 tensor-batch speed experiment

This is an AWS CPU performance experiment. It is not a new model result and
does not replace the frozen C3.3 scientific run.

## What changed

The current fast trainer runs four complete model copies in parallel, then
merges four gradient sets. The tensor path instead:

- stores all four sequences in one contiguous workspace;
- runs each shared projection as one matrix operation over 2,048 rows;
- keeps causal attention separate inside each 512-token sequence;
- accumulates one gradient set directly, with no gradient merge;
- keeps four optimizer workers without allocating private model caches; and
- optionally combines Q, K, and V into one projection.

The old serial and parallel paths remain unchanged. Tensor checkpoints record
their execution mode and can resume only with the same tensor-batch setting.

## Correctness controls

- Same frozen C2 starting checkpoint.
- Same ordered C3.3 training and validation packs.
- Same tokenizer, seed, schedule, dropout, and answer weights.
- Deterministic repeat checkpoint for each tensor binary.
- Pause and resume bound to tensor batch size and run-contract hash.
- Training loss, validation loss, and gradient norm must match the current
  parallel trainer at reported precision in the mechanics test.
- The sealed test set stays closed.

The tensor path changes floating-point accumulation order. It is therefore a
performance replay, not a scientific replication, even when reported metrics
match.

## Where speed is measured

Speed selection is Linux/OpenBLAS-only. Apple Silicon is used only to catch
correctness and memory errors. The benchmark script refuses to run a speed
comparison outside Linux.

The first AWS calibration should use the same `c6i.4xlarge` shape as the
completed C3.3 replay and compare:

1. Four sequence workers with one BLAS thread each—the current baseline.
2. Tensor batch with 1, 2, 4, 8, and 16 BLAS threads.
3. Tensor batch plus Q/K/V fusion with the same thread choices.

Dynamic threading stays disabled. Each candidate uses 50 updates. A candidate
may advance only when its metrics remain inside the frozen reporting tolerance
and it is at least 15% faster than the current parallel baseline. A full C3.3
performance replay requires a separate decision and budget.

Run the Linux benchmark with:

```sh
node scripts/benchmark_zero5_tensor.mjs \
  --asset-root /path/to/frozen-assets \
  --updates 50 \
  --blas-threads 8 \
  --out /tmp/zero5-tensor-8.json
```

The AWS calibration is authorized by `aws-contract.json` for at most $0.15 of
EC2 compute. The instance is limited to 780 seconds at $0.68/hour, or $0.1474
before provider rounding. It uploads every completed candidate immediately and
terminates itself on success, failure, or the hard time limit.

The launch path is:

- `scripts/aws/zero5-tensor-calibration-run-instance.sh`
- `scripts/aws/zero5-tensor-calibration-user-data.sh`
- `make zero5-tensor-aws-check`

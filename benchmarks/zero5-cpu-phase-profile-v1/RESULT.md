# ZERO.5 CPU phase profile result

## Decision

**Optimize Linux vector math next.** The current four-worker trainer spends
almost all useful time inside the model kernels. Gradient merging and the
optimizer are already small, so more scheduler or batching work will not give
the next meaningful speed gain.

This is a performance result only. It does not change the frozen C3.3 model
result, and the sealed test set stayed closed.

## Where the time went

| Worker CPU phase | Seconds | Share |
| --- | ---: | ---: |
| Linear forward and backward | 57.47 | **39.15%** |
| Attention forward and backward | 55.85 | **38.05%** |
| GELU forward and backward | 26.60 | **18.12%** |
| RMSNorm | 3.07 | 2.09% |
| Unattributed | 2.67 | 1.82% |
| RoPE and output loss | 1.12 | 0.76% |

The parallel training wave was 91.55% of tracked wall time. Input and dropout
setup used 5.98%, the optimizer 1.94%, and gradient merging only 0.53%.

## What this means

On Linux, the current GELU path still calls scalar `tanhf`, and attention
softmax still calls scalar `expf`. GELU alone is large enough that removing all
of its cost would have a theoretical 1.22x upper bound. Real speedup will be
smaller, but vector `tanh` and `exp` are the cheapest high-value experiment.

After vector math, the next targets are blocked causal attention and a frozen
OpenBLAS-versus-BLIS-or-oneMKL backend calibration. Q/K/V fusion, tensor
batching, gradient merging, and optimizer work should not be the first targets.

## Correctness, overhead, and cost

The uninstrumented trainer reached 5,054 tok/s. The profiler reached 5,070
tok/s, so measured overhead was effectively zero. Both produced identical
losses, gradient norms, and the same checkpoint SHA-256:

`d598e071751ce37858ab94fd4e9ea7ef031d0f2e4fe83098b84d569d78c7d08d`

The `c6i.4xlarge` run completed in 153 seconds for an estimated **$0.0289**,
below the approved $0.06 maximum. The instance terminated. Hardware PMU
counters were unavailable to this EC2 guest, but task-clock and software
counters were retained in `perf.csv`.

The machine-readable result, launch receipt, terminal status, calculations,
and hashes are beside this file. Verify them with
`make zero5-cpu-profile-aws-result-check`.

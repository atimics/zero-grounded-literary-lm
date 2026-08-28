# ZERO.5 blocked causal-attention experiment

The AWS phase profile assigns 38.05% of worker CPU to attention. The current
BLAS path computes full 512 by 512 attention matrices, then erases the future
half required by the causal mask. It also multiplies those zeros in the value
and backward passes.

This experiment divides query rows into blocks. Each BLAS call sees only the
key/value prefix required by that block. It keeps the existing full probability
cache, exact causal softmax, model architecture, optimizer, and training data.
At context 512, the three candidates reduce the main attention GEMM work to:

| Query block | Dense work retained |
| ---: | ---: |
| 32 | 53.1% |
| 64 | 56.3% |
| 128 | 62.5% |

Smaller blocks save more arithmetic but make more BLAS calls. The frozen Linux
calibration will choose among 32, 64, and 128 by measured end-to-end training
throughput, not by the arithmetic estimate.

Each checkpoint records the exact attention backend. A training resume rejects
a different backend, and `--require-attention-backend` lets a run contract fail
before training if it received the wrong binary. Old version-6 checkpoints with
an unbound reserved field remain readable, but cannot enter a new strict
attention-bound resume.

Run the local gradient, deterministic-mechanics, identity, and parser checks:

```sh
make zero5-blocked-attention-check
```

This is a performance experiment. It does not open the sealed test set and is
not a new C3.3 scientific result. No AWS compute is authorized yet.

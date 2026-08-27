# ZERO.5 CPU speed pass

This pass makes the C trainer faster without touching the active C3.3 run.
The benchmark uses the frozen C3.3 packs, model, tokenizer, batch size, and
training settings on the same Apple arm64 machine with Accelerate.

## Result

| Build | Tokens/second | Change from old trainer | 200-update time | Numerical rule |
| --- | ---: | ---: | ---: | --- |
| Old trainer | 6,324 | baseline | 64.89 s | Frozen C3.3 source |
| Strict | 7,796 | +23.3% | 52.92 s | Bit-for-bit compatible |
| Fast | 11,025 | +74.3% | 37.44 s | New runs only |
| Fast + four-way batch | 27,118 | +328.8% | 15.36 s | New runs only |

The strict build stores the GELU tanh value from the forward pass and reuses it
in the backward pass. The old trainer calculated the same tanh twice. A
50-update replay produced the exact old checkpoint SHA-256, so this change does
not change the model, optimizer, random state, or checkpoint format.

The fast build also uses native CPU tuning and link-time optimization. On
macOS it uses Accelerate vector math for tanh and exponentials. Its reported
train loss, validation loss, and gradient norm matched the strict build at the
trainer's printed precision. Its checkpoint is not byte-identical, so it must
have a new source hash and a new experiment contract. Never use it to resume a
frozen run.

Both trainer binaries passed all 35 finite-difference gradient checks.

The parallel build gives each sequence a private model cache and gradient
buffer while all workers read the same weights. Dropout masks are prepared in
the original sequence order. Gradients are merged in a fixed worker order, so
repeated runs and split-resume runs produce the same parallel checkpoint.
Parallel accumulation changes floating-point rounding, so it is deterministic
but not byte-identical to serial training. At 200 updates its reported train
loss, validation loss, and gradient norm still matched serial training.

## Run it again

Build and check both modes:

```sh
make zero5-cpu-speed-check
```

Run the frozen C3.3 workload benchmark with assets from another checkout:

```sh
node scripts/benchmark_zero5_cpu.mjs \
  --asset-root /path/to/checkout-with-assets \
  --updates 200 \
  --parallel-workers 4
```

The script runs strict and fast training with the same inputs, checks that the
reported metrics stay within tolerance, hashes both checkpoints, and removes
its temporary files.

## AWS rule

Parallel workers and BLAS threads multiply. Start the AWS calibration with
four batch workers and two OpenBLAS threads per worker, for eight active BLAS
threads on the 16-vCPU machine. Compare nearby settings before the full replay.
The full parallel replay needs its own source hash and execution contract.

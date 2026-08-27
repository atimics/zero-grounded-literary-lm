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

Both builds passed all 35 finite-difference gradient checks.

## Run it again

Build and check both modes:

```sh
make zero5-cpu-speed-check
```

Run the frozen C3.3 workload benchmark with assets from another checkout:

```sh
node scripts/benchmark_zero5_cpu.mjs \
  --asset-root /path/to/checkout-with-assets \
  --updates 200
```

The script runs strict and fast training with the same inputs, checks that the
reported metrics stay within tolerance, hashes both checkpoints, and removes
its temporary files.

## Next limit

The remaining large CPU opportunity is real batch execution. The current
trainer processes four sequences one after another and only then applies one
optimizer update. Running those independent sequences together could use more
CPU cores, especially on a 16-core AWS machine. That is a larger model-cache
and determinism change, so it belongs in a separate benchmark and contract.

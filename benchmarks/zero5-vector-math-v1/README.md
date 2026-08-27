# ZERO.5 GNU/Linux vector-math experiment

The AWS CPU phase profile found that GELU uses 18.12% of worker CPU and that
attention uses another 38.05%. On GNU/Linux, the existing fast trainer still
calls scalar `tanhf` in GELU and scalar `expf` in attention softmax.

This experiment adds three separate binaries while leaving
`zero5_c32_lm_fast` unchanged:

- `zero5_c32_lm_vector_tanh` uses the eight-float GNU libmvec AVX2 `tanh`;
- `zero5_c32_lm_vector_exp` uses the eight-float GNU libmvec AVX2 `exp`; and
- `zero5_c32_lm_vector_math` enables both.

Only the transcendental calls change. GELU's polynomial, the softmax maximum
and sum, and all model operations stay in their original order. The binaries
fall back to the normal path outside GNU/Linux x86-64. Speed claims are allowed
only on Linux x86-64.

The vector functions are checked against scalar libm during every C self-test.
The benchmark also requires deterministic checkpoints for each variant and
frozen reported-metric tolerances against the unmodified trainer. It does not
require bit-identical checkpoints across variants because libmvec may round
differently from scalar libm.

Verify mechanics with:

```sh
make zero5-vector-math-check
```

Run the real Linux comparison with:

```sh
node scripts/benchmark_zero5_vector_math.mjs \
  --asset-root /path/to/frozen-assets \
  --updates 100 \
  --repetitions 2 \
  --out /tmp/zero5-vector-math.json
```

This is a performance experiment, not a C3.3 scientific replication. The
sealed test set stays closed.

# ZERO.5 Q/K/V fusion experiment

This experiment implements real Q/K/V projection fusion in the pure C
trainer. It keeps the normal fast trainer unchanged and provides three
separate experimental binaries:

- `zero5_c32_lm_qkv_forward`: one forward Q/K/V matrix operation instead of
  three;
- `zero5_c32_lm_qkv_backward`: one fused Q/K/V backward projection instead of
  six matrix operations; and
- `zero5_c32_lm_qkv`: both changes together.

The fused weights and gradients are stored contiguously. Compact Q, K, and V
attention buffers are retained so attention does not pay a three-times-wider
memory stride.

## Result

The balanced benchmark ran each variant twice for 100 C3.3 updates. The second
repetition used reverse order to reduce temperature and background-load bias.

| Variant | Mean tokens/second | Change from baseline |
| --- | ---: | ---: |
| Existing fast trainer | 28,290.5 | baseline |
| Forward fusion | 28,229.0 | -0.22% |
| Backward fusion | 28,006.5 | -1.00% |
| Forward and backward fusion | 28,191.0 | -0.35% |

Every variant produced the exact same checkpoint SHA-256:

`a2353b4ed568a24a6faee44cf79c6e827cf8381663f9a4be6f5adb05a52a303b`

All reported losses and gradient norms matched. Each fused build passed all 35
finite-difference gradient checks.

## Decision

This is a clean engineering result but a performance **no-go** on Apple
Silicon. Fewer matrix calls do not repay the cost of packing and unpacking the
separate attention buffers. The fused binaries remain available for Linux and
AWS calibration, where OpenBLAS may behave differently, but fusion is not the
default.

The next serious CPU speed change is true batch-level tensor layout: operate on
all four sequences as one larger tensor through every linear layer, while
keeping attention boundaries separate. Projection-only fusion is too small.

## Verify

```sh
make zero5-qkv-fusion-check

node scripts/benchmark_zero5_qkv.mjs \
  --asset-root /path/to/checkout-with-assets \
  --updates 100 \
  --repetitions 2
```


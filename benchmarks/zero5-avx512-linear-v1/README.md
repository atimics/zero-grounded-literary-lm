# ZERO.5 AVX-512 float linear experiment

The C3.3 trainer stores weights, activations, gradients, and AdamW state as
float32. This experiment keeps that model unchanged. It does not add Q15
quantization or integer-to-float conversion.

The candidate replaces only the linear forward and backward `sgemm` calls. It
uses an AVX-512F 4-row by 4-output forward tile, a 4-output weight-gradient
tile, and a 4-row input-gradient tile. Attention remains on the existing BLAS
backend. Shapes outside the tile requirements use the portable scalar code.

The current four-sequence worker pool remains unchanged. Each worker applies
the same kernel to one 512-token sequence, so this experiment measures the new
linear code against the existing four-worker, one-BLAS-thread baseline.

## Correctness boundary

The accelerated path has a direct scalar-oracle self-test for forward output,
weight gradients, and input gradients. Repeated runs must produce the same
checkpoint for each backend. The frozen benchmark also requires training loss,
validation loss, and gradient norm to remain within the existing performance
experiment tolerances.

AVX-512 changes float reduction order, so cross-backend checkpoints are not
expected to be bit-identical. The combined math backend identity is stored in
version-6 checkpoints. A training resume between the OpenBLAS and AVX-512
paths therefore fails closed.

Run the parser and, on Linux x86-64, the kernel and trainer mechanics checks:

```sh
make zero5-avx512-linear-check
```

Run a balanced speed comparison on an AVX-512 machine with the frozen C3.3
assets:

```sh
node scripts/benchmark_zero5_avx512_linear.mjs \
  --asset-root /path/to/assets \
  --out /tmp/zero5-avx512-linear-result.json
```

This is a performance experiment. It does not open the sealed test set and is
not a new C3.3 scientific result.

## Bounded AWS run

The checked AWS contract authorizes one on-demand `c6i.4xlarge` run in
`us-east-1`. It has a 370-second automatic shutdown and a $0.07 EC2 ceiling.
The launcher uses an atomic S3 lock, immutable source and asset hashes, and an
instance-side watchdog.

Validate the launch path before staging or running anything:

```sh
make zero5-avx512-linear-aws-check
```

The source stage reuses the already-sealed private C3.3 asset archive and
uploads only the immutable source archive for commit `50b029b`.

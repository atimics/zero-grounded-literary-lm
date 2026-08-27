# ZERO.5 CPU speed pass 2

This pass makes the four-way C trainer a little faster without changing its
model result.

The old parallel path created three threads for every update, cleared four
complete gradient copies, merged the private gradients on one core, and then
updated every weight on one core. The new path:

- keeps the three private workers alive for the whole run;
- clears private gradients while they are merged;
- splits the fixed-order gradient merge across all four workers; and
- splits the independent AdamW weight updates across all four workers.

The gradient norm is still calculated in the original order. Each weight still
receives the same operations in the same order.

## Measured result

Two 500-update runs of each version used the same C3.3 packs, checkpoint,
tokenizer, batch size, seed, and Apple arm64 machine.

| Trainer | Run 1 | Run 2 | Mean tokens/second | Mean total time |
| --- | ---: | ---: | ---: | ---: |
| Previous four-way trainer | 26,548 | 26,292 | 26,420.0 | 38.955 s |
| Parallel merge and optimizer | 27,403 | 27,154 | 27,278.5 | 37.745 s |

That is a **3.25% throughput gain** and a **3.11% total-time reduction**.
All four final checkpoints have the same SHA-256:

`a6e93218920440af7c07b4b2b617bf184a2dd3b1b8dadfb1932694db97a4043a`

Both builds reported the same train loss, validation loss, and gradient norm.
Both C builds also passed all 35 finite-difference gradient checks, and the
C3.2 mechanics tests passed.

## Honest limit

This is useful, but it is not another step change. Profiling shows that matrix
math now dominates. The next serious CPU experiment should use true tensor
batching and fused Q/K/V projections so the math library receives fewer,
larger operations. That is a larger source change and should get its own
performance contract before an AWS replay.


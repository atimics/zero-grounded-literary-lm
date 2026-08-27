# ZERO.5 C3.3 parallel replay

This is a performance replay, not a new model experiment.

It keeps the C3.3 checkpoint initialization, data, order, seed, batch size,
schedule, loss weights, and 9,442 updates. It changes only the CPU executable:
the fast build uses cached nonlinear values and computes the four sequences in
each batch in parallel with private caches and a fixed gradient merge order.

That merge is deterministic, including across a checkpoint resume. It is not
bit-for-bit equal to serial training because floating-point additions happen in
a different grouping. The result therefore measures speed, cost, and validation
closeness. It cannot be counted as another scientific C3.3 seed.

Before the full run, the same instance times three small configurations:

- 4 batch workers × 1 BLAS thread
- 4 batch workers × 2 BLAS threads
- 2 batch workers × 4 BLAS threads

The fastest configuration runs the full frozen workload. This avoids silently
turning 4 workers × 8 BLAS threads into 32 competing compute threads.

The sealed test set stays closed. Private data and checkpoints stay private.
The requested EC2 ceiling is $1.20; the contract remains unauthorized until
that exact new spend is approved.

# ZERO.5 tensor-batch AWS result

## Decision

**Do not promote the tensor-batch path on this CPU.** It is correct, but it is
slower than the current four-worker C trainer at every tested OpenBLAS thread
count. Q/K/V fusion did not improve any candidate.

This is a performance result only. It does not change the frozen C3.3 model
result. The sealed test set stayed closed.

## Speed

| Path | OpenBLAS threads | Throughput | Versus baseline |
| --- | ---: | ---: | ---: |
| Current parallel baseline | 4 workers × 1 | **5,135 tok/s** | 1.00x |
| Tensor batch | 1 | 1,472 tok/s | 0.29x |
| Tensor batch | 2 | 1,952 tok/s | 0.38x |
| Tensor batch | 4 | 2,439 tok/s | 0.47x |
| Tensor batch | 8 | **2,835 tok/s** | **0.55x** |
| Tensor batch | 16 | 2,030 tok/s | 0.40x |

The fastest tensor result used eight threads. It was 44.79% slower than the
frozen baseline, so it failed the required 15% speed improvement by a wide
margin. The repeated parallel measurements ranged from 5,135 to 5,205 tok/s.

The fused Q/K/V path was slightly slower than the unfused tensor path at every
thread count. Its best result was 2,781 tok/s at eight threads.

## Correctness and cost

Training loss, validation loss, and gradient norm matched the current parallel
trainer at the frozen reporting precision for all ten tensor candidates.

The first 50-update attempt hit its process time guard before completing a
candidate and stopped at $0.035511. The corrected 10-update retry completed all
five thread choices for $0.043633. Combined estimated EC2 cost was **$0.079144**,
below the approved $0.15 maximum. Both instances terminated.

## Meaning

Larger matrix calls alone are not enough here. The shared tensor workspace
removes model copies and gradient merging, but the current row-wise kernels and
attention work dominate enough that the existing sequence-parallel design wins.
The next CPU optimization should profile kernel time and memory traffic inside
the tensor path before adding more fusion.

Integrity hashes and both attempt identities are locked in `comparison.json`.

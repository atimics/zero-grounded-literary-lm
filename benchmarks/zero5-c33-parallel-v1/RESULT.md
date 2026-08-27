# ZERO.5 C3.3 parallel replay result

## Decision

**Pass as a CPU performance result.** The optimized C trainer completed the
same ordered seed-0 C3.3 workload within the approved budget. This is not a
scientific replication and does not change the C3.3 no-go decision.

The sealed test set remained closed. The private checkpoint was hash-verified
and was not published.

## Result

| Measure | Scientific C3.3 | Parallel replay | Change |
| --- | ---: | ---: | ---: |
| Final reported throughput | 1,721 tok/s | **4,573 tok/s** | **2.66x** |
| Final validation loss | 1.5873 | **1.5873** | 0.0000 |
| Total EC2 cost | $2.7570 | **$0.8477** | **-$1.9093 / -69.25%** |
| Updates | 9,442 | 9,442 | exact |

The replay's aggregate measured throughput was 4,634.93 compute tokens per
second. The conservative final-interval comparison is 2.66x, above the frozen
2x speed gate. Its final validation value matches the scientific result to the
recorded precision and passes the 0.03 closeness gate.

The $0.8477 total includes the earlier zero-update bootstrap cost of $0.01738.
The corrected run and bootstrap stayed below the separately approved $1.20
ceiling. The instance terminated after uploading its immutable result.

## Calibration

The fastest safe configuration was four batch workers with one BLAS thread
each:

| Batch workers | BLAS threads | Calibration throughput |
| ---: | ---: | ---: |
| 4 | 1 | **5,146 tok/s** |
| 2 | 4 | 3,893 tok/s |
| 4 | 2 | 3,467 tok/s |

This confirms that more BLAS threads were harmful once sequence batches ran in
parallel. The correct CPU default for this workload is four batch workers and
one BLAS thread per worker, with dynamic threading disabled.

## Integrity

- Result SHA-256: `7d28b7f098e48482afc1b1b42a24f5c856a999f2a5def4d75c7ad669dc4d3eca`
- Checkpoint SHA-256: `0e9b4e2f67040e9daabbf2196e8e69e6907b8c9e4809a88159461cfe7c4545f7`
- Frozen contract SHA-256: `bfa863dc4dbd4e7aad8a42ae819fe26ab0ab3efd346235ad7cf72a672054aa2b`
- Source commit: `6e6c6a9051bbc14613daf64cf6923f26f085df58`
- Test metrics opened: no

`comparison.json` binds the scientific and performance results, status files,
training-log hashes, costs, speed calculation, and claim boundary.

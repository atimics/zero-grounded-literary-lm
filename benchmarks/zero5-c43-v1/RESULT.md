# ZERO.5 C4.3 result

C4.3 completed its one authorized local primary run and is a **no-go** under
the frozen gates. The sealed test stayed closed.

## Execution

- 28,707 optimizer groups completed in 1,586.99 seconds
- 19,337,216 compute-token exposures across 37,768 packs
- zero data wraps
- 12,184.86 aggregate compute-token exposures per second
- selected checkpoint: update 28,500, validation loss 1.9804
- local Apple Silicon with Accelerate; no AWS or paid compute

## Frozen validation

| Metric | C2 baseline | C4.3 | Change | Gate |
| --- | ---: | ---: | ---: | --- |
| Combined nats/token | 2.3373 | 2.0105 | 13.98% better | Pass |
| Evidence nats/token | 2.3086 | 2.0718 | 10.26% better | Pass |
| Atlas nats/token | 2.2786 | 2.1764 | 4.49% better | Pass |
| Anchor nats/token | 3.6942 | 3.7750 | 2.19% worse | Pass |
| Claim choice accuracy | 51.86% | 70.81% | +18.95 points | Pass |
| Retrieval choice accuracy | 51.34% | 53.76% | +2.42 points | **Fail: below 55%** |
| Claim pair-exact | 50.04% | 68.68% | +18.64 points | Pass |
| Retrieval pair-exact | 48.37% | 52.03% | +3.66 points | Pass |
| Cloze exact accuracy | 0.0281% | 0.0281% | no change | **Fail: below +1 point** |

Position, swap-consistency, retention, finite-metric, and sealed-test gates all
passed. C4.3 is not eligible for promotion because every gate was required.

## Interpretation

C4.3 fixed most of the C4.2 failure surface. It produced large claim gains,
cleared both pair-exact gates, improved retrieval choice by more than two
points, and improved the combined and retention losses. It did not teach exact
cloze completion, and retrieval choice stopped 1.24 points below its absolute
floor. The next corpus revision should target those two failures rather than
increase model scale.

## Publication boundary

This directory publishes the no-go decision, metrics, accounting, and hashes
under `zero5-c43-result-publication-2026-08-28-v1`. Corpus contents, checkpoint
bytes, raw logs, sample generations, and sealed-test data remain private.

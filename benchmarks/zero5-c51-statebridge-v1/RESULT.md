# ZERO.5 C5.1 StateBridge result

C5.1 completed its one authorized local run and is a **no-go** under the
frozen gates. The sealed test stayed closed.

## Execution

- 28,707 optimizer groups completed in 1,742.03 seconds
- 19,337,216 compute-token exposures across 37,768 packs, zero wraps
- exactly 25% of the frozen C4.3 pack stream replaced with C5.2
  structured-state text (9,442 packs, 4,721 two-pack groups), byte-for-byte
  compute-matched to C4.3
- local Apple Silicon with Accelerate; no paid compute

## Frozen validation

| Metric | C2 baseline | C4.3 control | C5.1 | Gate |
| --- | ---: | ---: | ---: | --- |
| Retrieval choice accuracy | 51.34% | 53.76% | 52.57% | **Fail: below 55% and below C4.3** |
| Claim choice accuracy | 51.86% | 70.81% | 56.14% | **Fail: claim retention** |
| Combined nats/token | 2.3373 | 2.0105 | 2.0801 | pass |
| Atlas nats/token | 2.2786 | 2.1884 | 2.2026 | pass |
| C1 anchor nats/token | 3.6942 | 3.7750 | 3.8591 | pass |
| C5.2 next-state target nats | 5.2477 | — | reduced 96.77% | pass |

Orientation, swap-consistency, evidence, finite-metric, and sealed-test gates
passed. Cloze exact is reported but retired as a decision metric.

## Interpretation

Replacing a quarter of the evidence corpus with structured state text cost
14.67 points of claim choice accuracy — the exact gain corpus composition had
delivered in C4.2/C4.3 — while retrieval choice fell 1.19 points below the
C4.3 control. The structured content was learned (next-state target nats
fell 96.77% from the C2 baseline on text supervision alone) but did not
transfer to the paired-choice deficit. The reallocation is a trade, not a
transfer.

This closes the structured-content claim of the C5 ladder: structured text
at compute-matched dose does not repair retrieval choice at this model size,
and it displaces the corpus gains that produced claim choice improvements.

## Publication boundary

This directory publishes the no-go decision, metrics, accounting, and hashes.
Corpus contents, checkpoints, raw logs, and sample generations remain
private. Venue note: deterministic byte-identical training across venues is
established for this codebase; an AWS replay of the frozen contract is
available on request for official-grade provenance.

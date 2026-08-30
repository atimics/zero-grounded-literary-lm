# ZERO.5 C5.2 TargetBridge result

C5.2 completed its one authorized local run and is a **no-go** under the
frozen gates. The sealed test stayed closed.

## Execution

- 28,707 optimizer groups completed in 1,621.30 seconds
- 19,337,216 compute-token exposures across 37,768 packs, zero wraps
- 293,606 verified auxiliary state-target events at loss weight 0.1
- factorized verified-state-target head (2,319,236 bytes) beside the frozen
  token head; ten-update loss-off byte-identity to the C5.1 trainer verified
- local Apple Silicon with Accelerate; no paid compute

## Frozen validation

| Metric | Matched control (C5.1 recipe) | C5.2 | Gate |
| --- | ---: | ---: | --- |
| Retrieval choice accuracy | 52.57% | 51.98% | **Fail: no gain (−0.59)** |
| Claim choice accuracy | 56.14% | 56.07% | pass |
| Auxiliary state-target accuracy | 57.24% | **89.73%** | pass (gain ≥ 5) |
| Auxiliary nats per event | 2.1061 | **0.2500** | pass (−88.13%) |
| Combined nats/token | 2.0801 | 2.0784 | pass |
| C5.2 choice orientation gap | — | 0.687 | **Fail** |

Retention, evidence-floor, finite-metric, and sealed-test gates passed.

## Interpretation

The auxiliary head learned the verified state targets almost perfectly —
accuracy rose 32.49 points to 89.73% and auxiliary nats fell 88.13% — while
retrieval choice moved *down* 0.59 points against the matched control. The
state targets are learnable at 4,852,992 parameters; a factorized head
trained beside the token head does not transfer that competence into
paired-choice decisions. Learning is not coupling.

This closes the verified-state-target-without-architecture claim. The
remaining live mechanism for the state representation is architectural:
the C6.1 shared-state bottleneck couples the verified factor decoder to
answer-token logits through a zero-initialized adapter, with a mandatory
same-checkpoint bridge-off ablation.

## Publication boundary

This directory publishes the no-go decision, metrics, accounting, and hashes.
Corpus contents, checkpoints, raw logs, and sample generations remain
private. Venue note: deterministic byte-identical training across venues is
established for this codebase; an AWS replay of the frozen contract is
available on request for official-grade provenance.

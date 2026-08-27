# ZERO.5 GNU/Linux vector-math result

## Result

**GNU libmvec `tanh` and `exp` together made the current AWS CPU trainer
28.14% faster.** This is the first large CPU kernel improvement after the
four-worker trainer became the baseline.

| Variant | Mean throughput | Change |
| --- | ---: | ---: |
| Current four-worker trainer | 5,253 tok/s | baseline |
| Vector `tanh` | 6,057 tok/s | +15.31% |
| Vector `exp` | 5,718.5 tok/s | +8.86% |
| Vector `tanh` and `exp` | **6,731 tok/s** | **+28.14%** |

For a fixed amount of training work, the combined result implies about 21.96%
less trainer time.

## Correctness

All eight balanced runs reported the same training loss, validation loss, and
gradient norm within the frozen tolerances. Each variant produced the same
checkpoint in both repetitions.

The vector checkpoints are not bit-identical to the scalar baseline because
GNU libmvec rounds transcendental functions differently. This is a performance
result, not a C3.3 scientific replication. The sealed test set stayed closed.

## Decision

The combined vector path is a strong promotion candidate, but the production
default is not changed by this result. Before promotion, the math mode should
be bound into checkpoint or run identity so a resume cannot silently switch
between scalar and vector math. A longer validation replay should then confirm
the path before it is used for a new scientific lineage result.

After that, the next major kernel target is blocked causal attention.

## Cost

The `c6i.4xlarge` run completed in 224 seconds for an estimated **$0.04231**,
below the approved $0.07 maximum. The instance terminated.

The machine-readable result, launch receipt, terminal status, calculations,
and hashes are beside this file. Verify them with
`make zero5-vector-math-aws-result-check`.

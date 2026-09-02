# ZERO.5 HT3 AnswerRoot pilot

## Status

**Preregistered with its terminal C6.1 dependency satisfied.** Implementation
review and training authority remain separate steps. This specification keeps
the paid-compute, retry, replication, promotion, publication, and sealed-test
boundaries fixed.

## Question

Can a single prompt-only semantic root, formed from predicted verified-factor
distributions, guide the complete answer better than C6.1's continuous
per-position shared-state bridge?

## Control

The parameter-matched control is the terminal C6.1 seed-0 continuous
shared-state arm. Its no-go result and checkpoint hashes are frozen in the HT3
contract. HT3 starts independently from C2. The C6.1 checkpoint serves only as
the control.

The control and treatment use the same 152-wide bottleneck, 752-tag factor
decoder, tied language head, answer positions, auxiliary loss, parameter
count, initialization, training data, order, and optimizer schedule.

## Predicted root

At the last prompt token, the factor head produces a separate softmax for every
registered non-singleton factor family. The set of families is fixed by the
hash-bound target vocabulary; it is not selected using gold record metadata.

The factor-output row also serves as that tag's 152-wide embedding. The answer
root is:

```text
root = mean over registered families f of
       sum over tags t in f of p(t | prompt, f) * W_factor[t]
```

The root is computed once and held fixed for the answer. The existing
152-to-256 bridge adds it only at answer target classes 2, 3, and 4. Language
loss may backpropagate through the probabilities, factor rows, prompt
bottleneck, and bridge. No stop-gradient is allowed.

Gold factor tags supervise the auxiliary loss but are never used as root input.
The root cannot read answer tokens, candidate answers, evaluator labels, or
future hidden states. At generation time it is derived from the model's own
prompt prediction exactly once.

## Parameter count

HT3 reuses the C6.1 factor rows as tag embeddings and therefore adds no new
codebook. Its exact auxiliary count remains 193,032:

```text
152 * 256 + 152   prompt bottleneck
752 * 152 + 752   factor decoder and bias
256 * 152         answer bridge
----------------
193,032
```

## Causal interventions

The same trained checkpoint is scored with:

1. its normal predicted root;
2. the root masked to exact zero;
3. a deterministically wrong root taken from the paired mirrored prompt;
4. language bridge disabled while the factor head remains active.

These interventions do not train or select a checkpoint. They test whether the
root causes the reported language behavior.

## Gates

All gates are conjunctive:

| Gate | Requirement |
| --- | --- |
| Factor nats | At least 10% below the zero-head reference |
| Factor accuracy | At least 5 points above the zero-head reference |
| Retrieval choice | At least 2 points above terminal C6.1 control |
| Retrieval pair exact | At least 2 points above terminal C6.1 control |
| Root contribution | Normal root at least 1 point above root-masked on choice and pair exact |
| Wrong-root intervention | Wrong root increases answer nats by at least 0.01 per target token |
| Orientation | Both orientations at least 50%, gap at most 15 points, swap at least 94% |
| Combined language | No more than 0.03 nats/token worse than terminal C6.1 |
| Claim preservation | Claim accuracy loses at most 2 points |
| Retention | Existing evidence, Atlas, and C1 anchor limits pass |
| Mechanics | Prompt-only causality, no-gold-input, finite-gradient, and treatment-off identity pass |
| Compute | Measured operation and wall-time ratios are each at most 1.15 |
| Test | Test content and metrics remain unopened |

A pass supports plan-first language expansion at this scale. A failure rejects
this probability-weighted factor root, not all semantic or structured output
representations.

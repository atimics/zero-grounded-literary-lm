# ZERO.5 HT1 MergeTree pilot

## Status

**Preregistered; implementation and training are not authorized.** This file
freezes the treatment and gates. It does not authorize a trainer, run, paid
compute, replication, promotion, publication, or sealed-test access.

## Question

Does exposing the byte-BPE512 merge tree to the tied token embeddings improve
held-out byte compression, especially for deeper merged tokens, without
changing the token stream or harming ZERO's task behavior?

## Treatment

The tokenizer remains fixed. Its 248 learned merge tokens each name a left and
right child that precede them in the vocabulary. The implementation computes a
recursive composition vector from the ordinary tied embedding table:

```text
C(base token)  = E(base token)
C(merge token) = 0.5 * (C(left child) + C(right child))
E*(token)      = E(token) + gate[depth(token)] * C(token)
```

`E*` replaces `E` for both input lookup and the tied output projection. It is
recomputed from the current embedding table, so language gradients reach both
the token and its descendants. There is no new tokenizer, segmentation,
normalization, codebook, escape path, or byte decoder.

The model allocates 249 scalar gate slots: one for depth zero and one for each
possible depth up to the 248-merge bound. Only depths present in the frozen
artifact are active. Every gate starts at exact zero. No random number is added
at initialization.

## Control

The matched control is the completed C5.1 seed-0 recipe. Fixing every gate to
zero must reproduce the control's logits, losses, base-model tensors, and
base-model optimizer tensors byte for byte for ten updates. The added gate
slots make the complete checkpoint layouts different, so full-file identity
is not claimed. The treatment starts from the same C2 checkpoint and uses the
exact C5.1 records, order, weights, optimizer, schedule, and compute-token
exposure.

## Evaluation

The evaluator reports ordinary validation nats per token and bits per decoded
raw byte. It also partitions target tokens into frozen merge-depth bands:

- depth 0: base tokens;
- depth 1: one learned pair merge;
- depth 2 or greater: recursively merged tokens.

The depth assignment comes only from the hash-bound tokenizer merge table.
Every token and decoded byte must appear in exactly one band and in the overall
total. Existing claim, cloze, retrieval, evidence, Atlas, and C1 anchor
measurements remain unchanged.

## Gates

All gates are conjunctive:

| Gate | Requirement |
| --- | --- |
| Overall compression | At least 1% lower validation bits per raw byte than C5.1 |
| Deep merges | At least 3% lower nats per target at merge depth 2 or greater |
| Task preservation | No claim, cloze, retrieval-choice, or pair-exact loss greater than 1 point |
| Combined language | No regression in combined validation nats per token |
| Retention | Existing evidence, Atlas, and C1 anchor limits pass |
| Tying | Input and output use the same effective embedding table |
| Mechanics | Exact round trip, causality, finite gradients, and ten-update gate-off shared-state identity pass |
| Compute | Measured operation and wall-time ratios are each at most 1.03 |
| Test | Test content and metrics remain unopened |

A pass supports merge-aware embeddings at this model scale. A failure rejects
this fixed recursive-average residual; it does not reject block or answer-level
hierarchy.

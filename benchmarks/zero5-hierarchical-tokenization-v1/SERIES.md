# ZERO.5 hierarchical tokenization series

## Status

**Three experiments are preregistered. The series is ready for implementation
review.** The series freezes the scientific questions, controls, resource
ceilings, evaluation rules, and execution order. Training authority remains a
separate step.

C6.1 reached its terminal no-go result. The result and selected checkpoint are
hash-bound in `series.json`. This satisfies the series dependency while
preserving the frozen C6.1 interpretation.

## Purpose

The current language path predicts a flat sequence of byte-BPE512 token ids.
The tokenizer itself has a recursive pair-merge tree, while C6.1 adds a
factorized state path beside the language head. This series tests three levels
of hierarchy without changing the lossless byte output:

1. **HT1 MergeTree** exposes the existing BPE merge tree to the tied token
   embeddings.
2. **HT2 BlockState** adds a causal state over completed eight-token blocks.
3. **HT3 AnswerRoot** predicts one prompt-only semantic root and uses it while
   expanding the answer into ordinary tokens.

These are separate causal experiments. A result at one level does not rewrite
the result at another level.

## Shared controls

Every trainable arm keeps the following fixed unless its contract explicitly
names the one changed mechanism:

- the selected C2 initialization checkpoint and fresh AdamW state;
- the lossless byte-BPE512 tokenizer, 512-token context, and 512-token
  language vocabulary;
- the C5.1 grouped training view, answer weights, record order, update groups,
  token exposures, seed, optimizer, schedule, and dropout;
- the frozen combined, evidence, Atlas, C1 anchor, claim, cloze, and retrieval
  validation surfaces;
- exact byte accounting and the existing sealed-test boundary.

The completed C5.1 recipe is the flat baseline. HT2 additionally trains a
parameter-matched one-block control. HT3 uses the terminal C6.1 continuous
shared-state arm as its parameter-matched control.

## Shared mechanics gate

Before any training authorization, each implementation must prove:

1. treatment-off produces byte-identical logits, losses, shared-parameter
   updates, and optimizer updates for ten steps against its named control; a
   full checkpoint must match only when both arms have the same parameter
   layout;
2. future tokens and future blocks cannot affect earlier logits or states;
3. document resets clear every added state;
4. padding positions cannot update or carry state;
5. input and output embeddings remain tied where declared;
6. the exact parameter count and measured operation ratio stay within the
   contract ceiling;
7. all new gradients are finite and nonzero on a deterministic fixture;
8. the launcher fails closed without a separate hash-bound authorization;
9. test content and metrics remain absent and unopened.

## Execution order

The fixed order is HT1, then HT2, then HT3. Completing an earlier experiment
does not itself authorize the next one. Each seed-0 pilot needs its own
registration, implementation review, and one-execution authorization. A pass
can authorize only a request for seeds 1 and 2 under a new frozen replication
contract.

No fourth tuning seed, independent retry, checkpoint publication, model
promotion, or sealed-test access is part of this series.

## Common decision rule

All gates are conjunctive. A pilot is a no-go if any required mechanics,
quality, task, retention, causality, compute, accounting, or test-policy gate
fails. Results must report failed gates as prominently as passed gates.

# Reasoner 5.1 preregistration

## Claim under test

Reasoner 5.1 tests whether a frozen source ranker can transfer through a small,
verified semantic adapter when target programs contain two primitive token IDs
that never occur in source training. It does not revise the Reasoner 5.0
result. Reasoner 5.0 remains a no-go.

## Frozen order of operations

1. Learn integer position and transition counts from the 16 registered source
   programs, all of which use only six known primitives.
2. Freeze and digest that artifact before opening target programs.
3. Reconstruct each opaque primitive from its zero and three basis responses.
4. Verify the reconstruction on three registered challenge vectors.
5. Convert the verified affine description into the same semantic class used
   by source training.
6. Rank all 512 three-token candidates from one target observation. The
   source artifact only breaks evidence ties.
7. Expand candidates in order. Only exact affine equality may accept one.
8. Run the seven registered controls and evaluate the frozen gate.

There are 12 target programs and two registered tie orders, for 24 episodes.
Every target uses at least one opaque primitive. The two opaque operations are
rotate-right and alternating-add-11 over three lanes modulo 257.

## Interpretation

A pass means verified semantic adaptation made source state causally useful on
this exact finite unseen-token task. A no-go means the frozen adapter/ranker
combination did not clear every gate. Either result is published. Neither
outcome establishes non-affine, noisy-evidence, grounded, or open-ended
transfer.

## Seal

The implementation file hashes are part of `contract.json`. Scientific output
can be opened exactly once with approval ID
`reasoner51-unseen-primitive-2026-09-02-v1` and a new exclusive lock path. No
retry and no post-open tuning are allowed.

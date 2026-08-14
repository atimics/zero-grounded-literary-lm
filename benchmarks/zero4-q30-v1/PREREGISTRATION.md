# Q3.0 routed quantity-adapter preregistration

Status: **implementation staged; pilot run not authorized**.

## Decision

Q2.9 retired the shared-weight graded-plasticity family. Its update-50
candidate recovered 81.0518% of quantity training loss and changed replay
training loss by only +0.12325%, but TinyStories reached 2.579735 bits/byte:
2.0521% above immutable ZERO.3 and 1.0417% above the frozen preservation
ceiling. The replay proxy therefore did not protect the evaluated language
distribution.

Q3.0 tests parameter isolation rather than another shared-weight schedule.
Every ZERO.3 parameter remains frozen. A private low-rank adapter
is active only for records whose channel style is the existing `Q` token.
Non-`Q` inputs skip every adapter operation and must remain bit-identical to
ZERO.3.

## Literature boundary

This mechanism is motivated by distributed adapters, task-specific sparse
deltas, and continual-learning parameter isolation:

- Houlsby et al. (2019): https://proceedings.mlr.press/v97/houlsby19a.html
- Guo, Rush, and Kim (2021): https://aclanthology.org/2021.acl-long.378/
- Wang et al. (2023): https://aclanthology.org/2023.acl-long.612/

These papers establish method families in other settings. They do not predict
Q3.0's outcome. Parameter efficiency alone is not treated as a preservation
guarantee; the hard `Q` route and unchanged language gate are authoritative.

## One changed mechanism

Starting from immutable ZERO.3, the `w1` and `w2` FFN matrices in each of the
six transformer layers receive rank-4 additive low-rank deltas:

`W1_Q = W1 + B1 A1`

`W2_Q = W2 + B2 A2`

The `A` factors are deterministically initialized from seed 2. Every `B`
factor starts at exact zero, making update 0 an exact no-op. The 24 adapter
matrices contain 62,976 trainable parameters, 1.297674% of ZERO.3's 4,852,992
parameters. Embeddings, norms, attention, original FFN weights, output
weights, and their optimizer moments are immutable.

The adapter activates only after `CHANNEL_START_TOKEN` followed by literal
style `Q`. In the batched trainer it is inactive for the channel-start row and
active from the `Q` row onward. In streaming inference a channel-start token
clears the route and the following style token selects it. No prompt-text
heuristic or learned router is allowed.

## Pilot and selection

Only seed 2 may run, for at most 200 optimizer updates. The quantity corpus,
tokenizer, learning rate, batch size, weight decay, and gradient clip remain
the frozen Q2.9 values. Only quantity examples produce gradients; direct
replay is measured as an identity invariant rather than used to update the
adapter.

Measurements occur at updates 0, 50, 100, 150, and 200. The first checkpoint
recovering at least 80% of baseline quantity training loss is frozen. If no
checkpoint qualifies by update 200, Q3.0 is a no-go. Selection cannot use
public quantity rows, promotion rows, BLiMP, or TinyStories.

At every update:

- the complete ZERO.3 base state must retain its exact digest;
- all base parameters must remain non-trainable;
- the six-range non-`Q` replay measurement must be bit-identical to update 0.

Any violation fails closed and produces no candidate.

One frozen training-valid candidate may receive the unchanged public quantity,
promotion, and language gates only under separate authorization. Passing the
mechanics or training selector does not authorize promotion or deployment.
Seeds 1 and 3 remain sealed until a complete seed-2 go is reviewed.

## Authority boundary

This preregistration and its implementation authorize no parameter training,
language evaluation, promotion evaluation, seed expansion, deployment, or
external compute. A one-shot runtime budget must bind the exact merged source
commit and all frozen inputs before the pilot can execute.

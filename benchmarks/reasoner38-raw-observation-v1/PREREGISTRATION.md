# Reasoner (3,7) raw-observation transfer preregistration

## Question

Can a small integer policy learn the shared quadratic relation between raw
`current`, `candidate`, and `goal` vectors, then use it to drive tool calls in
larger unseen dimensions?

Reasoner (3,7) removes the semantic readout used by Reasoner (3,5). The policy
never receives `valid`, `progress`, `remaining`, `cost`, or `reversal`. It gets
only raw integer vectors, the raw tool error code, and protocol phase. All
candidate replies must be observed before their raw values enter an `APPLY`
score. The model contains sixteen signed 32-bit weights, or 64 bytes.

The raw feature map pools coordinate-independent first- and second-order
integer terms. It includes sums of candidate, goal, and current coordinates;
sums of their squares; and candidate-goal and current-candidate products. It
does not contain a dimension field, candidate handle identity, domain identity,
distance, progress, or any answer label.

The exact training oracle queries every opaque handle, rejects a nonzero raw
error, and accepts the error-free candidate with minimum squared distance to
the goal. Equal-distance candidates are both valid targets. The learned policy
must produce the complete `QUERY`, `APPLY`, `COMMIT` sequence.

## Training and open development screen

Training uses only dimensions two and three. Its 2,880 episodes cover all
three generator domains, individual and mixed-domain episodes, all six mixed
orders, two opaque-handle orders, two coordinate orders, both signs, and
integer translations from -8 through 8.

The open screen is disjoint. It uses dimensions four and five, four stages,
six held-out generator variants, four opaque-handle orders, four coordinate
orders, sign flips, and translations -3, 0, and 3. It contains:

- 1,728 episodes, including 1,152 mixed-domain episodes;
- 6,912 stage-level coordinate permutations; and
- 36,720 exact tool decisions.

The development gate passes only if every policy decision is exact and all of
these controls behave as preregistered:

- the semantic oracle is exactly correct;
- a zero-weight policy fails;
- shuffled raw tool feedback fails;
- a policy trained without quadratic and product terms fails; and
- a dimension-bound lookup shortcut fails on the held-out dimensions.

## Sealed dimension transfer

The sealed suite is generated only in the authorized cloud runner. It uses
dimensions six through eight, five through seven stages, twelve held-out
variants, four opaque-handle orders, four coordinate orders, translations
from -4 through 4, sign flips, individual domains, and all six mixed-domain
orders. Its fixed size is:

- 15,552 episodes: 5,184 individual and 10,368 mixed;
- 93,312 stage-level coordinate permutations; and
- the exact decision count reported by the one-shot run.

The gate requires exact precision and recall over the whole suite. A failure
is final. There is no retry or post-seal tuning.

## Interpretation

A pass would show compositional dimension transfer from raw integer
observations under this controlled generator. It would be evidence that the
quadratic relation, not a dimension table, opaque handle order, coordinate
order, or semantic verifier field, drives the actions.

It would not show open-ended theorem discovery, natural-language reasoning,
or transfer outside the registered vector/tool family.


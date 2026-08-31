# Reasoner (3,8) exact-law preregistration

## Question

Can an exact integer learner recover the smallest translation-, sign-,
current-, coordinate-, and dimension-invariant law from raw action examples,
then use that law to drive tool calls in larger unseen dimensions?

Reasoner (3,8) keeps the Reasoner (3,7) boundary: the policy receives raw
`current`, `candidate`, and `goal` integer vectors, raw tool error codes, and
protocol phase. It never receives `valid`, `distance`, `progress`, `remaining`,
`cost`, `reversal`, a domain label, a dimension label, or an answer label.

The failed Reasoner (3,7) sealed cases remain quarantined. Their aggregate
result is retained, but no case, seed, variant, failure location, or candidate
is read or reused by this experiment.

## Learner

The raw feature vocabulary is fixed before training. It contains sums of
candidate, goal, and current coordinates; sums of their squares; candidate-goal
and current-candidate products; and the raw error code.

Training supplies only raw episodes and acceptable actions. The learner
enumerates bounded integer coefficient vectors and selects the primitive
vector with minimum L1 description length that satisfies every strict action
margin and an exact algebraic certificate. The certificate is computed over
the feature map, not over hidden examples. It requires:

- invariance under simultaneous integer translation;
- invariance under sign reversal;
- independence from the current vector when candidate and goal are fixed;
- invariance when neutral coordinates with candidate equal to goal are added;
- coordinate-permutation invariance; and
- no dimension, domain, or opaque-handle coefficient.

The final coefficients are not supplied to the search. Manually copying or
repairing a coefficient from Reasoner (3,7) is forbidden.

Protocol coefficients are learned separately by the same minimum-description
integer search. `QUERY`, `APPLY`, and premature `COMMIT` alternatives must be
separated by an exact integer margin. Tied actions are accepted only when the
oracle declares all tied candidates equivalent.

## Training and open screen

Training uses fresh generator salts and dimensions two through four. It covers
three individual domains, all six mixed-domain orders, one through four
stages, twenty variants, two opaque-handle orders, two coordinate orders,
translations from -6 through 6, and both signs.

The disjoint open screen uses dimensions five through eight, five stages,
eight held-out variants, four opaque-handle orders, four coordinate orders,
translations -4, 0, and 4, sign flips, individual domains, and all six mixed
orders. It contains:

- 4,608 episodes, including 3,072 mixed-domain episodes; and
- 23,040 stage-level coordinate-permutation records.

The open gate passes only if:

- the selected law is the unique primitive minimum-description solution and
  is algebraically certified;
- every training and open action is exact with the registered strict margins;
- the semantic oracle is exact;
- a zero policy fails;
- shuffled raw feedback fails;
- a linear-only learner cannot satisfy the law gate; and
- an ordinary unconstrained perceptron can fit training but fails the algebraic
  certificate.

## Fresh sealed transfer

The sealed generator uses a new salt and never recreates Reasoner (3,7)
episodes. It covers dimensions nine through twelve, six through eight stages,
twelve held-out variants, four opaque-handle orders, four coordinate orders,
translations from -6 through 6, sign flips, individual domains, and all six
mixed-domain orders. Its fixed size is:

- 20,736 episodes: 6,912 individual and 13,824 mixed; and
- 145,152 stage-level coordinate-permutation records.

The sealed gate requires every action and every episode to be exact. A failure
is final. There is no retry or post-seal tuning.

## Interpretation

A pass would support the claim that exact, minimum-description law induction
can replace approximate policy fitting for this raw nonverbal substrate. It
would not establish open-ended mathematical discovery or transfer outside the
registered quadratic vector/tool family.

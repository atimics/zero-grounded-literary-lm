# Reasoner 4.1 joint-transfer preregistration

## Question

Can the learner identify a fresh composed input representation and a fresh
composed law in the same episode, then act exactly without a task label, a
hand-coded domain switch, adapter-law compensation, or a core change?

Reasoner 4.1 tests the cross-product deliberately excluded from Reasoner 4.0.
It is a bounded joint-transfer question inside two already registered finite
languages. It is not arbitrary representation learning, discovery outside the
law grammar, or natural-language reasoning.

## Frozen cores

The representation layer is the unchanged Reasoner 4.0 adapter learner. Its
public development digest is `6af623f4d0e176fe`, with 170 canonical adapter
classes: one identity, six one-operation classes, 29 two-operation classes,
and 134 three-operation classes.

The law layer is the unchanged Reasoner (3,9) active integer-program learner.
Its public development digest is `c16b44a0ab50c456`, with 52 canonical laws:
six one-fold laws, 15 two-fold laws, and 31 three-fold laws. The contract pins
the source hashes of both layers.

No adapter operation, law operation, canonicalization rule, minimax rule, or
action rule may change after this preregistration.

## Separate commitment protocol

Each episode contains one hidden adapter and one hidden law. The learner must
complete these stages in order:

1. receive one raw-to-canonical alignment example;
2. call `ALIGN` while more than one adapter remains;
3. call `ADAPTER_COMMIT` only when one exact adapter remains;
4. replay all 288 registered raw probes exactly;
5. receive two raw law-comparison demonstrations;
6. call `LAW_QUERY` while more than one law remains;
7. call `LAW_COMMIT` only when one exact law remains;
8. make three exact `APPLY` calls;
9. call the joint `COMMIT`; and
10. call `REPORT` with both canonical programs.

The law learner receives no evidence until the adapter commitment. The exact
adapter identity and complete replay are checked independently before the law
commit, so a wrong adapter cannot be accepted because a different law happens
to produce the same action.

## Public development screen

The curriculum crosses all six one-operation adapters with all six one-fold
laws in dimension four and two opaque orders: 72 episodes.

Development crosses all 29 unseen two-operation adapters with all 15 unseen
two-fold laws in dimensions five through eight and two fresh opaque orders:
435 target pairs and 3,480 episodes. Every target adapter and every target law
is absent from the curriculum as a semantic class.

The exact development gate requires:

- both frozen-core source and semantic certificates;
- a unique adapter before every adapter commit;
- 1,002,240 exact raw-to-IR replays;
- a unique law before every law commit;
- every active query to match its registered minimax rule;
- all 10,440 actions, 3,480 joint commits, and 3,480 reports to be exact;
- no premature adapter, law, or joint commit;
- oracle-adapter and oracle-law isolation controls to pass; and
- identity-adapter, curriculum-pair, no-adapter-query, no-law-query,
  shuffled-alignment, and shuffled-law-feedback controls to fail.

## Fresh sealed cross-product

The unopened seal crosses all 134 three-operation adapters with all 31
three-fold laws in dimensions nine through twelve and two new opaque orders:
4,154 target pairs and 33,232 episodes. Every component and every pair is
absent from curriculum and development.

Local sealed execution is forbidden. The seal has zero scientific retries and
allows no tuning after opening. A later cloud run requires a frozen source
bundle, its exact hash and byte count, explicit user authorization for that
bundle, a cost and time cap, and a permanent one-shot execution lock.

This preregistration does not authorize a sealed run.

## Interpretation

A sealed pass would support exact, factorized joint transfer inside the
registered reversible adapter and typed integer-program languages. It would
not establish arbitrary representation recovery, new adapter or law
primitives, visual or natural-language grounding, noisy learning, or
open-ended mathematical invention.

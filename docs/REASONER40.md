# Reasoner 4.0: active representation induction

Reasoner 4.0 adds an exact representation adapter in front of the frozen
Reasoner (3,9) law engine. It learns a reversible raw encoding from alignment
examples, replays every registered raw probe into canonical IR, then lets the
unchanged core identify and apply a familiar law.

```text
opaque raw field vector
          |
          v
active exact adapter induction
          |
          v
canonical Reasoner IR
          |
          v
frozen Reasoner (3,9) law core
          |
          v
QUERY -> APPLY -> COMMIT -> REPORT
```

The adapter language contains six reversible operations over the prime field
257: reverse, rotate-left, prefix-sum, adjacent-pair shear, add 17, and
multiply by 3. Enumeration through depth three yields 259 raw programs and
170 canonical semantic classes.

The public screen is exact:

- 72 curriculum episodes over individual adapter operations;
- 1,392 development episodes over 29 unseen two-operation adapters;
- 400,896 exact raw-to-IR development replay checks;
- 1,392 exact adapter identifications and law identifications;
- 4,176 exact actions plus 1,392 exact commits and reports;
- at most one active adapter query and two frozen-core law queries per
  development episode; and
- an oracle adapter passes while identity, curriculum lookup, no-query, and
  shuffled-alignment controls fail.

The embedded Reasoner (3,9) development digest remains
`c16b44a0ab50c456`. Its 52 canonical programs, six familiar one-fold laws,
and complete dimension-vector semantic catalogue are rechecked before the
Reasoner 4.0 screen runs.

Run the public screen with:

```sh
make reasoner40-check
./reasoner40 development
make reasoner40-contract-check
```

The planned fresh seal contains 6,432 episodes over all 134 canonical
three-operation adapters, dimensions nine through twelve, two new opaque
probe orders, and the same six familiar laws. It is locked and unauthorized.
The compiled evaluator requires a cloud-only environment marker, the exact
frozen approval ID, and a new exclusive execution-lock path. A normal local
`./reasoner40 sealed-run RESULT.json` call refuses execution before any sealed
episode is evaluated.

A future sealed pass would support active compositional induction of an exact
adapter inside this registered reversible language. It would not support a
claim about arbitrary raw formats, unseen adapter primitives, images, natural
language, or simultaneous transfer to unseen law compositions. See the
[`preregistration`](../benchmarks/reasoner40-active-representation-v1/PREREGISTRATION.md)
and
[`locked contract`](../benchmarks/reasoner40-active-representation-v1/aws-contract.json).

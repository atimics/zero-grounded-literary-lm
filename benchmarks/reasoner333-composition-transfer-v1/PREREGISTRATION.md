# Reasoner (3,3,3) composition-transfer preregistration

Status: frozen before the sealed family is opened.

## Question

Can a compact policy trained only on isolated exact-offset modules produce
minimum verifier-guided traces when unseen, larger modules are joined by
bridge relations?

## Fixed data split

- Training: the three offsets of one two-variable module.
- Development: programs 1 through 15 over two width-2 modules and one bridge.
- Sealed: programs 1 through 63 over three width-3 modules and two bridges.
- Integer domain: `{-1, 0, 1}`.
- Relation constants: `{-1, 0, 1}`.
- Sealed labels: the six program bits followed by `b0 xor b3`, `b1 xor b4`,
  and `b2 xor b5`.

No sealed case may be used for feature choice, training, pruning, tie breaking,
or threshold selection.

## Fixed arms

- 16 signed 32-bit semantic weights: 64 bytes.
- 12-key exact training lookup plus actions and count: 64 bytes.
- Semantic policy with bridge feedback masked.
- Semantic policy with bridge actions removed.
- Legal-action tool with all semantic features zeroed.

All arms receive the same exact verifier and legal witness-resolving edits.

## Fixed interventions and outcomes

The semantic arm is rerun after four complete variable relabelings for every
program. A program counts as exact only if verification accepts it after the
minimum `2 * edge_count` edits. The gate requires 63 of 63 semantic programs
and 252 of 252 relabelings, while every control must be below 63 minimum
programs.

There are no retries for a scientific failure. Infrastructure failure before
a result artifact exists may be reviewed separately without changing source,
data, or thresholds.

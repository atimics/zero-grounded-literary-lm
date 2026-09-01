# Reasoner (3,3,1) preregistration

This file freezes the relational graph experiment before any sealed case is
opened.

## Question

Can one compact witness-conditioned policy, trained only on small paths,
produce minimum exact traces for larger integer difference-constraint trees
with unseen size and topology?

## Fixed family

- Integer domain: `[-2, 2]`.
- Atom: `x_i - x_j <= c`.
- Constants: `c in {-1, 0, 1}`.
- Target graph: a tree with one directed atom per undirected edge.
- Actions: toggle one of the six possible atoms on a target graph edge.
- Exact minimum: one edit per tree edge.

## Fixed split

- Training: complete 2-node and 3-node path target census, 42 programs and
  426 verifier decisions after subset and wrong-extra expansion.
- Development: complete 4-node path and 4-node star census, 432 programs.
- Sealed: complete 5-node path, star, and fork census, 3,888 programs.

The fork has edges `(0,1), (1,2), (1,3), (3,4)`. No development or sealed
decision may be used for training, feature selection, pruning, or tuning.

## Fixed arms

- Semantic: 16 signed 32-bit weights over shared relational features.
- Fixed hash: 16 signed 32-bit weights over hashed finite contexts.
- Witness-masked: semantic weights without source or repaired states.
- Tool-only: exact witness-resolving actions with no learned ranking.

All arms have the same verifier calls and legal action set. Semantic and hash
active capacity is 64 bytes each.

## Development gate

The sealed suite stays closed unless all conditions hold:

- semantic minimum traces are 432/432;
- exact relabeling actions are 31,104/31,104;
- semantic final training errors are zero; and
- the hash arm does not pass all 432 programs exactly.

The frozen local result passes: semantic 432/432, relabelings 31,104/31,104,
and hash 2/432.

## Sealed gate

A pass requires:

- semantic minimum traces are 3,888/3,888;
- exact relabeling actions are 1,866,240/1,866,240;
- hash, witness-masked, and tool-only do not pass all 3,888 programs exactly;
- semantic capacity is at most hash capacity; and
- the result is written even when the gate fails.

There is one scientific execution and no retry for a failed gate. Infrastructure
failure handling must preserve the execution lock and record the failure.
Language training and model promotion are out of scope.

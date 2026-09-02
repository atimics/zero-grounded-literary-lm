# Reasoner 5.2 preregistration

## Claim under test

Reasoner 5.2 tests a nonlinear family and a deeper composition length. A frozen
source artifact is learned from 16 two-operation programs. It contains only
semantic-class frequencies and adjacent class-transition counts. The target is
12 three-operation programs, each nonlinear, evaluated under two fixed tie
orders.

## Frozen procedure

1. Learn and digest the source artifact before target programs are opened.
2. Enumerate all 512 three-operation candidates.
3. Rank from observations at field inputs zero and one, using the source
   artifact only to break evidence ties.
4. Expand candidates in order. Only equality on all 17 field inputs may accept
   a candidate.
5. Run oracle, target-only, source-ablation, affine-projection, degree-blind,
   shuffled-source, and source-only controls.
6. Evaluate every frozen gate and publish pass or no-go.

This is an exact finite nonlinear test. It is not a claim about recursion,
unbounded programs, noisy data, language, or grounding.

## Seal

The implementation hashes are frozen in `contract.json`. The scientific target
may be opened exactly once with approval ID
`reasoner52-nonlinear-depth-2026-09-02-v1` and a fresh exclusive lock. No retry
or post-open tuning is allowed.

# Reasoner 5.8 development implementation

Reasoner 5.8 tests whether source behavior can improve exact search for new
nonlinear compositions. This implementation follows the frozen design in
`docs/REASONER5-NEXT.md` and
`benchmarks/reasoner5-next-set-v1/PLAN.json`.

## Finite domain

Every program maps one `GF(17)` value to one `GF(17)` value. The eight atoms
are two translations, two scales, negate, square, cube, and `x^2+x+1`.
Source programs have depth one or two. Target programs have canonical depth
three. Exhaustive enumeration produces 585 syntax programs and 428 semantic
classes. A complete 17-value truth table defines each semantic class.

The four target shifts use these affine and nonlinear atom patterns:

1. `AAN`: a known operation in a new composition.
2. `NAA`: a changed semantic class order.
3. `ANA`: a new cross-class composition with familiar atoms.
4. `NNN`: a longer nonlinear chain.

The syntax-first generator uses canonical program order. The behavior-skeleton
generator orders programs by exact output structure before it selects a short
syntax. Two separate input generators expose either two seeded distinct field
values or the fixed anchors zero and one. Program generation and input
generation vary independently. Each development shift has two program
families in each of two fixed program-generator environments. Every program
family is paired with both input generators. The paired input episodes stay
nested inside the program family.

## Frozen source guide

All 64 source tasks appear as replayable source episodes in the common
manifest. Exact source enumeration labels every semantic partial program.
A label is positive when the partial lies on the canonical shortest solution
path. The artifact stores Laplace-smoothed signed Q20 log odds for:

- output count, fixed points, collisions, polynomial degree, and invertibility;
- complete partial-execution table signatures;
- typed depth and subtree roles;
- legal operation transitions; and
- raw surface-token positions for the lexical control.

The core accumulates scores in signed 64-bit integers. The artifact has an
explicit little-endian format, an internal SHA-256 checksum, and a full-file
SHA-256 identity. Its parser checks every field and every stored score.

## Search and controls

Every arm uses the same 428-class semantic universe, one bottom-up search
interface, an exhaustive 17-point verifier, and one common cap. The main arm
uses the frozen behavior guide. The source-free guide learns only from the
two public examples. Registered controls cover target-only enumeration,
transition-only scoring, raw-token scoring, behavior-off scoring, shuffled
behavior signatures, consistent token permutation, source-only scoring, and
oracle truth rank. Thirty-one frozen behavior derangements support the random
order check.

The queue releases a semantic child only after its canonical semantic parent
has been popped. Every primary development row supplies the complete
parent-gated order. The canonical digest-bound fallback remains available for
censoring and recovery. Focused tests check parent-before-child order for every
arm and every development episode.

The behavior-off path reads the same artifact bytes and keeps the typed roles,
transitions, source labels, and binary layout. It removes behavior feature
scores at the ranking boundary. The source-ablation row is a byte-for-byte
copy of the source-free operational row with only the arm name changed.

Every proposed answer enters the exact verifier. An injected wrong candidate
enters first in every arm. The target-only arm uses direct size enumeration in
the same complete bottom-up queue. Separate adversarial tests exercise
canonical fallback, cap-plus-one charging, and complete-exhaustion charging.

The source raw-token table uses the canonical source vocabulary. Each target
episode registers a surface-token permutation. Raw-token scores respond to
that mapping. The semantic guide keeps the same order when the mapping is
applied consistently, which is also checked against the `token_permuted` arm.

## Data boundary and replay

The ranker receives one recursive public schema. It contains the public
grammar and observed examples. The full target AST, truth table, episode
recipe, source assignment, and verifier state remain in the evaluator view.
The shared harness enforces field names, leaf types, provenance classes, arm
parity, and exact raw-row keys.

The manifest registers families before it assigns episode seeds. It includes
64 source episodes, 32 calibration episodes from 16 program families, 32
development episodes from 16 program families, and 16 sealed family slots.
The sealed slots contain no episode seed. Every recorded input-generator rule
produces exactly two distinct public field values.
Generator code, input generation, replay code, source counts, artifact bytes,
raw rows, analysis settings, and the final result all have linked SHA-256
receipts.

## Development result

The full crossed development set has 16 independent program families, 32
episodes, and 1,344 raw rows. The two fixed program-generator environments
have equal weight. Each shift has four independent program families and eight
input-generator episodes. Four families exceed the registered minimum of
three. The selected source-free comparator has a median primary cost of 6.
The registered measurement floor is 16. The development decision is therefore
`measurement-floor`.

The full guide has a family-weighted geometric cost ratio of 1.1040 against
the source-free comparator. The 99 percent interval is 0.9148 to 1.3080.
There are 7 wins, 1 tie, and 8 losses. These measurements describe the
development set. They carry no scientific claim.

## Execution boundary

This branch authorizes development fixtures. The `execute`, `sealed`, and
`run` commands require a later frozen contract and explicit approval. The
checked manifest records zero scientific executions. The current development
decision is an engineering measurement and carries no scientific claim.
Reasoner 6.0 stays behind the registered Reasoner 5.8 pass gate.

Run the focused checks with:

```sh
make reasoner58-check
make reasoner58-sanitize-check
make reasoner58-development-check
make reasoner58-contract-check
```

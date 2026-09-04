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
syntax. Each development shift has three independent families and includes
both generators.

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
public example. Registered controls cover target-only enumeration,
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
64 source episodes, eight calibration episodes, 12 development episodes, and
12 sealed family slots. The sealed slots contain no episode seed. Generator
code, input generation, replay code, source counts, artifact bytes, raw rows,
analysis settings, and the final result all have linked SHA-256 receipts.

## Execution boundary

This branch authorizes development fixtures. The `execute`, `sealed`, and
`run` commands require a later frozen contract and explicit approval. The
checked manifest records zero scientific executions. The current development
decision is an engineering measurement and carries no scientific claim.

Run the focused checks with:

```sh
make reasoner58-check
make reasoner58-sanitize-check
make reasoner58-development-check
make reasoner58-contract-check
```

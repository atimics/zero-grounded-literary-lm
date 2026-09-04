# Reasoner 5.6 development specification

Status: development only

Reasoner 5.6 studies passive transfer of a learned observation model. The
checked fixture exercises the complete local implementation and the shared
Reasoner 5 evidence harness. A future preregistration will freeze fresh sealed
families and the publication rule.

## Exact program domain

Programs contain three operations over GF(17). The eight operations are add
one, multiply by two, negate, square, cube, add five, square plus input, and
cube plus one. Lexicographic enumeration creates 512 syntax programs. Exact
evaluation on all 17 inputs creates 427 semantic classes. The first syntax
program in each class is its canonical representative.

The exact verifier evaluates the accepted representative on all 17 inputs.
The ranker orders complete semantic classes. The verifier holds acceptance
authority.

## Split order and source artifact

Semantic classes are assigned before any episode is generated. The fixed
order is source training, calibration fit, calibration coverage, development,
and sealed reserve. The implementation rejects repeated AST, behavior, or
episode identities across lanes.

The source generator emits 256 depth-three programs, which cover 193 unique
semantic classes. Every source program is observed at all 17 inputs through
all three sensor IDs. Eight deterministic channel templates cover replacement,
input and value effects, bursts, random missingness, context-based missingness,
value-based missingness, and missing blocks.

Direct probes fill each local leaf to at least 32 observations. Ordered source
sequences continue until every exact first-order transition context has at
least 32 observations. The fixed local backoff is:

1. sensor, input, candidate value;
2. sensor, candidate value;
3. sensor;
4. global.

The fixed transition backoff is:

1. previous sensor, current sensor, previous state;
2. current sensor, previous state;
3. previous state;
4. global.

Each legal outcome receives a plus-one pseudocount. Log probabilities are
stored as signed Q20 integers. Candidate scores accumulate in signed 64-bit
integers.

The artifact has an explicit little-endian format. Its header fixes every
domain constant. A checksum covers the payload. The reader validates the
checksum, constants, length, and end of file. The family manifest also binds
the complete artifact with SHA-256.

## Posterior and calibration

The full score combines the frozen program guide, local emission scores, and
the first-order state score. The main `robust_hamming` comparator uses the same
program guide. Softmax runs over all 427 semantic classes after subtracting
the largest score. Equal scores receive equal probability.

Six temperatures are eligible: `0.25, 0.5, 1, 2, 4, 8`. Sixteen disjoint
program families select one temperature from their family-mean log loss over
eight channel draws. A further 99 disjoint program families set the 99 percent
candidate-mass threshold. Each family contributes its worst score over eight
channel draws. The finite-sample rank is 99. A full-set threshold of 1 applies
when the requested rank is unavailable.

## Public ranker boundary

The public ranker tree has one array named `observations`. Each observation has
exactly four typed leaves:

- `input`, an integer from 0 through 16;
- `sensor`, an integer from 0 through 2;
- `observed`, an integer from 0 through 16;
- `missing`, a Boolean.

A missing observation uses `observed = 0` as its canonical encoding. The
validator walks the complete tree and accepts only this shape. Candidate
semantics and the frozen artifact enter through separate read-only arguments.
Clean targets, channel details, severities, locations, directions, and seeds
remain evaluator data.

The source-free and source-ablation arms receive a null artifact. One execution
record supplies both aliases. Their probabilities, scores, search receipts,
costs, and artifact-read counts match exactly.

## Development crossing and controls

The fixture crosses eight program families with all eight modeled corruption
families and two nested repeats. This creates 128 episodes. Every episode runs
45 arms:

- full learned channel, robust Hamming, target-only, source-free, and
  source-ablation;
- one-trim, Markov-off, shuffled-sensor, value-only, mask-only, channel-only,
  and program-prior-only;
- oracle-channel and clean-evidence controls;
- 31 fixed within-row outcome-label derangements.

The target-only arm has a median verifier cost of 43, with a range from 34 to
51. This provides development headroom without choosing fixtures from the
treatment effect.

Repeat 0 trains the frozen static proxy classifier. Repeat 1 evaluates it. The
sensor-only and augmented balanced accuracies are both 0.125. The maximum
template fraction in every public static cell is 0.125. Runtime taint checks
also pass.

## Search and replay

The ranker proposes at most 24 classes. A SHA-bound canonical order supplies
fallback over the same immutable 427-class universe. Every proposal, fallback
expansion, and verifier call is charged. A capped unsolved search costs the cap
plus one. Each arm also receives an invalid first proposal, which the verifier
must reject.

The native trace has 5,760 rows. The shared harness normalizes all rows to its
strict schema, checks exact episode-by-arm coverage, reconstructs every family
manifest episode, binds arm parity, verifies fallback linkage, aggregates the
two-way program-by-corruption design, and rebuilds the result from raw traces.
Unknown wall time and peak memory are stored as JSON `null`.

## Development result

The shared search-cost gate resolves `no-go` on this fixture. Seven checks
fail: `primary_ratio`, `primary_upper_limit`, `family_win_rate`,
`family_win_lower_limit`, `marginal_win_gates`, `primary_strata`, and
`mechanism_effects`. Integrity, exact answers, certificates, invalid-first
rejection, fallback accounting, derangement checks, and source-ablation
equality pass.

The separate channel-readiness assessment resolves `development-ready`. The
full arm has mean log loss 0, compared with 6.056784 for uniform and 9.234742
for program-prior-only. Its candidate set has mean size 1 versus 427, with
coverage 1 and a one-sided 95 percent Wilson lower bound of 0.979300. Its mean
Brier score is about 5.30e-62 and its fallback rate is 0. All seven readiness
checks pass.

These values describe a deterministic engineering fixture. Fresh family
selection, power analysis, a frozen publication rule, and explicit execution
approval form the remaining scientific boundary.

## Execution boundary

The CLI supports self-tests and deterministic development fixtures. The
`execute` command exits with an authorization error. The contract contains no
sealed seed and records zero scientific executions.

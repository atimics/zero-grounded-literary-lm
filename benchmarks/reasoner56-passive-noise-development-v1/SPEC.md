# Reasoner 5.6 development specification

Status: development only

Reasoner 5.6 studies passive transfer of a learned observation model. This
implementation prepares and tests the finite domain. Preregistration will open
the sealed lane and define the scientific decision.

## Exact program domain

Programs contain three operations over GF(17). The eight operations are add
one, multiply by two, negate, square, cube, add five, square plus input, and
cube plus one. Lexicographic enumeration creates 512 syntax programs. Exact
evaluation on all 17 inputs creates 427 distinct semantic classes. The first
syntax program in each class is its canonical representative.

The exact verifier rebuilds a representative and checks all 17 outputs. The
ranker may order classes. Only this verifier can accept one.

## Source artifact

A counter-keyed source generator creates 256 depth-three programs. Every source
program is observed at all 17 inputs through all three sensor IDs. Eight
deterministic corruption templates cover replacement, input and value effects,
bursts, random missingness, context-based missingness, value-based missingness,
and missing blocks.

Direct probes fill each local leaf to at least 32 observations. Extra ordered
sequences fill each first-order transition leaf to at least 32 observations.
The fixed local backoff is:

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
domain constant. A checksum covers every byte before the checksum field. The
reader rejects a changed byte, a changed constant, a short file, or trailing
bytes.

## Posterior and calibration

The full score adds the frozen program-class prior, local emission scores, and
the first-order state score. Softmax runs over the 427 semantic classes after
subtracting the largest score. Equal scores receive equal probability.

One development lane selects a temperature from `0.25, 0.5, 1, 2, 4, 8`. A
disjoint development lane stores the conservative 99 percent cumulative-mass
threshold. The artifact records both lane counts and digests. Candidate sets
include every class tied at the boundary.

## Public ranker boundary

The public ranker tree has one array named `observations`. Each observation has
exactly four typed leaves:

- `input`, an integer from 0 through 16;
- `sensor`, an integer from 0 through 2;
- `observed`, an integer from 0 through 16;
- `missing`, a Boolean.

A missing observation uses `observed = 0` as its single canonical encoding.

The validator walks the complete tree. It rejects an extra leaf at any depth.
Candidate semantics and the frozen artifact enter through separate read-only
arguments. Hidden targets, clean values, channel family values, severity,
location, direction, and seeds have no field in the ranker type.

## Development controls and traces

The fixture runs full, source-free, source-ablation, one-trim, and Markov-off
arms. Source-free and source-ablation call the same implementation path and
must produce equal probabilities, integer scores, exact-search receipts, and
zero source-artifact reads.

Every trace row records exactness, certificate validity, verifier charges,
partial expansion charges, fallback work, observation count, invalid-first
rejection, source reads, and the candidate-universe, initial-evidence, verifier,
and artifact receipts. Matched arms share these receipts. One fixture episode
starts canonical fallback after the injected invalid proposal. The self-test
also checks a capped unsolved search and its cap-plus-one cost.

## Safety boundary

The CLI supports self-tests and deterministic development fixtures. The
`execute` command always stops with an authorization error. The contract holds
no sealed seed and records zero scientific executions.

The shared Reasoner 5 harness will add family manifests, seed commitments,
aggregate arm parity, trace coverage, two-way uncertainty, and result replay
before the R5.6 preregistration freezes.

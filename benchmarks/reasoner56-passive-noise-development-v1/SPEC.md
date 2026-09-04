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
the largest score. Equal scores receive equal probability. Calibration and
development comparisons compute log loss directly from Q20 scores as
`logsumexp(score) - truth_score`. The implementation separates maximum-score
ties and applies `log1p` to the lower tail. This preserves small competing
mass when the displayed truth probability rounds to one.

Native floating-point fields are diagnostic. Their JSON form retains the
first 14 significant decimal digits without final rounding. A macOS arm64 and
Linux x86_64 comparison found a maximum native absolute drift of
`4.440892098500626e-16` and a maximum relative drift of
`3.109391836691082e-16`. The largest change from the serialization boundary
was `9.57811607804615e-12` absolute and `9.832082644494586e-14` relative. The
stable signed-Q20 score-space replay remains the authoritative log-loss
evidence.

Six temperatures are eligible: `0.25, 0.5, 1, 2, 4, 8`. Sixteen disjoint
program families select one temperature from their family-mean log loss over
eight channel draws. A further 99 disjoint program families set the 99 percent
candidate-mass threshold. Each family contributes its worst score over eight
channel draws. The finite-sample rank is 99, and its selected threshold is 1
on this development fixture. The registered unavailable-rank fallback also
uses 1. A threshold of 1 uses the exact full universe. This includes every
smoothed positive-mass class even when its floating-point probability rounds
to zero.

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
template and severity labels receive separate checks. The maximum registered
gain is two balanced-accuracy points. No public static cell may identify one
template or severity with certainty. Template balanced accuracy stays at
0.125, with a gain of 0 and a maximum cell fraction of 0.125. Severity balanced
accuracy changes from 0.284743 to 0.25, with a maximum cell fraction of 0.5625.
Runtime taint checks also pass.

## Search and replay

The ranker proposes at most 24 classes. A SHA-bound canonical order supplies
fallback over the same immutable 427-class universe. Every proposal, fallback
expansion, and verifier call is charged. Every unsolved search costs the cap
plus one. Its receipt distinguishes a cap stop from complete fallback
exhaustion. Each arm also receives an invalid first proposal, which the
verifier must reject.

The native trace has 5,760 rows. The shared harness normalizes all rows to its
strict schema, checks exact episode-by-arm coverage, reconstructs every family
manifest episode, binds arm parity, verifies fallback linkage, aggregates the
two-way program-by-corruption design, and rebuilds the result from raw traces.
Unknown wall time and peak memory are stored as JSON `null`.
The contract binds both the stored gzip bytes and the canonical uncompressed
JSONL content. Cross-platform checks stream the content digest, so differences
between supported zlib encoders do not change the scientific trace identity.

## Development result

The shared search-cost gate resolves `no-go` on this fixture. Seven checks
fail: `primary_ratio`, `primary_upper_limit`, `family_win_rate`,
`family_win_lower_limit`, `marginal_win_gates`, `primary_strata`, and
`mechanism_effects`. Integrity, exact answers, certificates, invalid-first
rejection, fallback accounting, derangement checks, and source-ablation
equality pass.

The separate channel-readiness assessment resolves `development-no-go`. The
full arm has mean log loss 2.035434e-32, compared with 6.056784 for uniform
and 9.234742 for program-prior-only. All 128 displayed full-arm truth
probabilities round to one. Independent score replay preserves their positive
loss and matches the native values within 6.95e-14 relative error. The exact
threshold-one rule gives both the full and program-prior-only arms a
family-weighted mean candidate-set size of 427. The
size ratio is 1, so the registered 0.8 size gate fails. Candidate-set coverage
comes from the registered disjoint calibration-coverage lane. Its 99
program-family records bind all 792 draws. An independent JavaScript scorer
parses the artifact, rebuilds every full-arm Q20 score from each public draw,
and derives the family coverage values. All 99 families cover the truth and
their one-sided 95 percent Wilson lower bound is 0.973398. The development
interface and proxy audits pass. The sealed interface and proxy audit remains
pending, so the Reasoner 5.7 readiness gate stays closed for both reasons.

These values describe a deterministic engineering fixture. Fresh family
selection, power analysis, a frozen publication rule, the sealed interface and
proxy audit, and explicit execution approval form the remaining scientific
boundary.

## Execution boundary

The CLI supports self-tests and deterministic development fixtures. The
`execute` command exits with an authorization error. The contract contains no
sealed seed and records zero scientific executions.

# Reasoner 5.6: passive learned-noise transfer

Reasoner 5.6 has a complete development implementation. It uses 512
depth-three GF(17) programs and deduplicates them into 427 exact truth-table
classes. A deterministic source builder learns a three-sensor observation
model with local emissions, initial state counts, and first-order error and
missingness transitions from real ordered sequences.

The implementation includes fixed support-32 backoff, plus-one smoothing,
signed Q20 log scores, 64-bit score accumulation, normalized posteriors, fixed
temperature calibration, a 99 percent candidate set, exact verification,
canonical fallback, and the full control surface. Temperature fit and
candidate-set coverage use separate semantic family lanes. Their counts and
receipts are stored in the artifact.

The calibration-coverage receipt records 99 independent program families. It
binds and replays all eight corruption draws for each family, for 792 exact
draw receipts. Coverage uses one worst-draw result per program family.

The ranker boundary is structural. It accepts only the four declared leaves
inside each public observation. Hidden target and channel values have no valid
path through that interface. Missing observations have one canonical public
encoding. The public acquisition order has its own seed root, independent of
the target program and corruption family.

The development fixture crosses eight program families with eight corruption
families and two nested repeats. All 128 episodes run 45 arms, including 31
fixed channel derangements. The target-only verifier cost ranges from 34 to 51,
which supplies clear development headroom.

The artifact format is explicit little-endian data with a versioned header and
an integrity checksum. Development output is byte reproducible. The shared
Reasoner 5 harness checks every one of the 5,760 episode-arm rows, family
manifest replay, arm parity, exact-search receipts, two-way aggregation, and
result replay.

The search-cost gate gives a development `no-go`. The separate channel check
also gives a development `no-go`. All 99 calibration-coverage program families
cover the truth across their eight draws. The one-sided Wilson lower bound is
above 0.97. Full-arm candidate sets on the development lane have family-weighted
mean size one, while the program-prior-only sets have mean size 427. The
development interface, template proxy, severity proxy, and source-isolation
taint checks pass. The sealed interface and proxy audit remains pending.

The command for sealed execution stays closed. Reasoner 5.7 remains behind the
channel-readiness gate. The next scientific step is a reviewed preregistration
with fresh sealed families, a power result, a frozen publication rule, the
sealed interface and proxy audit, and explicit approval.

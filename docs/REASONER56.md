# Reasoner 5.6: passive learned-noise transfer

Reasoner 5.6 now has a complete development implementation. It uses 512
depth-three GF(17) programs and deduplicates them into 427 exact truth-table
classes. A deterministic source builder learns a three-sensor observation
model with local emissions, initial state counts, and first-order error and
missingness transitions.

The implementation includes fixed support-32 backoff, plus-one smoothing,
signed Q20 log scores, 64-bit score accumulation, normalized posteriors, fixed
temperature calibration, a 99 percent candidate set, exact verification,
canonical fallback, and source-free and mechanism controls. Temperature fit
and candidate-set coverage use separate deterministic development lanes. Their
counts and receipts are stored in the artifact.

The ranker boundary is structural. It accepts only the four declared leaves
inside each public observation. Hidden target and channel values have no valid
path through that interface. Missing observations have one canonical public
encoding. The public acquisition order has its own seed root, independent of
the target program and corruption family.

The artifact format is explicit little-endian data with a versioned header and
an integrity checksum. Development output is byte reproducible and includes a
raw row for every arm and episode. Each row carries the same candidate-universe,
initial-evidence, verifier, and artifact receipts across its matched arms.

This stage is preparation. The command for sealed execution stays closed. The
next engineering step is to join these rows and artifacts to the shared
Reasoner 5 family manifest, parity, statistics, and result-replay code. The next
scientific step is a reviewed preregistration with fresh sealed families and
fresh approval.

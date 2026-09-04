# Reasoner 5 generated-family harness

Status: development infrastructure

This harness is the common boundary for Reasoner 5.5 through 5.9. It builds
replayable family manifests, presents a narrow public view to rankers, checks
arm parity, aggregates family-level evidence, and binds results to raw traces.
It contains no experiment-specific scoring rule.

The implementation is
[`scripts/lib/reasoner5_harness.mjs`](../../scripts/lib/reasoner5_harness.mjs).
The independent executable check is
[`scripts/check_reasoner5_harness.mjs`](../../scripts/check_reasoner5_harness.mjs).

## State order

The builder has three ordered states:

1. register disjoint source, calibration, development, and sealed family
   lanes;
2. close family registration;
3. generate episodes inside their registered lane.

An episode records separate canonical fingerprints for its target AST, exact
behavior, and full specification. A fingerprint may repeat inside one lane
when the repeat is declared. The builder rejects a fingerprint that appears
in another lane. Family keys use the same rule.

Seeds are lowercase hexadecimal strings. Counter-based derivation keeps every
family, episode, and repeat independent of call order. The manifest records
SHA-256 seed commitments. Replay resolves through a registry keyed by the task
generator hash, input-generator hash, and replay-function hash. Replay code
receives only the fixed recipe. Function hashes use the intrinsic JavaScript
source operation and reject opaque native functions. The private registry map
is held outside the public registry object. A crossed episode may name only a
second family registered in the same split lane.

Ranker views are created by a recursive leaf whitelist with a type and
public-provenance class for every leaf. Every listed leaf must be present in
every matching array item. Extra fields are rejected at every depth. Hidden
field names are matched without regard to letter case. Hidden targets, clean
values, exact test domains, family data, generator data, corruption data,
renderer data, response-tape data, tie data, and latent state stay in the
evaluator record.

## Arm and verifier boundary

Each arm receives a receipt for its grammar, candidate multiset, initial
evidence, action set, latent episode, potential responses, verifier, and caps.
The parity check lists every difference outside the registered intervention.
Candidate multiset fingerprints bind paired semantic and syntax-tree digests
with exact multiplicities. They also bind the full canonical candidate record.
Candidate order cannot change the multiset receipt. Fallback uses the canonical
order by semantic digest, syntax digest, and full-record digest. A changed
syntax tree, semantic value, duplicate count, work charge, or fallback order
changes or invalidates the receipt.

The common verifier helper gives the verifier a frozen candidate snapshot and
returns one accept-or-reject value to the ranker. Every proposal must belong to
the registered candidate universe. Experiment code supplies the exact
semantic bytes and an evaluator-only counterexample receipt. A test places an
invalid candidate first and checks that it is rejected. Canonical exhaustive
fallback walks the full registered universe and charges duplicate expansions,
partial expansions, and verifier checks. Each unique expansion is linked to
the matching verifier row. Every unsolved search receives the registered
cap-plus-one cost. Its receipt states whether the global cap stopped the run or
the complete fallback was exhausted. Source ablation and the source-free path
must produce the same complete operational row, apart from the registered arm
name, with zero source-artifact reads.

## Statistics

Repeated tie salts, renders, corruptions, and queries are averaged before a
family enters the evidence calculation. One-way analysis resamples task
families. Two-way analysis requires a complete crossing and resamples both
family axes. Registered independent-unit fields are limited to `family_id`,
`cross_family_id`, and the optional fixed `generator_id` environment. Episode
and nested-repeat IDs remain nested. The harness reports paired log cost,
geometric and median ratios, wins, ties, losses, a bootstrap interval, and a
one-sided Wilson lower bound.

Confidence bounds are percentile limits from the ordinary cluster bootstrap.
One-sided p-values come from a separate recentered null distribution. Each
null sample uses the same family draws as its ordinary sample and subtracts
the observed equal-weight point estimate. Stratified one-way analysis keeps
equal weight across fixed generator environments. Two-way analysis keeps the
registered row and column resampling. Ordinary and null samples have separate
SHA-256 receipts. The output labels the ordinary sign-tail fraction as a
diagnostic. Holm ordering and gates use only the calibrated null p-values.

The common gate is rebuilt from registered names and raw-trace measurements.
Missing measurements fail closed. Exactness, certificate validity, fallback
coverage, family units, confidence receipts, shuffle statistics, source
ablation, headroom, and provenance come from raw rows. A supplemental analysis
callback cannot replace those fields. Each raw row has one exact top-level key
schema. Valid scientific gate misses produce a no-go decision. The result
digest binds the
canonical manifest, raw JSONL trace, and analysis settings. Replaying those
inputs must reproduce the same digest.

## Development boundary

The checked-in contract keeps execution authorization false. Harness tests use
development fixtures and opaque sealed-seed commitments. A future experiment
PR will freeze its generator, source artifact, power result, seed commitments,
budgets, and hashes before it requests a sealed run.

Run the focused check with:

```sh
make reasoner5-harness-check
```

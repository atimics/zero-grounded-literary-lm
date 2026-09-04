# Reasoner 5.9a symbolic transfer

Status: development-only.

Reasoner 5.9a measures whether a source concept prior reduces exact search on
ambiguous symbolic scene graphs. It is the symbolic prerequisite for the
later pixel stage. Pixel execution stays closed.

The exact domain contains 25,344 canonical scenes. Each scene has one to
three objects in distinct cells of a two-by-two grid. Objects use three
colors, three shapes, and two sizes. Object identity is removed by sorting
objects by cell.

The concept grammar has at most seven nodes. Every candidate includes a typed
concept AST and an injective map from two episode symbols into the eight
atomic predicates. The builder enumerates the complete joint AST and legend
universe. It rejects a grammar above 16,384 pairs. It then deduplicates pairs
by their complete Boolean behavior across all 25,344 scenes.

Two concept generators and two support builders form a complete two-by-two
development matrix. Each prior component learns from one concept generator.
It ranks targets from the other generator. The transfer direction is a fixed
analysis environment. Syntax-first samples one of the complete raw typed AST
and legend pairs before mapping it to its exact semantic class.
Behavior-constraint-first samples a balanced exact-density and twelve-probe
truth constraint. It then chooses the shortest legal AST, with canonical bytes
as its tie rule. Sparse positive and negative support examples retain at
least eight exact semantic classes. Development families also require a
target-only median from 16 through 64 verifier checks before family splits
freeze. This headroom calculation includes the 64-proposal path and canonical
fallback.

Each semantic shift has a fixed compound-signature partition before family
generation. Eight signatures belong to development. Four belong to
calibration. The rest belong to source training. Source and calibration may
share atomic attributes with development. Their registered compound
signatures have zero overlap with development.

The source artifact contains two generator-specific components. Each feature
event from each registered source concept adds one count. Every categorical
table starts with one smoothing count per value. Counts are normalized within
their feature group. Natural log probabilities are rounded to signed Q20
integers. A candidate score sums exactly two registered events in each enabled
group. The primary contrast is `full` against `target_only`. Controls include a source-free guide,
its exact source ablation, a binding-feature ablation, a frequency-only prior,
a source-only arm, a consistent surface-label bijection, oracle program order,
and 31 type-and-frequency-preserving prior derangements. The surface control
swaps both glyph names across the public grammar, every candidate AST and
legend, the evaluator target, and the exact verifier. A second application at
the prior boundary restores canonical feature roles. Each derangement stays
inside the registered event subtype given by the feature-token prefix.

Only an exhaustive 25,344-scene verifier may accept an answer. Search uses the
shared Reasoner 5 harness, canonical exhaustive fallback, cap-plus-one
censoring, strict raw traces, family-level inference, and raw-trace result
replay. Every proposal must match its complete registered candidate record.
Its charged partial-expansion count must meet the frozen candidate floor. The
checker re-executes every raw row from the manifest and source artifact before
it rebuilds the result. The common gate requires all four semantic shifts, both
transfer directions, and both support builders. The one-sided primary error
allocation is 0.005.

A future sealed 5.9a contract must also bind the complete 5.9b parser,
renderer, paired pixel manifest, controls, analysis, and hashes before any
5.9a sealed seed opens. A 5.9a pass may unlock 5.9b execution. This development
contract supplies no sealed seeds and grants no execution authority.

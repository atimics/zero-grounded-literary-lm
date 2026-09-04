# Reasoner 5.9a development result

Status: `no-go` development evidence.

The symbolic prerequisite ran on 16 generated families with two public tie
orders per family. This produced 32 episodes and 1,280 arm rows. Every answer
was checked against all 25,344 symbolic scenes. The checker executes every raw
row again from the frozen manifest and source artifact. It then rebuilds every
answer, certificate, counter, family statistic, and final result.

The full source prior had a family-weighted geometric mean cost ratio of
0.6312 against target-only. It won
11 of 16 families. Its one-sided 99.5 percent upper ratio was
1.0232. The registered upper-limit test therefore did not
pass. The target-only median was 26.0 verifier checks,
inside the frozen 16 through 64 measurement range.

The two transfer directions had different totals:

- behavior-constraint-first to syntax-first: 248 full checks and 355 target-only checks;
- syntax-first to behavior-constraint-first: 291 full checks and 457 target-only checks;

The common gate failures were primary_upper_limit, family_win_lower_limit, primary_strata, mechanism_effects, derangement_randomization.
The required stratum failures were shift:operation-attribute-compound, direction:syntax-first=>behavior-constraint-first, support:greedy-version-space.
Exactness, invalid-first rejection, fallback charging, source-ablation
equality, proposal-record binding, work-charge floors, subtype-preserving
derangement integrity, and the source-free measurement floor passed. The
derangement randomization p-value was above its registered maximum.

This result is a development diagnostic. It supports a redesign of the
generator-transfer prior before a sealed 5.9a run. Reasoner 5.9b stays closed.
Its parser, renderer, pixel-family manifest, controls, and analysis still need
complete hash commitments before any sealed 5.9a seed can open.

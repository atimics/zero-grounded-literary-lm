# Reasoner 5.9a development result

Status: `no-go` development evidence.

The symbolic prerequisite ran on 16 generated families with two public tie
orders per family. This produced 32 episodes and 1,280 arm rows. Every answer
was checked against all 25,344 symbolic scenes. Every answer, certificate,
counter, family statistic, and final result replays from the frozen manifest
and raw trace.

The full source prior had a family-weighted geometric mean cost ratio of
0.4594 against target-only. It won
13 of 16 families. Its one-sided 99.5 percent upper ratio was
1.0027. The registered upper-limit test therefore did not
pass. The target-only median was 25.5 verifier checks,
inside the frozen 16 through 64 measurement range.

The two transfer directions had different totals:

- behavior-constraint-first to syntax-first: 174 full checks and 369 target-only checks;
- syntax-first to behavior-constraint-first: 1,178 full checks and 465 target-only checks;

The common gate also recorded incomplete evidence across all four shift
strata and for the legend-binding mechanism contrast. Exactness, invalid-first
rejection, fallback charging, source-ablation equality, the 31-derangement
checks, and the source-free measurement floor all passed.

This result is a development diagnostic. It supports a redesign of the
generator-transfer prior before a sealed 5.9a run. Reasoner 5.9b stays closed.
Its parser, renderer, pixel-family manifest, controls, and analysis still need
complete hash commitments before any sealed 5.9a seed can open.

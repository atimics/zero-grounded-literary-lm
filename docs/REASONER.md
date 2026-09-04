# Reasoner research line

Reasoner is the primary scientific line in this repository. It studies a
small, auditable reasoning core that gathers structured evidence, chooses
verified actions, commits a sealed answer, and allows language only after the
reasoning trace is complete.

```text
structured observation
        |
        v
learned search and evidence requests
        |
        v
exact verifier and tools
        |
        v
sealed Answer IR
        |
        v
optional language renderer
```

The exact tools define correctness. Learned scores may choose among legal
actions, but they cannot turn an invalid state into an accepted answer. A
sealed run is useful only when the registered controls fail in the expected
way and the complete conjunctive gate passes.

## Evidence map

| Version | Boundary tested | Decision |
| --- | --- | --- |
| 0 | Exact Cartan verification, canonicalization, and sealed answers | Complete bounded foundation |
| 1 | Learned Cartan proposal search at an unseen rank | No-go: one invalid held-out proposal |
| 2 | Counterexample-conditioned minimum repair | No-go: feedback ablation remained too strong |
| 3 | ICE invariant repair under witness interventions | No-go: 1,738/1,740 traces were minimal |
| (3,1) | Progress-constrained transfer to sealed 3D programs | Pass: 1,674/1,674 minimal traces |
| (3,2) | Exact behavioral compression | Pass: 87-byte artifact, zero mismatches over 2,093,056 actions |
| (3,3) | Dimension transfer with a 64-byte semantic policy | Pass: 4,095/4,095 sealed programs |
| (3,3,1) | Relational graph transfer | No-go: eight of 3,888 traces were non-minimal |
| (3,3,2) | Necessary non-monotonic planning | Pass: 5,880/5,880 sealed worlds |
| (3,3,3) | Composition across unseen module count and width | Pass: 63/63 programs and 252/252 relabelings |
| (3,3,4) | Robustness to every allowed verifier witness | Pass: 4,095 programs and 4,877,336 decisions |
| (3,4) | One policy across planning, composition, and witness repair | Pass: one 64-byte policy passed every sealed slice |
| (3,5) | Task-blind tool routing | Pass: 79,536/79,536 tool decisions |
| (3,6) | Language causally downstream from reasoning | Pass: reasoning hash unchanged under broken language |
| (3,7) | Transfer from raw observations | No-go: 336 of 482,304 sealed decisions missed |
| (3,8) | Exact minimum-description law induction | Pass: 743,184/743,184 sealed decisions |
| (3,9) | Active induction of unseen law compositions | Pass: 744/744 sealed episodes |
| 4.0 | Active induction of reversible input representations | Pass: 6,432/6,432 sealed episodes |
| 4.1 | Joint induction of unseen representations and laws | Pass: 33,232/33,232 sealed episodes |
| 4.2 | Exact discovery and reuse of derived adapter abstractions | Pass: 34/34 sealed episodes |
| 5.0 | Contract-preserved frozen-ranker and residual transfer | No-go: 7.7% versus required 20% search reduction |
| 5.1 | Exact adaptation to two unseen primitive IDs | Pass: 45 checks versus 105 target-only |
| 5.2 | Nonlinear depth transfer | No-go: aggregate gain reached only 8 of 16 required row wins |
| 5.3 | Missing evidence plus one fixed changed value | Pass: 48 checks versus 66 target-only |
| 5.4 | Calibrated synthetic pixels | No-go: full and target-only both reached the one-check floor |

The version-specific documents and benchmark result files contain the frozen
contracts, controls, receipts, digests, and exact counts. Negative results are
part of the line and must not be rewritten as intermediate successes.

## Current claim boundary

Reasoner 4.1 is positive evidence for exact factorized joint transfer inside
the registered reversible-adapter and typed integer-law languages. It passed
all 33,232 sealed episodes over 4,154 fresh three-by-three pairs, with separate
adapter and law commitments and 9,570,816 exact raw-to-IR replays. It does not
establish arbitrary representation recovery, new primitives, noisy learning,
open-ended mathematical reasoning, or natural-language grounding.

Reasoner 4.2 adds sealed positive evidence for exact abstraction-library
growth. It solved nine short base programs, discovered three positive-MDL
two-operation abstractions, froze them, and passed 34/34 fresh sealed episodes
over 17 semantic classes requiring six base operations but only three library
calls. The frozen library searched 820 raw programs while the exhaustive base
oracle required 55,987. Program identity was certified by exact affine
matrices over every field input in dimensions four through twelve rather than
by a finite behavior sample. This remains a derived-abstraction result inside
the six-operation base meta-language.

## Reasoner 4 series boundary

The registered Reasoner 4 series is complete. Version 4.0 established active
representation induction, 4.1 established factorized joint representation and
law transfer, and 4.2 established exact discovery and reuse of a small derived
abstraction library on longer held-out compositions.

The next justified question belongs to a separately preregistered successor:

> Can the same verified search-and-commit design learn useful abstractions when
> the primitive language, observation channel, or task family itself changes?

That step must add a real boundary change rather than another larger sample
from the current finite affine language. Useful directions include learned or
unseen primitives, non-affine and recursive programs, noisy evidence, and
transfer between symbolic and grounded observation channels. None of those
claims is established by the Reasoner 4 results.

See [`REASONER42.md`](REASONER42.md), the unchanged
[`executed contract`](../benchmarks/reasoner42-abstraction-library-v1/contract.json),
the [`sealed result`](../benchmarks/reasoner42-abstraction-library-v1/RESULT.md),
and the
[`cloud provenance`](../benchmarks/reasoner42-abstraction-library-v1/CLOUD_PROVENANCE.json).

## Reasoner 5.0 result

Reasoner 5.0 tests learned-state transfer separately from protocol transfer. A
small integer ranker learned from the seven Reasoner 4.2 development solutions
is frozen and hashed. Five target calibration programs may train only a
same-schema residual. The combined scorer then orders candidates for twelve
held-out three-library-call programs while the exact affine verifier retains
all authority.

The single authorized run kept all 24 identifications, 1,944 affine replays,
72 applications, and 24 reports exact. But the full scorer required 229
candidate expansions versus 248 for target-only, a 7.7% reduction rather than
the required 20%. Source-only was better at 187 expansions, and the runtime
mismatch was slightly better at 225. The result is therefore no-go: identical
operating conditions made the transfer auditable and safe, but did not make
the registered residual useful.

See [`REASONER50.md`](REASONER50.md), the unchanged
[`prospective contract`](../benchmarks/reasoner50-residual-transfer-v1/contract.json),
and the [`result`](../benchmarks/reasoner50-residual-transfer-v1/RESULT.md).

## Reasoner 5.1 result

Reasoner 5.1 passed its registered finite unseen-primitive pilot. The verified
adapter and frozen class prior used 45 candidate expansions against 105 for
target-only. All 24 accepted programs were exact. The source corpus and
semantic classes were fixed during design. The control table and scope are
in the [result](../benchmarks/reasoner51-unseen-primitive-v1/RESULT.md).

## Reasoner 5 first-series boundary

Reasoner 5.0 through 5.4 are complete. The five one-time local runs produced
192 exact final answers, two passes, three no-go decisions, and zero retries.
The [series audit](../benchmarks/reasoner5-first-five-v1/SERIES.md) preserves
the result table and links every raw record.

Version 5.1 is the strongest transfer result. Its exact semantic adapter
preserved a useful source guide across two new primitive IDs. Version 5.2 has
an aggregate nonlinear lead and weak family coverage. Version 5.3 supports a
fixed one-outlier rule plus the source prior. Version 5.4 supports exact
decoding of its fully calibrated synthetic channel and exposes a ranking
measurement floor.

The researched [next-set design](REASONER5-NEXT.md) turns those limits into
five separate experiments: generated unseen primitives, a learned passive
noise channel, active evidence selection, nonlinear compositional transfer,
and ambiguous grounded concepts. Bounded recursion follows a positive
nonlinear composition result. Its machine-readable order and common gates are
in the [plan](../benchmarks/reasoner5-next-set-v1/PLAN.json).

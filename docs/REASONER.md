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
| 4.2 | Exact discovery and reuse of derived adapter abstractions | Development pass: 14/14 episodes; seal locked |

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

Reasoner 4.2 adds public development evidence for exact abstraction-library
growth. It solved nine short base programs, discovered three positive-MDL
two-operation abstractions, froze them, and passed 14/14 held-out development
episodes over seven semantic classes requiring four base operations but only
two library calls. Program identity is now certified by exact affine matrices
over every field input in dimensions four through twelve rather than by a
finite behavior sample. This remains a derived-abstraction result inside the
six-operation base meta-language.

## Next research question

The active experiment is the locked Reasoner 4.2 three-abstraction seal.

> Does the frozen learned library retain its search advantage when targets
> require three reusable abstractions and six expanded base operations?

The public development screen is complete. The planned seal contains 17 exact
semantic classes. Its library grammar has 820 raw programs through three
calls, while the corresponding base grammar has 55,987 raw programs through
six operations. Its cloud-only, one-shot evaluator is implemented, authorized,
and still unopened.

The checked contract requires:

- an unchanged three-entry library and library digest;
- exact affine identity and inverse certificates;
- unique identification before every commit;
- exact replay, application, and report traces;
- three library calls and six expanded base operations per target;
- oracle isolation plus no-library, shuffled-curriculum, single-use,
  lookup, and no-query controls; and
- a separately authorized one-shot seal with no post-seal tuning.

See [`REASONER42.md`](REASONER42.md) and the
[`development contract`](../benchmarks/reasoner42-abstraction-library-v1/contract.json).

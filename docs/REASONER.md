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

The version-specific documents and benchmark result files contain the frozen
contracts, controls, receipts, digests, and exact counts. Negative results are
part of the line and must not be rewritten as intermediate successes.

## Current claim boundary

Reasoner (3,9) is positive evidence for active compositional law induction
inside a registered typed integer program language. It does not establish
open-ended mathematical reasoning, invention of new operators, natural
language reasoning, or transfer from an arbitrary external representation.

The remaining hand-built boundary is the adapter that turns a domain input
into the reasoner's structured observation. Increasing dimension or adding a
larger census inside the current grammar would mostly repeat an established
result.

## Next research question

The next proposed experiment is Reasoner 4.0: representation transfer.

> Can the frozen Reasoner (3,9) core infer a structured input adapter from
> examples, then solve a fresh sealed representation without a task label,
> hand-coded domain switch, or core change?

The first stage should use unfamiliar representations of familiar laws. A
later stage may combine an unseen representation with unseen law composition.
Keeping those gates separate makes a failure interpretable.

A future contract should require:

- exact raw-input-to-IR replay;
- exact reasoning actions and sealed answers;
- no task or domain identity feature;
- no changes to the frozen (3,9) core;
- lookup, fixed-adapter, scrambled-example, and task-label controls;
- held-out compositions of representation operations; and
- a fresh one-shot seal with no post-seal tuning.

This document proposes the boundary. It does not authorize an experiment,
cloud run, model training job, or new sealed evaluation.

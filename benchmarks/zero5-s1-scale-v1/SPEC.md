# ZERO.5 S1: 5x scale control

## Question

Does the retrieval-choice deficit survive a 5.01x parameter increase under
the matched corpus recipe? This is the capacity control that the completed
elimination chain (presentation, definitions, weighting, pairing, corpus
mix, decoupled targets, architectural coupling) has earned. It separates
"re-architect the model" from "the model was simply too small" before any
new backbone is written.

## Design

One variable changes from the C4.3 recipe: parameter count. The model is
4,852,992 -> **24,323,264** parameters (dim 256->448, layers 6->10,
ff 1024->1792; heads 8, rotary positions, context 512, vocabulary 512 all
unchanged). Seed 0. No auxiliary heads, no bridge — a plain transformer,
matching the C-line architecture at 5x scale.

Two training stages, mirroring the C4.3 lineage:

- **Stage A (Atlas pretrain, C2 recipe):** fresh initialization, the frozen
  Atlas train/validation streams, 10,425 updates, batch 4, sequential
  ordered pass, lr 3e-4 cosine, warmup 400 — the C2 recipe verbatim at 5x
  scale. Declared controlled difference: the C1 literary stage that
  initialized C2 is omitted; Atlas dominated C2's compression gains and the
  omission is recorded, not hidden.
- **Stage B (C4.3 task stage):** initialize from stage A, the exact frozen
  C4.3 grouped packs, 28,707 update groups, the C4.3 answer weights,
  identical optimizer and schedule, identical accounting expectations.

Evaluation reuses the frozen C4.2 span-choice instruments and the C4.3
evaluator unchanged: the 24.3M candidate is scored against the hash-locked
C2 baseline on the same validation files.

## Gates (frozen; conjunctive where marked)

| Gate | Threshold | Rationale |
| --- | --- | --- |
| Retrieval choice accuracy | >= 0.55 | the deficit that survived eight interventions |
| Claim choice accuracy | >= 0.65 | C4.3 scored 0.708; slack covers the C1 omission |
| Retrieval orientation gap | <= 0.15, both positions >= 0.50 | position bias must not carry any pass |
| Swap consistency (both families) | >= 0.90 | span-instrument baseline is ~0.95 |
| Combined nats/token | <= 2.26 | C4.3 + 0.25 undertraining allowance (sanity) |
| Finite metrics, sealed test | required | house rules |

## Decision rules (frozen before training)

- **Retrieval >= 0.55 (pass):** capacity was binding at fixed data. The
  re-architecture premise weakens; a compute-proper scale line (more
  tokens) opens as the cheaper path, and C7 architecture work must beat
  the scaled transformer baseline to justify itself.
- **Retrieval < 0.55 with claim/language gates passing:** capacity at
  fixed data is ruled out as the sole cause. Architecture (C7 deltanet
  line) proceeds with convergent evidence.
- **Retrieval < 0.55 and combined nats > 2.26:** the run is undertrained
  at this budget; inconclusive on capacity. A token-scaled S2 may be
  proposed separately. No architecture conclusion is licensed from this
  branch.

Single seed. No promotion, no replication authorization, no checkpoint
publication, no test access from any branch of this decision tree.

## Venue and budget

AWS c6i.4xlarge, 16-thread OpenBLAS, one on-demand instance up to 43,200
seconds (12h), hard ceiling **$8.20** enforced in user-data, automatic
termination, 30-second status/state sync. Stage A must complete in one
uninterrupted phase (sequential stream); stage B is resumable across
segments by design if an interruption occurs.

Expected cost: ~5.7h stage A + ~5.2h stage B + ~0.5h evaluation at the
measured 5,135 tok/s baseline scaled by 5.01x ~ $7.8.

# Experiment Registry

Every training experiment, in order, with what was changed, why, and what
decision followed. This is the authoritative record. Individual RESULTS.md
files contain per-seed gate tables and model hashes; this document traces
the decision lineage.

Schema: `zero.experiment_registry.v1`.

---

| ID | Benchmark | Date | Proposal | Changed from previous | What was tested | Result | Decision | Next |
|---|---|---|---|---|---|---|---|---|
| **smoke-v1** | `benchmarks/zero4-smoke-v1` | 2026-07-16 | `FACULTY.md` mechanics gate | — (mechanics only) | Twenty-update multi-faculty pipeline and controller self-tests | Loss moved in the expected direction; the exact generation probe failed. | **No-go for promotion.** Mechanics passed, but this was not a capability experiment. | Pilot with frozen task gates |
| **pilot-v1** | `benchmarks/zero4-pilot-v1` | 2026-07-16 | `FACULTY.md` §6–8 | — (first ZERO.4 capability training) | 3 faculties (quantity, geometry, art), model generates full artifacts including arithmetic, 4,000 updates, seed 1 only | 0/20 exact artifacts each. Replay +3.52%. | **No-go.** Model learned target probabilities but produced zero verifiable artifacts. Do not add data or parameters. | Q1: single faculty, increase artifact signal |
| **q1** | `benchmarks/zero4-q1-v1` | 2026-07-16 | Pilot RESULTS.md recommendation | Dropped geometry and art. Single faculty (quantity). `--artifact-weight 4`. Controller-owned grammar + independent semantic validator. 3,000 updates. Seed 1 only. | Can one faculty with heavier artifact weighting produce exact results? | 4.0% exact (20/500). Closure and syntax 100%. Replay +2.7%. | **No-go.** This configuration did not generate exact arithmetic results reliably. Split routing from computation. | Q2: model emits typed request, controller handles arguments |
| **q2** | `benchmarks/zero4-q2-v1` | 2026-07-16 | Q1 RESULTS.md recommendation | Model emits typed request with arguments (e.g., `quantity.add 3 7`). Controller rejects changed args. Kernel computes result. 2,000 updates. Seed 1 only. | Can the model learn to emit correct operation + argument pairs? | 0.2% argument extraction. Operation extraction 100%. Closure/syntax 100%. Replay +2.7%. | **No-go.** This seed named operations but did not reliably extract arguments from source text. | Q2.1: operation-only, controller binds source arguments |
| **q21** | `benchmarks/zero4-q21-v1` | 2026-07-17 | Q2 RESULTS.md recommendation | Model emits only operation type (e.g., `quantity.add`). Controller independently parses source, binds arguments, rejects mismatches. Kernel computes. Seeds 1 and 2. | Can one faculty with operation-only routing pass all gates on multiple seeds? | Seed 1: 499/500 exact (99.8%), replay 1.864%. Seed 2: 500/500 exact (100%), replay **2.011%**. Seed 3 not run. | **No-go.** Operation-only routing passed quantity gates in two tested seeds; replay was seed-variable and seed 2 missed the frozen gate by 0.011 percentage points. | Q2.2: larger curriculum and joint checkpoint evaluation |
| **q22** | `benchmarks/zero4-q22-v1` | 2026-07-17 | Q2.1 AGGREGATE.md recommendation | Expanded quantity curriculum. Sentinel evaluations during training. Structured promotion/public/sentinel split. Constraint-aware training stopped at 400 updates (300 acquisition + 100 consolidation). Seed 2 only. | Can a larger curriculum and better measurement produce feasible checkpoints? | Quantity passed at updates 300 and 400. The replay adapter incorrectly stripped `--sample-weight`, restoring default 2x foundation weight. | **No-go due to invalid evaluation.** The trajectory is retained, but its recorded replay values are inadmissible. | Q2.2-R: correct and repeat the evaluation |
| **q22r** | `benchmarks/zero4-q22r-v1` | 2026-07-17–19 | Q2.2 EVALUATION-NOTICE.md | Corrected eval adapter (preserve `--sample-weight 1`, remove only `--distill`). Measured replay-only repair branches from retained Q2.2 frontiers. Frontier selection: feasibility → max margin → min replay. Seeds 1, 2, and 3. | Can corrected evaluation, with measured repair branches, produce a jointly feasible checkpoint on all three declared seeds? | Seed 1: no-go, 81.8% exact and 2.685% replay. Seed 2: go, 97.6% exact and 1.919% replay. Seed 3: no-go, 76.4% exact and 2.587% replay. Rejected state mutations: 0. Teacher hashes unchanged. | **No promotion: one go, two no-go.** ZERO.3 remains current. Activate optimizer-boundary interference controls instead of scaling quantity. | Q2.3 observer → transactional AdamW → local replay guard, diagnostic seed 2 |
| **q23** | `benchmarks/zero4-q23-v1` | 2026-07-19 | `ZERO4-BACKLOG.md` P0–P4 | Preregistered checkpoint-v4 transactional AdamW, per-attempt faculty/replay diagnostics, exact learned-state rollback, observer-derived guard calibration, and seed/promotion sealing. Student, teachers, corpora, routing, and public thresholds remained fixed from Q2.2. | Can optimizer-boundary observation and rollback prevent replay interference without weakening the quantity or 2% replay gates? | Observer seed 2 passed mechanics and calibrated a 0.25% hard band. Guarded seed 2 accepted all 200 attempts: 5 exceeded the warning band, none exceeded the hard band, and the maximum local increase was 0.2013%. Update 200 passed quantity exactly at threshold but replay regressed 2.685%. | **No-go.** The per-attempt local budget did not bind or control cumulative replay. Promotion and replication seeds 1 and 3 remained sealed; ZERO.3 remains current. | Q2.4 design: preregister a cumulative direct functional replay budget |
| **q24** | `benchmarks/zero4-q24-v1` | 2026-07-19 | Q2.3 no-go and `benchmarks/zero4-q24-v1/PREREGISTRATION.md` | Replaces the local one-step guard authority with an immutable ZERO.3 baseline over all six fixed replay slices. Every candidate is checked before commit; the 1.5% cumulative ceiling leaves 0.5 percentage points of reserve below the public gate. All other Q2.3 design choices remain fixed. | Can direct cumulative replay authority preserve the 2% public replay ceiling without closing the quantity-learning path? | Seed 2 committed 66 of 74 attempts. The first reject was attempt 67; eight consecutive candidates exceeded the hard budget and rolled back. No 100-commit public checkpoint was reached. | **No-go.** The guard bound before the first public quantity evaluation, so promotion and seeds 1 and 3 remained sealed. ZERO.3 remains current. | Q2.5 proposal: budget-aware continuation without weakening the replay or quantity gates |
| **q25** | `benchmarks/zero4-q25-v1` | 2026-07-19 | Q2.4 no-go and `benchmarks/zero4-q25-v1/PREREGISTRATION.md` | Keeps the immutable six-slice baseline and 1.5% authority, but retries each outer attempt at frozen scales 1, 1/2, …, 1/128. Every retry restores weights and AdamW moments and reuses the same minibatch, gradient, and proposed update. | Can deterministic first-feasible backtracking preserve replay safety while reopening the quantity-learning path? | Seed 2 committed 66 full-scale and 5 backtracked updates, then exhausted all eight scales on attempts 72–79. The smallest accepted scale was 1/128 and the maximum committed replay increase was 1.49944%. No 100-commit public checkpoint was reached. | **No-go.** Scalar continuation bought five updates but did not reopen the learning path. Promotion and seeds 1 and 3 remained sealed; ZERO.3 remains current. | Q2.6 proposal: change update direction or optimization geometry without weakening the frozen gates |

---

## Decision trace

```
pilot-v1 (3 faculties, full artifacts)
  "0/20 exact, model can't generate arithmetic"
  → Q1: single faculty, artifact-weight 4x

q1 (1 faculty, full artifacts, heavy weighting)
  "4% exact, model can't generate numbers"
  → Q2: typed request with arguments

q2 (operation + args in model output)
  "0.2% arguments, model can't extract from source"
  → Q2.1: operation-only, controller binds args

q21 (operation-only, 2 seeds)
  "Seed 1 go, seed 2 replay 2.011%"
  → Q2.2: larger curriculum, better measurement

q22 (expanded curriculum, sentinel evals)
  "Evaluation bug: sample-weight stripped"
  → Q2.2-R: corrected eval, replay repair

q22r (corrected eval, measured repair branches, 3 seeds)
  "Seed 2 go; seeds 1 and 3 fail quantity and replay."
  → Q2.3: measure and control interference at the optimizer boundary

q23 observer (transactional instrumentation, seed 2)
  "Learned state identical; direct guard calibrated; first-order signal non-predictive."
  → Q2.3 guarded seed 2 under the frozen 0.25% functional budget

q23 guard (local direct functional budget, seed 2)
  "200 accepts, 0 rejects; quantity passed; cumulative replay +2.685%."
  → Q2.4: budget direct functional drift cumulatively, not independently per attempt

q24 (immutable six-slice cumulative budget)
  "66 accepts, then 8 consecutive rejects above 1.5%; no public checkpoint."
  → Q2.5: change the candidate update when the budget binds; do not relax the gate

q25 (deterministic cumulative-guard backtracking)
  "66 full-scale + 5 backtracked commits; then 8 exhausted attempts, no public checkpoint."
  → Q2.6: change update direction or optimization geometry; do not relax the gates
```

---

## Key findings across experiments

1. **Full artifact generation was not reliable in the tested 4.85M configurations** for exact arithmetic (pilot: 0/20, q1: 4%). The operation-only controller boundary is the supported path; these runs do not prove that every full-generation configuration is infeasible.

2. **Argument extraction was much weaker than operation classification in Q2 seed 1** (0.2% args vs 100% ops). The current contract therefore lets the controller parse while the model classifies.

3. **Operation-only routing passed the quantity gates in both tested Q2.1 seeds** (99.8–100%). Seed 3 and the replay constraint still prevent calling the overall quantity faculty solved.

4. **Replay regression is the binding constraint**, not routing accuracy (q21 seed 2: 2.011%, q22r seed 2: 1.919%). The model learns quantity easily; it forgets Shakespeare slowly.

5. **The tested repair phase had little effect in seed 2.** The Q2.2-R events log shows replay changes on the order of 0.0003 over 100 updates and a 0.2 percentage-point quantity change. That is evidence about this seed and setting, not a general conclusion about replay repair.

6. **Q2.2-R did not replicate.** Only seed 2 passed. Seeds 1 and 3 both
missed quantity and replay, so the next experiment changes optimizer safety,
not capability scope or model size.

7. **Q2.3 observer mechanics passed, but the linear drift diagnostic did not.**
The learned state remained byte-identical while observation was enabled, but
predicted and realized replay changes had Pearson 0.0076. The guarded run must
therefore rely on its direct functional probe, not the first-order estimate.

8. **A safe-looking local step does not imply a safe trajectory.** Q2.3's
largest local replay-probe increase was 0.2013%, below its 0.25% hard band, so
all 200 attempts committed. Public replay nevertheless accumulated to 2.685%.
The next guard must track cumulative direct drift rather than independent
per-attempt quantiles.

9. **Direct cumulative authority worked as a safety boundary but closed the
learning path.** Q2.4 accepted 66 updates, with a maximum accepted composite
increase of 1.4253%, then rolled back eight consecutive candidates above the
1.5% hard ceiling. The run stopped before its first 100-commit public
checkpoint, so promotion and replication correctly stayed sealed. A follow-up
must change how a rejected candidate is constructed or scaled, not weaken the
frozen replay or quantity gates.

10. **Scalar continuation did not resolve the constrained optimization
boundary.** Q2.5 accepted five additional updates by shrinking the same
candidate direction, including one at 1/128, and held every commit below the
1.5% authority. It then exhausted all eight scales on eight consecutive outer
attempts. The next proposal must change the update direction, objective, or
optimization geometry rather than only reduce step length; the frozen replay
and quantity gates remain unchanged.

---

## Schema

Every completed capability result contains sibling `RESULTS.md` and
`manifest.json` files. Non-capability mechanics gates use a stage-specific
report such as `OBSERVER.md`. Experiment directories may additionally retain
invalidated trajectories, frontier checkpoints, or notices:

| File | Required | Content |
|---|---|---|
| `RESULTS.md` | Yes | Decision, gate table, model SHA-256, teacher hashes |
| `manifest.json` | Yes | Machine-readable result with schema version, all metrics, all hashes |
| `FRONTIER.md` | If multi-checkpoint | Frontier table with per-checkpoint feasibility |
| `frontier.json` | If multi-checkpoint | Machine-readable frontier |
| `selection.json` | If checkpoint selected | Selection policy, selected checkpoint, metrics |
| `events.jsonl` | If multi-phase | Append-only training/evaluation event log |
| `EVALUATION-NOTICE.md` | If errata | Corrections, caveats, known issues |

---

## Current state (2026-07-19)

- **Deployed browser baseline**: `docs/model.litq8`, update 14,500. This is distinct from the frozen ZERO.3 training teacher.
- **Student initialization and frozen teacher**: ZERO.3 (`teachers/zero3-balanced-final.teacher`, source update 16,600, SHA-256 `c8657694...`)
- **Latest completed experiment**: Q2.5 seed 2 (no-go; 71 commits / 79 attempts, no public checkpoint)
- **Next experiment**: Q2.6 is not yet preregistered; its proposal must change update direction or optimization geometry without relaxing the frozen gates
- **Active proposals**: See `PROPOSALS.md`
- **Promotion status**: Not promoted. Q2.5 seed 2 was no-go; promotion and replication seeds remain sealed.

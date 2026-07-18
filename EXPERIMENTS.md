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
| **q22r** | `benchmarks/zero4-q22r-v1` | 2026-07-17 | Q2.2 EVALUATION-NOTICE.md | Corrected eval adapter (preserve `--sample-weight 1`, remove only `--distill`). Measured 100 replay-only updates at lr=1e-6 from source updates 300 and 400. Frontier selection: feasibility → max margin → min replay. Seed 2 only. | Can corrected evaluation, with measured repair branches, produce a jointly feasible checkpoint? | **Go for seed 2.** Source update 400 + 100 repair updates: 488/500 exact (97.6%), replay 1.919%. Source update 300 + 0 repair: 479/500 exact (95.8%), replay 1.858%. Selected u400-r100. Rejected state mutations: 0. Teacher hashes unchanged. | **Go for seed 2 only.** Not promotion-eligible until seeds 1 and 3 pass. Repair caused only small changes and was not necessary for the feasible u300 branch. | Seeds 1 & 3 using the frozen acquisition and selection policy |

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

q22r (corrected eval, measured repair branches, 1 seed)
  "Seed 2 go; acquisition already contained a feasible branch, and repair had little effect in this seed."
  → Seeds 1 & 3 needed for promotion
```

---

## Key findings across experiments

1. **Full artifact generation was not reliable in the tested 4.85M configurations** for exact arithmetic (pilot: 0/20, q1: 4%). The operation-only controller boundary is the supported path; these runs do not prove that every full-generation configuration is infeasible.

2. **Argument extraction was much weaker than operation classification in Q2 seed 1** (0.2% args vs 100% ops). The current contract therefore lets the controller parse while the model classifies.

3. **Operation-only routing passed the quantity gates in both tested Q2.1 seeds** (99.8–100%). Seed 3 and the replay constraint still prevent calling the overall quantity faculty solved.

4. **Replay regression is the binding constraint**, not routing accuracy (q21 seed 2: 2.011%, q22r seed 2: 1.919%). The model learns quantity easily; it forgets Shakespeare slowly.

5. **The tested repair phase had little effect in seed 2.** The Q2.2-R events log shows replay changes on the order of 0.0003 over 100 updates and a 0.2 percentage-point quantity change. That is evidence about this seed and setting, not a general conclusion about replay repair.

6. **Seed variance in replay regression is the critical unknown.** Q2.1 seeds 1 and 2 differed by 0.147pp (1.864% vs 2.011%). One seed is not evidence; three seeds are.

---

## Schema

Every completed seed-level result contains sibling `RESULTS.md` and
`manifest.json` files. Experiment directories may additionally retain invalidated
trajectories, frontier checkpoints, or notices:

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

## Current state (2026-07-18)

- **Deployed browser baseline**: `docs/model.litq8`, update 14,500. This is distinct from the frozen ZERO.3 training teacher.
- **Student initialization and frozen teacher**: ZERO.3 (`teachers/zero3-balanced-final.teacher`, source update 16,600, SHA-256 `c8657694...`)
- **Latest experiment**: Q2.2-R seed 2 (go, 97.6% exact, replay 1.919%)
- **Next experiment**: Seeds 1 & 3 replication (see `PROPOSALS.md`)
- **Active proposals**: See `PROPOSALS.md`
- **Promotion status**: Not promoted. Quantity faculty passes seed 2 only.

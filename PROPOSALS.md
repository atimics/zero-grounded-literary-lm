# Proposals

The single authoritative document for what experiment should happen next and
why. This document resolves conflicts between the three proposal sources:

- `ZERO4-BACKLOG.md` — P0–P5: infrastructure-first, make training safe before scaling
- GitHub issues #1–21 — capability-first, add faculties and features
- `SATURATION.md` — measurement-first, determine capacity limits empirically

Status: **active**. Updated when an experiment completes and new proposals are
generated or existing proposals are promoted/demoted/rejected.

---

## Resolution principle

When proposals conflict, the tiebreaker is:

1. **Correctness before capability.** If the training process has a known bug
   (replay regression, evaluation error, non-determinism), fix it before adding
   anything new.
2. **Measurement before scaling.** Don't add a second faculty until we know
   how many fit. Don't measure until we have three-seed evidence that one
   works.
3. **Three seeds before promotion.** No claim about the architecture is
   credible on one seed. Replication is not optional.
4. **Cheapest informative experiment first.** If two experiments answer
   different questions, run the one with the lower measured cost on the
   declared backend. Do not label CPU-instance time as GPU time.

---

## Active proposals (ordered by priority)

### P0: Q2.2-R seeds 1 and 3 replication (resolved)

**Source**: Q2.2-R seed 2 RESULTS.md, EXPERIMENTS.md decision trace.
**Status**: Resolved — rejected. Seeds 1 and 3 were measured no-go; only seed
2 passed. Quantity is not promoted and ZERO.3 remains current.
**Blocks**: Resolved by activating transactional training infrastructure.
**Depends on**: Nothing.
**Cost**: To be reported in `c6i.4xlarge` instance-hours after the first seed.
The current runner is CPU-only; no GPU-day estimate has been measured.

**Design**:

Run the exact Q2.2 acquisition and selection pipeline from seed 2 on seeds 1
and 3: immutable ZERO.3 initialization, the same curriculum, teachers,
routing, sampling weights, 1,000-update acquisition budget, 400-update
consolidation budget, 25-update sentinels, 100-update full evaluations, replay
pressure, constraint-aware early stopping, and feasibility-first Pareto
selection. Seed 2 stopped after 400 total updates; that observed stop is not a
replacement for the frozen maximum budgets.

This replication contains no adaptive repair branch. If no checkpoint passes
the joint public gate, record the no-go and leave promotion untouched. If a
public-feasible checkpoint fails the one-time promotion gate, record that
no-go without adapting the run. Any extended replay repair, alternative
multi-objective score, or elastic-weight-consolidation experiment must be
pre-registered as a separate proposal using public validation only. This keeps
the independent variable fixed and prevents choosing a repair after seeing a
promotion outcome.

**Decision criteria**:

| Outcome | Action |
|---|---|
| All 3 seeds pass the frozen pipeline | Promote quantity. Proceed to SAT-1 (ops scaling within quantity). |
| 1 outstanding seed fails | Do not promote. Compare public-validation trajectories and pre-register one repair study. |
| Both outstanding seeds fail | Do not promote. Activate BACKLOG P0–P3 (observer → transactional AdamW → replay guard). |

**Environment**: Run through `.github/workflows/train.yml` on the declared
`c6i.4xlarge` CPU instance. The workflow accepts only outstanding seeds 1 and
3, restores hash-verified assets, and retains both go and no-go results.

---

### P1a: ZERO.4-Q2.7 — Top-FFN isolation repair

**Source**: Q2.6 seed-2 optimizer trace and the prospective
`zero-language-gate-v1` result.
**Status**: Preregistered and mechanically staged. A one-seed AWS budget and
non-waiting launch/collector exist, but compute is not authorized.
**Depends on**: Q2.6-R family promotion (satisfied) and the frozen language
gate (satisfied).
**Cost**: Proposed maximum $1.17/6,190 instance-seconds for seed 2 through
quantity promotion, conservatively inherited from the slowest Q2.6-R seed.
The candidate-only language gate is separate and remains capped at
$0.12/600 seconds.

**Design**:

Rerun the Q2.6 quantity experiment from immutable ZERO.3 while freezing every
parameter except `layer.5.norm2`, `layer.5.w1`, `layer.5.w2`, and
`final_norm`. This exposes 541,184 parameters (11.151554%) while isolating the
token embedding, which dominated the completed Q2.6 replay-drift diagnostics.
The Q2.6 optimizer, tangent guard, quantity gates, replay authority, split
isolation, selection rule, and stop conditions remain unchanged.

Only a prospectively selected quantity/replay-feasible seed-2 checkpoint may
open quantity promotion and then the candidate-only BLiMP/TinyStories gate,
each exactly once. Either failure resolves no-go without adaptation. Seeds 1
and 3 remain sealed behind a later replication contract and budget.

**Question**: Is language regression caused by broad parameter interference
rather than by the quantity faculty itself?

---

### P1b: SAT-1 — Single-faculty ops scaling

**Source**: `SATURATION.md` §3.1.
**Status**: Staged preregistration complete, but blocked at the five-operation
anchor; no compute authorized. Q2.6-R established the three-seed replay-safe
quantity result, but its frozen seed-2 model fails the prospective language
gate on TinyStories. `benchmarks/sat1-v1/contract.json` freezes the later
adaptive stage boundaries without authorizing them.
**Depends on**: Q2.6-R family promotion (satisfied) and a three-seed Q2.7
language-preserving five-operation anchor (unsatisfied).
**Cost**: Unmeasured. Stage 0 must produce a score-sealed AWS timing unit.
Every later stage requires its own immutable budget and explicit approval.

**Design**:

Hold total records, optimizer budget, model size, initialization, replay
authority, and promotion gates fixed while varying
$N_{\text{ops}}\in\{5,10,20,40,80,160\}$. Use one nested operation inventory
and balance records across active operation ids. Every selected arm must also
pass the candidate-only BLiMP/TinyStories language-preservation gate.

The staged design avoids opening all 18 arms:

1. Stage 0 freezes generation, split isolation, replay, and validation
   mechanics. Timing remains blocked with training.
2. Stage A reuses the frozen count-5 anchor, then screens 40 and 160 on seed 2
   only after a language-preserving five-operation anchor exists.
3. Stage B runs 10, 20, and 80 on seed 2 only if Stage A brackets a quantity
   failure while language remains preserved.
4. Stage C replicates either 5/160 (no transition through 160) or the
   prospectively selected adjacent transition bracket on seeds 1 and 3.

No stage automatically authorizes the next. All declared arms within an
authorized stage run even after an early scientific failure.

**Question**: Does routing accuracy undergo a phase transition? If so, at
what $N_{\text{ops}}$? If not up to 160, classification is not the
bottleneck — proceed to SAT-2.

---

### P2: BACKLOG P0–P3 — Training infrastructure (resolved)

**Source**: `ZERO4-BACKLOG.md`.
**Status**: Resolved — mechanics accepted, local-guard hypothesis rejected.
The contract, schemas, transactional checkpoint, rollback guard, and CI are
merged. The observer passed learned-state equivalence, but the guarded run
accepted all 200 attempts and missed the public replay gate.
**Depends on**: Q2.2-R replication failure (satisfied).
**Cost**: Unmeasured compute time plus engineering time (transactional AdamW,
replay guard implementation).

**Design**:

- **P0**: Freeze schemas for optimizer attempts, parameter groups, splits.
- **P1**: Observer-only diagnostics — compute faculty and replay gradients
  separately, report cosine, displacement norms, Fisher-weighted drift. Run
  on existing Q2.2 trajectory; verify disabling the observer is
  checkpoint-identical.
- **P2**: Transactional AdamW shadow state — propose, evaluate, commit/reject
  for each optimizer step. On rejection, prove learned state is
  byte-identical to pre-attempt state.
- **P3**: Local replay guard — reject or backtrack shadow candidates whose
  functional probe exceeds budget. Cap consecutive rejections.

**Question**: Can we detect and prevent replay regression at the optimizer
level rather than relying on post-hoc checkpoint selection?

---

### P3: SAT-2 — Multi-faculty scaling

**Source**: `SATURATION.md` §3.2.
**Status**: Proposed. Blocked on P1b (ops scaling) and P2 (replay guard).
**Depends on**: P1b passing, P2 implemented.
**Cost**: Unmeasured; derive from the P0/SAT-1 instance-hour observations.

**Design**:

Add faculties in order: foundation → logic → channel → geometry → art →
physics → epistemics → code → music → systems. Each faculty starts with 5
operation types. Train from ZERO.3 init for fixed update budget. Measure
per-faculty routing accuracy, cross-faculty interference matrix,
composition coherence, replay regression, faculty isolation (pairwise Holo
cosine similarity).

**Question**: At what faculty count does cross-faculty interference
degrade any existing faculty below 95% routing? Is replay or routing the
first constraint to bind?

---

### P4: Geometry faculty

**Source**: GitHub issue #7.
**Status**: Proposed. Blocked on P3 (multi-faculty scaling establishes capacity).
**Depends on**: P3 passing, quantity faculty promoted.
**Cost**: Unmeasured compute time plus generator engineering.

**Design**:

Build ZERO.G generator, checker, and SVG renderer at faculty-v1 scale
(100k records). Geometry depends on quantity (exact arithmetic for
coordinate solving). Train as second faculty after quantity is solid.

---

### P5: BACKLOG P4–P5 — Q2.3 diagnostic and replication

**Source**: `ZERO4-BACKLOG.md`.
**Status**: Resolved — rejected. Guarded seed 2 was a no-go: quantity reached
the frozen threshold at update 200, replay regressed 2.685%, and the local
0.25% guard rejected no attempts. Seeds 1 and 3 remain closed.
**Depends on**: BACKLOG P0–P3 passing.

**Design**:

- **P4**: Q2.3 diagnostic seed 2 — apply transactional replay guard to
  quantity training. Prove seed 2 passes with guard enabled.
- **P5**: Run seeds 1 and 3 with guard. Promote ZERO.4 only if all three
  seeds satisfy the frozen contract.

---

### P6: Q2.4 cumulative functional replay budget

**Source**: Q2.3 seed-2 `RESULTS.md`.
**Status**: Resolved — safety mechanism accepted, learning-path hypothesis
rejected. Q2.4 committed 66 updates and stopped after eight cumulative-guard
rejections before a public checkpoint.
**Depends on**: Q2.3 no-go (satisfied).

**Design**:

Keep the Q2.3 transaction and direct functional probe, but replace the
independent per-attempt hard threshold with an explicitly cumulative replay
budget relative to a frozen reference. Define how accepted attempts consume
and may recover budget, then pass mixed accept/reject rollback and resume tests
before opening one diagnostic seed. Do not use the non-predictive first-order
signal for authority, change public thresholds, or open promotion during
calibration.

**Question**: Can a cumulative direct functional constraint bind before many
sub-threshold local increases compound past the public 2% replay ceiling?

---

### P7: Q2.5 deterministic scalar continuation

**Source**: Q2.4 seed-2 `RESULTS.md`.
**Status**: Resolved — rejected. Backtracking committed five additional
updates, including one at 1/128, then eight outer attempts exhausted every
scale. No public checkpoint was reached.
**Depends on**: Q2.4 no-go (satisfied).

**Question**: Can first-feasible scalar backtracking reopen the constrained
learning path without weakening the cumulative or public gates?

---

### P8: Q2.6 global replay-tangent projection

**Source**: Q2.5 seed-2 `RESULTS.md` and terminal attempt trace.
**Status**: Resolved — accepted and promoted. Seed 2 resolved go after 700/700
commits and prospectively selected update 500. Under the unchanged Q2.6-R
contract, seeds 1 and 3 also passed their public and exactly-once promotion
gates. The three-seed family resolved go, and the frozen seed-2 artifact is
current ZERO.4.
**Depends on**: Q2.5 no-go (satisfied).

**Design**:

At each committed pre-attempt state, compute the arithmetic-mean gradient of
the same six replay validation windows used by the cumulative authority. For
each registered AdamW scale, remove only the replay-increasing component of
the candidate weight displacement with one global Euclidean projection, then
submit the candidate to the unchanged direct six-slice 1.5% guard. The
first-order gradient constructs candidates but never decides commits.

**Question**: Can a direction-changing tangent projection reach a jointly
feasible public checkpoint while preserving the exact Q2.5 authority?

---

## Deferred proposals

These are valid proposals that are explicitly deferred, with reasons.

| Proposal | Source | Reason for deferral |
|---|---|---|
| Boundary-aware loss / scaffolded decoding | Issue #3 | Q2.1 architecture (operation-only routing) solved the exact-artifact problem without needing this. Revisit only if full artifact generation becomes necessary. |
| Four-way channel ablation | Issue #4 | Requires consented human channel corpus (Issue #6) which is not yet collected. Deferred until corpus exists. |
| Consented human channel corpus | Issue #6 | Legal/logistical blocker. Not on the critical path for faculty scaling. |
| Three-teacher calibration (Phase T) | Issue #5 | Q2.2-R and Q2.1 results show hard-only routing works for new faculties. Teacher routing is only relevant for foundation/literary/channel, which are already calibrated. Revisit before multi-faculty training. |
| Art critic faculty | Issue #10 | Blocked on geometry (art uses same scene language). Deferred until after P4. |
| Physics simulator | Issue #9 | Blocked on quantity + geometry. Deferred until after P4. |
| Epistemics | Issue #12 | Blocked on logic. Deferred until multi-faculty capacity is known. |
| Five-domain student ablation | Issue #19 | Subsumed by SAT-2. Will run when multi-faculty scaling reaches 5 domains. |
| Learned registrar | Issue #13 | Separate v2 experiment. Deferred until replay-safe training exists. |
| Code, Music, Systems faculties | Issues #15, #17, #21 | Faculty v2 candidates. Deferred until v1 faculty capacity is measured. |
| Cross-platform CI | Issue #16 | Implemented in `.github/workflows/ci.yml`; close only after the first green portable, Accelerate, WASM, and results-integrity run. |
| Evaluation matrix documentation | Issue #14 | Addressed by `EXPERIMENTS.md` and this document. |

---

## Proposal lifecycle

```
PROPOSED → (dependency check) → ACTIVE → (experiment completes) → RESOLVED
                                                                   ├── ACCEPTED (promoted to next phase)
                                                                   ├── REJECTED (experiment disproved hypothesis)
                                                                   └── SUPERSEDED (another proposal made this obsolete)
```

A proposal becomes ACTIVE when:
- All dependencies are RESOLVED (ACCEPTED)
- No higher-priority proposal blocks it
- The experiment design is frozen

A proposal becomes RESOLVED when:
- The experiment completes on the required number of seeds
- A RESULTS.md is published with a decision
- The proposal's hypothesis is confirmed (ACCEPTED) or disconfirmed (REJECTED)

---

## Current state

- **Current model**: ZERO.4, promoted from the prospectively selected Q2.6 seed-2 update-500 artifact
- **Completed evaluation study**: the bounded ZERO-EVAL-1 screen is published; its mixed result retires the ≤8h30m/≤$5.78 full run
- **Active evaluation guard**: candidate-only BLiMP/TinyStories preservation, expected ≈305s and proposed at ≤600s/≤$0.12
- **ZERO.4 against the prospective guard**: BLiMP passes, TinyStories fails (1.681% worse bits/byte versus a 1% allowance); this does not retroactively change the quantity promotion
- **Next training proposal**: a separately frozen five-operation language-preserving repair; staged SAT-1 remains next after that anchor passes
- **Authorization**: ZERO language-gate execution and all SAT-1 stages remain at zero authorized compute until each has a separate immutable budget and explicit approval
- **Blocked proposals**: SAT-2 and faculty expansion remain downstream of SAT-1
- **Deferred proposals**: 14 proposals (see table above)
- **Next decision point**: preregister the cheapest five-operation
  language-preserving repair, while building SAT-1 inventory/validator
  mechanics only. Do not budget timing or launch training yet.

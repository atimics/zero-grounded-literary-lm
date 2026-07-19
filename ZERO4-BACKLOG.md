# ZERO.4 Backlog

Status: Q2.2-R seed 2 is a measured go and seeds 1 and 3 are measured no-go.
The Q2.3 v1 contract and transactional optimizer are merged. The full seed-2
observer passed its exact learned-state equivalence gate, but the guarded
diagnostic was a measured no-go: its local 0.25% budget rejected no attempts
and public replay regressed 2.685%. Seeds 1 and 3 remain sealed.
ZERO.3 remains the deployed default. Geometry, art, and physics remain closed.

**This document is one of three proposal sources.** The authoritative
prioritized proposal document is [`PROPOSALS.md`](PROPOSALS.md). The
experiment registry is [`EXPERIMENTS.md`](EXPERIMENTS.md).

The immediate objective is to detect and control faculty/replay interference
at the optimizer boundary without changing the 4,852,992-parameter student,
the three immutable teachers, their routes, or the Q2.1 operation/controller/
kernel responsibility split.

## P0 — Freeze terminology and schemas  [STATUS: complete]

- [x] Define `zero.optimizer_attempt.v1` for attempt id, committed update,
  phase, source ids, learning rate, guard budget, decision, and reason.
- [x] Define stable parameter-group ids for embeddings, each attention and
  feed-forward tensor, RMS gains, and final normalization.
- [x] Define learned state as weights + AdamW moments + committed-update count.
- [x] Define orchestration state as attempt count + sampler/RNG + guard state.
- [x] Freeze the observer probe, guard probe, public validation, and promotion
  splits before an intervention run.

Acceptance: schemas validate; every recorded corpus id and teacher hash is
immutable; promotion examples are inaccessible to training-time tools.

## P1 — Observer-only weight/update diagnostics  [STATUS: complete]

- [x] Compute faculty and rotating replay-probe gradients separately.
- [x] Report global gradient cosine, proposed displacement norm, and
  `g_replay dot displacement`.
- [x] Decompose the dot product and norms by stable parameter group.
- [x] Add diagonal Fisher-weighted drift from the immutable ZERO.3 start as a
  diagnostic only; do not regularize training yet.
- [x] Emit append-only attempt JSONL plus a compact tensor summary.
- [x] Run the current Q2.2 seed-2 trajectory with observation enabled but no
  optimizer intervention.

Acceptance: the disabled build is checkpoint-identical to Q2.2; observer mode
does not change weights, moments, RNG, sampling, or selected checkpoints; group
contributions sum to the global drift within tolerance; runtime and memory
overhead are reported; predicted drift is compared with realized sentinel loss
instead of assumed valid.

Observed seed-2 result: 200 attempts / 200 commits; the learned checkpoint
payload was byte-identical to the unguarded reference at every recovery.
Runtime overhead was 1.886x with 116,473,520 preallocated diagnostic bytes.
The first-order predictor was effectively uncorrelated with realized sentinel
change (Pearson 0.0076), so it remains descriptive rather than authoritative.

## P2 — Transactional AdamW shadow state  [STATUS: complete]

- [x] Preallocate rollback storage for weights and both AdamW moment arrays outside the
  training loop.
- [x] Split optimizer execution into propose, shadow-evaluate, commit, reject.
- [x] On rejection, prove by digest that learned state is byte-identical to the
  pre-attempt state.
- [x] Advance attempt/sampler state after rejection while leaving committed
  update unchanged.
- [x] Serialize attempt counter, committed counter, RNG, and guard state in a
  versioned full checkpoint.
- [x] Add interrupted/resumed equivalence tests containing both accepted and
  rejected attempts.

Acceptance: no dynamic allocation in the training loop; weights and moments
never diverge across rollback; uninterrupted and resumed runs are identical;
the existing unguarded checkpoint format remains readable.

## P3 — Local replay guard  [STATUS: complete for v1 diagnostic]

- [x] Begin with observer-calibrated warning and hard guard bands rather than
  requiring replay improvement on every update.
- [x] Reject or backtrack a shadow candidate whose functional probe exceeds
  its local budget.
- [ ] Add half-space projection only after its predicted and realized effects
  pass a synthetic conflicting-gradient fixture.
- [x] Ensure the gradient used to update AdamW moments is consistent with the
  accepted constrained step; rejected gradients cannot leak through moments.
- [x] Cap consecutive rejections and define a deterministic fallback: increase
  replay pressure, reduce learning rate, or end acquisition.

Acceptance: projection satisfies the first-order half-space test; functional
evaluation still has final authority; temporary bounded replay regression is
permitted; the 2% public replay ceiling is never weakened.

The observer calibrated a 0.1641% warning band and a 0.25% hard band. Direct
functional replay evaluation has final authority; projection remains disabled
in v1 because the first-order diagnostic did not demonstrate predictive value.

## P4 — ZERO.4-Q2.3 diagnostic seed 2  [STATUS: complete — no-go]

- [x] Freeze Q2.3 after P0–P3 pass without looking at promotion data.
- [x] Keep Q2.2 architecture, teachers, routing, corpus, initialization, and
  public thresholds fixed; the transactional guard is the independent variable.
- [x] Retain exact recovery checkpoints every 25 committed updates and run the
  full feasibility/Pareto evaluation every 100 committed updates.
- [x] Stop on the declared compute, rejection, plateau, or replay conditions.
- [x] Open promotion exactly once only if a public-validation checkpoint is
  jointly feasible.

Acceptance: seed 2 must pass quantity, controller/kernel safety, and replay at
one checkpoint. A no-go is recorded without seed substitution or threshold
changes.

Measured result: 200 attempts / 200 commits, with zero rejections. Five local
probe changes exceeded the 0.1641% warning band, but none exceeded the 0.25%
hard band; the maximum was 0.2013%. Update 200 passed quantity exactly at the
minimum gates but had 2.685% public replay regression. The run stopped after
two consecutive full replay violations and never accessed promotion.

## P5 — Replication and faculty expansion  [STATUS: closed — P4 no-go]

- [ ] Run seeds 1 and 3 only after the diagnostic seed-2 gate passes.
- [ ] Promote ZERO.4 only if all three seeds satisfy the frozen contract.
- [ ] Open geometry next; keep art dependent on checked geometry and physics
  dependent on quantity, units, and geometry.

Acceptance: every seed and channel is reported separately; one failed mandatory
gate blocks promotion; ZERO.1, ZERO.2, and ZERO.3 hashes remain unchanged.

## Next design question — cumulative functional replay budget

Q2.3 falsified the assumption that an observer-quantile per-attempt budget is
sufficient to control cumulative public replay. Any Q2.4 proposal must retain
direct functional authority but budget drift relative to a frozen baseline or
explicitly account for spent replay budget across accepted attempts. It must
be preregistered as a new independent variable and pass synthetic rollback and
resume tests before another capability run. Projection remains inadmissible
until a predictor demonstrates measured validity.

## Deferred

- Per-weight leave-one-out evaluation: computationally prohibitive and not
  invariant under neural reparameterization.
- Learned latent registrar and continuous faculty prefix tokens: separate v2
  architecture experiment after replay-safe training exists.
- Larger student: scale experiment only after Q2.3 determines whether the
  current failure is optimization interference rather than capacity.

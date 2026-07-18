# ZERO.4 Backlog

Status: Q2.2-R seed 2 is a measured go; Q2.3 is designed but not frozen.
ZERO.3 remains the deployed default. Geometry, art, and physics remain closed.

**This document is one of three proposal sources.** The authoritative
prioritized proposal document is [`PROPOSALS.md`](PROPOSALS.md). The
experiment registry is [`EXPERIMENTS.md`](EXPERIMENTS.md).

The immediate objective is to detect and control faculty/replay interference
at the optimizer boundary without changing the 4,852,992-parameter student,
the three immutable teachers, their routes, or the Q2.1 operation/controller/
kernel responsibility split.

## P0 — Freeze terminology and schemas  [STATUS: proposed — blocked on PROPOSALS.md P0]

- [ ] Define `zero.optimizer_attempt.v1` for attempt id, committed update,
  phase, source ids, learning rate, guard budget, decision, and reason.
- [ ] Define stable parameter-group ids for embeddings, each attention and
  feed-forward tensor, RMS gains, and final normalization.
- [ ] Define learned state as weights + AdamW moments + committed-update count.
- [ ] Define orchestration state as attempt count + sampler/RNG + guard state.
- [ ] Freeze the observer probe, guard probe, public validation, and promotion
  splits before an intervention run.

Acceptance: schemas validate; every recorded corpus id and teacher hash is
immutable; promotion examples are inaccessible to training-time tools.

## P1 — Observer-only weight/update diagnostics  [STATUS: proposed — blocked on PROPOSALS.md P0]

- [ ] Compute faculty and rotating replay-probe gradients separately.
- [ ] Report global gradient cosine, proposed displacement norm, and
  `g_replay dot displacement`.
- [ ] Decompose the dot product and norms by stable parameter group.
- [ ] Add diagonal Fisher-weighted drift from the immutable ZERO.3 start as a
  diagnostic only; do not regularize training yet.
- [ ] Emit append-only attempt JSONL plus a compact tensor summary.
- [ ] Run the current Q2.2 seed-2 trajectory with observation enabled but no
  optimizer intervention.

Acceptance: the disabled build is checkpoint-identical to Q2.2; observer mode
does not change weights, moments, RNG, sampling, or selected checkpoints; group
contributions sum to the global drift within tolerance; runtime and memory
overhead are reported; predicted drift is compared with realized sentinel loss
instead of assumed valid.

## P2 — Transactional AdamW shadow state  [STATUS: proposed — blocked on PROPOSALS.md P0]

- [ ] Preallocate candidate weights and both AdamW moment arrays outside the
  training loop.
- [ ] Split optimizer execution into propose, shadow-evaluate, commit, reject.
- [ ] On rejection, prove by digest that learned state is byte-identical to the
  pre-attempt state.
- [ ] Advance attempt/sampler state after rejection while leaving committed
  update unchanged.
- [ ] Serialize attempt counter, committed counter, RNG, and guard state in a
  versioned full checkpoint.
- [ ] Add interrupted/resumed equivalence tests containing both accepted and
  rejected attempts.

Acceptance: no dynamic allocation in the training loop; weights and moments
never diverge across rollback; uninterrupted and resumed runs are identical;
the existing unguarded checkpoint format remains readable.

## P3 — Local replay guard  [STATUS: proposed — blocked on PROPOSALS.md P0]

- [ ] Begin with observer-calibrated warning and hard guard bands rather than
  requiring replay improvement on every update.
- [ ] Reject or backtrack a shadow candidate whose functional probe exceeds
  its local budget.
- [ ] Add half-space projection only after its predicted and realized effects
  pass a synthetic conflicting-gradient fixture.
- [ ] Ensure the gradient used to update AdamW moments is consistent with the
  accepted constrained step; rejected gradients cannot leak through moments.
- [ ] Cap consecutive rejections and define a deterministic fallback: increase
  replay pressure, reduce learning rate, or end acquisition.

Acceptance: projection satisfies the first-order half-space test; functional
evaluation still has final authority; temporary bounded replay regression is
permitted; the 2% public replay ceiling is never weakened.

## P4 — ZERO.4-Q2.3 diagnostic seed 2  [STATUS: proposed — blocked on P0–P3]

- [ ] Freeze Q2.3 after P0–P3 pass without looking at promotion data.
- [ ] Keep Q2.2 architecture, teachers, routing, corpus, initialization, and
  public thresholds fixed; the transactional guard is the independent variable.
- [ ] Retain exact recovery checkpoints every 25 committed updates and run the
  full feasibility/Pareto evaluation every 100 committed updates.
- [ ] Stop on the declared compute, rejection, plateau, or replay conditions.
- [ ] Open promotion exactly once only if a public-validation checkpoint is
  jointly feasible.

Acceptance: seed 2 must pass quantity, controller/kernel safety, and replay at
one checkpoint. A no-go is recorded without seed substitution or threshold
changes.

## P5 — Replication and faculty expansion  [STATUS: proposed — blocked on P4]

- [ ] Run seeds 1 and 3 only after the diagnostic seed-2 gate passes.
- [ ] Promote ZERO.4 only if all three seeds satisfy the frozen contract.
- [ ] Open geometry next; keep art dependent on checked geometry and physics
  dependent on quantity, units, and geometry.

Acceptance: every seed and channel is reported separately; one failed mandatory
gate blocks promotion; ZERO.1, ZERO.2, and ZERO.3 hashes remain unchanged.

## Deferred

- Per-weight leave-one-out evaluation: computationally prohibitive and not
  invariant under neural reparameterization.
- Learned latent registrar and continuous faculty prefix tokens: separate v2
  architecture experiment after replay-safe training exists.
- Larger student: scale experiment only after Q2.3 determines whether the
  current failure is optimization interference rather than capacity.

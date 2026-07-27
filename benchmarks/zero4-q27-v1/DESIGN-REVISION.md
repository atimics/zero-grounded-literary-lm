# Q2.7 design revision — paid-for historical control

Status: **authorized under issue #61**. This amendment changes the
interpretation and comparison plan, not the frozen Q2.7 training mechanics.
The authorization permits exactly one $1.17-capped top-FFN quantity execution
and, only if candidate-ready, its already-preregistered $0.12 language gate.

## High-ROI comparison

The literature review correctly rejected the premise that top-FFN isolation
is a literature-established safe boundary. Q2.7 now treats it as a
prospective scope ablation.

The broader-scope control does not need to be rerun. Q2.6 seed 2 already:

- started from the same immutable ZERO.3 initialization;
- used the same seed, teachers, data, optimizer, tangent projection, direct
  replay authority, quantity gates, selection rule, and stop conditions;
- trained the full model and selected update 500 prospectively;
- passed quantity and replay, then received the frozen ZERO-EVAL-1 language
  screen that the Q2.7 candidate gate inherits.

The sole prospective training difference is therefore full-model versus
`--trainable-scope top-ffn`. Hash drift or any second changed variable
invalidates the historical comparison and fails closed.

Reusing this control avoids up to $1.17 of duplicate training and $0.12 of
duplicate language evaluation. The only new scientific execution remains the
top-FFN arm (at most $1.17), followed conditionally by its candidate language
gate (at most $0.12).

## Outcomes

- **Go:** the selected seed-2 top-FFN candidate passes quantity, direct
  replay, promotion, BLiMP, and TinyStories. This supports only a bounded
  scope-ablation result and consideration of separately budgeted replication.
- **No-go before language evaluation:** no promoted quantity/replay candidate
  exists. Retire this scope and save the conditional $0.12 evaluation.
- **No-go at language evaluation:** either bounded language screen fails.
  Retire this scope without tuning or repetition.
- **Inconclusive:** infrastructure or integrity failure produces no scientific
  evidence and cannot change the intervention.

BLiMP aggregate accuracy remains gate authority. All 67 paradigm values,
already emitted by the evaluator, are reported descriptively and are not
treated as adequately powered individual tests. TinyStories claims are
limited to its frozen 1,000-case distribution.

## Literature decision

No second broad literature review is required for this comparison. The
existing review already covers replay projection, localization,
counterevidence to parameter-count safety, and both language screens.

A small targeted review becomes mandatory only before introducing a new
intervention family—such as adapters, masks/pruning, or another layer
boundary—or if the historical-control comparability audit fails. No such
review or mechanism is part of this amendment.

# ZERO.4 Q3.6 preregistration — projection-scale and gradient-clip factorial probe

Follow-up to the Q3.5 `feature_no_go`. Feature-level diagnostic only.

## Question

Which constraint froze the Q3.5 expanded heads at uniform logits: the unscaled
projection (H-scale) or the unchanged global gradient-norm clip (H-clip)?

## Context

Q3.5 ran ReLU(P x) with a unit-entry ternary projection and the inherited
global gradient-norm clip. The linear arm reproduced Q3.4 exactly (0.416), but
both expanded arms sat at chance with cross-entropy pinned to ln(5). A
post-hoc diagnostic showed the expanded code was healthy (post-ReLU std 7.18,
nonzero fraction 0.50, across-record CV 1.12), so the failure is in the
optimization path, not the representation.

## Locked intervention

Inherited unchanged from Q3.5 unless listed: base runtime
`benchmarks/zero4-q31-v1/results/candidate.litqhead` (`84c67ea5…`), 4,852,992
frozen parameters; deployment-exact 1,536-dimensional features; the frozen
projection `benchmarks/zero4-q35-sparse-probe-v1/projection.bin`
(`efdf4306…`), 6,144 × 1,536, density 1/10; top-307 winner-take-all; Adam,
batch 64, learning rate 0.001, gradient clip 1.0; seed 2; at most 100 updates
measured at 0, 25, 50, 100.

Two factorial factors:

- **scale** — `unscaled`, or `fanin`: multiply unit i by
  1/sqrt(nonzeros in projection row i). Applied at run time; projection bytes
  unchanged.
- **clip** — `global` (inherited: one clip over the whole gradient), or
  `perparam` (elementwise clamp of each gradient to [-1, 1] before Adam).

## Arms (one execution, one feature extraction)

| Arm | Features | Scale | Clip |
| --- | --- | --- | --- |
| linear | raw 1,536 | unscaled | global |
| dense-unscaled-global | 6,144 dense | unscaled | global |
| sparse-unscaled-global | 6,144 top-307 | unscaled | global |
| dense-unscaled-perparam | 6,144 dense | unscaled | per-parameter |
| sparse-unscaled-perparam | 6,144 top-307 | unscaled | per-parameter |
| dense-fanin-global | 6,144 dense | fan-in | global |
| sparse-fanin-global | 6,144 top-307 | fan-in | global |
| dense-fanin-perparam | 6,144 dense | fan-in | per-parameter |
| sparse-fanin-perparam | 6,144 top-307 | fan-in | per-parameter |

## Hypotheses and decisions

Feature gate: held-out accuracy at least 0.80 overall and 0.60 per class at a
measured update.

- **H-scale** (primary `sparse-fanin-global`): fan-in scaling alone, with the
  global clip unchanged, reaches the gate.
- **H-clip** (primary `sparse-unscaled-perparam`): per-parameter clipping
  alone, with the unscaled projection, reaches the gate.
- **H-interaction** (primary `sparse-fanin-perparam`): both together reach the
  gate.

Each hypothesis is decided independently. The linear anchor must reproduce
Q3.4's 0.416 exactly or the run is a mechanics failure. The dense arms are
controls that separate sparsity from the intervention. A pass on any primary
arm is `feature_go`; otherwise `feature_no_go`.

## Not authorized

No packaging, canonical regression gate, runtime claim, language gate,
deployment, additional seed, resume, or hyperparameter search. Local compute,
maximum spend $0.15.

## Stop boundary

One seed, one execution. A `feature_go` opens a separately registered packaging
experiment that carries the projection and the winning scale/clip policy into
the runtime and runs the unchanged Q3.4 package gates. A `feature_no_go` on all
three hypotheses closes the fixed-random-feature family at this exposure and
points to the adequate-exposure ablation.

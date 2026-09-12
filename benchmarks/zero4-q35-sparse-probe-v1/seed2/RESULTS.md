# ZERO.4 Q3.5 result — sparse random-feature semantic probe

- Status: completed, `feature_no_go`
- Scope: feature-level diagnostic. No package, canonical, runtime, language, or
  promotion claim.
- Source commit: `cb57a0170b17bcdacaab67efb95ca04233a6a3cd`
- Contract SHA-256: `c2b7baf5318c8ea105a83606e358d356355742d532f027ddf3b82b09fb6ab052`
- Authorization SHA-256: `1fa8bee978127a9d699f482c8099de75e5728608a13ebdbc70d9416d9fbf0857`
- Projection SHA-256: `efdf4306df47e188700d48803653703b63d75332665f49332e8dae07fda0e144`
- Result SHA-256: `da17f638af3c31eadc1f7f60e140321027cffeb4b927415bf8b317f0f4ab4d8e`
- Diagnostics SHA-256: `38a941eebd7efa9cd2a294fd921b89137ad60aad006984db1b84e0cc87f3bc13`

## Decision

The sparse arm did **not** reach the frozen feature gate (≥ 0.80 overall, ≥ 0.60
per class). Neither did the dense control. The linear in-run reference
reproduced Q3.4 exactly.

| Arm | Features | Trainable | Update 100 accuracy | Final per class | Gate |
| --- | --- | ---: | ---: | --- | --- |
| linear | 1,536 raw | 7,685 | 0.416 | 0.01 / 0.08 / 0.49 / 0.92 / 0.58 | fail |
| dense | 6,144 ReLU(P x) | 30,725 | 0.200 | 0.00 / 0.00 / 0.00 / 1.00 / 0.00 | fail |
| sparse | 6,144 ReLU(P x) + top-307 WTA | 30,725 | 0.200 | 0.00 / 0.00 / 0.00 / 1.00 / 0.00 | fail |

Q3.4's recorded semantic accuracy was 0.416. The in-run linear arm reproduced
it exactly at every measurement (cross-entropy 1.3289, accuracy 0.4160, per
class identical), which validates the harness against the frozen Q3.4 record.

Both expanded arms sat at chance with cross-entropy pinned to ln(5) = 1.6094
and collapsed to a single predicted class. The nonlinear feature map did not
merely fail to beat the linear head; the head did not move at all.

## Mechanism

A post-hoc, exploratory diagnostic (not part of the preregistered intervention)
measured the expanded code on 500 holdout records:

| Quantity | Raw features | Expanded, pre-ReLU | Expanded, post-ReLU |
| --- | ---: | ---: | ---: |
| mean | 0.0031 | -0.1488 | 4.8783 |
| std | 1.0000 | 12.4222 | 7.1832 |
| nonzero fraction | — | — | 0.4967 |

Across-record coefficient of variation of unit means: 1.1214.

The expanded code is healthy and informative: it is neither near-constant nor
degenerate, and its units vary across records at least as much as their mean.
The failure is therefore **not representational**. It is an optimization-scale
interaction:

- the frozen ternary projection uses unit entries with no fan-in scaling, so
  post-ReLU activations have std 7.18 against the raw features' std 1.00;
- the head has 6,144 inputs against 1,536, so its gradient norm is larger
  again;
- `q32_head_update` applies a single **global gradient-norm clip** (`clip =
  min(1, 1/||g||)`) before Adam.

The clip shrinks every step by roughly the gradient norm. With ~7× larger
features over 4× the parameters, the step is suppressed enough that the
30,725-parameter head remains at uniform logits. The unchanged optimizer,
which is part of the frozen contract, is the active constraint — not the
representation.

## Falsification record

Per the preregistration, a feature no-go closes the frozen intervention and
names the next boundary. It does not close the fly-brain architecture family,
because the mechanism is now identified as a scale/clipping interaction rather
than a representational limit.

## Next boundary

Two separately registered, pre-declared interventions follow:

1. **Fan-in scaled projection (Q3.6 candidate).** Scale P by
   1/sqrt(nonzeros per row) ≈ 1/sqrt(154) so post-ReLU activations have unit
   scale, matching the raw features, with the optimizer unchanged. This tests
   the architecture without changing the optimizer.
2. **Per-parameter gradient clipping (Q3.6 alternative).** Keep the unscaled
   projection and replace the global clip with a per-parameter clip, isolating
   the optimizer interaction directly.

A go on either opens the packaging experiment that carries the projection into
the runtime and runs the unchanged Q3.4 package gates. The adequate-exposure
ablation remains open but is now a lower priority, because the in-run linear
arm shows the raw features carry signal at the current exposure.

## Replication

One seed, one execution, as preregistered. No additional seed is authorized.
The authorization file is single-use and its output directory already exists,
so the runner will refuse to re-run this experiment.

# ZERO.4 Q3.6 result — projection-scale and gradient-clip factorial probe

- Status: completed, **`feature_no_go`** for all three hypotheses
- Scope: feature-level diagnostic. No package, canonical, runtime, language, or
  promotion claim.
- Source commit: `8f048aab1f922e65abfbebef86f200e84ab528cd`
- Contract SHA-256: `230b874a109320ec316843ffe52a585b971349a8e69c088dc14e6b6bdb0ead9b`
- Result SHA-256: `1747f319f8f1567417397e5df8269584323a2d1a221333a885a9849f70a54dec`
- Linear anchor reproduced Q3.4 exactly: 0.416.
- Separability SHA-256: `e2625cd2aed508de56ad51c9e3015832283f7ba3c73ea638a85cc3ceba724427`

## Decision

Neither projection scaling (H-scale) nor per-parameter gradient clipping
(H-clip), nor both together (H-interaction), unfroze the expanded heads.

| Arm | Scale | Clip | Update 100 accuracy |
| --- | --- | --- | ---: |
| linear | unscaled | global | 0.416 |
| dense-unscaled-global | unscaled | global | 0.200 |
| sparse-unscaled-global | unscaled | global | 0.200 |
| dense-unscaled-perparam | unscaled | per-parameter | 0.200 |
| sparse-unscaled-perparam | unscaled | per-parameter | 0.200 |
| dense-fanin-global | fan-in | global | 0.200 |
| sparse-fanin-global | fan-in | global | 0.200 |
| dense-fanin-perparam | fan-in | per-parameter | 0.200 |
| sparse-fanin-perparam | fan-in | per-parameter | 0.200 |

`hypotheses_supported`: empty. `scientific_decision`: `feature_no_go`.

## Decisive observation

For the sparse arm, the `global` and `per-parameter` clipping modes produced
**byte-identical head-state digests at every measurement**. The two policies
are therefore both inactive: the expanded-arm gradient norm is below 1 and
each element is below 1. The expanded heads move only through tiny,
inconsistent gradients, so Adam stalls and the predictor collapses to one
class. Clipping is not the constraint because neither clip engages.

## Class-separability diagnostic

A post-hoc, exploratory nearest-centroid diagnostic (means from 1,000 training
records, test on the 500-record semantic holdout) shows the failure is **not**
representational:

| Features | Nearest-centroid accuracy |
| --- | ---: |
| raw 1,536 | 0.300 |
| dense unscaled | 0.332 |
| **sparse unscaled** | **0.420** |
| dense fan-in | 0.328 |
| sparse fan-in | 0.416 |

The sparse winner-take-all code is the **most linearly separable** of all the
representations tried, and a trivial nearest-centroid readout on it matches the
gradient-trained raw linear head (0.416). The expanded representation carries
at least as much class signal as the raw features; the gradient-trained head is
what fails.

## Conclusion

1. Projection scale and gradient clipping are both refuted as the constraint.
2. The sparse random code is linearly at least as good as the raw features.
3. The fixed random expansion does **not** raise the linear-semantic ceiling
   above the raw features (~0.42 nearest-centroid vs the 0.80 gate).
4. Therefore the semantic gap is in the frozen representation and/or the
   training exposure, not the readout architecture. The fixed-random-feature
   family is closed at this exposure.

## Next boundary

- The 0.80 semantic gate needs a representation or supervision change, not a
  larger random readout. Upstream's own recorded boundary ("adequate exposure
  and a small nonlinear probe before a larger routed expert") is now sharper:
  the nonlinear probe was run and did not raise the linear ceiling.
- If a further fly-aligned probe is wanted, the correct one is a **closed-form
  readout** (nearest centroid or ridge) on the sparse code, which removes the
  Adam pathology. This diagnostic already estimates its ceiling at ~0.42, so it
  is not expected to clear 0.80 and is lower priority than a representation or
  exposure experiment.

## Exploratory status

`diagnostics.json` and `separability.json` are post-hoc analyses. They explain
the recorded outcome and did not change it.

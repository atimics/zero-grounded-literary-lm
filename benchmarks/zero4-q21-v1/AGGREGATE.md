# ZERO.4-Q2.1 multi-seed decision

Decision: **no-go**. ZERO.4 is not promoted.

The model selects only an operation. Source arguments are bound by the controller and arithmetic is executed by the deterministic kernel; neither is credited as neural arithmetic. Every channel remains visible below.

| Seed | Decision | Model operations | Controller bindings | Exact commits | Replay regression |
| ---: | :---: | ---: | ---: | ---: | ---: |
| 1 | go | 499/500 | 500/500 | 499/500 | 1.864% |
| 2 | no-go | 500/500 | 500/500 | 500/500 | 2.011% |
| 3 | not run | — | — | — | — |

Seed 1 passed all gates. Seed 2 passed every quantity and safety gate but replay regressed 2.011%, narrowly above the fixed 2.000% ceiling. Seed 3 was therefore not run. The next experiment must freeze a stronger replay-preservation schedule or a multi-objective checkpoint selector before replication; geometry, art, and physics remain closed.

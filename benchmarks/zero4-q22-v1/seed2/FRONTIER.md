# ZERO.4-Q2.2 seed 2 frontier — invalid replay weighting

This report is inadmissible. Replay evaluation accidentally restored the
trainer's default 2x foundation weight after distillation flags were removed.
The corrected equal-weight evaluation and repair result is in
`benchmarks/zero4-q22r-v1/seed2/FRONTIER.md`.

Decision: **no-go**. Stop: replay exceeded 2% on two consecutive full evaluations.

No checkpoint was selected because the public quantity and replay constraints never passed jointly. The disjoint promotion set remained untouched: no jointly feasible public-validation checkpoint.

| Update | Phase | Quantity pass | Minimum learned-gate margin | Replay loss | Replay regression | Feasible |
| ---: | --- | :---: | ---: | ---: | ---: | :---: |
| 200 | acquisition | no | -20.200% | 1.6849 | 1.844% | no |
| 300 | acquisition | yes | 0.800% | 1.6911 | 2.218% | no |
| 400 | consolidation | yes | 1.000% | 1.6926 | 2.309% | no |

Replay baseline: 1.6544. Updates executed: 400 (300 acquisition, 100 consolidation).

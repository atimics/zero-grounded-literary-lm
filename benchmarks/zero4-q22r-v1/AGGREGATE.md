# ZERO.4-Q2.2-R multi-seed decision

Decision: **no-go**. ZERO.4 is not promoted.

All three declared seeds completed under the frozen policy. A seed-level go is insufficient: family promotion requires every seed to pass the quantity and replay gates jointly.

| Seed | Decision | Operation rate | Exact-artifact rate | Replay regression | Promotion split evaluated |
| ---: | :---: | ---: | ---: | ---: | :---: |
| 1 | no-go | 81.800% | 81.800% | 2.685% | no |
| 2 | go | 97.600% | 97.600% | 1.919% | yes |
| 3 | no-go | 76.400% | 76.400% | 2.587% | no |

Seed 2 passed, but seeds 1 and 3 stopped after replay exceeded 2% on two consecutive full evaluations. Their best retained diagnostics also missed the operation, exact-request, commit, and exact-artifact gates. The disjoint promotion split remained untouched for both failed seeds. A new attempt requires a separately preregistered follow-up; no ZERO.4 checkpoint replaces ZERO.3.

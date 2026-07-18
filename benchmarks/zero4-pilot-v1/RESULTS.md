# ZERO.4 Faculty Pilot v1

Decision: **no-go** after seed 1; seeds 2 and 3 were not authorized.

The implementation and data gates passed, but the first capability curriculum
did not pass promotion. This is a useful failure: the model learned substantial
target probability and some typed grammar without yet learning verified
artifacts or preserving the historical function closely enough.

| Promotion sample | ZERO.3 close/syntax/exact | ZERO.4 close/syntax/exact | Target bits |
| --- | --- | --- | ---: |
| Quantity | 10/0/0 of 20 | 15/9/0 of 20 | 1.4803 |
| Geometry | 4/0/0 of 20 | 11/5/0 of 20 | 1.2849 |
| Art | 5/0/0 of 20 | 7/0/0 of 20 | 1.3151 |

ZERO.3 baseline target bits were `5.9943`, `4.8685`, and `5.7402`, respectively,
so the student learned the new distributions strongly. It nevertheless emitted
zero exact artifacts. The replay-heavy consolidation ended at historical loss
`1.8038` against the frozen `1.7424` baseline, a 3.52% regression and therefore
outside the 2% gate.

The next iteration should not add more teachers, data, or parameters yet. It
should test boundary-aware loss or controller-scaffolded typed decoding, score
generated artifacts through the domain validators, and demonstrate replay
preservation on seed 1 before replication.

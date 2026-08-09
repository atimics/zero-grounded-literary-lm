# Q2.8 fixed graded-plasticity preregistration

Q2.7 tested a hard architectural cutoff: almost the entire model was frozen and
only the top feed-forward sublayer could change. It preserved the old behavior
but did not learn the new quantity behavior. Q2.8 tests the narrower follow-up
hypothesis that every layer may need some capacity to change, while
replay-sensitive groups should change less.

## Stage 1: no-update shadow audit

The audit uses only the frozen ZERO.3 initialization and the existing Q2.6
training splits. It measures four deterministic training samples from the
quantity range and from each of the six replay ranges. For every parameter
group it records quantity and replay gradient energy, their alignment, the
complete proposed AdamW movement, and the movement predicted after graded
scaling and replay projection.

The audit computes exactly one coefficient per group:

`p_g = 0.05 + 0.95 * N_g / (N_g + O_g + 1e-12)`

`N_g` is the group's quantity-gradient energy divided by the median quantity
energy across groups. `O_g` is the analogous replay-gradient quantity. The
result is a fixed profile between 0.05 and 1.0. The profile cannot change after
the audit.

The audit simulates one optimizer proposal only to measure its consequences.
It then restores the model. Success requires all weights and both AdamW moment
arrays to be byte-identical to their starting values. No optimizer update is
committed and no checkpoint is produced.

## Stage 2: proposed 200-update pilot

Stage 2 is not authorized by this contract. A later approval must bind the
exact merged implementation and exact profile SHA-256 before it can run.
This change intentionally exposes no parameter-training mode; activation must
arrive in a later exact-commit, budget-bound change after merge.

If authorized, the diagnostic seed-2 pilot will start from ZERO.3 with fresh
moments and apply the same immutable profile for at most 200 optimizer updates.
Each coefficient scales its group's complete proposed AdamW weight movement,
including weight decay. The replay-tangent correction is weighted by the same
coefficients so the projection cannot silently restore full plasticity in a
nominally sticky group.

Measurements are frozen at updates 0, 100, and 200. The historical Q2.6
full-model and Q2.7 top-FFN results are controls; they are not rerun. Maximum
new quantity compute is $0.50.

## Leakage and decision boundary

BLiMP, TinyStories, quantity public rows, quantity promotion rows, language-gate
results, and promotion inputs are forbidden during the audit, training, and
checkpoint selection. They cannot influence the profile.

Only a prospectively selected candidate that first passes the frozen quantity
and replay criteria may become eligible for one separately bounded language
gate costing at most $0.12. The language gate remains conditional and model
promotion is not authorized.

The experiment is a no-go if the shadow audit changes state, creates an invalid
profile, violates the weighted-projection invariant, receives a forbidden
input, or produces no valid quantity/replay candidate by update 200.

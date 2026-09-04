# Reasoner 5.7 development specification

Status: gated development scaffolding. The bound R5.6 channel-readiness
assessment is `development-no-go`. Its exact threshold-one candidate sets have
a full-to-program-prior size ratio of one, above the registered maximum of
0.8. The bound v2 assessment computes full-arm log loss in stable Q20 score
space and independently replays its positive 2.035434e-32 mean. Its
prospective sealed interface and proxy audit is also pending.

R5.7 consumes the exact published R5.6 observation artifact after channel
readiness passes. The current R5.6 assessment uses 99 independent calibration
program families. All 99 cover the truth across their registered corruption
draws. An independent artifact scorer replays all 792 draws. The one-sided 95
percent Wilson lower bound is 0.9733982695. The selected threshold is one, so
the exact candidate set is the complete 427-class universe and the candidate-
set utility gate fails. The sealed interface and proxy audit remains pending.
Policy training, selector choice, calibration, development, and sealed
identities are separate semantic partitions.

Every primary arm starts with three reads at inputs 0, 1, and 2, with one read
per sensor. Every arm then buys four unit-cost input-and-sensor reads. The
program guide, semantic universe, R5.6 channel, posterior update, verifier,
candidate order, and caps stay fixed across arms.

For the analytic controls, let `p(h)` be the current semantic posterior. Let
`r(h,y|a)` be the exponential of the R5.6 local plus transition Q20 score,
divided by the R5.6 temperature. Normalize `r` across the 18 outcomes for each
hypothesis to obtain `L(h,y|a)`. Missing is outcome 17. Define the predictive
mass `q(y|a) = sum_h p(h)L(h,y|a)`.

The multiclass noisy-GBS control maximizes:

```text
1 - max_y q(y|a)
```

The posterior-L2 EC2 edge-cut control maximizes:

```text
sum_y q(y|a) sum_h (p(h)L(h,y|a)/q(y|a))^2 - sum_h p(h)^2
```

Canonical input-then-sensor order resolves ties.

The native checkpoint includes deterministic semantic splits, source policy
training, selector choice, policy calibration, fixed development identities,
all registered controls, exact verification, and a fail-closed execution
entrypoint. The scaffolding binds shared harness commit `a463821`, its
deterministic binary64 reference math, its bounded 14-digit final receipt
encoding, its proposal record and work-charge guarantees, and its v2
recentered-null bootstrap receipts. Shared-harness replay and frozen R5.7
output files will be added after the prerequisite passes.

# ZERO.4-Q2.6 preregistration — cumulative replay tangent projection

Status: **frozen before seed-2 execution**.

## Question

Can a global replay-tangent projection change each AdamW candidate direction
enough to preserve the unchanged cumulative replay authority and reopen the
quantity-learning path?

Q2.5 held the six-slice composite below 1.5% and extended Q2.4 from 66 to 71
committed updates. It then exhausted every learning-rate scale from 1 through
1/128 on eight consecutive outer attempts. The terminal 1/128 trials missed
the boundary by only 0.000151–0.000238 percentage points, but smaller steps no
longer produced an admissible direction. Q2.6 therefore changes direction,
not authority.

## Frozen candidate construction

At the committed pre-attempt state, evaluate the gradients of the same six
fixed replay validation windows used by the cumulative guard and take their
arithmetic mean `r`. Freeze `r`, the sampled minibatch, clipped training
gradient, proposed committed-update index, weights, and AdamW moments for the
entire outer attempt.

For each registered learning-rate scale `1`, `1/2`, `1/4`, `1/8`, `1/16`,
`1/32`, `1/64`, and `1/128`:

1. restore the complete pre-attempt learned state and training gradient;
2. form the scaled AdamW candidate and retain its candidate moments;
3. let `d` be its candidate weight displacement;
4. if `dot(r, d) > 0`, replace `d` with
   `d - dot(r,d)/dot(r,r) * r`; otherwise leave it unchanged;
5. directly evaluate all six frozen replay slices against immutable ZERO.3;
6. commit the first finite trial at or below the unchanged 1.5% cumulative
   increase.

The projection is global over all trainable weights. It changes weights only;
the AdamW moments formed by the selected scaled trial commit with them. A retry
or outer rejection restores weights and both moment arrays exactly. The mean
replay gradient is candidate construction only: its first-order prediction has
no authority. The direct six-slice functional evaluation remains the sole
commit decision.

## Unchanged authority

- Student, initialization, teachers, corpora, source order, tokenizer,
  optimizer, learning-rate schedule, batch, and attempt budgets are Q2.5's.
- The cumulative hard ceiling remains 1.5%, preserving 0.5 percentage points
  below the 2% public replay gate.
- Quantity gates, 25-commit recovery cadence, 100-commit public cadence,
  frontier rule, and stop conditions are unchanged.
- The promotion split opens exactly once only after a jointly feasible public
  checkpoint.
- Diagnostic seed 2 is the only authorized run. Seeds 1 and 3 remain sealed
  unless seed 2 passes.

## Logging and mechanics gate

Every trial records scale, six candidate losses, direct composite change,
projection trigger, coefficient, pre/post projection dot products, removed
displacement fraction, and selection decision in `zero.optimizer_attempt.v4`.
The attempt record binds the all-slice replay-gradient norm and complete
rollback digest.

Before seed 2 may execute, the implementation must prove:

- a C self-test with a positive conflicting displacement that applies the
  projection and verifies the post-projection tangent dot product;
- full-scale and backtracked commits under the direct guard;
- byte-identical uninterrupted and 4+4 resumed checkpoints and attempt logs;
- exact restoration of weights and both AdamW moment arrays through all eight
  projected retry scales;
- contract/checker and result-registry validation on both portable C and
  Accelerate CI.

The machine-readable authority is [`contract.json`](contract.json). No Q2.6
seed-2 outcome may be observed before that contract and implementation merge.

# ZERO.4-Q2.4 preregistration

Status: **frozen before any Q2.4 training**.

Q2.3 showed that a one-step, one-slice replay delta was not an effective
authority boundary: all 200 seed-2 attempts committed, yet the frozen public
replay score regressed 2.685%. Q2.4 changes only that authority rule.

Before every commit, the candidate is evaluated on the fixed validation window
of all six replay sources. Their arithmetic-mean loss is compared with the same
mean evaluated on the immutable ZERO.3 initialization. A candidate is rolled
back if the cumulative relative increase is non-finite or greater than 1.5%.
The threshold leaves a 0.5 percentage-point reserve below the existing 2%
public balanced-replay ceiling. The rotating local delta and first-order drift
remain diagnostics and have no authority.

Seed 2 is the only admitted diagnostic run. Seeds 1 and 3 remain sealed unless
seed 2 produces a jointly feasible public checkpoint and passes the promotion
split. The full machine-readable contract is [`contract.json`](contract.json).

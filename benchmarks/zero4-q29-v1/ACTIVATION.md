# Q2.9 implementation activation

Issue #83 authorizes the fail-closed implementation of the Q2.9 conservative
exposure pilot. A protected merge does not authorize the pilot itself.

Before one execution, an external runtime budget must bind the exact merged
commit and preserve every frozen cap in `pilot-budget.json`. The runner rejects
the checked-in template, reused output directories, source drift, profile or
input drift, runtime overrides, resume attempts, language inputs, and promotion
authority.

The pilot stops at the first measured replay breach or quantity first hit, and
never commits more than 100 updates. It only writes training-side measurements
and raw checkpoints. A candidate is copied and hash-frozen only when the
preregistered first-hit rule passes. No language gate is executed by the pilot.

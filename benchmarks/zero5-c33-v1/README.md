# ZERO.5-C3.3 paired-invariance screen

C3.3 changes one thing from the frozen C3.2 D arm: both orientations of every
mirrored claim or retrieval pair now contribute gradients inside the same
optimizer update.

The model, C2 initialization, tokenizer, 55,065 training records, answer
weights, batch size, update count, and 19,337,216 compute-token exposures stay
fixed. The exact C3.2 validation files are reused and all 10,166 test records
remain sealed.

This tests atomic paired minibatching. It does **not** add a direct consistency
penalty. A pass requires a 10-point improvement in mean swap consistency over
C3.2 D, a 5-point improvement in mean pair-exact accuracy, and no material
loss in choice, completion, position balance, Atlas retention, or C1 anchor
retention.

Run `make zero5-c33-check` before any paid run. The contract authorizes one
seed-0 arm only, capped at $3.40 of on-demand EC2 compute.

The run is complete. Pair-atomic batching did not pass: mean swap consistency
fell by 11.83 points and mean pair-exact accuracy fell by 6.40 points relative
to C3.2 D. Completion quality and Atlas/C1 retention were largely preserved,
but the primary relational gates failed. No replication or broad promotion is
authorized. See [RESULT.md](RESULT.md) for the plain-English result.

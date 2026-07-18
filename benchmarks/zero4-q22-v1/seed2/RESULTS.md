# ZERO.4-Q2.2 seed 2

Decision: **no-go** because the recorded replay evaluation used the wrong
sampling functional. This run is retained as an evaluation-invalidated
acquisition trajectory, not as evidence that its checkpoints failed.

The replay adapter removed both distillation and `--sample-weight 1`, restoring
the trainer's default two-times foundation weight. Consequently the replay
values in this directory cannot be used for checkpoint selection. Corrected
evaluation and the seed-level decision are recorded under Q2.2-R.

No promotion model was produced from this invalid evaluation.

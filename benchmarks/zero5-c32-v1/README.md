# ZERO.5-C3.2

C3.2 is a fixed-model, fixed-tokenizer, equal-compute test of repaired C3 task
definitions. Claims are exact-evidence mirrored choices. Retrieval examples are
evaluated in both passage orders. Cloze is unchanged.

Arm C trains the repaired braid with uniform answer weights. Arm D uses the
same packs, order, seed, and compute with weights derived to equalize total
answer-token mass across tasks.

The contract was frozen before training. The test split stays sealed. This is
a single-seed pilot, not a broad model promotion.

Run the preflight with `make zero5-c32-check`. Run the authorized experiment
with `make zero5-c32-run`.

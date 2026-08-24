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

## AWS baseline cache

The exhaustive frozen C2 baseline may be reused on a recovery instance only
through `scripts/zero5_c32_baseline_cache.mjs`. Its cache identity binds the
baseline payload to the C3.2 contract, evaluator sources, C2 checkpoint,
tokenizer, every evaluation artifact, evaluation settings, and backend. The
installer rejects changed metrics, files, bindings, or cache hashes.

After an AWS run has durably written `state/baseline.json`, publish an immutable
private cache with:

```sh
ZERO5_TRAINING_BUCKET=zero-training-022118847419 \
ZERO5_BASELINE_SOURCE_RUN_ID=<run-id> \
scripts/aws/zero5-c32-publish-baseline-cache.sh
```

Pass the returned `ZERO5_BASELINE_CACHE_KEY` and
`ZERO5_BASELINE_CACHE_SHA256` values to a later launch or resume. A state-local
baseline with the same payload may be upgraded to the verified cache; a
conflicting baseline stops the instance before training.

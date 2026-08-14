# ZERO.4 Q3.4 semantic-head preregistration

## Question

Does a balanced canonical/paraphrase objective turn the already-successful 7,685-parameter frozen-base operation head into a semantic router, while preserving canonical behavior?

This is a corrective training experiment after Q3.3 measured only 130/500 semantic routes correct. It does not test natural-language argument binding: the evaluator isolates operation selection, then supplies the canonical input to the existing deterministic binder and oracle.

## Locked intervention

- Freeze every one of the 4,852,992 base parameters.
- Train only a zero-initialized linear 1,536-to-5 head (7,685 parameters, 0.1584% of the base).
- Use the deployment-exact quantized streaming representation from all six frozen layers.
- Train on 4,500 canonical and 4,500 semantic records, balanced exactly across the five operations.
- Seed 2, batch 64, learning rate 0.001, no weight decay, at most 100 updates.
- Measure at updates 0, 25, 50, and 100. Select the first measured checkpoint whose semantic-private representation accuracy is at least 80% overall and 60% in every class.

The 500 private paraphrases use template families absent from training. The 500 confirmation paraphrases use a third, never-extracted template bank. Every semantic split is 100 examples per operation, 50 lexical and 50 implicit per operation. Input-length buckets are class-independent, and literal operation names are prohibited in visible paraphrases.

## Package gates

Before freezing a candidate, it must pass all of the following through the packaged runtime:

1. Semantic private and untouched semantic confirmation: at least 80% overall, 60% for every operation, 75% lexical, and 65% implicit.
2. Canonical private and the combined disjoint public-plus-promotion split: at least 99% operation accuracy overall and 98% per operation; closure, syntax, arguments, and oracle arithmetic exact.
3. Rejected routes make zero state mutations and non-Q probabilities remain byte-for-byte identical.

The checkpoint is selected only from private data. Confirmation, public, and promotion data cannot change the selected update; they can only reject it.

## Stop boundary

One seed and one execution. No base fine-tuning, resume, hyperparameter search, extra seed, language gate, deployment, or publication is authorized. Passing this test establishes operation-routing transfer only—not open-domain semantic understanding or end-to-end natural-language calculation.

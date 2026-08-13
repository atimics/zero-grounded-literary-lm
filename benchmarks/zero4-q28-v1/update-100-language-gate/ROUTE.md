# Q2.8 update-100 diagnostic language gate

This route binds the already-frozen Q2.8 seed-2 update-100 checkpoint to one
deterministic `LITQ8V1` artifact and the unchanged
`zero-language-gate-v1` science contract. It is a post-result diagnostic, not
the preregistered Q2.8 candidate-selection route and not a promoted model.

The quantity pilot originally selected update 200 before seeing BLiMP or
TinyStories. Update 100 was also quantity-eligible: quantity training loss
improved by 94.7272% while replay training loss regressed by 0.94218%, inside
the preregistered 2% ceiling. This one diagnostic asks whether the language
failure observed at update 200 was already present at update 100. It may
measure only the frozen 1,000-case BLiMP and TinyStories screens, in that order.

The tracked budget is deliberately non-executable. A launch dispatch must
materialize a runtime budget from a separate final approval that binds the exact
merged implementation commit and quantized candidate hash. The AWS route is
fixed to one `c6i.4xlarge` in `us-east-1`, 600 instance seconds, 540 workload
seconds, and at most $0.12. An S3 conditional-write lock prevents a second
scientific execution. The launch workflow exits immediately after recording the
instance; a separate terminal collector validates and publishes the result.

No result from this route can revise the final Q2.8 no-go. A pass supports an
accumulation or checkpoint-selection diagnosis and requires a new stopping rule
before future training. A fail supports a graded-profile diagnosis and a sparse
redesign. No part of this route permits training, threshold changes, candidate
substitution, retries after the execution lock, model promotion, or execution
of seed 1 or seed 3.

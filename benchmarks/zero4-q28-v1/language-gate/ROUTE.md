# Q2.8 candidate-bound language gate

This route binds the Q2.8 seed-2 update-200 checkpoint to one deterministic
`LITQ8V1` artifact and the frozen `zero-language-gate-v1` science contract.
The checked-in model is a diagnostic candidate, not a promoted model.

The quantity pilot selected update 200 before seeing BLiMP or TinyStories. Its
quantity training loss improved by 98.2847% while replay training loss regressed
by 1.94345%, inside the preregistered 2% ceiling. The language gate may measure
only the frozen 1,000-case BLiMP and TinyStories screens, in that order.

The tracked budget is deliberately non-executable. A launch dispatch must
materialize a runtime budget from a separate final approval that binds the exact
merged implementation commit and quantized candidate hash. The AWS route is
fixed to one `c6i.4xlarge` in `us-east-1`, 600 instance seconds, 540 workload
seconds, and at most $0.12. An S3 conditional-write lock prevents a second
scientific execution. The launch workflow exits immediately after recording the
instance; a separate terminal collector validates and publishes the result.

No part of this route permits training, threshold changes, candidate
substitution, retries after the execution lock, or model promotion.

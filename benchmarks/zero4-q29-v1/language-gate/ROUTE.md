# Q2.9 candidate-bound language gate

This route binds the Q2.9 seed-2 update-50 checkpoint to one deterministic
`LITQ8V1` artifact and the frozen `zero-language-gate-v1` science contract.
The checked-in model is a frozen candidate, not a promoted model.

The quantity pilot selected update 50 before seeing BLiMP or TinyStories. Its
quantity training loss improved by 81.0518% while replay training loss regressed
by 0.12325%, inside the preregistered 0.75% ceiling. The language gate may measure
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

A failure records the preregistered Q2.9 no-go, keeps seeds 1 and 3 sealed, and
retires this profile family. A pass stops here and requires a separately
authorized three-seed replication contract; seed 2 is not promoted.

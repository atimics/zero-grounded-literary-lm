# ZERO.5 C6.1 terminal result

## Decision

C6.1 completed with a **no-go** decision. The state head learned its auxiliary
target. The shared-state bridge missed the retrieval, paired-choice, and
causal-contribution gates. Retention and sealed-test gates passed.

This closes the C6.1 seed-0 pilot. The result supports studying a different
hierarchy. It supplies the terminal dependency for the hierarchical
tokenization series.

## Evaluation recovery

The approved evaluation-only recovery completed all 18 frozen tasks from the
selected private checkpoint. It ran for 3,800 instance seconds and cost an
estimated $0.717777777778 on one `c6i.4xlarge` instance. It executed zero
training updates.

The private result has SHA-256
`f08036025f74911e53f5341b35d4844cf49e9261c3599ba134ed7e56072e1d32`.
The selected checkpoint has SHA-256
`975a2c2be303147a05a37681d8baa5fd0472dceb36d6715f593826412df54078`.

## Publication boundary

The public record contains the decision, gate names, accounting, hashes, and
AWS receipts. Detailed metrics and checkpoint bytes remain in private storage.
The sealed test stayed closed.

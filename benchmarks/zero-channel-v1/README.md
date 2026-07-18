# zero-channel-v1

This frozen development benchmark measures bounded channel behavior before
ZERO trains another checkpoint. It contains contrastive language cases and
deterministic episodic-recall cases.

`cases.tsv` supplies a preferred target and a plausible counter-target. The C
evaluator teacher-forces both continuations under the same context and records
their mean bits per token. A case is a contrastive win when the preferred
target has lower NLL. This is a declared `corpus_proxy`, not an exact semantic
verifier.

`holo.tsv` supplies three stored episode keys, a query, the expected stored
entry, and an abstention threshold. These rows are exact checks of the declared
feature-hashing and recall algorithm. They do not establish semantic truth.

The files are public and must never be added to a training stream. Any content
change requires a new benchmark id. Whole future human channels must be split
before record generation; token-level random splitting is forbidden.

Run:

```sh
make zero-benchmark
make zero-benchmark-check
```

The baseline evaluates four bounded runtime policies:

1. transcript window only;
2. learned recurrent memory;
3. recurrent memory plus flat episodic recall; and
4. recurrent memory plus partitioned episodic recall.

The result is diagnostic. Promotion thresholds are defined separately in
`ablation-contract.json` and require a trained multi-seed comparison plus
blinded human review.

Frozen inputs and the deployed checkpoint are pinned in `manifest.json`.
Machine-readable measurements are in `results/baseline.json`; the generated
human-readable report is `results/BASELINE.md`.

# ZERO.4 Q3.5 preregistration — sparse random-feature semantic probe

Companion to the ilxyr freeze at
`docs/experiments/Q35-SPARSE-SEMANTIC-HEAD-PREREGISTRATION.md`. This file is the
executable repository record. It is a **feature-level diagnostic**, not a
packaged runtime experiment.

## Question

Does a frozen sparse ternary random expansion followed by winner-take-all lift
frozen-base semantic operation routing above the Q3.4 linear no-go, at the
unchanged data, optimizer, seed, and update budget?

Q3.4 reached 208/500 (41.6%) with the same 7,685-parameter linear head. Its
recorded next boundary is "compare adequate exposure and a small nonlinear
probe before training a larger routed expert." This is the small nonlinear
probe.

## Locked intervention

Everything not listed here is inherited unchanged from Q3.4.

- Base: `benchmarks/zero4-q31-v1/results/candidate.litqhead`
  (`84c67ea5…`), 4,852,992 parameters, all frozen.
- Features: deployment-exact quantized streaming hidden states, 1,536
  dimensions, unchanged extractor.
- Projection: `benchmarks/zero4-q35-sparse-probe-v1/projection.bin`
  (`efdf4306…`), frozen, 6,144 × 1,536 ternary {-1, 0, +1}, density 1/10,
  generated once by `scripts/generate_zero4_q35_projection.mjs` and loaded as
  bytes.
- Nonlinearity: ReLU. Winner-take-all keeps the top 307 of 6,144 units
  (4.997% — the fly mushroom-body ~5% ratio).
- Trained head: zero-initialized linear to 5 classes. 7,685 parameters for the
  linear arm, 30,725 for the dense and sparse arms.
- Optimizer: unchanged Adam, batch 64, learning rate 0.001, gradient clip 1.0.
- Seed: 2. Updates: at most 100; measure at 0, 25, 50, 100.
- Data: Q3.4 `mixed-training.tok` (`efa8f4e7…`), 9,000 training records and a
  500-record holdout. The holdout is the semantic private set in channel form;
  Q3.4's holdout accuracy equalled its runtime semantic rate exactly (41.6%),
  which is why this feature-level probe is informative.
- Existing Q3.4 outputs, checkpoints, and data are inputs only. They are not
  modified, resumed, or re-selected.

## Arms

One execution, one feature extraction, three heads:

- **sparse** (primary): ReLU(P x) with top-307 winner-take-all.
- **dense** (control): ReLU(P x), no winner-take-all. Isolates sparsity from
  added dimension and nonlinearity.
- **linear** (in-run reference): the unchanged 1,536-to-5 Q3.4 head.

## Gate and decision

Feature-level gate: held-out accuracy at least 0.80 overall and 0.60 in every
class, at a measured update.

- **feature_go** — the sparse arm reaches the feature gate.
- **feature_no_go** — it does not.

This gate is necessary but not sufficient for the Q3.4 package gate, which also
requires lexical and implicit strata and canonical non-regression.

## Not authorized

No packaging, no canonical regression gate, no runtime claim, no language gate,
no deployment, no additional seed, no resume, no hyperparameter search, no base
fine-tuning. Local compute only, maximum spend $0.15.

## Stop boundary

One seed, one execution. If the sparse arm reaches the feature gate, the
follow-up is a separately registered packaging experiment that carries the
projection into the runtime and runs the unchanged Q3.4 package gates. If it
does not, the follow-up is the adequate-exposure ablation, because Q3.4
consumed only 6,400 of 9,000 records (less than one epoch).

## Reproduce

```bash
node scripts/generate_zero4_q35_projection.mjs   # verify projection hash
make sparse_semantic_probe
./sparse_semantic_probe --self-test
node scripts/run_zero4_q35_sparse_probe.mjs \
  --authorization benchmarks/zero4-q35-sparse-probe-v1/authorization.json \
  --out benchmarks/zero4-q35-sparse-probe-v1/seed2
```

The authorization file is created only after the source commit is fixed. It is
single-use; the runner refuses to overwrite an existing output directory.

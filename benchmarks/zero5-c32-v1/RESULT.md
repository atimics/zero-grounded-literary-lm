# ZERO.5-C3.2 result

Decision: **no-go under the frozen paired-invariance gates**. Neither arm is
eligible for replication, broad promotion, or checkpoint publication.

This is a useful result, not a dead end. The balanced objective in arm D
removed most of the claim position bias and improved paired choice, but it did
not make answers stable when the same evidence was swapped. The next test must
train the pair as a pair.

The exact machine result is `result.json`, SHA-256
`e87305b52d229a71483c49a9aed09258211e118dd14b2f09855b77f89a059688`.
The complete AWS run cost $6.5484. All 10,166 test records remained sealed.

## Fixed comparison

Both arms started from the same C2 checkpoint and used the same 4,852,992
parameter model, tokenizer, seed, 37,768 packed sequences, 9,442 updates, and
19,337,216 compute-token exposures. C used uniform answer weights. D changed
only the answer weights so each task contributed equal total answer loss.

| Metric | C: uniform | D: task-balanced | Change |
| --- | ---: | ---: | ---: |
| Combined validation NLL | **1.5634** | 1.5643 | +0.0009 |
| Claim choice accuracy | 52.76% | **58.22%** | +5.46 points |
| Retrieval choice accuracy | 51.38% | **53.17%** | +1.78 points |
| Mean paired choice accuracy | 52.07% | **55.69%** | +3.62 points |
| Claim position gap | 47.02 points | **2.76 points** | -44.25 points |
| Retrieval position gap | 26.21 points | **15.53 points** | -10.68 points |
| Claim swap consistency | 20.96% | **21.71%** | +0.75 points |
| Retrieval swap consistency | 36.80% | **39.76%** | +2.97 points |
| Mean pair-exact accuracy | 16.51% | **21.06%** | +4.55 points |

Lower NLL and position gap are better. Higher accuracy and consistency are
better.

## What passed

- Both arms completed one exact pack pass with no wraps.
- Both improved combined validation NLL by about 41% over the frozen baseline.
- Every completion-NLL gate passed.
- Atlas and C1 anchor retention passed.
- D passed both claim position accuracies and the claim position-gap gate.

## What failed

The paired gates require at least 60% choice accuracy, at least 55% accuracy in
each position, at most a 10-point position gap, at least 60% swap consistency,
and at least 35% pair-exact accuracy.

- D claim choice was 58.22%, 1.78 points below its gate.
- D retrieval choice was 53.17%, 6.83 points below its gate.
- D retrieval position B was 45.40%, 9.60 points below its gate.
- D retrieval position gap was 15.53 points, 5.53 points too large.
- D swap consistency was 21.71% for claims and 39.76% for retrieval.
- D pair-exact was 19.08% for claims and 23.05% for retrieval.

The important distinction is that task balancing fixed an aggregate bias but
not per-example invariance. The model can look balanced across all examples
while changing its answer when the same two choices trade places.

## Next decision

Do not scale the model and do not repeat D. Build C3.3 as a single-seed,
equal-compute screen with the same model, tokenizer, repaired corpus, split,
and C2 initialization. Keep D's task-balanced answer loss as the control and
change one thing: make each original/mirrored example an atomic training unit
with an explicit pair-consistency objective. The primary outcome is the mean
of claim and retrieval swap consistency; choice and pair-exact accuracy remain
guardrails. Test data stays sealed.

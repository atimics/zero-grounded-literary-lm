# ZERO.5 C4.2 result

## Decision

**No-go for promotion.** C4.2 completed its frozen 27,962-update run and
improved combined validation loss by 13.66%, but it did not pass every frozen
promotion gate. The sealed test set remained closed. The private checkpoint
was hash-verified and was not published.

## Result

| Measure | C2 baseline | C4.2 | Change | Gate |
| --- | ---: | ---: | ---: | --- |
| Combined validation loss | 2.3373 | **2.0180** | **-13.66%** | pass |
| Evidence validation loss | 2.3086 | **2.0922** | **-9.37%** | pass |
| Atlas validation loss | 2.2786 | **2.1884** | **-3.96%** | pass |
| C1 anchor validation loss | 3.6942 | 3.8247 | +3.53% | pass |
| Claim choice accuracy | 51.86% | **76.91%** | **+25.04 points** | pass |
| Retrieval choice accuracy | 51.34% | 54.15% | +2.82 points | **fail: below 55%** |
| Claim swap consistency | 96.36% | 95.22% | -1.14 points | **fail** |
| Retrieval swap consistency | 94.07% | 95.75% | +1.68 points | **fail** |
| Claim pair-exact | 50.04% | **74.52%** | **+24.47 points** | pass |
| Retrieval pair-exact | 48.37% | **52.03%** | **+3.66 points** | pass |
| Cloze exact match | 0.028% | 0.084% | +0.056 points | **fail** |

Both claim and retrieval position-balance gates passed. All metrics were
finite. The no-go is therefore specific: cloze exact improvement missed its
one-point minimum, both swap improvements missed their five-point minimum,
and retrieval choice accuracy finished at 54.15% against the 55% floor.

## Training and cost

- Training updates: 27,962 / 27,962
- Compute token exposures: 19,337,216, with zero wraps
- Training wall time: 4,686.61 seconds
- Aggregate training throughput: 4,126.06 tokens/second
- Best/final packed-validation loss during training: 1.9860
- Total instance time: 6,085 seconds
- Estimated EC2 cost: **$1.1494**, below the approved $1.50 ceiling
- Instance: one `c6i.4xlarge`, automatically terminated

## Integrity

- Result SHA-256: `63e4209b19637e2b09e3798f3cf0c32e84d983f09b33b161b39463c4b3d8c279`
- Checkpoint SHA-256: `1fec9b54677448562a80ef9066341af51947d6ca30ca4aed275204c778748437`
- Frozen contract SHA-256: `80026e32956bb9fe0092fa0b867633850c20bb615c687c4d8eaa9422551a6250`
- Source commit: `f1a7195d581140c047eb24f01d306c7cf56346a6`
- Run ID: `zero5-c42-aws-20260828-f1a7195`
- Test metrics opened: no

The immutable launch, status, and result receipts bind the approval, source,
private assets, contract, budget, instance, cost, checkpoint, and decision.

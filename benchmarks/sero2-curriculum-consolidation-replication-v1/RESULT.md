# Sero curriculum consolidation replication result

The two-stage curriculum result repeated. Seeds 0, 1, and 2 all passed every
frozen final gate after retention consolidation.

| Seed | Staged test BPB | Final test BPB | Final EOD accuracy | Final decision |
|---:|---:|---:|---:|---|
| 0 | 1.356154 | 1.327818 | 89.16% | pass |
| 1 | 1.356897 | 1.330186 | 88.02% | pass |
| 2 | 1.355336 | 1.327488 | 89.11% | pass |

The final mean test score is **1.328497 BPB** with sample standard deviation
**0.001471**. Consolidation improved test BPB by **2.04% on average** relative
to each seed's staged parent. The worst final gate margin is Wikinews, where
the worst seed remains **0.016600 BPB below** the frozen maximum.

The staged models reproduced the same narrow failure: Wikibooks, Wikinews,
and Simple Wikipedia retention. Consolidation repaired all three for every
seed. It traded back some of the staged technical and reasoning gain, but all
MDN, OpenAssistant, GSM8K, overall, and document-boundary gates still passed.

The new four-run replication cost **$3.0088** in measured EC2 compute. Including
the earlier seed-0 parent and consolidation runs, the full three-seed evidence
cost **$4.5136**.

## Decision

Promote the two-stage curriculum recipe as the Sero baseline and open the next
model-scale experiment. The next test should change model capacity while
keeping this data, tokenizer, two-stage schedule, evaluation suite, and
three-seed discipline fixed.

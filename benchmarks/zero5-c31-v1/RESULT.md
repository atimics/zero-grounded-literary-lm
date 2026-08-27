# ZERO.5-C3.1 result

Decision: **no-go under the frozen conjunctive gate**. No arm is eligible for
replication, broad promotion, or checkpoint publication.

This is still a strong positive curriculum result. The richer 512-token Braid
view, record-safe packing, smooth task interleaving, and explicit answer loss
all helped. The no-go is narrow: the best answer-weighted arm missed the claim
answer gate and the retrieval-choice gate.

The exact machine result is `result.json`, SHA-256
`dbe4dd29d5f4ea20180c5cc5b76cb48e77edfba8a013563b1a4b6178205d453f`.
The 10,167 test records remained sealed.

## Fixed comparison

Every arm started from the same C2 checkpoint, used the same 4,852,992
parameters, seed 0, tokenizer, 79,694 training records, 37,768 complete-record
packs, and one exact pass. V kept solid task blocks. A smoothly interleaved the
exact same packs. B used A's exact order and changed only answer-token weight
from 1 to 4.

| Metric | C2 baseline | V: blocked | A: interleaved | B: interleaved + 4x answer |
| --- | ---: | ---: | ---: | ---: |
| Combined validation NLL | 2.7317 | 1.7623 | **1.5666** | 1.5694 |
| Combined improvement | — | 35.41% | **41.75%** | 41.62% |
| Claim answer NLL | 2.435611 | 2.268062 | 2.265288 | **2.258295** |
| Claim improvement | — | 6.88% | 6.99% | **7.28%** |
| Cloze answer NLL | 2.920720 | 3.146257 | 2.280066 | **2.138002** |
| Cloze improvement | — | -7.72% | 21.93% | **26.80%** |
| Retrieval answer NLL | 2.835764 | 0.116394 | 0.116808 | **0.114184** |
| Retrieval improvement | — | 95.90% | 95.88% | **95.97%** |
| Retrieval choice accuracy | 0.00% | 53.09% | 52.25% | **54.77%** |
| Atlas validation NLL | 2.2786 | 2.2817 | 2.2739 | **2.2542** |
| C1 anchor NLL | 3.6942 | **3.8648** | 3.9112 | 3.9227 |

Lower NLL is better. B answered 1,108 of 2,023 retrieval choices correctly;
the frozen 55% gate required 1,113. Being five choices short is not a pass and
does not authorize rounding the threshold.

## Gates

| Gate | Threshold | V | A | B |
| --- | ---: | :---: | :---: | :---: |
| One exact pack pass, zero wraps | required | pass | pass | pass |
| Combined validation NLL | at most 2.42622 | pass | pass | pass |
| Combined relative gain | at least 10% | pass | pass | pass |
| Claim answer NLL | at most 2.192050 | fail | fail | fail |
| Cloze answer NLL | at most 2.628648 | fail | pass | pass |
| Retrieval answer NLL | at most 2.552188 | pass | pass | pass |
| Retrieval choice accuracy | at least 55% | fail | fail | fail |
| Atlas retention | at most 10% regression | pass | pass | pass |
| C1 anchor retention | at most 10% regression | pass | pass | pass |
| Test metrics unopened | required | pass | pass | pass |

## What changed our understanding

V shows that the 512-token view fixed the severe retrieval-information
problem: retrieval answer NLL improved by 95.90%. Its blocked order still made
cloze answers 7.72% worse. The validation curve moved sharply at the
claim-to-cloze and cloze-to-retrieval boundaries.

A removed that interference. It improved combined NLL by 41.75% and cloze
answer NLL by 21.93% with exactly the same records, tokens, and compute as V.
Task order therefore had a large causal effect in this run.

B retained nearly all of A's whole-record gain and improved every answer NLL
relative to A. It raised retrieval choice by 2.52 percentage points to 54.77%,
but claim improvement moved only from 6.99% to 7.28%. Global 4x answer weight
was useful but did not solve the remaining task definitions.

The claim prompt supplies only a topic and section while its target is a long,
specific held-out sentence. The weak gain is consistent with an
under-specified conditional task. That is an interpretation of the task format,
not proof that long-form claim generation is impossible for this model.

## Next decision

Do not repeat this exact recipe or scale the model yet. Prepare a new Braid
release and preregister a fixed-model C3.2 data-definition test:

1. Give claim records exact evidence and a short, verifiable target. Keep
   unconstrained claim prose as language modeling, not an answer gate.
2. Pair each retrieval item with its passage order swapped. Score both
   orientations together so a fixed A or B preference cannot pass.
3. Balance answer loss by task or record instead of raw answer-token count.
   C3.1 contains 460,920 claim answer tokens, 24,138 cloze tokens, and only
   12,138 retrieval tokens.
4. Use A's smooth braid as the control and compare one preregistered balanced
   answer objective. Keep the model, tokenizer, split, and total admitted-token
   budget fixed.

No C3.2 training is authorized by this result.

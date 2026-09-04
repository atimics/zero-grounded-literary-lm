# Reasoner 5.5 task guide: development results

The four-weight guide reaches near parity with the original local guide on
paired verification cost. It improves on the grouped-search controls. The role
mapping remains an open research question.

All 1,248 answers are exact. Every injected wrong answer is rejected. Source
removal reproduces group-size ranking, and oracle roles reproduce recovered
roles. The independent checker also reproduces the fitted weights and every
candidate ordering.

## What changed

The solver groups programs by their full affine behavior. A small learned guide
ranks those groups using four features: group size, role variety, source-guide
scores, and intermediate values from the current task. It learns one set of
four weights for each source generator. Training uses 128 source tasks. The
eight development targets supply the comparison.

The [design](SPEC.md) was committed before the new target results were measured.
The source guide retains the original canonical source solutions. Both fits
use 256 full-batch steps and the fixed settings in the design. Their mean
training losses fall from 3.146 to 3.008 and from 3.062 to 2.244.

The artifact contains 1,823 bytes of source-guide counts, 32 bytes of fitted
weights, and an eight-byte format marker: **1,863 bytes in total**. The weights
and features use integer millionths during ranking.

## Results

There are 32 episodes: eight targets, two source views, and two tie repeats.
The table includes the strongest original source-free comparator. A lower
paired ratio is better.

| Method | Verification checks, total | Paired ratio to original local guide |
| --- | ---: | ---: |
| Original local guide | 380 | 1.000 |
| Original source guide | 407 | 1.165 |
| Equal group scores | 579 | 1.611 |
| Group-size scores | 511 | 1.347 |
| Summed source scores | 390 | 1.128 |
| Learned task guide | 350 | 0.988 |
| Lexical roles with task guide | 352 | 0.977 |
| Oracle roles with task guide | 350 | 0.988 |
| Task guide with source-score feature removed | 385 | 1.099 |

The paired ratio averages `log((method_checks + 1) / (reference_checks + 1))`
within each target, then across the eight targets, and takes the exponential.
Source views and tie repeats stay within their target. Every target's ratio is
saved in [DEVELOPMENT.json](DEVELOPMENT.json).

Against group-size ranking, the task guide's paired ratio is 0.733. Against the
original local guide, it is 0.988, with three target wins and five losses. The
large difference between these comparisons makes the original local guide an
essential reference.

Five of the 31 shuffled role mappings have a better paired score than the
correct mapping. Including the correct mapping gives an exploratory rank
p-value of 0.1875. Lexical roles also have a slightly better paired score. These
controls call for stronger evidence before attributing the gain to semantic
role transfer. The original R5.5 development decision remains its own no-go
record. This follow-up is development evidence.

## Costs

Each method runs in its own process with one warmup pass and three measured
passes. The recorded host is an Apple M4 Max. The task-guide process spends
about 210 ms fitting both source models together.

Across the 32 task-guide episodes, the recorded full pipeline takes about
53 ms. About 31 ms goes to hashing the full feature and ranking records, 12 ms
to sorting, 3.6 ms to enumeration, 2.9 ms to feature scoring, and 0.39 ms to
verification and fallback. [TIMING.json](TIMING.json) contains each raw sample,
the host, the binary digest, and the exact totals.

The prefix cache builds 4,680 compositions for each episode. Directly building
each four-step program would require 16,384 compositions. The independent
checker reconstructs each program directly and verifies the same groups and
features. Native parity also checks all 557,056 individual program maps and
prefix features across the 136 source and target families.

The full timing includes allocation, adapter recovery and its domain audit,
enumeration, grouping, scoring, sorting, record hashes, exact verification,
fallback, and release. The group-size baseline takes about 62 ms. The fitted
guide trades additional scoring work for fewer verification checks. The full
feature hashes make this a heavier audit than the original R5.5 timing sample.
The separate stage measurements show that cost explicitly.

Peak RSS covers the entire process, including source preparation and warmup.
Method order is fixed. Further timing comparisons can vary process order and
host while keeping the deterministic search results fixed. An earlier recording
on the same host took about 22 ms for the task guide and 21 ms for group-size
ranking. This variation calls for controlled timing runs before a speed claim.

## Reproduction

```sh
make -f Makefile.reasoner55 reasoner55-semantic-guide
make -f Makefile.reasoner55 reasoner55-semantic-guide-check
```

The first command writes the model, search results, and timing record. The
second checks the native run against independent training and search replay.
It checks the loss gradient, altered weights, altered features and ranks,
false verification counts, duplicate episodes, target separation, forced
fallback, and the verification cap. The existing shared search checker proves
candidate coverage, canonical fallback, and verifier receipts for every row.

- [SPEC.md](SPEC.md): fixed development design.
- [MODEL.hex](MODEL.hex): canonical source guides and learned weights.
- [DEVELOPMENT.json](DEVELOPMENT.json): model checks, source digests, all 39
  methods, all 1,248 search rows, and target-level comparisons.
- [TIMING.json](TIMING.json): host-specific raw timing samples.
- [Source-choice diagnostic](../reasoner55-transfer-diagnostics-v1/README.md).

## Implications for the lab

Task execution features are practical in a very small model. This follows the
search guidance used by [BUSTLE](https://arxiv.org/abs/2007.14381) and
[CrossBeam](https://arxiv.org/abs/2203.10452). Here, four weights improve on a
simple grouping rule and bring transfer close to the local guide.

The next research step is a larger, fixed comparison with distinct
composition rules. The current skeleton generator favors four distinct roles,
and its fitted model learns that preference. Fresh task families can test
whether the guide transfers useful composition knowledge. The next runtime
step is to reduce the measured cost of full audit records and sorting while
preserving exact replay.

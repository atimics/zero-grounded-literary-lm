# Braid handoff: ZERO.5 C4.2 result and C4.3 request

## Request

Please prepare a governed Braid C4.3 training release that targets exact cloze
recall and hard retrieval discrimination while preserving the marker-free,
mirrored C4.2 format. Keep the C4.2 validation artifacts unchanged and keep
the sealed test set unavailable to ZERO.

This request does not authorize training or paid compute. ZERO will first
verify the release, freeze the final contract, and request a separate cost
approval.

## What ran

ZERO trained the 4.85M-parameter ZERO.5 model from the selected C2 checkpoint
on the exact C4.2 release:

- Braid source commit: `5dbfec78c53676c6aaa32137f7d30e6f81a53593`
- Braid merge commit: `f951cc2910a76277baaf1548b2bb4184987ee1a5`
- release ID: `braid-corpus-four-two-zero5-512-v0.1.0-f98728ce8a110e3b949fb0fdb3916b0c9c58d7357172b63003e9c1f3e12c3336`
- ZERO run: `zero5-c42-aws-20260828-f1a7195`
- updates: 27,962 / 27,962
- compute token exposures: 19,337,216, with zero wraps
- estimated EC2 cost: $1.1494
- sealed test opened: no

The run and its immutable receipts are recorded in
`benchmarks/zero5-c42-v1/result.json`.

## Result

C4.2 is a no-go for promotion under its frozen contract.

| Measure | C2 baseline | C4.2 | Change | C4.2 gate |
| --- | ---: | ---: | ---: | --- |
| Combined validation loss | 2.3373 | **2.0180** | **-13.66%** | pass |
| Claim choice accuracy | 51.86% | **76.91%** | **+25.04 points** | pass |
| Retrieval choice accuracy | 51.34% | 54.15% | +2.82 points | fail: below 55% |
| Claim swap consistency | 96.36% | 95.22% | -1.14 points | fail |
| Retrieval swap consistency | 94.07% | 95.75% | +1.68 points | fail |
| Claim pair-exact | 50.04% | **74.52%** | **+24.47 points** | pass |
| Retrieval pair-exact | 48.37% | **52.03%** | **+3.66 points** | pass |
| Cloze exact match | 0.028% | 0.084% | +0.056 points | fail |

Evidence, Atlas, C1-anchor, position-balance, finite-metric, and sealed-test
gates all passed.

## Contract defect

The C4.2 contract used one five-point improvement gate for both swap metrics.
The C2 claim-swap baseline was 96.36%, leaving only 3.64 points of possible
headroom. A five-point gain would require 101.36% accuracy, so that claim gate
was impossible. The retrieval gate was technically possible but required
99.07% from a 94.07% baseline.

This does not turn C4.2 into a pass. Cloze exact match and the retrieval choice
floor failed independently, and the claim swap score regressed. The C4.2
decision must not be changed after seeing the result.

C4.3 replaces swap improvement with two achievable requirements for each
task: at least 95% absolute swap consistency and no more than one point of
regression from the frozen C2 baseline. ZERO also adds a general contract
check that rejects any bounded-metric improvement requirement above the
available headroom.

## Failure diagnosis

The run learned broad prediction and claim discrimination, but it did not
learn exact recall strongly enough and it missed the retrieval choice floor by
0.85 points.

C4.2 contained 3,018,930 answer-target tokens:

- claim: 731,688, or 24.24%
- cloze: 135,644, or 4.49%
- retrieval: 2,151,598, or 71.27%

The loss weights made the aggregate weighted target mass roughly equal across
the three tasks. The cloze failure is therefore not explained by a simple
weight omission. It points to sparse raw cloze coverage, example diversity,
span difficulty, or a mismatch between token loss and full-span exact match.
The retrieval result calls for harder, evidence-dependent alternatives rather
than more easy pairs.

## C4.3 release requirements

Please provide:

1. A marker-free C4.3 train release for the same 512-token ZERO.5 target.
2. At least three times C4.2's raw cloze answer-target coverage and at least
   15% cloze share among all answer-target tokens.
3. A cloze target-length histogram and training coverage that follows the
   frozen validation length bands instead of relying on a few repeated forms.
4. Retrieval alternatives that require the supplied evidence, with frozen
   counts for entity, relation, numeric, temporal, and lexical-confounder
   negatives.
5. Both orientations of every claim and retrieval pair, with an explicit
   pair/group ID so both orientations remain in one optimizer update.
6. A development slice for recipe checks that has no record or source overlap
   with training, the frozen C4.2 validation set, or the sealed test set.
7. Release, membership, pack-plan, tokenizer, split, provenance, attribution,
   and per-artifact SHA-256 records.
8. A machine-readable task report with record counts, answer-target counts,
   source counts, duplicate checks, target-length bands, negative subtypes,
   and orientation balance.

The C4.3 primary training view must fit the existing 19,337,216 compute-token
exposure ceiling. ZERO will recompute answer weights after import so weighted
task mass remains balanced without using a cloze multiplier above 8.

## Acceptance boundary

ZERO will accept the Braid handoff only if deterministic imports match, the
C4.2 validation and test identities remain unchanged, the new data report
passes, and the final C4.3 contract is frozen before a primary run. No private
corpus row, checkpoint, validation answer, or test content may be published by
ZERO as part of this request.

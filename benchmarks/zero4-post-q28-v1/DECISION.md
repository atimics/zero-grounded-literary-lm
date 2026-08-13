# Post-Q2.8 conservative-exposure decision

Status: **Q2.9 implementation authorized by issue #83; run not yet authorized**

Date: 2026-08-10

## Decision

Retire Q2.8 as a no-go and advance one conservative Q2.9 seed-2 pilot. Q2.9
keeps Q2.8's fixed graded-plasticity profile and optimizer mechanics unchanged,
but caps exposure at 100 updates, measures every 25 updates, enforces a tighter
0.75% replay-regression guard, and freezes the first checkpoint that recovers at
least 80% of the baseline quantity loss.

Do not run Q2.8 seeds 1 or 3. Do not use BLiMP, TinyStories, public quantity
rows, or promotion data to choose a Q2.9 checkpoint. At most one frozen Q2.9
candidate may later receive the unchanged language gate.

## What the update-100 diagnostic changed

The selected Q2.8 update-200 checkpoint improved quantity training loss by
98.2847% and regressed replay training loss by 1.94345%. Its update-100
checkpoint had already improved quantity loss by 94.7272% with only 0.94218%
replay regression. Both passed the BLiMP floor and failed TinyStories:

| Checkpoint | Quantity recovery | Replay regression | BLiMP | TinyStories bits/byte | TinyStories decision |
| --- | ---: | ---: | ---: | ---: | --- |
| update 100 | 94.7272% | +0.94218% | 0.546 | 2.645309 | fail |
| update 200 | 98.2847% | +1.94345% | 0.539 | 2.675123 | fail |

The frozen TinyStories ceiling is 2.553140 bits/byte. Update 100 remained
3.6100% above it, but it was 0.029815 bits/byte better than update 200 and was
better on all 1,000 paired TinyStories cases. BLiMP did not show a reliable
directional change: update 100 alone was correct on 16 cases, update 200 alone
on 9, and the paired McNemar p-value was 0.2295.

This evidence does not show that earlier exposure will pass language. It does
show that later Q2.8 exposure made the language failure uniformly worse while
adding little quantity recovery. A preregistered early stopping test is
therefore the smallest next repair.

## Why the fixed 5% mask moved to fallback

The earlier draft proposed a new distributed sparse-coordinate estimator.
That remains a reasonable fallback, but running it now would change both the
coordinate set and the exposure regime. Q2.9 instead isolates the cheaper
operational question: can the already-useful Q2.8 profile be stopped before
replay drift reaches the range associated with the two observed language
failures?

The Q2.9 thresholds are prospective engineering thresholds, not values fitted
to an unseen checkpoint. No update-25, update-50, or update-75 language result
exists. The 80% quantity threshold requires substantial learning; the 0.75%
replay ceiling is strictly below the failed update-100 trajectory; first-hit
selection minimizes exposure without ranking checkpoints after the fact.

If Q2.9 produces no eligible checkpoint or its one frozen checkpoint fails the
unchanged language gate, retire this profile family. The next reviewed family
is the fixed distributed-sparse mask, followed by an adapter/low-rank proposal
under a separate architecture and parameter-budget review.

## Frozen evidence

| Artifact | SHA-256 |
| --- | --- |
| Q2.8 fixed profile | `de858b2cddc21cacb25a831e63ab30eba2e4ea9e944b3010d8ba6759653a0e4e` |
| Q2.8 quantity result | `8b6ac9908834b96c61fcc37a56a296392152ac0ed2a5a19e29aa7687d69824e6` |
| Q2.8 update-100 language result | `52b3ed25e522b1ff64c77d17d34a4f891f9fda76d1b9eaac835eb7f5ec5f1417` |
| Q2.8 update-100 language manifest | `164744da1bb41eda722bbf5f9ce9e0fad48e79eb5423886afe5b95bef864e579` |
| Q2.8 update-200 language result | `8161e1bda448c2172220991d3f58f02d5bb017ab31b6bd8fcebfbaa60ab1deb1` |
| Q2.8 update-200 language manifest | `2a1133a61eb3163a7ffe8be7496c06331a8bf4855c89d60e69d8c78bd711c93b` |

The machine-readable evidence and inference boundaries are in
[`decision.json`](decision.json). The executable contract is in
[`../zero4-q29-v1/contract.json`](../zero4-q29-v1/contract.json).

## Authority boundary

Issue #83 authorizes implementation only. It does not authorize a pilot run,
language evaluation, candidate promotion, or deployment. One pilot execution
requires a separate immutable authorization bound to the merged source commit.

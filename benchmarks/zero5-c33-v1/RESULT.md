# ZERO.5 C3.3 result

## Decision

**No-go.** Putting both orientations of each mirrored pair in the same update
did not improve relational consistency. The sealed test set was not opened.

## Main result

| Measure | C3.2 D | C3.3 E | Change |
| --- | ---: | ---: | ---: |
| Mean choice accuracy | 55.69% | 55.21% | -0.48 points |
| Mean swap consistency | 30.74% | 18.90% | -11.83 points |
| Mean pair-exact accuracy | 21.06% | 14.67% | -6.40 points |
| Combined validation loss | 1.5643 | 1.5873 | +0.0230 |

The primary gate required mean swap consistency to rise by at least 10 points.
It moved in the opposite direction. Retrieval remained strongly sensitive to
which passage appeared first: 91.79% accuracy in position A versus 11.47% in
position B.

## What held up

- All 37,768 training packs were consumed exactly once.
- Claim, cloze, and retrieval completion-loss guardrails passed.
- Claim choice, position gap, swap, and pair-exact guardrails passed.
- Atlas and C1 anchor retention passed.
- All metrics were finite.
- The test set remained sealed.

## What failed

- Combined validation loss missed its limit by 0.0074 nats/token.
- Retrieval choice accuracy missed by 0.53 points.
- Retrieval position gap, swap consistency, and pair-exact accuracy failed.
- Both mean step-improvement gates failed.

The useful lesson is narrow but clear: pair co-location alone does not teach
order invariance. A future relational experiment needs an explicit
order-sensitive objective, representation, or contrastive signal rather than
another rearrangement of ordinary next-token loss.

The completed AWS segment and the earlier zero-update bootstrap cost $2.7570
in total, below the approved $3.40 limit. The private checkpoint was not
published.

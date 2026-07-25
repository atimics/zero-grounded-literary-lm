# ZERO language-preservation gate v1

This is the cheap post-training guard that replaces the proposed
8h30m/$5.78 ZERO-EVAL-1 full run. It scores one frozen candidate on only the
1,000-case BLiMP screen and the 1,000-case TinyStories screen, while reusing
the already-frozen ZERO.3 aggregate as the reference.

The gate is conjunctive:

| Task | ZERO.3 reference | Candidate must satisfy |
| --- | ---: | ---: |
| BLiMP raw accuracy | 0.532 | at least 0.522 (no more than 1 point lower) |
| TinyStories bits/byte | 2.527861 | at most 2.553140 (no more than 1% higher) |

These are engineering preservation tolerances, not statistical equivalence
bounds. Passing says only that the candidate stayed within both declared
screen tolerances. Failing does not invalidate the candidate's faculty result;
it blocks promotion until a separately preregistered decision resolves the
tradeoff.

Applied illustratively to the already-frozen ZERO.4 screen, BLiMP passes but
TinyStories fails: its 2.570353 bits/byte is 1.681% worse than ZERO.3 and above
the 2.553140 ceiling. The conjunctive result would therefore be fail. The gate
is prospective and does not retroactively undo ZERO.4's independently valid
three-seed quantity promotion.

The completed screen observed 304.644 seconds for ZERO.4 on these two tasks.
A future candidate-only AWS execution is therefore proposed at a 600-second
hard ceiling and $0.12 maximum compute cost on `c6i.4xlarge`. Nothing in this
directory authorizes that execution.

## Paired outputs

The runner emits packed raw and normalized BLiMP correctness bits and a
case-ordinal/target-bits/target-bytes trace for TinyStories. The trace contains
no case text. The historical ZERO.3 screen did not retain those traces, so the
first comparison against it remains aggregate-only. New traces make paired
analysis possible between future candidates under a separately frozen rule.

## Mechanical checks

```sh
make zero-language-gate-check
```

An authorized future run will use:

```sh
node scripts/run_zero_language_gate.mjs \
  --model candidate.litq8 --model-id candidate-id \
  --blimp /prepared/blimp.tsv \
  --tinystories /prepared/tinystories.tsv \
  --budget authorized-candidate-budget.json \
  --output result.json --jobs 16
```

The budget must use schema `zero.language_preservation_gate_budget.v1`, bind
the exact contract and candidate hashes, bind `c6i.4xlarge` in `us-east-1`,
stay at or below 600 seconds/$0.12, and record explicit one-time manual
authorization. The runner refuses scientific scoring without it. CI uses
`--mechanics-only` only on tiny generated fixtures.

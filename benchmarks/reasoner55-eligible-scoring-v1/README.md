# Reasoner 5.5 eligible scoring

This opened-family check reduces feature and ranking work before search.
It scores proposals that match the public example, then keeps at most 64
with a bounded heap. The same code serves all four comparison arms.

Across 16 opened measured visits per arm, prior-score calls in each guide
fall from 65,536 to 644. Scored semantic groups fall from 47,644 to 432.
The candidate still enumerates 4,096 programs and scans their group membership
on every visit. These are exact work counts. Timing remains in engineering
receipts until a fresh fixed-machine comparison.

| Arm | Prior calls after filtering | Verifier checks |
| --- | ---: | ---: |
| Semantic frequency | 0 | 211 |
| Task guide | 644 | 243 |
| Raw lexical task guide | 644 | 176 |
| Guide with prior feature removed | 0 | 233 |

The full guide still uses more verifier checks on these opened cases than
both cost controls. The earlier matched primary no-go remains the scientific
reference. This change improves the shared implementation and preserves the
model weights and the feature values of every eligible group.

## Reference and checks

The reference computes all features and sorts all groups, then selects the
same eligible proposals. The candidate applies the public filter before those
features and uses a bounded heap. Their eligible feature digests, proposal
keys, final answers, verifier checks and fallback receipts agree.

Both use the original exact verifier and canonical fallback. The verifier
challenge takes the first syntactic candidate with a wrong map and follows
planning. This common challenge and the eligible proposal policy define a
new engineering comparison. Earlier results retain their original rules.

The check uses four previously opened families, two source views and two tie
views. Each arm and planner has a separate process with one warmup and one
measured pass. It records 280 native episode visits and independently replays
76 measured normal and forced-failure rows. It also checks 258 heap sizes
against a full sort, including score extremes and ties. Four altered evidence
records fail independent replay.

Forced zero budget and an empty eligible set each reach canonical fallback.
A verifier cap stops with its failed-answer record intact. A missing model
process preserves its terminal record and zero completed episodes. Local
address and undefined-behavior checks pass for all eight processes and the
heap cases.

The first Linux and macOS jobs passed the behavior check. Artifact collection
then failed because receipt names used a colon. The corrected names use a
hyphen. [FAILURES.json](FAILURES.json) preserves the job, exact cause and the
absence of raw CI artifacts from that first attempt. The workflow requires
both behavior checks and artifact publication on each platform.

## Reproduce

```sh
make -f Makefile.reasoner55-eligible reasoner55-eligible-check
```

Set `REASONER_ELIGIBLE_RECEIPTS` to a fresh folder to keep each process's raw
rows, errors and exit record. The check saves partial evidence before testing
exit status. [SMOKE.json](SMOKE.json) binds the inputs, implementation and
stable work counts. [PLAN.md](PLAN.md) defines the comparison.

The next step is a fresh-family comparison with source, development, earlier
fixed-transfer, matched and opened-smoke behaviors and primitive sets excluded.
It will retain both lexical guidance and semantic frequency as cost references,
use the shared implementation, and report complete process costs and failures.

# ZERO.4-Q2.3 seed 2 observer

Decision: **pass**. Stop: replay exceeded 2% on two consecutive full evaluations.

Promotion remained sealed: observer stage never accesses promotion.
The observer committed all 200 attempts and its learned checkpoint payload was
byte-identical to the unguarded reference at every 25-update recovery.

Calibration from 115 positive functional-probe changes set the warning band to
0.1641% and the frozen hard band to 0.25%. The first-order drift estimate was
effectively uncorrelated with realized sentinel replay change (Pearson 0.0076),
so it remains diagnostic; the guarded run uses the direct functional probe as
its authority. Observer runtime was 129.758 seconds versus 68.790 seconds for
the reference (1.886x), with 116,473,520 preallocated diagnostic bytes.

| Committed | Attempts | Phase | Quantity pass | Minimum gate margin | Replay regression | Feasible |
| ---: | ---: | --- | :---: | ---: | ---: | :---: |
| 200 | 200 | acquisition | yes | 0.000% | 2.685% | no |

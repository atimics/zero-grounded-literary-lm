# Reasoner 5: first five experiments

The first Reasoner 5 sequence is complete. Five prospective contracts produced
five one-time local runs. The series contains 192 exact final answers, two
passes, three no-go decisions, zero retries, and $0 cloud cost.

| Version | Boundary | Decision | Full checks | Target-only | Key reading |
| --- | --- | --- | ---: | ---: | --- |
| 5.0 | Same-interface residual transfer | No-go | 229 | 248 | The residual added little value and weakened the source-only ranker. |
| 5.1 | Two unseen primitive IDs | Pass | 45 | 105 | Exact semantic adaptation preserved a useful source prior. |
| 5.2 | Nonlinear depth shift | No-go | 30 | 44 | Aggregate search improved; individual wins reached 8 of the required 16. |
| 5.3 | Missing evidence plus one changed value | Pass | 48 | 66 | Robust evidence handling and the source prior cleared every gate. |
| 5.4 | Calibrated synthetic pixels | No-go | 24 | 24 | Perception was exact; the ranking task sat at the one-check floor. |

The strongest result is 5.1. The verified adapter matched its oracle search
cost and cut checks by 57.1%. Reasoner 5.3 adds a second positive result under
the registered one-error model, with a 27.3% reduction on its primary
condition. Reasoner 5.2 provides a promising aggregate lead with weak episode
coverage. Reasoner 5.4 validates the full pixel-to-symbol-to-program path and
reveals a measurement floor in its ranking test.

## What scales next

The next series should move from hand-selected targets to generated families.
Use a separate development split to screen for measurable search headroom.
Freeze a test split with a target-only median of at least four checks. Report
distributions, confidence intervals, and per-family effects.

The recommended order is:

1. Replicate 5.1 across fresh primitive families and code generators.
2. Expand 5.3 across several missingness rates and registered corruption
   processes.
3. Rebuild 5.2 with a larger nonlinear family and stratified difficulty.
4. Repeat 5.4 with ambiguous symbolic evidence, then move to a real or partly
   labelled visual channel.
5. Add bounded recursion with trace certificates after the nonlinear
   replication clears its gate.

This path keeps the exact verifier as the safety boundary. It also gives the
learned ranker enough search space for transfer gains to be measured.

The machine-readable [series record](series.json) links every raw result and
provenance record.

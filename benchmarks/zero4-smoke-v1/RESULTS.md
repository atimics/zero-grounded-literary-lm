# ZERO.4 Faculty Smoke v1

Status: mechanics passed; capability not promoted.

Decision: **no-go** for promotion; this is a mechanics-only smoke run.

The run initialized the 4.85M-parameter student from the immutable ZERO.3-final
weights with a fresh optimizer and trained for 20 hard-target updates. It mixed
the new quantity, geometry, and symbolic-art channels with historical replay.

| Evaluation | ZERO.3 baseline | Update 20 | Change |
| --- | ---: | ---: | ---: |
| Faculty aggregate | 3.9336 | 3.7842 | -3.8% |
| Quantity | 4.1362 | 3.9578 | -4.3% |
| Geometry | 3.3100 | 3.1822 | -3.9% |
| Art | 4.0469 | 3.9209 | -3.1% |
| Historical replay | 1.7424 | 1.7386 | -0.2% |

Training loss fell from `2.7277` at update 10 to `2.0446` at update 20. The
mixed validation loss fell from `2.9104` to `2.8762`. All 26,250 canonical
records passed their independent domain checks and integrity validation. The
controller passed atomic rejection, commit, switch locking, channel isolation,
and deterministic 256D registrar tests.

This is not a capability result. A greedy `add 2 3` channel probe did not emit
the exact artifact after only 20 updates. The next run needs enough updates to
measure promotion-task exactness, three seeds, and a task-level evaluator. No
teacher weight has been granted to the new channels.

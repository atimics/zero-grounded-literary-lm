# Reasoner (3,5): task-blind tool routing

Reasoner (3,5) replaces the three task-specific feature builders used by
Reasoner (3,4) with one common tool-call record.

Every candidate is scored through the same sixteen integer fields. The policy
does not receive a task label or candidate handle. It learns when to query
opaque handles, when to apply verified progress, and when to commit a complete
trace. Planning, composition, and witness-repair stages can appear in the same
episode.

Run the open screen with:

```sh
make reasoner36-check
./reasoner36 development
```

The sealed command refuses local execution. A historical one-shot cloud run
of source commit `b26bd62ee11dba7341d227c2c4cb1f2a2568da65` completed and its
result is recorded in
[`RESULT.md`](../benchmarks/reasoner36-task-blind-tools-v1/RESULT.md). The
checked-in contract remains locked and grants no new run or retry authority.

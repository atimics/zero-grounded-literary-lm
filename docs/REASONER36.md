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

The sealed command refuses local execution. Cloud execution requires both
`R36_SEALED_EXECUTION=cloud` and a new `R36_EXECUTION_LOCK` path. The source
bundle is frozen at commit `b26bd62ee11dba7341d227c2c4cb1f2a2568da65`.
Its exact bundle, destination, and capped one-shot run were authorized on
2026-08-30 with no retry.

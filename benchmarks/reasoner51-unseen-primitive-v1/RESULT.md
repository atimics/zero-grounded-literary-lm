# Reasoner 5.1 result: pass

The single registered run passed every frozen gate. The full scorer used 45
exact-verifier expansions. Target-only used 105. That is a 57.1% reduction.
All 24 episodes ended in an exact affine match.

| Registered arm | Expansions |
| --- | ---: |
| Full verified adapter | 45 |
| Oracle adapter | 45 |
| Target-only | 105 |
| Identity adapter | 95 |
| Shuffled adapter | 55 |
| Query-free adapter | 95 |
| Source token lookup | 95 |
| Source ablation | 105 |

The full scorer won on 17 of 24 episodes. Its largest search took four
expansions. Target-only reached ten. The adapter used eight reconstruction
queries and six challenge queries before the target episodes. All six
challenges passed.

The first ranked suggestion required correction on 15 episodes. The exact
verifier supplied that correction. Every accepted program matched the target.

## Scope of the evidence

This is a finite affine pilot over three lanes modulo 257. The semantic
classes and source corpus were chosen during design. The learned artifact
contains class counts and transition counts. The result supports transfer of
that small prior through the registered adapter on these twelve target
programs and two tie orders.

Several controls share implementation paths. Source ablation uses the
target-only path. The identity, query-free, and token-lookup controls use the
same fallback classes. Their identical totals reflect that shared design.
The strongest distinct adapter comparison is the shuffled arm at 55
expansions. Search totals cover candidate verification; adapter queries are
reported separately.

## Run record

Run `reasoner51-20260902t054250z` used source commit
`287fb462e5f736e037fb235cd23e35348904b0b5`. It took 5.699 milliseconds locally
at $0 cloud cost. The execution count is one. The sealed source, original
output bytes, and consumed lock hashes are recorded in `PROVENANCE.json`.

`RESULT.json` and `EXECUTION.json` preserve the original output. `ARTIFACT.hex`
reconstructs the exact 224-byte learned artifact. The result checker verifies
these bytes and recalculates the gate from the recorded measurements.

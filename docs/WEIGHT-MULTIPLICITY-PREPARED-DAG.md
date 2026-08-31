# Prepared dependency-DAG performance note

## Outcome

The prepared engine is a real step change, but it does not yet clear the
one-second frontier gate.

On the local release build, the former hard E8 query

```text
highest = 0,0,8,0,0,0,0,0
target  = 2,1,1,3,0,0,1,2
```

returns the same exact multiplicity,
`636782228236670659005329`, in about 5.1 seconds with eight workers. The
merged recursive engine took 32.72 seconds on the same case. That is about a
6.4x end-to-end speedup, while still leaving roughly a 5x gap to the gate.

The result is not a shortcut or a changed recurrence. Both engines report
137,281,531 recurrence terms and 120,201,356 internal Weyl folds. The prepared
run discovers 212,283 canonical nodes from 201,300,640 raw transitions and
stores 59,160,168 combined edges.

The representative E8 profiling query falls from about 2.72 seconds in the
merged recursive engine to 0.28 seconds in the prepared engine. Its answer and
structural counters also match exactly: 11,752,915 recurrence terms and
10,433,089 folds.

## Why it is faster

The engine separates graph discovery from arithmetic evaluation:

1. Independent nodes are discovered in parallel.
2. Every dependency is folded to its dominant representative before graph
   lookup.
3. Duplicate transitions from one parent to the same canonical dependency are
   combined into one edge.
4. Nodes are evaluated by depth, with a barrier between depths and parallel
   work inside a depth.
5. A representation session retains the graph and values for later targets.

The hard query compresses 201.3 million raw transitions to 59.2 million edges,
or 3.40x. Discovery remains the dominant phase: about 4.56 seconds versus
0.53 seconds for evaluation in the bounded grouped run.

The earlier 5.57x direct-fold speedup exceeded the 4.35x Amdahl ceiling implied
by a 77% sampled hotspot. That is expected because removing determinant work
also removed costs outside the sampled routine, including call overhead,
temporary state, register pressure, and missed inlining. The result was not
treated as a timing-only correctness claim; the differential canonicalizer and
identical recurrence counters supplied the correctness evidence.

## Memory and reuse

The hard query stays under the configured two-GiB shared allocation ceiling:

- 1,089,478,656 bytes retained after the query;
- 1,132,470,272 bytes peak counted allocation; and
- 1,180,647,424 bytes measured process peak RSS in the bounded grouped run.

Chunked edge storage is important here. A growing contiguous edge array
reached 2,115,108,864 bytes of process peak RSS on the same query, leaving too
little safety margin below two GiB. Fixed 65,536-edge blocks reduced peak RSS
by about 935 MB and removed the old-plus-new edge-array resize spike.

The prepared session also demonstrates cross-target reuse. After the hard E8
query, the distinct target `0,1,6,1,0,0,0,1` returns multiplicity 1 with zero
new memo entries, zero new nodes, zero new edges, and zero recurrence terms.

## Validation

The implementation is covered by:

- normal and exact-reference canonicalizer self-tests;
- differential recursive-versus-prepared answers and structural counters;
- a second-query session reuse check;
- a forced shared-byte-limit failure check;
- AddressSanitizer and UndefinedBehaviorSanitizer; and
- ThreadSanitizer on the parallel representative E8 query.

The prepared surface is additive. The sealed Phase 0 adapter and evidence are
unchanged. A new frontier run must therefore be recorded as new Phase 0.5
evidence, not as a correction to the earlier record.

## Next performance target

The remaining cost is canonical graph discovery, not big-integer evaluation.
The next useful work should reduce or avoid discovery states: stronger
representation-level graph reuse, a mathematically justified pruning rule, or
a different multiplicity algorithm for deep E8 cells. Tuning arithmetic or
adding more evaluation workers cannot close the remaining fivefold gap by
itself.

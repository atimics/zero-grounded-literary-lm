# Prepared dependency-DAG performance note

## Outcome

The prepared engine is a real step change, but it does not yet clear the
one-second frontier gate. A second implementation pass removed the serialized
edge merge that dominated the first prepared version.

On the local release build, the former hard E8 query

```text
highest = 0,0,8,0,0,0,0,0
target  = 2,1,1,3,0,0,1,2
```

returns the same exact multiplicity,
`636782228236670659005329`, in 3.83 seconds with eight workers. The first
merged prepared version took 5.54 seconds in the directly matched local run,
and the merged recursive engine took 32.72 seconds. The current result is
1.45x faster than the first prepared version and 8.54x faster than the
recursive engine, while still leaving a structural gap to the gate.

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
or 3.40x. Discovery remains the dominant phase: 3.27 seconds versus 0.56
seconds for evaluation in the directly matched eight-worker run.

The first prepared version still took one global graph lock for every combined
edge. Sampling showed seven discovery workers waiting while one worker looked
up or inserted dependencies. The current version gives every worker its own
edge shard. During one discovery round the node table is read-only. A worker
therefore writes edges without a shared lock and records only previously unseen
node names in a local table. At the round barrier, those names are merged once
and temporary local edge references are patched to final node indexes.

Each retained edge is 12 bytes: a node index, a common 32-bit scale, and an
exact term count with flags. Rare 64-bit scales use a per-shard side table.
This is an exact representation change, not a narrowing of the arithmetic.

The earlier 5.57x direct-fold speedup exceeded the 4.35x Amdahl ceiling implied
by a 77% sampled hotspot. That is expected because removing determinant work
also removed costs outside the sampled routine, including call overhead,
temporary state, register pressure, and missed inlining. The result was not
treated as a timing-only correctness claim; the differential canonicalizer and
identical recurrence counters supplied the correctness evidence.

## Memory and reuse

The hard query stays under the configured two-GiB shared allocation ceiling.
With eight workers, the current implementation reports:

- 769,925,120 bytes retained by the graph; and
- 903,131,136 bytes peak counted working allocation.

The first prepared version used 1,003,495,424 graph bytes and peaked at
1,132,470,272 counted bytes on the same query. Compact sharded edges therefore
cut retained graph capacity by 23% and counted peak allocation by 20% while
also removing the discovery lock.

Chunked edge storage is important here. A growing contiguous edge array
reached 2,115,108,864 bytes of process peak RSS on the same query, leaving too
little safety margin below two GiB. Fixed 65,536-edge blocks reduced peak RSS
by about 935 MB and removed the old-plus-new edge-array resize spike.

The larger E8 zero-weight query at depth 1,080 now completes instead of
exhausting the graph budget. With eight workers it returns
`22278930779369659541330447609576694716700` in 10.61 seconds, stores
120,839,537 combined edges, peaks at 1,796,395,008 counted bytes, and reaches
2,007,367,680 bytes of process RSS. Ten workers reduce wall time to 9.46
seconds and reach 2,081,914,880 bytes of RSS. Twelve workers are faster at
8.69 seconds but reach 2,157,576,192 bytes of RSS, above the binding two-GiB
ceiling, so twelve is not a safe frontier setting.

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
On the depth-1,080 query, discovery is about nine times as expensive as
evaluation. The next useful work should reduce or avoid discovery states:
stronger representation-level graph reuse, a mathematically justified pruning
rule, or a different multiplicity algorithm for deep E8 cells. More workers
help at the margin, but the measured RSS sweep shows that worker count cannot
close the remaining gap inside the memory contract.

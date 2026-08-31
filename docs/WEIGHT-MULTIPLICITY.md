# Exact weight-multiplicity oracle

This program computes the multiplicity of a weight in a finite-dimensional,
irreducible highest-weight representation. It is the symbolic oracle for the
signed weight-multiplicity transfer study. It is not a learned model.

The implementation accepts the 31 finite connected Cartan types through rank
8 used by the study:

- `A1` through `A8`
- `B2` through `B8`
- `C3` through `C8`
- `D4` through `D8`
- `G2`, `F4`, `E6`, `E7`, and `E8`

Public `B_n` and `C_n` names follow the standard Dynkin-label convention.
For ranks 3 through 8, the self-test checks
`dim V_Bn(omega_1) = 2n + 1` and `dim V_Cn(omega_1) = 2n`. `B2/C2` remains
the rank-two isomorphism edge case and is not used to distinguish the names.
Historical binaries built before this convention repair used the opposite
public B/C labels; their sealed outputs must be mapped explicitly rather than
rewritten.

Highest and target weights use Dynkin labels. The highest weight must be
dominant. The target may be dominant or non-dominant.

## Method

The oracle first asks Reasoner0 to verify the Cartan matrix and its integer
symmetrizer. It then constructs every root by exact Weyl reflection and keeps
the positive roots in a stable order.

For a query, the target is reflected to its dominant Weyl representative. Every
recursive dependency weight is also reflected to its dominant representative
before memo lookup and recurrence evaluation. Weyl-equivalent internal states
therefore share one exact multiplicity calculation even in a cold single
query. A target outside the highest-weight representation returns zero.
Remaining multiplicities are computed with the Freudenthal recurrence. All
multiplicity arithmetic is unsigned 1024-bit integer arithmetic. Division must
be exact; overflow, a non-exact division, or a bound violation returns an error
instead of a guessed result.

The fixed 1024-bit capacity is intentionally conservative for the signed
study's label range of 0 through 31. Phase 0 must still measure the full query
frontier and reject any cell that reaches an implementation limit.

## Build and check

```sh
make weight-multiplicity-check
```

The self-test checks:

- the exact positive-root count for all 31 types;
- the complete 3,750-case ACR-1 adjoint integrity surface;
- non-dominant Weyl-orbit targets;
- prepared-graph answers and recurrence counters against the recursive engine;
- prepared-graph reuse inside one representation session;
- the shared memo-and-graph byte ceiling;
- `A1` weight strings and root-lattice gaps; and
- the three weights of the `A2` fundamental representation.

The ACR-1 cases are an integrity check, not evidence of learned structural
transfer.

## Query

```sh
./weight_multiplicity query A2 1,1 0,0
```

The command writes one stable JSON record. Multiplicity is a decimal string so
that downstream tools cannot lose integer precision:

```json
{"schema_version":1,"type":"A2","rank":2,"highest_weight":[1,1],"target_weight":[0,0],"multiplicity":"2","positive_roots":3,"memo_entries":1,"recurrence_terms":3,"recursive_weyl_folds":2,"maximum_level":2}
```

The work counter fields are diagnostic. `recursive_weyl_folds` counts internal
dependency requests redirected to a dominant orbit representative. It is not a
count of unique orbits. These counters are not scientific metrics and must not
replace measured elapsed time or memory in a frontier.

## Persistent adapter

Phase 0 should measure uncached query work without charging every query for
process startup or root-system initialization. Start the persistent adapter:

```sh
./weight_multiplicity --serve
```

It prints a ready record, then accepts one tab-separated request per line:

```text
A2\t1,1\t0,0
```

The adapter caches only verified Cartan and positive-root data. Every query
gets a fresh Freudenthal memo table, so multiplicities are not reused between
requests. Each response is the same stable JSON record as the one-shot query.
This lets the ilXyr controller time calls and replay the exact input stream in
a fresh process to check byte identity.

Phase 0.5 adds a separate grouped adapter without changing that historical
interface:

```sh
./weight_multiplicity --serve-grouped
```

The grouped adapter retains one bounded Freudenthal memo for one exact Lie type
and highest weight. Requests with the same `(type, highest_weight)` reuse exact
intermediate multiplicities. A type or highest-weight change destroys the old
memo before creating the next one. The adapter never enumerates an unrequested
weight and never shares a memo across representations.

Every grouped response uses schema Version 2 and reports the memo entries
before the query, entries added, recurrence cache hits, final entries, and
allocated memo capacity. It also reports peak simultaneous memo allocation,
including the old and new hash tables during a resize. `@reset` explicitly
evicts the active representation. `@metrics` reports both process peak RSS and
the active memo high-water state.

The default memo allocation ceiling is 2,147,483,648 bytes. Tests may lower it
with `ZERO_WEIGHT_MEMO_LIMIT_BYTES`; the ilXyr controller still enforces the
binding two-GiB total incremental process-memory limit independently. The
original `--serve` mode remains fresh-memo and byte-compatible with the sealed
Phase 0 evidence.

Allocator-policy audits may set `ZERO_WEIGHT_MEMO_INITIAL_CAPACITY` to a
power-of-two entry count. The default is 1024. Presizing avoids the temporary
old-plus-new allocation of earlier resizes while leaving the hash function,
70% load threshold, recurrence, and answers unchanged. The grouped ready
record states the selected capacity, the memo entry size, and whether the run
uses the default or presized policy. This control is for versioned audit
reruns; it does not rewrite earlier frontier evidence.

## Prepared dependency graph

Deep or grouped work can use the prepared engine explicitly:

```sh
./weight_multiplicity query-prepared E8 HIGHEST TARGET
./weight_multiplicity --serve-prepared
```

The prepared engine discovers the canonical Freudenthal dependency graph for
the requested target. It combines repeated edges to the same dominant weight,
then evaluates equal-depth nodes in parallel after all higher-weight
dependencies are ready. The grouped adapter keeps both the exact values and
the prepared graph for the active `(type, highest_weight)` session. A later
target already covered by that graph is a direct lookup.

`ZERO_WEIGHT_PREPARED_WORKERS` sets the worker count from 1 through 32. The
default is 8. Small evaluation groups stay on one thread, so the configured
count is a ceiling rather than a promise that every query uses every worker.

The prepared graph gives each discovery worker a private edge shard backed by
fixed blocks. A round reads a stable node table, then merges only newly seen
node names at its barrier. This removes a shared lookup lock from the edge hot
path. Common edges occupy 12 bytes; rare scales outside 32 bits are retained
exactly in a per-shard side table. The
`ZERO_WEIGHT_MEMO_LIMIT_BYTES` ceiling is shared by the memo, graph, temporary
discovery tables, and resize overlap. Schema Version 3 reports graph size,
graph build and evaluation time, worker count, and the shared working-set
high-water mark. Process RSS remains a separate controller measurement.

This is a new Phase 0.5 execution surface. It does not change the historical
`--serve` output or rewrite sealed Phase 0 evidence.

## Stabilizer orbits and root rays

The prepared engine groups positive roots under the Weyl subgroup that fixes
the current dominant weight. Roots in one such orbit have the same folded
dependency and the same Freudenthal contribution. The engine therefore folds
one representative for each active orbit and keeps the original logical term
and fold counters. A differential build checks every grouped endpoint against
the ungrouped canonicalizer.

An additional exact root-ray engine is available for memory-sensitive deep
queries:

```sh
./weight_multiplicity query-ray E8 HIGHEST TARGET
./weight_multiplicity --serve-ray
```

It treats all positive multiples of a root as one memoized ray state. A ray
stores its ordinary and distance-weighted multiplicity sums, so a source node
can reconstruct the unchanged Freudenthal numerator without retaining the
prepared graph's many-to-one edge list. Ray states are keyed by canonical
weight node and signed root direction. The state table uses 48-byte entries,
direct per-node root lookup, 128-bit inline values, and an exact 1,024-bit side
table when an inline value is too small.

The root-ray engine now separates transition discovery from arithmetic
evaluation. Its compact transition graph is ordered by lowering depth, and
nodes at the same depth run in parallel. `ZERO_WEIGHT_RAY_WORKERS` selects one
through 32 workers; the default is eight.

This engine is additive and is not yet the default. It is faster and smaller
than the prepared graph on the measured depth-1,080 E8 query, but a new
frontier run must establish the full surface before the default changes.
Schema Version 4 reports canonical nodes, ray states, hits, transitions,
discovery and evaluation time, worker use, and counted allocation. The same
shared byte ceiling applies to the multiplicity memo, compact graph, work
queue, and ray tables. See
`docs/WEIGHT-MULTIPLICITY-ROOT-RAY.md` for the matched measurements and the
remaining performance decision.

Sending `@metrics` returns the process peak resident-set size in bytes. The
controller records it before type initialization, after warm-up, and after the
cell. This keeps memory accounting separate from query latency.

The controller can obtain the verified coordinate data once per type with:

```sh
./weight_multiplicity describe E8
```

The stable JSON result contains the Cartan matrix, its integer symmetrizer, and
all positive roots in simple-root coordinates. The Phase 0 candidate generator
uses this record instead of carrying a second handwritten Cartan catalogue.

# Stabilizer-orbit and root-ray performance note

## Outcome

This work produced two speed optimizations and a lower-memory deep-query
path. The parallel root-ray DAG is now faster than the prepared engine on
both measured deep E8 queries. It still does not clear the one-second gate.

The speed optimization groups positive roots under the stabilizer of each
dominant weight. On the depth-1,080 E8 zero-weight query, the prepared engine
now folds 194,273,583 orbit representatives instead of visiting 507,433,688
root multiples separately. It keeps the same 320,139 canonical nodes,
120,839,537 combined edges, 321,688,747 nonzero recurrence terms, and exact
multiplicity. A clean local run fell from the earlier 10.61 seconds to about
7.2 seconds.

The root-ray engine goes further mathematically. It replaces each sequence
along one signed root with a memoized pair of sums. The first recursive
version reduced the depth-1,080 query to 16,157,157 ray transitions and
returned the same 40-digit multiplicity:

```text
22278930779369659541330447609576694716700
```

That first version used 1,192,695,936 bytes of counted working allocation in
the matched run, versus 1,795,608,576 bytes for the prepared graph. Wall time
was about the same, 7.35 seconds versus 7.36 seconds.

The follow-up stores ray transitions first, orders the canonical nodes by
lowering depth, and evaluates independent nodes at the same depth in
parallel. In a clean matched depth-1,080 run, prepared took 12.21 seconds
(10.10 seconds discovery and 2.13 seconds evaluation). Parallel root ray took
4.90 seconds (4.04 seconds discovery and 0.83 seconds evaluation), a 2.49x
speedup. Counted working allocation fell from 1,795,608,576 to 1,324,881,920
bytes, a 26% reduction. The retained server measured 1,373,437,952 bytes of
maximum RSS.

For the former hard representative E8 query, the matched time fell from 5.04
seconds prepared to 3.03 seconds parallel root ray, a 1.66x speedup. It
returned `636782228236670659005329`. The smaller query is the memory
crossover: counted root-ray allocation was 946,933,760 bytes, compared with
903,131,136 bytes prepared.

## What changed

At a dominant weight, simple reflections whose Dynkin labels are zero form a
parabolic stabilizer. Positive roots in one stabilizer orbit lead to the same
dominant dependency. The prepared graph now precomputes those root orbits for
all possible zero-label masks, selects one active representative, and scales
its edge contribution by the active orbit size.

The root-ray engine additionally carries a signed root through the same Weyl
fold used for the dependency weight. Its memo key is the canonical weight node
and the stabilized signed-root representative. Each state stores the sum of
multiplicities on the rest of the ray and the same sum weighted by distance.
Those two numbers reproduce every term of the original root string exactly.

The first direct implementation was exact but retained two full 1,024-bit
integers and an eight-coordinate weight in every ray hash entry. The hard E8
case used about 7.7 GiB and took 11.4 seconds. The retained implementation
uses:

- stable 32-bit canonical node identifiers instead of repeated coordinates;
- direct `(node, signed root)` lookup instead of a second large hash table;
- fixed blocks, so growth does not retain an old and new table together;
- 48-byte ray entries;
- four inline 32-bit limbs for the common case; and
- an exact 32-limb side table for larger values.

That compression cut the hard case to about 0.87 GiB. Passing the stable node
identifier through recursive ray hits then reduced its time to about 5.0
seconds.

## Parallel level-order execution

Every canonical dependency is at a strictly lower lowering depth. The new
engine uses that order in two phases. Discovery computes canonical folds
outside the shared lock and merges new states in small batches. Evaluation
then completes all pending ray states for one node, followed by that node's
multiplicity. Nodes at the same depth are independent and can be assigned to
workers safely.

The representative E8 query has 211,748 evaluated canonical nodes in 245
depth groups. The depth-1,080 query has 308,012 evaluated nodes in 503 groups.
Both retain exactly the prepared engine's logical recurrence-term count:
137,281,531 and 321,688,747 respectively.

The temporary discovery queue is included in the byte budget and released
before evaluation. A readiness bit in the compact value reference separates
an unevaluated transition from a computed zero. This lets a retained session
answer a shallow target, extend the same graph for a deeper target, and make
a repeated deep target zero work. `ZERO_WEIGHT_RAY_WORKERS` controls the
worker count; it defaults to 8 and accepts 1 through 32.

## Correctness evidence

The normal and exact-reference builds both pass all 31 supported finite
crystallographic types, covering 931 positive roots and 3,750 ACR-1 cases.
Every ordinary expected-value check also runs the ray engine and requires:

- the same exact multiplicity;
- the same logical recurrence-term count; and
- successful exact Weyl canonicalization.

The A3 prepared, recursive, and ray engines agree under session reuse. The
session test first answers a shallow target, extends to the zero weight,
matches a fresh recursive traversal across both steps, then confirms that a
repeat is zero work. The hard and depth-1,080 E8 queries also agree exactly
with the earlier prepared results and recurrence-term counts.
AddressSanitizer and UndefinedBehaviorSanitizer pass the full test suite and
an E8 ray query. ThreadSanitizer passes parallel E8 discovery without a
reported race.

The prepared orbit optimization has a stronger differential check. In the
cross-check build, every raw active root in a grouped stabilizer orbit is
folded independently and must land on the same canonical dependency as the
representative. The prepared engine also retains the old logical transition
and fold counters, so graph shape remains directly comparable to the earlier
implementation.

## Decision

The stabilizer-orbit optimization belongs in the prepared default: it is
faster, exact, and lowers no safety margin.

The root-ray engine remains an explicit Schema Version 4 surface through
`query-ray` and `--serve-ray`. These results justify rerunning the Phase 0.5
frontier, but not changing the default engine before that evidence exists.
The one-second gate remains open.

Discovery is now the main root-ray cost: about five times evaluation on the
depth-1,080 run. More than eight workers did not improve the matched local
runs. The next implementation target is therefore less shared discovery
coordination, such as sharded insertion or round-based local discovery and
merge, rather than adding more arithmetic workers.

These measurements are forward Phase 0.5 engineering evidence. They do not
rewrite the sealed Phase 0 record or change the earlier memory erratum.

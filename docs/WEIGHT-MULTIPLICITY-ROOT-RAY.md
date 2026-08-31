# Stabilizer-orbit and root-ray performance note

## Outcome

This pass produced one speed optimization and one lower-memory alternative.
It did not clear the one-second E8 gate.

The speed optimization groups positive roots under the stabilizer of each
dominant weight. On the depth-1,080 E8 zero-weight query, the prepared engine
now folds 194,273,583 orbit representatives instead of visiting 507,433,688
root multiples separately. It keeps the same 320,139 canonical nodes,
120,839,537 combined edges, 321,688,747 nonzero recurrence terms, and exact
multiplicity. A clean local run fell from the earlier 10.61 seconds to about
7.2 seconds.

The root-ray engine goes further mathematically. It replaces each sequence
along one signed root with a memoized pair of sums. This reduces the
depth-1,080 query to 16,157,157 ray transitions and returns the same
40-digit multiplicity:

```text
22278930779369659541330447609576694716700
```

It used 1,192,695,936 bytes of counted working allocation in the matched run,
versus 1,795,608,576 bytes for the prepared graph. Wall time was about the
same, 7.35 seconds versus 7.36 seconds. The ray engine is therefore useful as
a memory-safe fallback, not as the new speed path.

For the former hard representative E8 query, root rays used 866,127,872 bytes
of counted working allocation and returned
`636782228236670659005329` in about 5.0 seconds. The stabilizer-grouped
prepared engine remained faster at roughly 3 to 4 seconds on otherwise idle
local runs.

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

## Correctness evidence

The normal and exact-reference builds both pass all 31 supported finite
crystallographic types, covering 931 positive roots and 3,750 ACR-1 cases.
Every ordinary expected-value check also runs the ray engine and requires:

- the same exact multiplicity;
- the same logical recurrence-term count; and
- successful exact Weyl canonicalization.

The A3 prepared, recursive, and ray engines agree under session reuse. The
hard and depth-1,080 E8 queries also agree exactly with the earlier prepared
results and recurrence-term counts. AddressSanitizer and
UndefinedBehaviorSanitizer pass the full test suite and an E8 ray query.

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
`query-ray` and `--serve-ray`. It proves that the root-string dimension can be
factored and gives substantially more memory headroom, including a
single-worker route for the depth-1,080 cell. It should not replace the
prepared engine on speed grounds.

The next speed pass should keep the ray factorization but separate discovery
from evaluation. Ray transitions always point to a lower depth, so they form a
level-ordered DAG. Discovering that compact DAG once, then evaluating equal
depths in parallel, is the direct way to combine the ray engine's smaller
state space with the prepared engine's worker utilization. The present result
shows that root-ray factorization alone is insufficient; the parallel
level-order execution is part of the performance requirement.

These measurements are forward Phase 0.5 engineering evidence. They do not
rewrite the sealed Phase 0 record or change the earlier memory erratum.

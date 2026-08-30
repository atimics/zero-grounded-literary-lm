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

Highest and target weights use Dynkin labels. The highest weight must be
dominant. The target may be dominant or non-dominant.

## Method

The oracle first asks Reasoner0 to verify the Cartan matrix and its integer
symmetrizer. It then constructs every root by exact Weyl reflection and keeps
the positive roots in a stable order.

For a query, the target is reflected to its dominant Weyl representative. A
target outside the highest-weight representation returns zero. Remaining
multiplicities are computed with the Freudenthal recurrence. All multiplicity
arithmetic is unsigned 1024-bit integer arithmetic. Division must be exact;
overflow, a non-exact division, or a bound violation returns an error instead
of a guessed result.

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
{"schema_version":1,"type":"A2","rank":2,"highest_weight":[1,1],"target_weight":[0,0],"multiplicity":"2","positive_roots":3,"memo_entries":3,"recurrence_terms":5,"maximum_level":2}
```

The work counter fields are diagnostic. They are not scientific metrics and
must not replace measured elapsed time or memory in the Phase 0 frontier.

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

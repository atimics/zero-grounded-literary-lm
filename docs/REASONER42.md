# Reasoner 4.2: exact abstraction-library growth

Reasoner 4.2 tests whether solved programs can create a small reusable
library that makes longer programs searchable without weakening exact
verification.

```text
base adapter grammar
        |
        v
solve curriculum exactly
        |
        v
MDL subprogram discovery -> freeze three derived library entries
        |
        v
library-guided active search
        |
        v
exact affine proof -> COMMIT -> APPLY -> REPORT
```

The six Reasoner 4.0 adapter operations remain unchanged. The new learner
solves nine curriculum semantic classes with the base grammar, counts repeated
contiguous subprograms, and selects the three positive-gain abstractions under
a deterministic minimum-description rule. Each abstraction is stored as its
base expansion, occurrence count, MDL gain, and exact proof digest. The
library is frozen before development evaluation.

## Proof-based program identity

Reasoner 4.0 compared adapter behavior on 288 registered probes. Reasoner 4.2
instead compiles every program to the affine map

```text
y = Mx + b  over GF(257)
```

for every registered dimension from four through twelve. Matrix and offset
equality is an exact proof that two registered programs agree on every field
vector in those dimensions, not only on a sample. The runtime also proves that
each program's symbolic inverse composes to the identity and that the C
implementation agrees with the symbolic certificate on the affine basis.
Hashes only accelerate comparison; a matching hash is followed by exact
matrix comparison.

## Public development result

The public gate passes exactly:

- 259 raw and 170 exact canonical base programs;
- nine curriculum targets and 729 exact certificate replays;
- three learned two-operation abstractions with nine corpus occurrences;
- a net curriculum MDL gain of three tokens after paying six definition
  tokens;
- 91 raw and 74 canonical programs in the frozen library search space;
- seven held-out semantic classes that require four base operations but only
  two library calls;
- 14/14 exact development episodes, 1,134 exact certificate replays, and
  42/42 exact applications;
- at most one active query per episode; and
- passing semantic-oracle isolation over the full base depth-four grammar,
  with no-library, shuffled-curriculum,
  single-use-library, curriculum-lookup, and no-query controls all failing as
  required.

The library searches 91 raw programs under the frozen 100-program budget. A
complete base-only depth-four search requires 1,555 raw programs. The result
therefore demonstrates reusable compression under a fixed search budget; it
does not show a new primitive outside the six-operation meta-language.

Run the public gate with:

```sh
make reasoner42-check
./reasoner42 development
make reasoner42-contract-check
```

## Locked next seal

The registered next split contains 17 exact semantic classes that require
three library calls and six expanded base operations. The library grammar has
820 raw programs through depth three; the corresponding base grammar has
55,987 raw programs through depth six. The sealed evaluator is not implemented
or authorized, and every `sealed-run` request fails closed.

The current result is evidence for exact derived-abstraction discovery and
reuse inside the registered reversible affine language. It does not establish
arbitrary library learning, non-affine program induction, noisy observations,
natural-language grounding, recursive algorithms, or open-ended reasoning.
See the
[`preregistration`](../benchmarks/reasoner42-abstraction-library-v1/PREREGISTRATION.md),
[`contract`](../benchmarks/reasoner42-abstraction-library-v1/contract.json),
and
[`development result`](../benchmarks/reasoner42-abstraction-library-v1/DEVELOPMENT.md).

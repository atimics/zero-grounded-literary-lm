# Reasoner-0: Cartan classification seed

Reasoner-0 starts where the interesting invariant lives: connected finite-type
Cartan matrices. It does not make a model walk through set theory, topology, or
manifolds before seeing Lie classification.

The task is bounded to rank 8. A proposer supplies an integer matrix. A local
kernel either accepts it or returns an exact counterexample. Accepted matrices
are sealed before language can name the type.

```text
canonical integer matrix
          |
          v
 learned control policy --call--> cartan.verify
          ^                         |
          |                         v
          +--- exact certificate or counterexample
          |
          +--commit--> sealed Answer IR
                              |
                              v
                     language.render tool
```

This is a mechanics and dataset-generator baseline. The control policy is
learned from typed phase-to-action records. The matrix proposer is currently a
deterministic exhaustive search, so the repository can establish complete
ground truth before training a neural proposer.

## Exact verifier

For a rank `n` integer matrix `A`, `cartan.verify` requires:

1. `A[i,i] = 2`.
2. Every off-diagonal entry is non-positive.
3. `A[i,j] = 0` exactly when `A[j,i] = 0`.
4. Every finite-type bond product is in `{0, 1, 2, 3}`. Product `4` is
   allowed to reach the exact minor check so rank-2 affine cases are labeled
   by determinant zero; products above `4` fail immediately.
5. The diagram is connected. Direct sums are rejected.
6. A positive integer symmetrizer exists.
7. Every proper principal minor is positive and the full determinant is
   positive.

All determinants use the fraction-free Bareiss algorithm over signed integers.
There are no eigenvalues, tolerances, or floating-point comparisons. If every
proper principal minor is positive and the full determinant is zero, the
verifier returns the dedicated `affine_determinant_zero` counterexample.
This includes the product-4 rank-2 affine case. A product-5 negative is rejected
as `bad_bond_product` before any determinant is computed.

Connectedness is part of the verifier, not a dataset filter. This closes the
`A1 x A1 x ...` reward channel: a reducible matrix cannot receive a valid
certificate.

The self-test keeps the important paths separate: `G2` exercises product 3;
`F4` exercises an internal product-2 bond; affine `A1` and affine `D4` exercise
two different determinant-zero shapes; and a product-5 matrix fails before any
principal minor is checked.

## Canonical reward identity

Cartan matrices that differ only by a simultaneous row and column permutation
are one proposal. Before verification, reward, or deduplication, Reasoner-0:

1. partitions nodes by degree and directed bond-multiplicity signature;
2. orders those signatures;
3. searches permutations only inside equal-signature groups; and
4. selects the lexicographically least matrix.

The policy therefore cannot earn repeated credit by relabeling one diagram.
Directed bond counts remain in the node signature and the full directed matrix
is compared. The self-test therefore requires `B4` and its transpose `C4` to
have different canonical forms and different type names.

## Enumeration curriculum

The deterministic proposer starts from `A1`. At each rank it attaches one new
node to each previously accepted connected diagram with one of the five
crystallographic directed bonds:

```text
(-1,-1)  (-1,-2)  (-2,-1)  (-1,-3)  (-3,-1)
```

Only verified, canonical, novel diagrams seed the next rank. Rejected
extensions become counterexamples. Affine determinant-zero counterexamples
receive weight 8; ordinary rejects receive weight 1. After rank 8, a final
rank-9 extension scan gathers boundary negatives, including one-node
extensions of `E8`, without adding rank-9 positives to the benchmark.

The checked rank-by-rank ground truth is:

```text
rank 1: A1
rank 2: A2, B2/C2, G2
rank 3: A3, B3, C3
rank 4: A4, B4, C4, D4, F4
rank 5: A5, B5, C5, D5
rank 6: A6, B6, C6, D6, E6
rank 7: A7, B7, C7, D7, E7
rank 8: A8, B8, C8, D8, E8
```

The cumulative rank-2 curriculum has the four starting types `A1`, `A2`,
`B2/C2`, and `G2`. At rank 8 the bounded task contains the four families
`A`, `B`, `C`, `D` and all five exceptions `G2`, `F4`, `E6`, `E7`, `E8`.

The rank-8 benchmark terminates with 31 connected types. The family rules can
of course be extended beyond rank 8; the seed benchmark itself is finite and
has exact precision and recall.

## Run it

Build and test:

```sh
make reasoner0-check
```

Train the typed control policy and enumerate the complete bounded target:

```sh
./reasoner0 train /tmp/reasoner0.r0p
./reasoner0 enumerate /tmp/reasoner0.r0p 8
```

Materialize the reason-only training corpus:

```sh
./reasoner0 dataset /tmp/reasoner0.r0p 8 /tmp/reasoner0.jsonl
```

The JSONL file has 584 canonical examples: all 31 in-scope positives and all
553 exact negatives. Each record contains only the integer matrix, exact
certificate or local counterexample, example weight, and target control
actions. Accepted records end in `call_language_render`, but rendered text is
not stored as a target. Valid rank-9 extensions are outside the bounded task
and are not written; rank-9 boundary negatives are written with
`boundary_scan: true`.

Verify `A2` and show every boundary crossing:

```sh
./reasoner0 verify /tmp/reasoner0.r0p 2 2 -1 -1 2 --trace
```

The deterministic rank-8 run currently reports:

```text
587 canonical proposals
31 accepted connected types
553 exact counterexamples
45 affine determinant-zero counterexamples
exact precision and recall: true
```

The counts include the separate rank-9 boundary scan, so accepted plus rejected
does not equal the total: valid rank-9 family extensions are measured but are
outside the bounded positive set.

## Reason and language separation

The learned policy has four typed actions:

```text
proposed       -> call_cartan_verify
verified       -> commit_answer
counterexample -> reject_candidate
sealed         -> call_language_render
```

There are no words, byte tokens, target explanations, learned scores, or judge
preferences in training. The verifier returns a local exact certificate:
matrix, determinant, checked principal-minor count, and integer symmetrizer.
The canonical Answer IR binds that certificate and is sealed with SHA-256.

`language.render` reruns canonicalization and exact verification, checks the
seal, then names the known type. It cannot turn a rejected or altered matrix
into prose that looks accepted.

## What comes next

[`REASONER1.md`](REASONER1.md) implements the first learned proposer. It receives
canonical graph state and the last exact counterexample, then scores discrete
node-attachment and directed-bond actions. Its evaluation remains mechanical:

- precision over novel canonical proposals;
- recall against the complete type set at each rank;
- duplicate rate after canonicalization;
- affine-boundary discrimination;
- exact action traces and sealed matrices before and after compression.

The rank-7 holdout recovers all five rank-8 types but still makes one invalid
proposal. That is enough to keep compression blocked. Language input and richer
explanations remain tools around the formal loop, not part of the
classification reward.

## Scope

- This does not claim that ZERO has learned Lie theory.
- It does build the complete bounded environment, verifier, baseline search,
  counterexample stream, sealing boundary, and exact evaluation needed to train
  that claim honestly.
- It does not authorize ZERO.5 base-model training or model promotion.

The matrix conditions and finite-type principal-minor criterion follow the
standard generalized-Cartan formulation summarized in
[Williams, *Cluster algebras and scattering amplitudes*, Sections 5.1-5.2](https://people.math.harvard.edu/~williams/papers/chapters4-5.pdf).

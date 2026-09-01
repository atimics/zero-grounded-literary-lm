# Reasoner (3,2): exact behavioral compression

Reasoner (3,2) asks whether the passing Reasoner (3,1) policy can become a
small, direct reasoning runtime without changing what it does. This is a
compression experiment, not a new training run. It starts from the frozen
integer weights produced by Reasoner (3,1).

The gate is stricter than matching aggregate accuracy. The compressed policy
must choose the same action as the dense policy for every program and every
hypothesis in the complete finite world. It must also reproduce every full
start-to-finish trace and sealed answer.

## Compressor

The dense model has 131,072 signed 32-bit weight slots. Only 186 are nonzero.
Reasoner (3,2) first converts those weights to sorted `(feature index, int8
value)` pairs. It then performs deterministic behavioral pruning:

1. Run the verifier on all 511 programs and all 4,096 hypotheses.
2. Canonicalize rejected observations over all six coordinate permutations.
3. Try nonzero weights in increasing absolute-value and feature-index order.
4. Remove a weight only when every affected canonical context keeps the same
   selected action, including the exact tie break.
5. Recheck the pruned policy against the dense policy on the full,
   non-deduplicated world.

The canonical pass reduces 2,091,329 rejected program/hypothesis pairs to
61,397 distinct policy contexts. Canonicalization is only an optimization for
the pruning search. The final proof still checks all 2,093,056 raw pairs, so a
canonicalization mistake cannot create a passing artifact.

Some arbitrary hypotheses have no one-edit action that resolves their current
witness. Both policies return no action on those states. They remain in the
full action comparison. They are not reached by any of the 511 traces that
start from the empty hypothesis.

## Result

The greedy pass removes 170 of the 186 nonzero weights and retains 16:

| Measure | Dense (3,1) | Sparse (3,2) |
| --- | ---: | ---: |
| Stored artifact | 524,316 bytes | 87 bytes |
| Weight slots or pairs | 131,072 | 16 |
| Active weight payload | 524,288 bytes | 80 bytes |
| Weight value range | -5 to 4 | -3 to 4 |

The 87-byte artifact is 36 bytes of metadata plus delta-coded feature indices
and signed byte values. Inference reads the sparse pairs directly. It never
reconstructs the dense array.

The exact comparison is:

```text
program/hypothesis pairs: 2,093,056
accepted pairs: 1,727
rejected pairs with an action: 657,601
rejected pairs without a one-edit action: 1,433,728
action mismatches: 0

complete program traces: 511
total edit steps: 1,920
trace mismatches: 0
sealed-answer mismatches: 0
```

The action and trace digests are frozen in the runtime. The artifact also has a
payload checksum. Loading checks the encoding, checksum, metadata, sorted
indices, frozen digests, all world actions, all complete traces, and all final
seals before accepting the model.

## What this establishes

Reasoner (3,2) passes the trace-preserving compression gate. Most of the dense
feature table and most of its learned nonzero weights are unnecessary for the
policy's exact behavior in this world. The result also gives a small runtime
that preserves the separation:

```text
sparse reasoner -> exact verifier -> sealed Answer IR -> language tool
```

This does not show new intelligence. Pruning uses the complete finite world,
and the compressed policy solves exactly the same bounded task as its dense
source. It does not establish transfer to a larger hypothesis language, an
unknown verifier, or natural language. Language training remains blocked.

## Artifact format

The shell-safe binary name is `reasoner32`, and its model suffix is `.r32p`.
The displayed experiment version is `(3,2)`.

The artifact stores:

- a fixed `R32V` header and format version;
- the training, evaluation, and sealed-test stage markers;
- the retained weight count;
- frozen behavior and trace digests;
- a checksum over the header contract and payload; and
- strictly increasing feature-index deltas followed by signed byte values.

## Run it

```sh
make reasoner32-check
./reasoner32 demo
./reasoner32 build /tmp/reasoner32.r32p
./reasoner32 verify /tmp/reasoner31.r31p /tmp/reasoner32.r32p
./reasoner32 render /tmp/reasoner32.r32p 510
```

To compress an existing dense artifact:

```sh
./reasoner31 train /tmp/reasoner31.r31p
./reasoner32 compress /tmp/reasoner31.r31p /tmp/reasoner32.r32p
```

## Next gate

No further shrinking experiment is needed on this answer set. The next
reasoning experiment should change the generalization axis while keeping this
sparse policy as a control. It must be frozen separately before training; this
result does not by itself authorize a Reasoner `(3,3)` or language training.

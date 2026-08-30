# Reasoner (3,3): dimension transfer

Reasoner (3,3) tests whether a small relational policy transfers beyond the
finite world used to train it. It is not another compression pass.

Reasoner (3,2) is an exact 87-byte policy, but its retained weights address a
fixed hashed feature table. That leaves two explanations for its size:

- it found a small reusable rule; or
- it found a small lookup table for the complete 3D world.

This experiment separates those explanations.

## Frozen progression

The task family contains axis-aligned integer boxes over `[-2, 2]`. Every
dimension contributes four possible bound atoms and eight distinct minimal
interval choices. The exact program census is therefore:

| Dimensions | Programs | Role |
| ---: | ---: | --- |
| 1 | 7 | training |
| 2 | 63 | training |
| 3 | 511 | development |
| 4 | 4,095 | sealed cloud test; passed |

The shared policy trains on 1D and 2D only. It must then solve all 511 3D
programs with minimum-length traces and pass every generated coordinate
permutation. Only after that gate passes may 3D cases be added to training.
The 4D world is opened once by the cloud `sealed-run` command. It is not used
for pruning, tuning, or architecture selection.

## Capacity-matched arms

The experiment compares:

- the frozen 16-weight Reasoner (3,2) hash policy, generalized mechanically to
  the larger feature space; and
- a 16-feature shared semantic scorer trained only on smaller dimensions.

The semantic features describe whether an edit adds or removes a bound, how
the bound relates to the verifier's source and target states, witness type,
integer slack, and the resulting local interval width. They contain no fixed
dimension identity. Its full weight array is 64 bytes, below the 80-byte
active payload of the hash control.

Both arms receive the same exact witness-progress action set. The learned
policy only ranks legal edits.

## Gate

Reasoner (3,3) passes only if all conditions hold:

- all 4,095 4D programs are solved in the minimum number of edits;
- every one of the 24 coordinate permutations preserves the selected action;
- every equal-admissibility witness pair selects a correct action on both
  sides;
- the frozen hash control does not pass 4D exactly;
- the witness-masked and tool-only controls do not pass exactly; and
- the semantic policy stays within the 80-byte active-weight budget.

A failed gate is still a valid result and must be recorded. Language training
remains out of scope in either case.

## Local development check

```sh
make reasoner33-check
./reasoner33 development
```

These commands stop after the 3D development gate and state explicitly that
4D stayed sealed. The command below is reserved for the immutable cloud run:

```sh
./reasoner33 sealed-run result.json
```

The cloud route adds an immutable source digest, one-run lock, hard time and
cost ceilings, automatic instance termination, and a durable result receipt.

## Sealed result

The single authorized cloud run passed:

```text
semantic minimum-edit programs: 4,095/4,095
coordinate interventions: 471,040/471,040
equal-admissibility pairs: 180,899/180,899
fixed hash control: 31/4,095
witness-masked control: 0/4,095
tool-only control: 0/4,095
semantic capacity: 64 bytes
hash-control capacity: 80 bytes
```

The execution took 298 instance-seconds and an estimated $0.000860888889 of
EC2 compute. The instance terminated automatically. The result digest is
`6a41d18ddfa1cac4`; the full receipt is in
[`benchmarks/reasoner33-dimension-transfer-v1/RESULT.md`](../benchmarks/reasoner33-dimension-transfer-v1/RESULT.md).

This establishes dimension transfer for the bounded, axis-aligned integer-box
family. It does not establish general mathematical reasoning. More independent
coordinates now repeat a solved factorization, so the next gate should change
the relation structure rather than merely increase dimension.

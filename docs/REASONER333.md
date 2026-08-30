# Reasoner (3,3,3): composition transfer

Reasoner (3,3,3) asks whether the small relational behavior found by Reasoner
(3,3) composes. This is an independent branch, not another dimension test.

## Constraint family

Every variable is an integer in `{-1, 0, 1}`. A relation slot exposes six
possible difference atoms:

```text
x_child - x_parent <= c
x_parent - x_child <= c
c in {-1, 0, 1}
```

The target chooses one atom in each direction, so it fixes the exact offset
between the two variables. A module is a path of these exact-offset relation
slots. A bridge is the same kind of relation, but it joins the last variable
of one module to the first variable of the next module.

The verifier enumerates the complete finite integer state space. It returns a
target state rejected by the candidate, or a candidate state rejected by the
target plus its nearest target-safe repair. A trace is exact only when the
candidate and target accept the same states. It is minimum only when it uses
exactly two edits per relation slot.

## Frozen progression

| Stage | Modules | Width | Variables | Programs | Access |
| --- | ---: | ---: | ---: | ---: | --- |
| Training | 1 | 2 | 2 | 3 | open |
| Development | 2 | 2 | 4 | 15 | open |
| Sealed | 3 | 3 | 9 | 63 | one cloud run |

Training contains only isolated modules. It contributes six exact decisions:
two relation atoms for each of the three possible offsets. The development
stage adds a bridge and checks every nonzero four-bit label program. It cannot
call the sealed generator.

The sealed stage changes both forms of composition: it has more modules, and
each module is larger than any training or development module. Its six-bit
program code supplies labels 0 through 5. The remaining labels are frozen as
`b0 xor b3`, `b1 xor b4`, and `b2 xor b5`. Programs 1 through 63 are all used.

## Learned arm and controls

The learned arm is a 16-weight, 64-byte integer scorer. Its features describe
only the proposed relation, whether it is added or removed, and its exact
slack on the verifier states. They do not contain variable identities, module
identities, or a bridge flag.

The controls are:

- a 64-byte lookup table fitted to exactly the same six training decisions;
- bridge-masked feedback, which hides repair semantics only for bridge edits;
- module-only actions, which cannot edit a bridge; and
- tool-only ranking, which receives the legal edit set but no witness meaning.

Four frozen variable relabelings are run for every semantic program: rotation,
reversal, adjacent swaps, and even-then-odd numbering. Every relabeled trace
must remain minimum.

## Gates

Development must solve all 15 programs and all 60 relabeling interventions
with minimum traces. Both compact arms must fit all six isolated-module
training decisions, and each active artifact must remain 64 bytes.

The sealed gate passes only if:

- the semantic arm solves all 63 programs with minimum traces;
- all 252 sealed relabeling interventions remain minimum;
- the lookup, bridge-masked, module-only, and tool-only controls each fail to
  reach 63 minimum traces; and
- no weights or rules change after the sealed family opens.

A scientific failure is final and must be recorded. Language training stays
out of scope regardless of the result.

## Commands

The local commands below stop at development and report
`"sealed_family_opened": false`:

```sh
make reasoner333-check
./reasoner333 development
```

The result command is reserved for the immutable cloud source archive:

```sh
R333_SEAL_APPROVAL_ID=reasoner333-composition-seal-2026-08-30-v1 \
  ./reasoner333 sealed-run result.json
```

The cloud launcher adds a one-run object lock, a source digest, a hard time
and cost ceiling, automatic termination, and a durable result receipt. Do not
run the sealed command during development.

The frozen implementation source is commit
`f7465586b0133b82c6627162b75df5a28d25883b`. The cloud contract permits one
`t3.micro` instance for at most 900 seconds and at most $0.003 of EC2 compute.

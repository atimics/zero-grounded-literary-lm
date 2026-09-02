# Reasoner (3,3,4): counterexample-order robustness

Reasoner (3,3,4) tests whether a policy depends on the verifier returning one
preferred counterexample. Reasoner (3,3) used a deterministic nearest-boundary
witness. A policy could learn that selection habit instead of learning how the
witness relates to the hidden constraint.

This branch keeps the same exact integer-box task but changes the witness
channel. At each step of a fixed minimum-length target prefix, it enumerates
every state that satisfies the current hypothesis and violates the target. The
verifier may return any one of those negative counterexamples. Its accompanying
target state is the exact nearest safe state.

The policy must choose a target edit for every such counterexample. If every
decision is correct, any counterexample order produces a minimum-length trace
along the frozen prefix.

## Frozen split

| Dimensions | Programs | Use |
| ---: | ---: | --- |
| 1 | 7 | training |
| 2 | 63 | training |
| 3 | 511 | complete development gate |
| 4 | 4,095 | sealed cloud test |

Training enumerates all valid counterexample sources in 1D and 2D. After the
3D development gate passes, the final model may train on the same complete 3D
census. The 4D counterexample census is first opened by `sealed-run` in cloud.

## Controls

All learned controls use the same 64-byte array:

- the semantic policy trains on every allowed counterexample source;
- the canonical-witness control is the Reasoner (3,3) learner, trained only on
  the deterministic verifier stream;
- the witness-masked control sees the exact legal-action set but not the
  source or target state; and
- the tool-only control uses the canonical legal-action tie break.

The semantic branch passes only if it is exact, all coordinate relabelings are
exact, and every control fails the complete sealed gate.

## Development result

The sealed dimension remained closed. The 1D/2D learner converged with two
updates and two nonzero weights:

```text
[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
```

The complete 3D development result is:

```text
semantic decisions: 101,436/101,436
robust programs: 511/511
coordinate relabelings: 9,600/9,600
canonical-witness control: 67,576/101,436 decisions; 63/511 programs
witness-masked control: 19,253/101,436 decisions; 0/511 programs
tool-only control: 19,253/101,436 decisions; 0/511 programs
```

## Run it

Local commands stop before 4D:

```sh
make reasoner34-witness-check
./reasoner34_witness development
```

The command below is reserved for the immutable cloud execution:

```sh
./reasoner34_witness sealed-run result.json
```

This is a robustness intervention inside one bounded task family. It does not
test a new constraint language or non-monotonic planning; those are separate
fan-out branches.

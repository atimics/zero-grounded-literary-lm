# Reasoner-3: exact invariant synthesis from counterexamples

Reasoner-3 is the next nonverbal experiment after the Cartan repair line. It
does not tune Reasoner-2. It changes the task so the hidden object cannot be
read from the input shape.

The design follows the teacher/learner split in Garg, Neider, Madhusudan, and
Roth's [ICE invariant-learning
work](https://madhu.cs.illinois.edu/popl16.pdf): a verifier teaches through
positive, negative, and implication counterexamples. The causal test borrows
the experimental idea, not the neural architecture, of [interchange
interventions](https://proceedings.mlr.press/v162/geiger22a.html): swap the
putative cause while holding the rest of the input fixed, then require the
predicted action to change in the specified way.

The verifier owns a bounded integer transition system. The learner sees only:

- its current conjunction of integer inequalities; and
- one structured counterexample from the verifier.

The learner selects one inequality to add or remove. It never sees the hidden
safe-state set, transition table, target invariant, program index, or a
language label.

```text
current invariant
       |
       v
 exact hidden verifier ----> positive / negative / implication witness
       ^                                      |
       |                                      v
       +----------- one integer edit <--- learned policy
                                              |
                                    accepted Answer IR
                                              |
                                              v
                                      language.render
```

## Exact world

The state is `(x, y)` with both coordinates in `[-2, 2]`. The hypothesis
language has twelve axis-aligned integer inequalities. Programs use one to
four irredundant atoms, which defines the four curriculum stages.

Each program cycles through every safe state. Unsafe states self-loop. This
construction gives an exact contract: an accepted inductive safe invariant has
the same semantic state set as the hidden target.

The verifier checks in this order:

1. the initial state is included;
2. no unsafe state is included; and
3. every included transition ends in an included state.

It returns a positive, negative, or implication witness. A negative witness
contains the closest unsafe state admitted by the hypothesis and its nearest
safe boundary state. The pair is local evidence, not the target program. An
early implementation returned only the unsafe point; exact corpus generation
proved that observation was insufficient because identical observations could
require disjoint shortest edits. The runtime rejects such ambiguous training
contracts instead of silently picking a label.

There are 168 hidden programs and 6,428 repair states. An exact breadth-first
search over all 4,096 hypotheses supplies minimum-edit labels. There is no
learned reward model and no floating-point test.

## Learned policy

The policy is an integer perceptron over 65,536 sparse features. It scores the
twelve possible atom flips from the current hypothesis and counterexample.
Features do not contain program identity, the hidden target, or the verifier's
irrelevant nonce. Coordinate exchange is canonicalized, so swapping `x` and
`y` must swap the chosen action exactly.

Training promotes stages one through four only after the cumulative action
set separates exactly. Each curriculum prefix is rebuilt and normalized on
its own, so stage-4 labels cannot alter stage-3 targets. The final supervised
result is:

```text
programs: 168
repair states: 6,428
positive witnesses: 2,868
negative witnesses: 2,968
implication witnesses: 592
minimum-edit repairs: 6,428/6,428
repeated hypotheses: 0
```

This final result is supervised replay. It is not the generalization claim.

## Frozen causal experiment

The policy is frozen after stage 3 and evaluated on every stage-4 repair state
before any stage-4 labels are shown.

The causal checks are:

- **No-feedback ceiling.** On the ambiguous common start state, the best fixed
  first action can be correct on at most 50.0% of cases.
- **Witness interchange.** There are 396 pairs with disjoint correct action
  sets. Exchanging the witness must exchange the selected edit.
- **Irrelevant swap.** Changing only the verifier nonce must never change an
  edit.
- **Coordinate permutation.** Swapping `x` and `y` must swap every edit.

Frozen stage-4 results:

```text
cases solved: 1,740/1,740
minimum-edit repairs: 1,738/1,740 (99.8%)
blind first-action ceiling: 50.0%
trained blind first-action result: 0.0%
witness-interchange pairs passed: 396/396
irrelevant swaps passed: all
coordinate permutations passed: all
exact causal gate: false
```

This is a useful no-go. Counterexamples control the action on the direct
intervention test, and the learner solves every unseen program, but two traces
use an extra edit. The conjunctive gate therefore fails. Do not describe the
fully supervised 6,428/6,428 replay as unseen reasoning, and do not compress or
attach a language model on the strength of this run.

## Sealed output

`language.render` accepts only an intact Answer IR that passes the hidden
verifier again. The learner cannot call it during repair. It turns an already
accepted atom mask into a sentence; it does not help choose the mask.

## Run it

```sh
make reasoner3-check
./reasoner3 demo
./reasoner3 train /tmp/reasoner3.r3p 4
./reasoner3 eval /tmp/reasoner3.r3p 1 4
./reasoner3 ablate /tmp/reasoner3.r3p 1 4
./reasoner3 render /tmp/reasoner3.r3p 167
```

The self-test freezes the program census, witness census, learned weights,
holdout result, interventions, artifact replay, and the rule that language is
unavailable before sealing.

## Next gate

The two non-minimal traces were one error under an `x`/`y` swap: each first
edit failed to resolve the current positive witness. The witness already held
enough information, so bounded history was not added. A 2D axis-aligned box
also cannot supply a stage-5 target because four irredundant sides is its
maximum.

Reasoner (3,1) implements the exact witness-progress action contract and moves
the untouched generalization test to 3D boxes. It passes all 6,066 stage-5
development cases and all 1,674 sealed stage-6 cases minimally. See
[`REASONER31.md`](REASONER31.md).

# Reasoner (3,1): progress-constrained 3D invariant synthesis

Reasoner (3,1) tests the smallest explanation of the Reasoner-3 holdout miss.
Both failed traces had enough information in the current positive witness. The
policy nevertheless added a redundant inequality before removing the
inequality that excluded the required state. The two errors were the same
policy rule under an `x`/`y` swap.

Reasoner (3,1) therefore does not add memory. It makes immediate witness progress
part of the action contract:

```text
candidate edit is legal
    iff
the edited hypothesis resolves the current counterexample
```

The exact tool computes this legal-action set. The learned integer policy still
ranks the legal edits. This is not an answer oracle: most decisions retain
multiple legal choices, and a deterministic tool-only policy performs poorly.

## New exact world

The 2D Reasoner-3 world ends at stage 4 because an irredundant rectangle has at
most four sides. Reasoner (3,1) moves to three dimensions instead of inventing an
impossible fifth 2D stage.

The state is `(x, y, z)` with every coordinate in `[-2, 2]`. Each coordinate
has four useful integer bounds, for twelve atoms total. The complete finite
world contains:

```text
125 states
4,096 possible hypotheses
511 irredundant hidden box programs
```

The exact program census is:

| Stage | Programs | Use |
| ---: | ---: | --- |
| 1 | 12 | training |
| 2 | 57 | training |
| 3 | 136 | training |
| 4 | 171 | training |
| 5 | 108 | development holdout |
| 6 | 27 | sealed test |

Each safe set is one exact 125-bit value. A program cycles through all of its
safe states while unsafe states self-loop. The verifier returns positive,
negative-boundary, or implication witnesses. Minimum edit distance is computed
by exact breadth-first search over all 4,096 hypotheses.

Curriculum prefixes are generated and normalized independently. Later labels
cannot change earlier training targets. Program identity, safe states,
transitions, target masks, and stage-5/6 labels are absent from policy
features.

## Model and symmetry

The learner is one integer perceptron over 131,072 sparse features. It sees the
current hypothesis and one verifier witness. Every feature and tie break is
canonicalized over all six permutations of `x`, `y`, and `z`.

Training stages 1 through 4 use exact minimum-edit targets. Stage 5 is opened
only after stage 4 training. Stage 5 must pass before its labels may be used to
train the stage-5 policy. Stage 6 is then opened once as the final untrained
test. Stage-6 labels are never used for training.

Here, sealed means withheld from fitting and from architecture selection before
the first evaluation. After that first pass, the exact result is intentionally
replayed by the repository self-test; it is no longer claimed as a fresh test
on each run.

## Results

The stage-5 development gate passed:

```text
minimum-edit repairs: 6,066/6,066
seen learner observations: 2,583/2,583 minimal
unseen learner observations: 3,483/3,483 minimal
legal decisions with multiple choices: 8,100/10,368
ranker-witness-masked: 3,381/6,066 minimal
progress-tool-only: 619/6,066 minimal
no feedback and no progress tool: 119/6,066 minimal
equal-admissibility witness pairs: 932/932 passed
```

Only after that pass, the sealed stage-6 test was opened. It also passed:

```text
minimum-edit repairs: 1,674/1,674
seen learner observations: 711/711 minimal
unseen learner observations: 963/963 minimal
legal decisions with multiple choices: 2,295/2,862
ranker-witness-masked: 1,189/1,674 minimal
progress-tool-only: 139/1,674 minimal
no feedback and no progress tool: 30/1,674 minimal
equal-admissibility witness pairs: 27/27 passed
all six coordinate permutations: exact
irrelevant nonce changes: exact
repeated hypotheses: 0
unresolved edits: 0
```

An equal-admissibility pair has the same hypothesis, the same legal-action set,
and disjoint correct actions. Only the witness differs. A witness-masked ranker
must choose the same action for both sides and therefore cannot pass both. The
full policy passes every such pair; the masked policy passes both sides of
zero pairs. This separates learned witness use from the exact progress tool.

The training prefix through stage 5 has 22,276 cases: 9,123 positive, 11,485
negative, and 1,668 implication cases. Training converges in nine deterministic
epochs with 31 updates and zero final supervised action errors.

## What this establishes

This is a pass for the bounded experiment:

- the exact action contract prevents verifier-ignoring edits;
- the learned ranker is still necessary among legal edits;
- witness changes cause different actions even when the legal set is fixed;
- the policy composes to programs with more constraints than any training
  target; and
- the complete action trace is exact under every coordinate permutation.

It is not a claim about general program verification, continuous geometry, or
natural-language reasoning. The hypothesis language remains finite and small.

## Sealed language boundary

The language renderer remains a final tool. It accepts only an intact Answer
IR, reruns the hidden verifier, and formats the already accepted conjunction.
It has no role in selecting edits.

## Run it

```sh
make reasoner31-check
./reasoner31 demo
./reasoner31 train /tmp/reasoner31.r31p
./reasoner31 eval /tmp/reasoner31.r31p 6 full
./reasoner31 eval /tmp/reasoner31.r31p 6 ranker-masked
./reasoner31 eval /tmp/reasoner31.r31p 6 tool-only
./reasoner31 eval /tmp/reasoner31.r31p 6 none
./reasoner31 render /tmp/reasoner31.r31p 510
```

## Next gate

Reasoner (3,2) now completes this gate. Its 87-byte sparse policy reproduces
every action in the full finite world and every start-to-finish trace exactly.
See [`REASONER32.md`](REASONER32.md). Language training remains out of scope;
only the deterministic final renderer is permitted.

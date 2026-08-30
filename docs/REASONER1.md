# Reasoner-1: learned Cartan proposal search

Reasoner-1 replaces Reasoner-0's deterministic proposal filter with a learned
structured policy. The exact verifier, canonicalizer, Answer IR, and language
boundary do not change.

The model does not emit a type name. It decides whether a discrete graph action
is worth sending to the verifier:

```text
canonical accepted diagram
          |
          v
all attach(node, directed_bond) actions
          |
          v
four graph-message rounds + last verifier failure
          |
          v
learned integer score ----skip----> next action
          |
       propose
          v
exact cartan.verify ----counterexample----> recurrent failure state
          |
       accepted
          v
canonical rank census
```

Language is absent from this loop.

## Model

The action space has five directed crystallographic bonds:

```text
(-1,-1)  (-1,-2)  (-2,-1)  (-1,-3)  (-3,-1)
```

For each current node and bond, the runtime constructs the candidate and
canonicalizes it before scoring. Relabelings therefore do not create reward.

The encoder performs four deterministic graph-message rounds. Each node starts
from its directed incident-bond signature. Every round mixes the sorted colors
of its neighbors with the incoming and outgoing multiplicities. The sparse
feature set also includes:

- the selected node's recurrent color;
- graph-wide recurrent color multisets;
- distance and degree structure around the attachment;
- the directed bond action; and
- the last exact verifier failure.

There is no full-matrix identity feature and no type-label feature. Removing
rank-specific identities is what allows the rank-7 model to continue the `B`
and `C` families at rank 8.

The learned head is one integer perceptron with 65,536 signed 32-bit weights.
Scores and updates use integer arithmetic. This is an unquantized mechanics
baseline: there is no distillation, low-bit packing, or language loss.

## Training

Reasoner-0 mechanically creates the canonical action corpus through rank 8:

```text
583 structured action examples
30 accepted non-seed actions
553 exact negatives
45 affine determinant-zero negatives
0 language targets
```

Ordinary negatives have weight 1, positives weight 4, and affine negatives
weight 8. The higher affine weight is part of the policy training, not only an
evaluation statistic.

Training promotes one rank at a time. A stage may advance only when:

1. every cumulative structured example is separated;
2. learned rollout recovers the exact known types through that rank;
3. raw proposal precision is 100%; and
4. canonical recall is 100%.

The model receives verifier outcomes and action labels, but never `A8`, `E8`,
or another type name. Type names exist only in the external census evaluator.

## Results

The deterministic training run currently reports:

```text
curriculum promotions: 7
training errors: 0
final rank-8 accepted census: 31/31
final raw proposal precision: 100%
final canonical recall: 100%
verifier calls: 30 of 432 canonical action opportunities
invalid final verifier calls: 0
```

The more important check freezes the model after rank 7 and rolls it forward to
rank 8 before showing it any rank-8 labels:

```text
rank-8 types found: A8, B8, C8, D8, E8
held-out canonical recall: 100%
held-out raw proposal precision: 96.7%
held-out invalid proposals: 1
exact precision and recall: false
```

This is a useful generalization signal and a failed exact gate. The final exact
result is supervised curriculum performance; it must not be described as
unseen discovery.

## Run it

Build and test both the learned proposer and the unchanged exact verifier:

```sh
make reasoner1-check
```

Train and save an exact rank-8 artifact:

```sh
./reasoner1 train /tmp/reasoner1.r1p 8
```

Reload it and run the independent census evaluator:

```sh
./reasoner1 eval /tmp/reasoner1.r1p 8
```

Or print the training, holdout, and final results without keeping an artifact:

```sh
./reasoner1 demo
```

Only a model that reruns its complete learned rollout at exact precision and
recall may be saved. Loading reruns the same gate, so changing the artifact
cannot bypass verification.

## Compression gate

Compression is blocked. The first compression experiment may start only after
an unseen-rank rollout reaches both 100% precision and 100% recall without type
labels. A compressed candidate must then preserve:

- every proposed canonical matrix;
- every verifier call and counterexample;
- every accepted rank census;
- action order; and
- every sealed Answer IR produced downstream.

The comparison must be exact, not statistically close.

Reasoner-2 now implements the next repair experiment described by this gate.
It learns minimum graph edits from exact counterexamples, but its masked-
feedback ablation remains too strong. See [`REASONER2.md`](REASONER2.md).

## Scope

- This is a learned graph-action proposer, not a language model.
- Exact supervised rank-8 performance does not prove general reasoning.
- The rank-7-to-rank-8 holdout is promising but fails the precision gate.
- No base-model training, model promotion, distillation, or quantization is
  authorized by this result.

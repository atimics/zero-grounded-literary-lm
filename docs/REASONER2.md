# Reasoner-2: counterexample-conditioned repair

Reasoner-2 tests whether exact verifier feedback can steer a learned repair
policy. It starts from a rejected Cartan matrix, sees the verifier's structured
failure, and may make at most two graph edits before asking the verifier again.
Language remains outside the reasoning loop.

```text
rejected Cartan matrix + exact failure
                  |
                  v
       four graph-message rounds
                  |
                  v
      learned integer action score
                  |
          delete node or set bond
                  |
                  v
          exact cartan.verify
             |             |
          accepted      counterexample
             |             |
             v             +----> next repair step
       sealed Answer IR
             |
             v
       language.render tool
```

## Repair space and exact teacher

At each step the policy may:

- delete one node; or
- set one node pair to no bond, a single bond, either orientation of a double
  bond, or either orientation of a triple bond.

The runtime enumerates this finite action space to compute the true minimum
repair distance. A one-edit solution is always preferred to a two-edit
solution. Training labels come from the exact verifier and minimum-distance
search, not from a language model or learned judge.

The corpus has 267 canonical rejected inputs:

```text
241 one-edit cases
26 two-edit cases
52 affine determinant-zero cases
0 language targets
```

It includes product-5 bonds, disconnected diagrams, two independent bad
bonds, affine leaf extensions, affine cycles, and affine A1. Canonicalization
happens before deduplication, and directed bonds remain directed.

## Model and feedback

The model is one integer perceptron over 65,536 sparse features. Four fixed
graph-message rounds encode local structure around each candidate edit.
Features also expose the exact verifier observation:

- failure kind;
- failing row and column;
- failing principal-minor mask;
- determinant sign; and
- the last verifier result in a multi-step repair.

There is no natural-language target, Lie type label, or full-matrix identity
feature. Invalid bond products are represented by one generic class so the
policy cannot memorize a particular bad magnitude.

Training promotes one rank at a time from rank 2 through rank 8. A stage passes
only when every cumulative case is repaired with the minimum number of edits,
without repeated states.

## Results

The final supervised curriculum is exact:

```text
cases solved: 267/267
minimum-edit repairs: 267/267
verifier calls: 293
repeated states: 0
excess edits: 0
```

The important test freezes the policy after rank 7 and evaluates rank 8 before
showing any rank-8 repair labels:

```text
rank-8 cases solved: 69/69
minimum-edit repairs: 66/69 (95.6%)
repeated states: 0
exact holdout gate: false
```

Masking every verifier-feedback feature gives:

```text
rank-8 cases solved: 66/69 (95.6%)
minimum-edit repairs: 63/69 (91.3%)
feedback-ablation collapse: false
```

Feedback helps: it recovers three additional cases and three additional
minimum repairs. But the masked policy remains strong, so graph shape still
does most of the work. This fails the causal-use gate. The result does not
show that the policy learned to reason from counterexamples, and it does not
authorize compression.

The frozen numbers above are regression-tested. The final exact supervised
score must not be presented as unseen generalization.

## Run it

Build the runtime and run all repair regressions:

```sh
make reasoner2-check
```

Train and save the rank-8 model:

```sh
./reasoner2 train /tmp/reasoner2.r2p 8
```

Evaluate with normal feedback or with those features masked:

```sh
./reasoner2 eval /tmp/reasoner2.r2p 2 8
./reasoner2 ablate /tmp/reasoner2.r2p 2 8
```

Or run training and the final supervised evaluation without keeping an
artifact:

```sh
./reasoner2 demo
```

## Next gate

Do not tune against the rank-8 holdout. The next experiment needs new repair
families whose correct first edit cannot be chosen from graph shape alone.
Freeze those cases before training, then require both exact minimum repair and
a large preregistered failure when counterexample fields are masked. Only then
test whether the successful trace can be compressed without changing actions,
verifier calls, or sealed answers.

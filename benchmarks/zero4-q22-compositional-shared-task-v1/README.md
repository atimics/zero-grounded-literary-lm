# Q22 compositional routing shared task

This is the shortcut-resistant successor to `zero-solomon.q22-operation.v1`.
It tests whether a proposer can route five quantity operations from held-out
sentence forms instead of learning a different command prefix for each class.

Every input starts with the same four tokens. Each input also contains a
balanced background sentence about the wrong operation. The actual case comes
after that distractor. Training and promotion use separate template families
and separate normalized sentence surfaces. Literal `quantity.*` operation
identifiers never appear in the model input.

The five target classes are exactly balanced, so a classifier that only reads
the shared prefix scores exactly 20%. Distractor classes are also balanced for
each target class. This removes both the old first-token shortcut and a simple
distractor-frequency shortcut.

The contract freezes 10,000 training records, 1,000 promotion records, seed 23,
all source hashes, and all generated data hashes. Generate the files and check
the frozen surface with:

```sh
make zero4-q22-compositional-shared-task-check
```

The allowed claim is narrow: successful held-out paraphrase routing under a
balanced distractor. This task does not test arithmetic execution, open-ended
language quality, or general reasoning.

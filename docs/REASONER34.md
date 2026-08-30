# Reasoner (3,3,1): relational graph transfer

Reasoner (3,3,1) asks whether the small policy from Reasoner (3,3) can move
from independent bounds to relations between variables. This is a new
structural test, not a larger box test.

Each atom is an integer difference constraint:

```text
x_i - x_j <= c, where c is -1, 0, or 1
```

The variables range over `[-2, 2]`. The relation graph is a tree. Each tree
edge chooses one of six relations: either direction and one of the three
constants. The verifier checks the full finite integer domain, so acceptance
is exact rather than sampled.

## Frozen split

| Stage | Graph families | Programs | Role |
| --- | --- | ---: | --- |
| Train | 2-node path, 3-node path | 42 | policy fitting only |
| Development | 4-node path, 4-node star | 432 | complete local gate |
| Sealed | 5-node path, 5-node star, 5-node fork | 3,888 | one cloud run |

Training includes exact subgraphs of every training target and wrong extra
relations. It produces 426 verifier decisions. Development changes both size
and topology. No development or sealed decision is added to training.

The sealed fork has degree sequence `3,2,1,1,1`. It is absent from both
training and development. The sealed path and star separate size transfer
from topology transfer.

## Exact minimum

A target contains one relation for each tree edge. The action vocabulary is
limited to relations on those same edges. Removing an edge separates the tree
into two components, and no action on another edge crosses that cut. An exact
answer therefore needs at least one edit per edge. The target itself reaches
that lower bound, so the required minimum is exactly `|E|` edits.

The verifier returns either:

- a target-safe state rejected by the candidate; or
- a candidate-safe state that violates the target, paired with a repaired
  target-safe state.

For a missing relation, the verifier constructs the second witness by moving
one whole side of the tree cut. Internal differences stay unchanged. The
shared policy learns to select the unique edge relation that is tight after
the repair and violated before it. Its 16 signed weights occupy 64 bytes and
contain no variable or edge identity.

## Controls and interventions

Every arm receives the same exact verifier and the same witness-resolving
action set.

- The fixed hash arm has the same 16 signed weights and the same 64-byte
  capacity. Its features hash the complete finite context.
- The witness-masked arm keeps the learned policy but hides both witness
  states.
- The tool-only arm ranks no legal edit; it uses only the deterministic action
  order.

For the semantic arm, every selected edit is repeated under every vertex
relabeling. Development therefore requires 31,104/31,104 exact transformed
actions. A passing sealed run requires 1,866,240/1,866,240.

## Local gate

```sh
make reasoner34-check
./reasoner34 development
```

The local commands report `sealed_graphs_opened:false`. They do not call the
five-variable suite.

The frozen development result is:

```text
training decisions: 426
training mistakes: 1
final training errors: 0
semantic minimum traces: 432/432
vertex relabelings: 31,104/31,104
fixed hash minimum traces: 2/432
semantic capacity: 64 bytes
hash capacity: 64 bytes
```

## Sealed command

Only the one-run cloud runner may use:

```sh
R34_SEALED_EXECUTION=cloud \
R34_EXECUTION_LOCK=execution.lock \
./reasoner34 sealed-run result.json
```

The command atomically claims the lock before opening a sealed graph. A
scientific failure is recorded and is not retried. The cloud instance must
terminate after it uploads the result, regardless of the gate outcome.

Passing requires all 3,888 semantic traces and all 1,866,240 relabelings to be
exact, while the hash, witness-masked, and tool-only arms must each fail the
complete sealed gate. The semantic policy must not exceed the hash arm's
64-byte capacity.

This experiment can support a narrow claim about reusable difference-relation
selection on bounded trees. It cannot establish transfer to cycles, larger
integer domains, arbitrary constants, or general theorem proving.

# Reasoner (3,4) joint substrate preregistration

## Question

Can one 64-byte linear policy retain three previously separate reasoning
abilities without a task label or a policy switch?

The shared weight vector is scored through each domain's frozen action-feature
adapter. The adapters expose state/action relations but do not add a task bit,
select a weight bank, or alter weights at inference time.

## Open development screen

Training uses only the already-open small curricula:

- courier planning with one through three gates,
- isolated two-variable relation modules, and
- counterexample-order training through two dimensions.

Five arms are frozen:

1. planning plus composition,
2. planning plus witness reasoning,
3. composition plus witness reasoning,
4. all three, cycled through all six task orders, and
5. all three sequentially with no replay.

Every learned arm has exactly sixteen signed 32-bit weights (64 bytes). The
three independent 64-byte policies form a 192-byte positive control. A zero
weight vector is the negative control.

The local screen passes only if every pairwise arm and the cyclic three-way arm
have zero training errors and exact development behavior, the independent
control passes, the zero control fails all tasks, and the sequential arm is
reported separately rather than used to define success.

## Sealed combinations

The seal is opened once, in the cloud, only after the development screen and
source freeze pass. It contains three new combinations:

- all 40,320 labelings of an eight-gate courier world,
- 63 four-module, width-two relation programs with four exact relabelings each,
- every allowed negative source paired with every equally nearest valid repair
  in all 4,095 four-dimensional witness programs, plus frozen coordinate
  permutations.

The eight-gate world, four-module topology, and alternate nearest-repair choice
were not evaluated by the earlier seals.

The sealed gate passes only if the same cyclic three-way 64-byte vector is
exact on all three slices. Partial success is recorded but is a no-go.

## Interpretation

A pass supports a shared reasoning substrate across these three finite domains.
It does not show language ability, neural scaling, or unrestricted task
transfer. A failure identifies representation interference and is final; there
is no retry or post-seal tuning.

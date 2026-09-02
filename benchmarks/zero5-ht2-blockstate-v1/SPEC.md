# ZERO.5 HT2 BlockState pilot

## Status

**Preregistered; implementation and training are not authorized.** This file
does not authorize either required arm, paid compute, a retry, replication,
promotion, publication, or sealed-test access.

## Question

Does a small causal state that carries information across completed token
blocks improve long-range retrieval more than a parameter-matched state that
sees only the immediately completed block?

## Fixed block boundary

Blocks contain eight active language tokens. Block counting restarts at every
document or record attention reset. Padding does not belong to a block. A
partial final block may produce a summary but cannot cross a reset.

For block `k`, the last active hidden vector is `h[k]`. Both arms use a
128-wide state and a zero-initialized projection into the next block's token
states. The first block receives the exact zero state.

## Parameter-matched control

The local control uses only the immediately completed block:

```text
u[k] = tanh(W_h h[k])
s[k] = tanh(W_h h[k] + W_s u[k] + b)
```

`s[k]` may condition block `k+1`, then it is replaced. It cannot carry older
state directly.

## Recurrent treatment

The treatment changes only the second source term:

```text
s[k] = tanh(W_h h[k] + W_s s[k-1] + b)
```

The same `W_h`, `W_s`, bias, output bridge, parameter count, initialization,
block boundaries, and training recipe are used in both arms. A completed block
can affect only later blocks. Current or future block tokens cannot affect an
earlier logit.

Each arm adds exactly 82,048 parameters:

```text
128 * 256        completed-block projection
128 * 128        local or recurrent state projection
128              state bias
256 * 128        zero-initialized output bridge
---------------
82,048
```

## Control and accounting

Both new seed-0 arms start independently from the same selected C2 checkpoint
with fresh optimizer state. They consume the exact C5.1 grouped schedule once.
Neither arm may initialize from HT1, C6.1, the other arm, or a pilot checkpoint.

The comparison is treatment versus the parameter-matched local control. C5.1
is reported as a historical flat reference but is not a substitute for the
new control arm.

## Gates

All gates are conjunctive:

| Gate | Requirement |
| --- | --- |
| Retrieval choice | Treatment at least 2 points above local control |
| Retrieval pair exact | Treatment at least 2 points above local control |
| Orientation | Each treatment orientation at least 50% |
| Orientation gap | At most 15 points |
| Swap consistency | At least 94% |
| Distance evidence | Treatment improvement is non-negative in every preregistered evidence-distance band |
| Combined language | Treatment no more than 0.03 nats/token worse than local control |
| Task preservation | Claim accuracy loses at most 2 points; cloze is reported |
| Retention | Existing evidence, Atlas, and C1 anchor limits pass |
| Mechanics | Reset, padding, causality, finite-gradient, and bridge-off checks pass |
| Compute | Each arm stays at or below 1.15 times the flat reference |
| Test | Test content and metrics remain unopened |

A pass supports a temporal level above flat tokens. A failure rejects this
fixed eight-token, 128-wide recurrence; it does not reject MergeTree or an
explicit answer root.

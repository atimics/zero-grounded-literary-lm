# ZERO.4-Q2.6-R family replication preregistration

## Status

Frozen before seeds 1 and 3 are executed. The source contract, checker,
aggregation rule, and both downstream experiment registrations must merge before
either result is observed.

The [execution-venue addendum](AWS-EXECUTION.md) requires one ephemeral AWS
`c6i.4xlarge` per seed and quarantines laptop attempts as invalid infrastructure
incidents. It changes no scientific parameter or decision rule.

## Authorization earned by seed 2

Q2.6 seed 2 resolved go from frozen execution commit
`412ab70a7922a8f964a3ab7429dd601ba0250383`. It committed 700/700 full-scale
updates, selected a jointly feasible public checkpoint, and passed the disjoint
promotion split exactly once. The published result and quantized model are
content-pinned in `contract.json`.

This result opens only the declared replication seeds. It does not promote
ZERO.4 by itself.

## Frozen replication design

- Authorized seeds are exactly 1 and 3. Seed 2 is not rerun.
- The Q2.6 global all-six-slice replay-tangent projection is unchanged.
- ZERO.3 initialization, teachers, quantity corpus, replay slices, optimizer,
  budgets, learning rates, geometric retry scales, checkpoint cadence, and stop
  rules are inherited from the diagnostic contract.
- The 1.5% direct cumulative commit authority, 2% public replay ceiling, all
  quantity gates, and exactly-once promotion evaluation are unchanged.
- Each seed is an independent prospective run. Both seeds execute even if the
  first resolves no-go; early family stopping is forbidden.
- A completed non-passing seed is valid no-go evidence. Execution or envelope
  failures are recorded separately and never coerced into no-go.

## Frozen family decision

The family resolves go if and only if seeds 1, 2, and 3 all resolve go. Only
that conjunction makes ZERO.4 promotion eligible. The already-selected seed-2
model is the frozen promotion candidate; replication models cannot replace it
through post-hoc selection.

If either replication seed is no-go, the family is no-go and ZERO.3 remains
current. Aggregation waits for both declared replication results in all cases.

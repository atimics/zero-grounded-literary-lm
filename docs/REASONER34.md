# Reasoner (3,3,2): non-monotonic planning

Reasoner (3,3,2) asks whether a compact learned policy can make a necessary
temporary regression. It changes the task structure after the passing
Reasoner (3,3) dimension-transfer result.

## Exact courier task

A world is a line of `n` gates. The courier starts at position zero without
the cargo. The cargo is beyond gate `n`. Every gate starts closed. The goal is
to return to position zero with the cargo and with every gate closed.

The symbolic actions are:

- toggle an adjacent gate;
- cross an adjacent open gate; or
- collect the cargo at the far end.

The state is `(position, open-gate mask, has-cargo)`. A complete world has
`2(n+1)2^n` states. Reverse breadth-first search from the single goal state
computes an exact distance for every state. The verifier accepts a plan only
when every transition is legal, every step lowers that exact distance by one,
the final state is the goal, and the length equals the initial BFS distance.

The shortest length is `4n+1`: each gate must be opened, crossed outbound,
crossed inbound, and closed, and the cargo must be collected. This lower bound
is achieved. It also proves non-monotonicity. Every valid plan must change all
`n` initially goal-correct closed gates to the wrong open state and restore
them later. The frozen local goal distance increases both when a gate opens
and when the courier moves away from home.

## Learned policy and controls

The shared policy is a 16-weight linear scorer. Its features name relations,
not gate identities: outbound or inbound phase, action kind, open or closed,
and whether an edge is forward, backward, or immediately behind the courier.
It trains on all labelings of the one-, two-, and three-gate worlds.

The comparison arms use the same legal action set and exact verifier:

- `greedy-distance` refuses any step that increases the frozen local goal
  distance;
- `tool-only` chooses the first legal symbolic action;
- `hash` has the same 16 signed 32-bit weights as the semantic policy but
  hashes the complete finite context and action into them; and
- `lookup` gets a fixed 56-byte table, smaller than the 64-byte semantic
  policy, and has no fallback for a missing state.

The hash arm is trained for the same 256-epoch ceiling. Its failure to separate
the small training corpus is recorded rather than hidden. The comparison is a
capacity-matched finite-memory control, not a claim that every possible hash
learner must fail.

## Frozen progression

| Gates | Labelings | Role |
| ---: | ---: | --- |
| 1-3 | 1, 2, 6 | training |
| 4 | 24 | local development gate |
| 5-7 | 120, 720, 5,040 | one sealed cloud run |

The development command evaluates every one of the 24 four-gate relabelings.
It never constructs a five-, six-, or seven-gate oracle. For each renamed
world, the semantic trace must match the identity-labeled physical trace step
for step. This is the gate-label intervention.

The sealed gate opens 5,880 larger, unseen worlds once. A pass requires:

- every semantic plan is BFS-minimal;
- every renamed physical action is unchanged;
- every world contains a measured goal-distance increase;
- every initially correct gate is opened and later restored;
- greedy-distance, tool-only, fixed hash, and bounded lookup do not pass
  exactly; and
- the semantic policy remains within the 64-byte hash budget.

A failed sealed gate is a valid no-go and must be recorded. No tuning or retry
is allowed after opening the sealed worlds.

## Commands and seal

Local development is safe:

```sh
make reasoner34-check
./reasoner34 development
```

Both commands say that the 5-7 gate worlds stayed sealed. The result command
is reserved for the cloud wrapper:

```sh
./reasoner34 sealed-run result.json
```

It refuses to run unless the wrapper supplies a cloud marker, a 40-character
source commit, and a 64-character contract digest. The preregistered contract
also requires one execution lock, a hard time and cost ceiling, source digest
checking, result upload, and automatic instance termination. The fan-out order
and exact bundle approval authorize one capped sealed run with no retry.

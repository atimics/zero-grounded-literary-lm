# Q3.0 seed-2 pilot result

Status: **no-go; no candidate**.

The one-shot pilot bound to source commit
`4d92dd4208a89ed8ad3b6ae36d45643613aa6992` ran the preregistered rank-4
Q-routed adapter through the 200-update ceiling. The selector required an 80%
relative reduction in quantity training loss at the first qualifying
measurement. No measurement qualified, so no public quantity, promotion, or
language gate ran.

## Measurements

| Update | Quantity loss | Relative reduction | Non-Q replay loss |
| ---: | ---: | ---: | ---: |
| 0 | 3.825022638 | 0.0000% | 1.148257500 |
| 50 | 3.760490537 | 1.6871% | 1.148257500 |
| 100 | 3.672551572 | 3.9861% | 1.148257500 |
| 150 | 3.553030193 | 7.1109% | 1.148257500 |
| 200 | 3.395522058 | 11.2287% | 1.148257500 |

The 80% selector required loss at or below `0.765004528`. Update 200 remained
`2.630517530` above that ceiling and achieved only `14.0359%` of the required
reduction. Quantity loss nevertheless decreased at every measurement. The
successive 50-update loss drops were `0.064532101`, `0.087938964`,
`0.119521379`, and `0.157508135`.

## Preservation invariants

- The non-Q replay loss was bit-identical at every measurement.
- The frozen ZERO.3 state digest remained `0af92f28cdc3c69b`.
- The adapter state digest changed at every measurement after update 0.

The parameter-isolation mechanism therefore passed, while the training
recovery requirement failed within the authorized horizon.

## Audit note

The immutable raw terminal event reports `updates_committed: 201`. This is a
logging defect in source commit `4d92dd4`: after completing optimizer updates
1 through 200, the C loop counter advanced once before the terminal event was
written. No update 201 ran, and the last checkpoint and measurement are both
update 200. The raw event was not rewritten. A subsequent source correction
records the committed-update value explicitly and makes the runner reject a
terminal count that differs from the final measurement or exceeds the cap.

## Artifact hashes

- `runtime-budget.json`: `f6da63ffc8b1f23c80d5930132993fab8c4ede504bd13ebb15965604ee24bd34`
- `events.jsonl`: `6a067d50d6c3477fa7e317ee27cd9725dfc6caaa5cdd8090bdf4cbb88368e22d`
- `result.json`: `a77a156931f35a6ce9ccd793ff133ac8ec81757044674beeb523caa36823f20e`
- update-200 checkpoint: `721b48e1a35fcf7e46f0b95b199b27016b84cbd375b5549b6b60f64049ce4592`

The authorization is consumed. Seeds 1 and 3 remain sealed, and no promotion
or deployment is authorized.

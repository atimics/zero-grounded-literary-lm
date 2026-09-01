# ZERO.5 C6.1 evaluation recovery record

## Frozen training state

The corrective-parser authorization
`zero5-c61-shared-state-aws-2026-08-31-v2` produced one fresh run and a later
continuation. Both instances reached the 9,000-second venue ceiling and wrote a
terminal `recoverable` status without `result.json`.

The continuation's synced training log proves that training completed all
28,707 update groups with the frozen accounting:

- 37,768 sampled sequences;
- 19,337,216 compute-token exposures;
- 293,606 auxiliary events;
- zero wraps; and
- 532.00 seconds in the final resumed training segment.

The frozen evaluation input is the selected `best.ckpt` pair under the
continuation prefix
`zero5-c61-aws-20260831-e977b63r1/state/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `best.ckpt` | 58,236,496 | `975a2c2be303147a05a37681d8baa5fd0472dceb36d6715f593826412df54078` |
| `best.ckpt.aux` | 2,316,480 | `9e8426389293368d0bb1bcf5199c6371a22730796fed867c93f08e089533252c` |
| `training.log` | 6,141 | `2961b31e4de4ac9b405512b7f2d9621a5c34a344493aa5e551ce1f483fe78b7e` |

The checkpoint remains private. These digests identify it without authorizing
publication.

## Execution receipts

| Attempt | Terminal state | Seconds | Estimated EC2 USD | Receipt SHA-256 | Status SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| `zero5-c61-aws-20260831-e977b63` | recoverable, no result | 8,842 | 1.670155555556 | `ca18a287dccc8c69d366ce0245267e96b05610fbbf00926f2c22d235e2301e3b` | `11ff2b8144426391ecf09e3326eed0aa3c7c50094e259dfcfa31e36860638b72` |
| `zero5-c61-aws-20260831-e977b63r1` | recoverable, no result | 8,849 | 1.671477777778 | `1c2a93d33e19af668a02356d594b9bd235bdfb750d6faa0e9e759ea997643ec2` | `5ad0e55a52aff950d6393daba2af9c165e938d33725efc0ce9f832453a2cabd3` |

The v2 authorization records exactly one fresh run and explicitly excludes
independent retries. The later continuation is preserved as operational
evidence, but it is not covered by that written scope and cannot authorize any
further execution. The `execution-v6.lock` object proves that it consumed a
separate launch boundary.

Including the earlier v1 attempts recorded in `AMENDMENT-NOTES.md`, cumulative
C6.1 EC2 spend is approximately $5.75. No scientific result exists yet.

## Recovery boundary

Training must not run again. Any recovery must:

1. bind the exact private checkpoint pair and completed training log above;
2. execute only the unchanged frozen validation and bridge-off ablation;
3. cache each atomic evaluation result so an infrastructure timeout cannot
   discard completed scoring work;
4. keep the sealed test, checkpoint, corpus, and raw metrics private;
5. use a separate hash-bound evaluation-only authorization; and
6. produce the original `zero.c61_shared_state_result.v1` decision record or a
   terminal evaluation status without changing a scientific gate.

## Authorized evaluation-only execution

The recovery is frozen in `evaluation-recovery-contract.json` at SHA-256
`dd8e8bed413c551507ba424ee82ba0b6b91403ef4c50c423b1961dcee801cfa0`.
The separate authorization
`zero5-c61-evaluation-recovery-aws-2026-09-01-v1` is bound to that contract and
permits one c6i.4xlarge evaluation for at most 9,000 seconds and $1.70. It
permits zero training updates and no independent retry.

The recovery evaluator runs 18 hash-bound atomic tasks with four workers and
writes each completed task to the private synced cache. It preserves the
original evaluator and scientific contract byte for byte. A final result still
uses the original C6.1 gates and can authorize only a replication request, not
replication or promotion itself.

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
`55f56532f1abb545d3b363c7dbf19a9f162fd163999d05c9ff8440f7fcad5dc5`.
The separate authorization
`zero5-c61-evaluation-recovery-aws-2026-09-01-v1` is bound to that contract and
permits one c6i.4xlarge evaluation for at most 9,000 seconds and $1.70. It
permits zero training updates and no independent retry.

The recovery evaluator runs 18 hash-bound atomic tasks with four workers and
writes each completed task to the private synced cache. It preserves the
original evaluator and scientific contract byte for byte. A final result still
uses the original C6.1 gates and can authorize only a replication request, not
replication or promotion itself.

## Terminal outcome

Run `zero5-c61-eval-20260901-10f8435` completed all 18 atomic tasks in 3,800
instance seconds for an estimated $0.717777777778. The result SHA-256 is
`f08036025f74911e53f5341b35d4844cf49e9261c3599ba134ed7e56072e1d32`.
The frozen decision is no-go. Auxiliary state-learning and retention gates
passed. Retrieval, paired-choice, and bridge-contribution gates failed. The
sealed test stayed closed.

## Cumulative experiment budget and resumable evaluation (issue #196)

The C6.1 AWS envelope (9,000s / $1.70 per instance) is structurally below the
real cycle: ~9,600s training + ~8,700s evaluation ~= 18,300s. Every run hit
the ceiling and paid a continuation tax; because the evaluator had no
checkpoints, every continuation re-ran evaluation from scratch.

The phase profiling to size this correctly already exists
(`zero5-cpu-phase-profile-v1`). A cumulative experiment budget
(`evaluation-budget.json`) is now derived from the measured phase costs:

- **Training phase**: 9,600s wall / $1.81 (measured from two-instance
  continuation: 8,842s + 8,849s, final resumed segment 532s).
- **Evaluation phase**: 8,660s wall / $1.64 (anchored from local duration
  calibration: base arm 1,103s, candidate arm 781s, ablation arm 760s,
  auxiliary 427s; on-instance anchor ratio 2.81x).
- **Full cycle**: 18,260s / $3.45.
- **Cumulative budget**: 18,300s / $3.46 across 3 instances (2 training, 1
  evaluation), replacing the per-instance ceiling as the governing limit.

The evaluator now emits a `zero.c61_evaluation_progress_checkpoint.v1` file
after each atomic task completes. The user-data downloads prior synced state
(including the hash-bound task cache) before starting evaluation, and passes
`--resume-evaluation` when a prior `execution.json` exists without a result.
A `recoverable` termination therefore continues evaluation from the cached
atomic-task checkpoints instead of restarting it.

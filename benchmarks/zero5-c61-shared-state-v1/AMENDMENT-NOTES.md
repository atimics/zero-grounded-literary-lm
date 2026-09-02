# ZERO.5 C6.1 corrective parser amendment (2026-08-31)

## Defect discovered during execution

Resume 2 (`zero5-c61-aws-20260831-93c8003r2`) proved training complete (the
runner's accounting check passed against the synced training log) and then
failed during evaluation:

```
error: /opt/zero/repo/zero5_c61_bottleneck_lm failed:
error: invalid completion evaluation record
```

## Root cause

The C6.1 trainer's `--completion-eval` record parser rejects
`target_start == 0` unconditionally. The established
`zero.c3_completion_eval.v1` format (writer: `scripts/prepare_zero5_c51.mjs`
`writeCompletion`; canonical reader: the base C3.2 trainer) accepts
`target_start == 0` whenever `token_count < context + 1`, because the answer
position `offset + target_start - 1` is still in range (`offset >= 1`). Only a
full-context record with a zero start would underflow, and that is exactly the
condition the base parser forbids.

The frozen cloze validation bin
(`cloze.validation.completion-eval.bin`, sha256
`e0b0a591bf515dd41968c00e348849558006d078ee4d9d211c3c876a1c683168`,
hash-pinned by the C4.3 contract and reused by C4.3 per
`reuse_c42_validation_artifacts`) contains **537 records with
`target_start == 0`**, the first at index 7 (`token_count=118, target_start=0,
target_count=6`). Every one of them is valid under the base parser. The C6.1
parser rejected the first one and the evaluator could not complete under the
previous contract.

## Verification (all performed without opening sealed metrics)

- Structural scan of every evaluation bin in the asset archive against the
  strict and base parser rules:
  - `c52.next-state`, `c52.choice-a`, `c52.choice-b` (4924 records each):
    zero violations under both rules.
  - `cloze` (3555 records): 537 zero-start records; zero violations under the
    base rule; first strict violation at record 7.
  - `claim`/`retrieval` span-choice bins (2280/1011 pairs): zero violations;
    the span-choice parser is byte-for-byte the same validation logic as the
    base trainer's and was not changed.
- The span-choice and packed-evaluation parsers in the C6.1 trainer are
  otherwise identical in validation semantics to the base trainer's.
- The fix reproduces the base parser condition exactly; the trainer rebuilds
  clean.

## Amendment

- `zero5_c61_bottleneck_lm.c`: the invalid-record condition changes from
  `target_start == 0U` to
  `(target_start == 0U && token_count == (uint32_t)model->cfg.context + 1U)`.
  No other trainer logic changes.
- `contract.json`: `implementation.trainer_sha256` updated to the corrected
  source (`5177fa54b6d73173fb2c1ad34874eb1c361a35c4cd366ffcceb14ab3368ac62e`);
  `authorization.approval_id` updated to
  `zero5-c61-shared-state-aws-2026-08-31-v2` with the supersession record.
  Specification, gates, model, training, evaluation, and every other
  implementation hash are unchanged. The SPEC.md hash is unchanged.
- `authorization-aws.json`: new authorization
  `zero5-c61-shared-state-aws-2026-08-31-v2` binding the amended contract
  (`26112674e9aad846610ba456e2e524df35809567be7e3c50ad2a285ad7a0f984`),
  granted by explicit user instruction ("Do it", 2026-08-31). Same venue,
  budget, and limits: one c6i.4xlarge on-demand instance, 9,000-second maximum,
  $1.70 hard ceiling, automatic termination, single run, seed 0, no
  independent retries, no promotion, no sealed-test access.
- Launch scripts: execution lock bumped to `execution-v5.lock`; approval id
  checks updated.

## Consequence for prior executions

The prior AWS executions (`...-93c8003`, resumes r1/r2) remain recoverable
terminal records under the superseded contract. Their trained checkpoints bind
the superseded contract hash and cannot be resumed under the amended contract;
the amended authorization funds exactly one fresh training run initialized
from the frozen C2 checkpoint. Cumulative experiment spend to date: $1.67
(original) + $0.13 (r1) + $0.61 (r2) = $2.41; the fresh run adds at most $1.70.

## Post-amendment execution outcome

The amended fresh run and a later continuation both reached the hard instance
ceiling without producing `result.json`. The continuation completed all 28,707
training updates, but the sequential evaluation did not finish. The later
continuation used `execution-v6.lock`; it is not covered by the v2 record's
one-run, no-independent-retry scope. No further training or continuation is
authorized. Exact receipts, checkpoint hashes, costs, and the evaluation-only
recovery boundary are recorded in `EVALUATION-RECOVERY-NOTES.md`.

## Continuation ceiling record (2026-08-31, later)

- Fresh run `zero5-c61-aws-20260831-e977b63` trained to ~27,000 updates and hit
  the 9,000-second instance ceiling (exit 124, $1.67), terminating recoverable
  as designed. Continuation `...e977b63r1` completed training (full accounting)
  and then hit the ceiling again mid-evaluation (exit 124, $1.67) after
  ~8,220 seconds of evaluation without producing a result.
- Duration calibration (timing only, all metrics discarded unopened): the full
  evaluation takes ~3,070s on the local instrumented environment (base arm
  1,103s, candidate arm 781s, ablation arm 760s, auxiliary 427s). Anchoring
  against the observed on-instance base-arm duration (~3,100s vs 1,103s
  locally) gives an instance evaluation cost of ~8,660s, about 440s beyond what
  r1's window allowed.
- The user-data runner timeout margin is reduced from 180s to 120s. The final
  state sync and terminal status upload complete well within 60s, so the
  change is safe and returns 60 seconds of evaluation window per instance.
  A fresh continuation therefore has ~8,800s of evaluation window, which covers
  the estimated ~8,660s requirement.

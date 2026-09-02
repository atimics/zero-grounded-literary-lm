# ZERO.5 C6.1 AWS resume record

## Resume 1 (2026-08-31)

- **Trigger.** Run `zero5-c61-aws-20260829-93c8003` reached update ~26,500 of
  28,707 at the 9,000-second instance ceiling (exit 124, $1.67 spent) and
  wrote terminal status `recoverable`. No `result.json` exists. The frozen
  checkpoints (`active.ckpt`, `best.ckpt` + `.aux`), `training.log`, and
  `execution.json` were synced to S3 per the venue contract.
- **Instruction.** Explicit user instruction to resume the single authorized
  C6.1 run from the synced checkpoint and finish training, frozen validation,
  and the bridge-on/bridge-off ablation.
- **Continuation, not a retry.** The resume reuses the same approval
  (`zero5-c61-shared-state-aws-2026-08-29-v1`), the same frozen contract
  (`cf855417...`), the same authorization record (`5e3b120b...`), the same
  source archive (`93c80036...`), and the same asset archive
  (`8aadf2ce...`). No training parameter changes. The runner resumes from
  `active.ckpt` and appends to the existing `training.log`; the completion
  accounting check still covers the full run.
- **Run id.** `zero5-c61-aws-20260831-93c8003r1`. The prior run's S3 state
  was copied byte-for-byte to
  `experiments/zero5-c61-shared-state-v1/zero5-c61-aws-20260831-93c8003r1/state/`
  so the venue user-data finds it, detects `execution.json`, and passes
  `--resume-run`.
- **Execution lock.** Bumped to `execution-v3.lock` (v1: first failed launch;
  v2: timed-out launch). The atomic lock still limits this resume
  authorization to one execution.
- **Budget.** Same per-instance ceiling enforced in user-data: 9,000 seconds
  maximum, $1.70 hard cost ceiling, c6i.4xlarge on-demand us-east-1, automatic
  termination. Expected resume usage is materially below the ceiling
  (~2,200 remaining updates plus validation and ablation). Cumulative
  experiment spend after this resume is expected near $1.9-2.0.
- **First launch of this resume is not independent retries.** If the resume
  itself exhausts the ceiling before `result.json`, it again terminates
  `recoverable` and requires a further explicit instruction to continue.
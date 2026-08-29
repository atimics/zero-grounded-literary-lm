# ZERO.5 C6.1 prep notes (2026-08-28)

Not part of the frozen specification; SPEC.md is hash-pinned by the contract
and must not change after freeze. These notes live here instead.

- `make zero5-c61-shared-state-check` passes; trainer binary builds clean
  with the vector-math Accelerate path.
- `authorization-draft.json` binds the frozen contract hash
  (`e06a7fb3...`). Flipping `authorized` and `ilxyr.run_authorized` to true
  requires one explicit user instruction, per house convention.
- Private import artifacts (C5.1 mixed packs, verified target streams, C4.3
  frozen validation) live in the executing agent's sandbox; the runner
  verifies each by hash before training starts.
- Run command shape (executing environment):

  `node scripts/run_zero5_c61_shared_state.mjs --authorization <auth.json> --target-import <dir> --c51-import <dir> --c43-import <dir> --c0-dir build/zero5-c0-v1/corpus-one --c2-dir build/zero5-c2-v1/run --c2-import-dir build/zero5-c2-v1/import-final --control-result <matched-control-result.json>`

- The evaluator scores the trained checkpoint twice (bridge on / bridge off);
  the bridge-on score must beat bridge-off by at least one point on retrieval
  choice and pair-exact for any gain to count as shared-path causation.

## AWS venue amendment (2026-08-29)

User direction: the official run must execute on AWS because sandbox
execution is not externally monitorable. `aws-venue-amendment.json` proposes
the venue move; the local authorization is superseded unused (verified: no
output, checkpoint, or process ever existed).

Executing the amendment:

1. Contract revision PR: update `execution` to the AWS venue block from the
   amendment, set `cost_ceiling_usd` and instance bounds, add the
   superseding authorization record
   (`zero5-c61-shared-state-aws-2026-08-29-v1`), refresh the runner hash
   after its venue validation accepts `aws us-east-1 c6i.4xlarge`
2. Stage assets: `scripts/aws/zero5-c61-stage.sh` (adapted from the C4.2
   stage script) verifies all contract inputs by hash, runs the preflight,
   and uploads immutable source + private asset archives to
   `s3://zero-training-022118847419/inputs/zero5-c61-v1/`
3. Launch: `scripts/aws/zero5-c61-run-instance.sh` (C4.2 pattern) enforces
   the approval id, contract hash, cost ceiling, and 9,000-second maximum;
   writes `launch.json` as the immutable receipt
4. User-data: C4.2 pattern with 30-second status/log sync to
   `experiments/zero5-c61-v1/<run-id>/state/`, automatic termination, and
   result upload with `result.json` SHA recorded in `status.json`

Monitoring (the point of the move): instance state, cost ceiling, training
progress, and results are observable in S3 by any IAM principal with bucket
read — no trust in the executing sandbox required.

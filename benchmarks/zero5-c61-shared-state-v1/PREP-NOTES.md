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

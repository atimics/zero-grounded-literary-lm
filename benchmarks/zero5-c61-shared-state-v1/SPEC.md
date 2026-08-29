# ZERO.5 C6.1 Shared-State Bottleneck pilot

## Question

Can a compact state representation improve retrieval when the same learned
representation is used both to predict verified Braid factors and to alter the
answer-token language logits?

C6.1 starts from the frozen C2 checkpoint and reuses the exact C5.1 text
mixture, target stream, seed, update groups, optimizer, schedule, and retention
audits. The prior C5.2 run has a private terminal record. This public contract
does not use or disclose its outcome, metrics, checkpoint hashes, or result
hash.

## Treatment

The final hidden state enters a 152-wide `tanh` bottleneck. A factorized decoder
predicts the same 752 verified Braid state tags used by TargetBridge. A separate
zero-initialized projection maps that bottleneck back to the 256-wide language
state and adds it, at scale 0.1, only at answer-token positions.

The down projection starts as a deterministic identity slice and consumes no
random numbers. Both output projections start at zero, so the initial language
path is unchanged. The bottleneck, factor decoder, and answer projection add
193,032 parameters. This is 232 fewer than the C5.2 auxiliary ceiling and keeps
the total at 5,046,024 parameters.

## Controls

The completed C5.1 seed-0 result is the matched text-only control. The evaluator
also scores the trained C6.1 checkpoint twice: once with the answer bridge on
and once with the bridge off. This same-checkpoint ablation must show that any
retrieval gain comes from the explicit shared path.

The bridge-off score is not a second training run. There is one treatment run,
one seed, and no retry.

## Decision

The state decoder must reduce development factor nats by at least 10% and raise
factor accuracy by at least five percentage points over its zero-head control.

With the bridge on, frozen retrieval choice accuracy must reach 55% and improve
by at least one percentage point over C5.1. Pair-exact accuracy must reach 53%
and improve by at least one percentage point over C5.1. The bridge-on score
must also beat the same checkpoint with the bridge off by at least one point on
both measures.

Both retrieval orientations must reach 50%, their gap must stay at or below 15
points, and swap consistency must reach 94%. The C5.2 development choice A/B
token-accuracy gap must be at or below 15 points.

Claim accuracy may lose at most two points versus C5.1 and claim swap
consistency must reach 94%. Combined language loss may rise by at most 0.10
nats versus C5.1. The established evidence, Atlas, and C1 anchor limits remain
in force.

A pass authorizes only a request for a frozen multi-seed replication. It does
not authorize replication, promotion, publication, or sealed-test access.

## Authorization boundary

This repository builds and freezes the experiment but does not authorize
training. A run requires a separate authorization record bound to the frozen
contract hash and the ilXyr registration. Until that record exists, the runner
fails closed before preflight or compute.

## Fixed boundaries

- Local Apple Silicon only, one seed-0 treatment run, hard stop at 3,600
  seconds.
- No AWS or paid compute.
- Frozen C2 initialization with fresh AdamW state.
- Frozen 37,768-pack C5.1 training view and development validation.
- Exactly 28,707 update groups and zero data wraps.
- C5.2 sealed test content stays absent and unopened.
- No symbolic serialization is imported or claimed.
- Corpus, checkpoints, raw logs, generations, and results stay private.
- No independent retry, publication, promotion, replication, or test access is
  authorized.

## Prep status (2026-08-28)

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

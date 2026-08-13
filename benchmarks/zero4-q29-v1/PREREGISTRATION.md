# Q2.9 conservative sparse-exposure preregistration

Q2.8 learned the target quantity behavior but failed the frozen TinyStories
preservation ceiling at both update 100 and update 200. The earlier checkpoint
was better on every paired TinyStories case and had less replay drift. Q2.9
tests whether the unchanged Q2.8 training profile can be stopped earlier under
a stricter replay guard.

Issue #83 authorizes this implementation. It does not authorize a pilot run,
language evaluation, promotion, or deployment.

## Frozen pilot

One diagnostic seed-2 trajectory starts from the immutable ZERO.3
initialization with fresh AdamW moments. It reuses the Q2.8 profile, quantity
and replay training inputs, batch size, deterministic sample order, learning
rate, weight decay, gradient clip, measurement inputs, and profile-weighted
replay-tangent projection.

The maximum is 100 optimizer updates. Frozen measurements occur at updates 0, 25, 50, 75, and 100. Each post-baseline measurement computes:

- quantity recovery: `(baseline quantity loss - current quantity loss) /
  baseline quantity loss`; and
- replay regression: `(current replay loss - baseline replay loss) /
  baseline replay loss`.

The stop rule is evaluated only at those checkpoints and in this order:

1. If replay regression exceeds 0.75%, stop immediately with no candidate.
2. Otherwise, if quantity recovery is at least 80%, freeze this first eligible
   checkpoint and stop immediately.
3. Otherwise continue, unless update 100 has been measured. Reaching update
   100 without eligibility is a no-go.

The strict replay-first ordering means a checkpoint above the replay guard
cannot qualify even when its quantity recovery exceeds 80%. No later
checkpoint can outrank a first hit. The measurement forward passes do not
commit optimizer updates or change the sampling RNG.

## Leakage firewall

BLiMP, TinyStories, public quantity rows, quantity promotion rows, language-gate
examples or scores, and model-promotion inputs are forbidden until the
candidate is selected and hash-frozen. The Q2.8 language results justify this
experiment family but may not alter Q2.9 coefficients, thresholds, checkpoint
order, or selection after execution starts.

Runtime input and hyperparameter overrides are forbidden. A run authorization
must bind the exact merged source commit, profile SHA-256, fixed input hashes,
seed, 100-update ceiling, checkpoint schedule, thresholds, and one-execution
limit. Resume is forbidden.

## Decision branches

- Replay guard breach: Q2.9 no-go. Do not select an earlier unqualified or
  later checkpoint.
- No first hit by update 100: Q2.9 no-go. Do not extend or relax thresholds.
- First hit: freeze exactly that checkpoint. Stop training; do not inspect
  later checkpoints.
- Frozen candidate fails either unchanged language screen: Q2.9 no-go. Keep
  seeds 1 and 3 sealed and retire this profile family.
- Frozen candidate passes both screens: stop. A separate three-seed replication
  contract is required; seed 2 is not promoted.

The proposed pilot cap is $0.25 and the conditional one-candidate language cap
is $0.12. Both executable caps remain zero until exact run authorization.

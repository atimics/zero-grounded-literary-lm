# Post-Q2.7 graded-plasticity research decision

Status: **research complete; experiment not authorized**

Issue: [#69](https://github.com/atimics/zero-grounded-literary-lm/issues/69)

Date: 2026-08-08

## Executive decision

Q2.7 did not fail because its trainable top FFN was held too still. Its two
large FFN matrices moved **44% and 77% more** over 300 matched updates than the
same matrices did in successful Q2.6, yet Q2.7 never learned syntax, operation,
or exact-request behavior. Every Q2.7 update was accepted at full scale, and
projection removed at most 6.2% of a proposed direction. This substantially
weakens simple guard-rejection, insufficient top-FFN movement, and
stop-rule-only explanations.

The combined trace and literature evidence favors a different hypothesis:
quantity routing needs coordinated capacity distributed through the network,
while the old language behavior needs graded protection. In the building
analogy, do not renovate only the top floor; permit small, controlled work on
every floor, making load-bearing parts progressively harder to change.

The recommended next intervention is a **fixed, cross-layer graded-plasticity
profile** computed only from quantity-training and direct-replay gradients.
It is a hypothesis to test, not established science. The cheapest defensible
causal pilot is one 200-update graded arm against the frozen Q2.7 hard-freeze
control, with a conservative $0.50 quantity cap and the existing $0.12
language screen only if a valid candidate is frozen. No run is authorized by
this document.

## Frozen terminal evidence

| Field | Frozen value |
| --- | --- |
| Q2.7 workflow run | `31270819935` |
| Source commit | `59a97ff57e964db4e576bbf1a75e44dc7a983e9d` |
| Result SHA-256 | `e460286d746518c44f908a178cab839eb484d8f85e4afb69beba73873c58aef2` |
| Decision | `no-go` |
| Stop | `no Pareto improvement for 200 committed updates` |
| Attempts / committed | `300 / 300` |
| Trainable scope | `top-ffn`, 541,184 / 4,852,992 parameters |
| Observed quantity cost | `$0.484688888889` |
| Selected checkpoint | none |
| Language gate | not evaluated |

The result, optimizer-attempt, and event hashes are embedded in
[`trace-analysis.json`](trace-analysis.json). The generated summary binds the
terminal result rather than restating an unverified status.

## What the matched traces establish

Q2.6 and Q2.7 use the same seed and are compared over the first 300 committed
updates. The complete 700-update Q2.6 trace and complete 300-update Q2.7 trace
are both summarized; matched gate comparisons occur at updates 100, 200, and
300.

| Observation | Q2.6 | Q2.7 | Interpretation |
| --- | ---: | ---: | --- |
| Accepted full-scale updates, first 300 | 300 | 300 | Q2.7 was not blocked by rejected or backtracked steps. |
| Projected updates | 185 | 204 | Projection was somewhat more frequent in Q2.7. |
| Maximum direction removed | 7.88% | 6.20% | Gross projection removal does not explain the no-go. |
| Mean gradient norm | 1.6459 | 0.6491 | The isolated subspace saw a much weaker aggregate signal. |
| Mean step displacement | 0.01171 | 0.00711 | Total steps were smaller even though the active top FFN accumulated more movement. |
| First quantity pass | update 200 | none | Update 200 is the earliest defensible pilot decision point. |
| Operation / exact request at update 200 | 0.954 / 0.954 | 0 / 0 | The difference is behavioral, not merely a small margin change. |

Q2.6 moved FFN matrices throughout all six layers, with attention value/output
groups also active. Token embeddings produced the largest summed absolute
replay-drift and Fisher-weighted-drift diagnostics. This is evidence of a
distributed signature and a likely high-risk group, **not causal proof** that
each moved group was necessary or that embeddings must be frozen.

The trace cannot yet distinguish a missing top-FFN quantity gradient from bad
adaptive conditioning or removal of a small but decisive direction. That is
why the first implementation step is a no-update shadow audit that records
groupwise quantity signal, replay risk, alignment, proposed optimizer delta,
and post-profile/post-projection delta.

## What the literature adds

The full-text review contains 12 primary papers in
[`LITERATURE-REVIEW.json`](LITERATURE-REVIEW.json). Its most decision-relevant
results are:

- EWC and Synaptic Intelligence establish soft, importance-weighted
  consolidation as a real method family, but warn that importance estimates
  are approximate and noisy.
- ULMFiT shows that last-layer-only tuning can underfit and that gradual
  unfreezing eventually restores flexibility below the top layer.
- Child-Tuning shows that new-task importance matters: selecting parameters
  merely because they are low-Fisher for another objective can select capacity
  that is safe but useless.
- Diff Pruning learns sparse cross-layer task changes and reports much worse
  performance when its changes are confined to fully connected layers after
  attention.
- Distributed adapters have cumulative effects across layers, but change the
  architecture and do not prove that the active model preserves language.
- A-GEM and OGD support local gradient constraints; neither says projection
  can create new-task signal absent from the allowed subspace.
- Controlled language evidence shows that parameter efficiency alone is not a
  forgetting guarantee. BLiMP and TinyStories remain bounded screens rather
  than comprehensive language-quality measures.

Therefore the literature supports **testing** graded distributed plasticity.
It does not establish the proposed preservation boundary, formula, or outcome
for Zero.

## Evidence matrix

| Candidate mechanism | Trace support | Primary-literature support | Main falsifier | Rank |
| --- | --- | --- | --- | ---: |
| Distributed graded plasticity | Q2.6 changes are distributed; Q2.7 preserves replay but underfits | EWC, SI, ULMFiT, Child-Tuning | No update-200 improvement over Q2.7, or quantity progress breaches replay/language gates | 1 |
| Distributed sparse mask | Same distributed Q2.6 signature | Diff Pruning, Child-Tuning | Training-only mask is unstable, collapses to one layer, or underfits at update 200 | 2 |
| Top attention + FFN | Large ineffective Q2.7 top-FFN movement leaves routing as plausible missing capacity | ROME/localization literature is indirect | Still zero syntax/operation at update 200 | 3 |
| Complete top block | Cheap expansion of Q2.7 | Layerwise transfer supports wider tuning, not a top boundary | No matched improvement without extra replay damage | 4 |
| Adapters / LoRA | Q2.7 suggests immutable-base preservation is useful but local capacity is not | Houlsby adapters; controlled LoRA counterevidence | Active model fails quantity or preservation | 5 |
| Embedding / output adaptation | Embeddings moved in Q2.6 | Transfer literature is indirect | Replay damage without causal quantity gain | 6 |
| Optimizer / projection / stop only | Alignment and conditioning remain unmeasured | A-GEM and OGD support diagnostics | Shadow audit finds weak unprojected top-FFN signal | 7 |

The optimizer/projection hypothesis is ranked last as a new training
intervention, but its **no-update diagnostic comes first** because it is cheap
and can invalidate the graded-profile construction before paid training.

## Proposed graded profile

For each eligible parameter group, compute two quantities from frozen
training-authority data only:

- `O_g`: old-behavior importance from mean squared direct-replay gradients,
  normalized by the median across groups;
- `N_g`: new-task relevance from mean squared quantity-acquisition gradients,
  normalized the same way.

Use the fixed coefficient:

`p_g = 0.05 + 0.95 * N_g / (N_g + O_g + epsilon)`

This keeps a 5% flexibility floor, gives more movement to groups with stronger
new-task signal relative to old-behavior risk, and avoids picking a layer by
hand. It is a preregistration candidate, not a validated optimum.

The profile is computed once, hash-bound, and held fixed. It scales the whole
proposed parameter delta, including weight decay, before a
plasticity-weighted replay projection. Optimizer state starts fresh, is never
reused across profiles, and is discarded after the run. A dynamic schedule
would need a new review and explicit moment-reset rule.

BLiMP, TinyStories, promotion examples, and public candidate outcomes cannot
influence `O_g`, `N_g`, the coefficient formula, the floor, or the stopping
rule. Replay results must be reported by slice and parameter group so damage
cannot hide by migrating elsewhere.

## Cheapest discriminating pilot

The existing successful Q2.6 control first passed at update 200, so stopping
at 100 would not decide the question. The proposed pilot is:

1. Run the no-update shadow audit and freeze its input hashes, coefficients,
   and output.
2. If the profile is stable across training-only resamples, run exactly one
   seed-2 graded arm for at most 200 committed updates.
3. Evaluate only at frozen checkpoints 0, 100, and 200 against unchanged
   quantity and per-slice replay gates.
4. Compare to the hash-bound Q2.7 hard top-FFN run and the Q2.6 full-model
   reference.
5. Stop at 200. Do not retune the profile or extend the run.
6. Only if a jointly feasible candidate is frozen, spend at most $0.12 on the
   already-defined language gate. Do not promote from this pilot.

Cost basis: Q2.7 spent $0.484688888889 for 300 updates, or about $0.1616 per
100 updates by linear extrapolation. Two hundred updates project to $0.3231;
a conservative quantity cap is $0.50. Including the conditional language
screen, the proposed maximum new-compute envelope is $0.62.

The literature and trace work are already complete; exact agent-credit usage
is unavailable and is not fabricated. The marginal shadow-audit plus graded
implementation is estimated at 16-28 engineering hours, so engineering—not
AWS—is the dominant cost. The pilot is high-value only because it replaces a
broad multi-arm sweep with one causal comparison. Its $0.62 maximum is 48.1%
of the prior $1.29 quantity-plus-language envelope; engineering value must be
judged separately from that compute-only ratio.

## Reproduction

With read access to the frozen result bucket:

```sh
mkdir -p /tmp/zero-issue-69-q27
aws s3 cp s3://zero-training-022118847419/jobs/31270819935/seed2/results/optimizer-attempts.jsonl /tmp/zero-issue-69-q27/q27-optimizer-attempts.jsonl
aws s3 cp s3://zero-training-022118847419/jobs/31270819935/seed2/results/events.jsonl /tmp/zero-issue-69-q27/q27-events.jsonl
aws s3 cp s3://zero-training-022118847419/jobs/31270819935/seed2/results/q27-result.json /tmp/zero-issue-69-q27/q27-result.json
sha256sum /tmp/zero-issue-69-q27/q27-optimizer-attempts.jsonl /tmp/zero-issue-69-q27/q27-events.jsonl /tmp/zero-issue-69-q27/q27-result.json
node scripts/analyze_zero4_plasticity.mjs \
  --q26-attempts benchmarks/zero4-q26-v1/seed2/optimizer-attempts.jsonl \
  --q26-events benchmarks/zero4-q26-v1/seed2/events.jsonl \
  --q27-attempts /tmp/zero-issue-69-q27/q27-optimizer-attempts.jsonl \
  --q27-events /tmp/zero-issue-69-q27/q27-events.jsonl \
  --q27-result /tmp/zero-issue-69-q27/q27-result.json \
  --q26-attempts-locator benchmarks/zero4-q26-v1/seed2/optimizer-attempts.jsonl \
  --q26-events-locator benchmarks/zero4-q26-v1/seed2/events.jsonl \
  --q27-attempts-locator s3://zero-training-022118847419/jobs/31270819935/seed2/results/optimizer-attempts.jsonl \
  --q27-events-locator s3://zero-training-022118847419/jobs/31270819935/seed2/results/events.jsonl \
  --q27-result-locator s3://zero-training-022118847419/jobs/31270819935/seed2/results/q27-result.json \
  --out benchmarks/zero4-post-q27-v1/trace-analysis.json
node scripts/check_post_q27_research.mjs
```

Expected Q2.7 input hashes:

- optimizer attempts: `1cd6f546a2aeb0eb8af023dcc7e41845a66b813fb0781b4bbf08e1b008da95e3`
- events: `9cd34379af110a13bf75f33be339d89d9849cfba7c492ca36afab7c809c11ace`
- result: `e460286d746518c44f908a178cab839eb484d8f85e4afb69beba73873c58aef2`

## Authority boundary

This research decision authorizes no workflow dispatch, AWS compute,
training, language evaluation, candidate promotion, or profile tuning. A new
experiment requires a separate issue, protected-path approval, exact commit,
cost envelope, and dispatch authorization.

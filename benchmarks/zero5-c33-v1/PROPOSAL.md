# ZERO.5-C3.3 proposal: mirror-consistency training (DRAFT for review)

Status: **draft**. Not authorized, not frozen. This document proposes the
experiment; `contract.json` freezes it only after review. Nothing in this
directory trains anything.

## Question

Can an objective-level coupling between mirrored orientations teach the fixed
4,852,992-parameter model to decide by content rather than presentation —
after presentation-space and weighting levers have each been ruled sufficient
for their own effects but insufficient for order-invariant deciding?

## Evidence chain that motivates this design

C3.2 (official, run `zero5-c32-aws-20260824-44d34a7`, result SHA
`e87305b52d229a71483c49a9aed09258211e118dd14b2f09855b77f89a059688`)
eliminated hypotheses one at a time:

| Lever | Result | Established |
| --- | --- | --- |
| Both orientations in training data (C3.2 arms C, D) | swap consistency 0.21–0.40 | Data symmetry alone does not produce order-invariant decisions |
| Answer-token mass balancing (D vs C) | mean choice +3.62 points; claim position gap 47 → 2.8 points | Weighting moves decisions and erases position preference |
| Same (D) | swap consistency unchanged (~0.22/0.40); pair exact **below independence** (claims 0.191 vs ~0.34 expected at p=0.582) | Weighting cannot make the model read order-invariant features |

The pair-exact anti-correlation is the decisive diagnostic. At D's per-family
accuracies, independent orientations would produce both-correct rates near
p² (claims ~0.34, retrieval ~0.28). Observed: 0.191 and 0.230. The model is
not a noisy content-decider; it uses orientation-correlated features that
flip answers under the mirror. No data-ordering or token-weighting scheme can
penalize that. A loss term that must agree with itself across the mirror can.

## Hypothesis

Adding a mirror-consistency term — coupling the two orientations of the same
comparative item so their verdict distributions are penalized for divergence
— raises swap consistency from ~0.22/0.40 toward the 0.60 gate and lifts
pair-exact above the independence floor, without regressing completion NLL,
atlas/anchor retention, or the token budget.

This is an objective-level intervention: it changes what the loss scores,
not what the data contains or how tokens are weighted. It requires no corpus
change, no new items, no Braid dependency.

## Design

Fixed across all arms: the C3.2 frozen packs (37,768 packs, 19,337,216
compute-token exposures), tokenizer, C2 initialization checkpoint, seed 0,
optimizer schedule, 9,442 updates, parameter count, evaluation, and gates
unchanged from C3.2 unless stated.

### Arms

- **Control — C3.2-D official.** Reused via the verified S3 baseline cache,
  not retrained. Data, seed, checkpoint, and schedule are identical by
  construction; retraining would buy nothing. The cache identity already
  binds the baseline payload to this experiment family.
- **E — mirror-consistency.** C3.2-D recipe plus one coupling term. For each
  comparative training pair, let p1 and p2 be the verdict-class distributions
  (the token head's probabilities restricted to the two candidate answer
  tokens) at the verdict positions of the two orientations:

  `L = L_token + λ · JS(p1 ‖ p2)`

  with λ = 0.1, linear warmup over the first 500 updates, both values frozen
  in the contract. JS (Jensen–Shannon, symmetric, bounded) is chosen over KL
  so neither orientation is privileged — the term is itself mirror-symmetric.
  Implementation requires a pairing index from each orientation's verdict
  position to its mirror; the packer emits this map (deterministic, checked
  at import). Compute overhead: one extra reduction per comparative pair;
  both orientations already flow through the batch stream.

### What E deliberately is not

- Not a data change. Both orientations already appear in training (C3.2
  established that is insufficient alone).
- Not a state-tag auxiliary head (that is the C5/Braid #2 line and needs
  corpus support). E uses only the existing token head.
- Not contrastive against other items (no in-batch negatives, no
  representation-level machinery). The coupling is item-internal only.

## Gates (drafted; frozen at contract time)

Conjunctive, evaluated on validation, test split sealed:

| Gate | Threshold | C3.2-D official value |
| --- | --- | --- |
| Swap consistency (both families) | ≥ 0.60 | 0.217 / 0.398 (fail) |
| Pair exact (both families) | ≥ 0.35 **and** ≥ p̄² of the arm itself | 0.191 / 0.230 (fail both) |
| Per-family paired choice accuracy | ≥ 0.60 | 0.582 / 0.532 (fail) |
| Orientation gap | ≤ 0.10 | claims 0.028 (pass), retrieval 0.155 (fail) |
| Completion NLL (all three families) | C3.2 limits unchanged | pass |
| Atlas / C1 anchor retention | C3.2 limits unchanged | pass |
| Full pack pass, zero wraps, finite metrics, tests sealed | required | pass |

The pair-exact-above-independence gate is new and is the point of the
experiment: it fails automatically for any orientation-driven decider,
independent of how the token head is weighted.

## Predictions (falsifiable; to be attached as ilXyr mechanism forecasts before training)

1. E swap consistency ≥ 0.60 in both families. (Primary.)
2. E pair exact exceeds p̄² in both families: anti-correlation eliminated.
3. E per-family choice lands in [0.58, 0.66]; the 0.60 gate may or may not
   clear on seed 0 — this prediction is explicitly uncertain.
4. Anchor and NLL gates hold: coupling does not damage what C3.2-D achieved.

Prediction 3 is the honest weak point: consistency training constrains the
decision rule but does not by itself supply the content features the rule
needs. A pass on 1–2 with a near-miss on 3 is the expected informative
outcome, and the decision rules below treat it as its own branch.

## Decision rules (frozen with the contract)

- **All gates pass** → authorize three-seed replication of E (seeds 1, 3),
  per the family rule.
- **Consistency gates pass (1–2), choice gates fail** → order-invariance is
  achievable at this size but content extraction is not: the model becomes
  consistent *and* consistently wrong or near chance. This is the
  "fair-but-ignorant" world. Next authorized question becomes the
  state-tag/latent-target line (C5, Braid #2/#6), which supplies content
  features; parameter increase remains unauthorized.
- **Consistency gates fail** → objective-level coupling does not build
  order-invariant decisions at 4.85M parameters. Presentation, weighting,
  and objective levers are then all exhausted with the same deficit intact;
  the parameter-count decision point becomes the authorized next question,
  with the full elimination chain as its evidence.
- **Any retention or NLL gate fails** → the coupling term is harmful to
  existing competencies; no-go with diagnosis, λ sensitivity becomes a
  follow-up only if a concrete instability mechanism is identified.

No branch authorizes checkpoint publication or broad promotion. Single seed.
Five-choice misses are misses.

## Budget

One training arm at the C3.2 schedule. Measured C3.2 segment cost was
$6.55 across recovery segments for two arms plus baselines; one arm with
the baseline cache reused is expected at $2–4 on c6i.4xlarge, or ~50 minutes
locally as an exploratory preflight that cannot substitute for the official
run.

## Literature registration

Per the proposal resolution rules: primary literature with limitations and
at least one disconfirming source.

Supportive:

- Consistency regularization across augmented views is a standard
  semi-supervised mechanism (Π-model and successors; FixMatch,
  arXiv:2001.07685) — the mirror is our augmentation, the verdict our label.
- Latent/continuous-space objectives improve planning at small scale
  (Coconut, arXiv:2412.06769) — evidence that objectives beyond next-token
  change decision behavior, though via a different mechanism than proposed
  here.
- Multi-token prediction heads improve downstream reasoning cheaply
  (arXiv:2404.00329) — precedent that auxiliary coupling terms do not
  destabilize token loss.

Limiting / disconfirming:

- Consistency objectives are documented as optimization-unstable
  (hyperparameter-sensitive, can stall early training); this is why λ has
  warmup and why the anchor gates are conjunctive rather than advisory.
- Concept-space language modeling (Large Concept Models) underperformed
  token-level LMs at matched compute — higher-level objectives do not
  automatically win; if E fails, this is the precedent it joins.
- The coupling cannot add information. If content features are absent from
  the representation, JS regularization makes the model consistently
  wrong. Branch 2 of the decision rules exists because of this source.

## Relationship to other lines

- C5 / Braid state tags (#2, #6): complementary, not competing. E tests
  whether order-invariant deciding is trainable at this size by objective
  coupling alone; state tags supply content supervision if branch 2 occurs.
  The two compose: a C6 could pair consistency coupling with tag prediction.
- Parameter increase: remains gated behind E's outcome. The elimination
  chain (presentation → weighting → objective) is exactly the evidence a
  capacity decision would need, and it is one experiment away from complete.

## What this proposal does not claim

- No claim that consistency training yields intelligence, understanding, or
  generalization beyond the mirrored comparative families.
- No claim about seeds other than 0. Replication is a separate, gated
  authorization.
- No reinterpretation of C3.2's official no-go. This proposal reads its
  numbers as evidence, exactly as recorded.

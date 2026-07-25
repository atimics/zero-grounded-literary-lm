# ZERO.4-Q2.7 preregistration — top-FFN isolation repair

Status: **preregistered, not authorized**. This merge may validate mechanics;
it may not launch training or external evaluation.

## Why this is next

Q2.6 solved the quantity/replay problem across all three seeds and promoted
ZERO.4. The later bounded external screen did not support a general language
improvement claim: ZERO.4 improved BLiMP raw accuracy from 0.532 to 0.537, but
TinyStories bits/byte worsened from 2.527861 to 2.570353. That 1.681% relative
regression fails the prospective 1% candidate gate and blocks SAT-1 at its
five-operation anchor.

The completed Q2.6 optimizer trace provides a useful localization hypothesis.
Across the diagnostic trajectory, `token_embedding` dominates aggregate
absolute replay drift and Fisher-weighted drift. In contrast, `layer.5.w1`
and `layer.5.w2` carry the two largest aggregate displacement norms. Q2.7
therefore freezes the embedding, attention, and lower blocks and permits
learning only in:

- `layer.5.norm2`
- `layer.5.w1`
- `layer.5.w2`
- `final_norm`

That is 541,184 of 4,852,992 parameters (11.151554%). This boundary is a
prospective intervention chosen from existing internal diagnostics. It was
not selected by trying alternatives against BLiMP or TinyStories.

## One changed variable

Q2.7 starts again from immutable ZERO.3, not from the language-regressed
ZERO.4 artifact. It inherits Q2.6's teachers, corpora, split isolation, source
order, optimizer schedule, batch size, attempt budgets, tangent construction,
1.5% cumulative replay authority, 2% public replay ceiling, quantity gates,
selection rule, and stop conditions.

The only scientific change is `--trainable-scope top-ffn`. Global gradient
clipping and replay-tangent projection operate in that subspace. Every frozen
weight and both of its AdamW moment arrays must remain byte-identical through
updates, retries, commits, rollbacks, checkpoints, and resume. The scope is
encoded in checkpoint metadata; a mismatched resume fails closed.

## Diagnostic sequence

Only seed 2 may be proposed for a later diagnostic authorization:

1. train from immutable ZERO.3 under the exact top-FFN scope;
2. select with the unchanged Q2.6 public quantity/replay rule;
3. open the disjoint quantity promotion split exactly once only for a
   public-feasible checkpoint;
4. only after quantity promotion passes, run the frozen candidate-only
   BLiMP/TinyStories preservation gate exactly once;
5. resolve go only if every quantity, replay, promotion, and language
   predicate passes conjunctively.

A failure ends Q2.7 without adaptation. Seeds 1 and 3 remain sealed unless a
seed-2 go is merged and a separate replication contract and budget are
approved. SAT-1 remains blocked until the repair family resolves go.

## Compute firewall

This registration authorizes zero optimizer attempts, zero instance-seconds,
and zero dollars. It adds no training workflow. The next step after green CI
is an AWS-only timing/budget proposal whose launch workflow exits after
dispatch and whose collector never waits or starts compute. Training requires
another explicit approval.

The machine-readable authority is [`contract.json`](contract.json).

# Braid C5 Guidance

*For the developers of the C5 corpus and training stage. Written before any
C5 item exists; read alongside ZEROADMAP.md and the C3.1/C3.2 results.*

## The thesis C5 tests

Presentation-space repairs are exhausted: task order (C3.1), answer weighting
(C3.1-B), and task definitions (C3.2-C) each fixed exactly what they targeted,
yet swap-consistent paired choice still sits near chance while compression keeps
improving. Our working hypothesis is **not** that text cannot teach meaning — it
is that natural text is an *inefficient teacher at fixed small capacity*: the
answer-relevant relation is diluted across thousands of tokens of surface-form
variance that a big model can afford to absorb and ours cannot.

C5 therefore raises **supervision density**: bits of usable gradient per
parameter per token shown. This is the same move that won C0 (byte-BPE512 cut
validation content tokens 57.07% at fixed parameter budget), applied one level
up — to the construction of the items themselves rather than their encoding.

This is a measurable engineering claim, not a philosophy claim. The
preregistered question: *does a compute-matched braid containing structured
non-textual items improve swap-consistent paired choice over a text-only
braid at identical parameter count, tokenizer, and token budget?*

## Research base

What we are borrowing, and how much weight it carries:

| Finding | Source | Strength |
| --- | --- | --- |
| Generative next-token objectives spend capacity modeling unpredictable surface detail; predicting in abstract/latent state learns better representation per parameter | LeCun et al., I-JEPA (arXiv:2301.08243); V-JEPA line | Strong for vision; suggestive for us |
| World models emerge from prelinguistic sequence prediction: a model trained only on legal-move transcripts develops linearly decodable board-state representations | Li et al., Othello-GPT (arXiv:2210.13382); Nanda's grokking work | Strong; directly analogous to our scale and method |
| Self-play over structured state yields planning competence with zero language | AlphaZero / MuZero | Strong for the ceiling of the approach; silent on tiny models |
| Small models need curated, simplified data; coherence at 1–10M params required shrinking vocabulary and constraining distribution | TinyStories (arXiv:2305.07759); BabyLM challenge | Strong |
| Grokking: algorithmic circuits form abruptly after long training on synthetic tasks; rare in natural-text training | Power et al. (arXiv:2201.02177) and follow-ups | Suggestive |
| Concepts precede words developmentally; word learning maps labels onto pre-existing relational repertoire | Developmental cognition literature (Spelke objects, Gavagai) | Motivating analogy only — do not cite as evidence about transformers |
| One ordered pass ≈ 4 tokens/param vs ~20 compute-optimal; our runs remain undertrained relative to size | Chinchilla (arXiv:2203.15556) | Strong; bounds all our conclusions |

Internal precedents carry equal weight: byte-BPE512's efficiency win (C0), the
interleaving causal result (C3.1 A vs V), answer-token imbalance discovery
(C3.1), and the mirrored-gate position-bias catch (C3.2-C).

## The four-axis filter

Every candidate C5 item type must pass all four. An item that fails any axis
is rejected regardless of intuition:

1. **Unambiguous encoding.** Two different states must never share an
   encoding, and the same state must never take materially different forms.
   Surface ambiguity is the dilution we are removing; do not reintroduce it
   through sloppy serialization.
2. **Target behavior directly in the loss.** If the item teaches comparison,
   the loss must score the comparison verdict — not hope it condenses out of
   predicting filler around the verdict.
3. **Low surface variance across instances.** Minimal memorizable shell.
   Measure it: train a probe model on shells alone; if shells predict answers
   above chance, the axis failed.
4. **Verifiable without human scoring.** Every item needs a deterministic
   checker compatible with the grounding-authority machinery.

### Item types that pass today

- **State-transition game transcripts.** Small deterministic games with
  explicit serialized state. Move transcripts are Othello-GPT fuel:
  prelinguistic, checkable, and they force state tracking. Start with games
  whose state fits in ≤64 tokens.
- **Same/different and odd-one-out over structured items.** Direct gradient
  signal for comparison. Present pairs in both orders by construction (see
  symmetry rules below).
- **Relational quantity/ordering tasks.** Extend the promoted q22r faculty
  from operations to relations: more/less/between/equal over countable or
  orderable encodings.
- **Shortest-path / reachability queries over tiny explicit graphs.**
  Comparison plus multi-step state following, fully checkable.

### Item types rejected for now

- Raw pixels, audio, or any high-entropy continuous input — fails axis 1
  catastrophically at 4.85M parameters.
- Anything requiring human judgment to score — fails axis 4.
- Items whose answers correlate with surface statistics (e.g., always the
  longer list) — fails axis 3 by construction; audit for this.

## Symmetry rules (non-negotiable)

C3.2-C showed position bias survives definition repair. C5 items are built so
positional cues cannot exist:

- Every comparative item appears in **all** orientations in both train and
  validation, balanced counts, interleaved — not blocked (the C3.1 lesson).
- Answer positions, orderings, and labels are counterbalanced with exact
  counts recorded in the contract.
- The packer emits per-task answer-token masses (issue #17 accounting);
  declared budgets must match recorded masses within the tolerance the
  contract sets. Balanced weighting (arm-D style) may be layered on top, but
  balance-by-construction is preferred over balance-by-weighting.
- Swap consistency is evaluated on validation during training (it already
  is), and **mean-paired accuracy plus orientation gap are reported per
  checkpoint**, so the curves — not just the endpoint — are visible.

## Braid composition

- **Interleave, never block.** Solid task blocks caused the original C3
  interference; the smooth braid is the control condition now.
- **Anchor retention is a gate, not a wish.** Atlas and C1 anchors keep
  their existing retention thresholds. A C5 that teaches comparison while
  forgetting prose is a failed C5.
- **Text remains the majority of tokens.** Non-textual items are a
  supplement targeting the deficit, roughly in the 20–35% band for the
  pilot — enough gradient signal to matter, not enough to crowd out anchors.
  The exact ratio is declared in the contract before training.
- **Compute-matched control arm is mandatory.** Arm structure mirrors C3.2:
  one mixed-braid arm against one text-only braid arm consuming the identical
  pack count, token exposures, seed, optimizer schedule, and C2-derived
  starting checkpoint policy. Without the control, any improvement is
  unattributable.

## Gates (drafted for contract freezing; numbers finalized at freeze time)

Primary outcome gates, conjunctive:

1. Mean paired choice accuracy on held-out validation ≥ preregistered floor
   (set relative to the C3.2 official arms' measured means, +N points where N
   is declared at freeze — do not tune after seeing curves).
2. Orientation gap ≤ preregistered ceiling on both comparative families.
3. Swap consistency: no orientation-specific passing (both orientations must
   individually clear a floor).
4. Atlas and C1 anchor retention within existing regression limits.
5. Zero wraps on the packed stream; full-pack consumption exactly once.

Secondary (reported, not gating): per-task completion NLLs, shell-probe
predictability, calibration of any attached mechanism forecasts.

Single seed-0 pilot. Pass authorizes three-seed replication; nothing else.
No promotion, no publication of checkpoints, test splits sealed.

## Known risks

- **Capacity competition.** Non-textual items spend the same parameter budget
  everything else needs. Mitigation: the compute-matched control makes the
  trade visible instead of hidden; if anchors regress or prose metrics fall
  disproportionately, the mix ratio was wrong, and that is a finding.
- **Tokenizer mismatch.** Structured items need encodings that survive the
  byte-BPE512 vocabulary cleanly. Audit round-trips: serialize → tokenize →
  decode → re-parse must be identity for every item family, checked by script
  before packing.
- **Trivial learnability.** If probe accuracy on shells predicts answers, the
  items are teaching shell recognition, not comparison. The shell-probe is
  cheap; run it during import, not after training.
- **We fool ourselves post hoc.** All thresholds frozen in `contract.json`
  before training; five-choice misses are misses; interpretation follows
  result, never precedes it.

## Deliverables expected from the C5 developer

1. Item-family specifications with checkers, passing the four-axis filter
   explicitly in writing.
2. Round-trip tokenizer identity script output per family.
3. Shell-probe predictability report per family.
4. Packed-stream token accounting vs declared budgets (per-task masses).
5. Frozen contract with arms, gates, mix ratio, and symmetry counters.
6. Only then: training.

Nothing trains before 1–5 exist and the contract hash is pinned.

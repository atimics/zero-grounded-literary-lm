# ZERO.5 C5.1 StateBridge structured-content pilot

## Question

Does replacing exactly 25% of the frozen C4.3 pack stream with C5.2
structured-state text improve the frozen C4.2 retrieval-choice deficit without
breaking language retention?

This is one causal claim. It tests structured content only. It does not test
the symbolic serialization or the auxiliary factorized state-target head.

## Matched control

The control is the completed C4.3 seed-0 run. The experimental arm starts from
the same frozen C2 checkpoint and keeps the same model, tokenizer, context,
seed, optimizer, answer weights, learning-rate schedule, 28,707 optimizer
groups, 37,768 packs, 14,850,534 active targets, and 19,337,216 token
exposures.

The import replaces 4,721 complete two-pack C4.3 groups with 4,721 C5.2
two-pack groups. This keeps update shape fixed. Each C5 choice group contains
the matched A and B orientations. The C5 share is 9,442 packs, exactly 25%.

ZERO uses an explicit document boundary token. Braid's pack plan uses a
zero-position attention reset. ZERO therefore repacks unchanged C5.2 records
into boundary-safe packs. All C5 target spans stay active at standard causal
weight 1. Input-side causal targets are deterministically thinned so the total
active-position count is byte-for-byte compute matched to C4.3.

## Decision

The primary gate is frozen C4.2 retrieval choice: at least 55% accuracy and at
least one percentage point above C4.3. Orientation, swap consistency, pair
exactness, claim behavior, combined validation, evidence, Atlas, and C1
retention must also pass. C5.2 validation must show at least a 5% reduction in
next-state target nats versus C2.

Cloze exact is reported but retired as a decision metric. C4.2 and C4.3 showed
that it is saturated and non-discriminating at this model scale.

A pass authorizes only a frozen multi-seed replication request. A pass does
not authorize promotion, test access, checkpoint publication, paid compute,
or another independent run.

## Boundaries

- Local Apple Silicon only, one seed-0 run, hard stop at 3,600 seconds.
- No AWS or paid compute.
- C2 initialization with fresh optimizer state.
- Frozen C4.2 validation and C5.2 validation only.
- C5.2 test content is absent from the ZERO import and stays sealed.
- Corpus, checkpoints, raw logs, and generations stay private.
- Symbolic serialization and verified auxiliary state-target loss are not
  present and cannot be claimed from this result.


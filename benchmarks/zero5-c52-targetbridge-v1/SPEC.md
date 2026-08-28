# ZERO.5 C5.2 TargetBridge verified-loss pilot

## Question

Does a verified factorized state-target loss connect C5.2's structured state
examples to the frozen C4.2 retrieval-choice behavior that the text-only C5.1
run did not improve?

This is one narrow causal test. The training packs, language loss, C2 starting
checkpoint, seed, optimizer, schedule, compute, and development sets are the
same as C5.1. The only treatment is an auxiliary state-target head with loss
weight 0.1.

## Matched control

The matched loss-off control is the completed C5.1 seed-0 run. The auxiliary
head is zero initialized and does not consume random numbers. With auxiliary
weight zero, the new runner produces a byte-identical base checkpoint to the
frozen C5.1 trainer. This was checked over ten optimizer updates with the
preregistered answer weights and schedule.

The treatment therefore needs only one full seed-0 run. It is not a retry of
C5.1 and it does not add a second control run.

## State target

The Braid target stream contains several typed factors for each record. ZERO
uses a separate softmax within each state family. Digits compete with valid
digits, predicates with valid predicates, and so on. Families with only one
observed value are excluded because they have zero information and zero
gradient.

Each target is read from the final hidden state at the last prompt token. It
cannot read the answer tokens. Mirrored choice A and B records remain exactly
balanced: 7,880 records in each orientation. The 752-tag projection adds
193,264 parameters, for 5,046,256 parameters in total.

## Decision

The auxiliary head must reduce development factor nats by at least 10% and
raise factor accuracy by at least five percentage points over its zero-head
control. Transfer must also be visible in the frozen retrieval audit: at least
one percentage point improvement in both choice accuracy and pair-exact
accuracy over C5.1. The frozen retrieval-position gap must stay under 15
percentage points. The C5.2 choice A/B token-accuracy gap must shrink by at
least five percentage points from C5.1, to at most 57.43 percentage points.

Claim accuracy may lose at most two percentage points versus C5.1. Combined
language loss may rise by at most 0.10 nats. The established evidence, Atlas,
and C1 retention limits still apply.

Cloze exact is reported but remains retired as a decision metric. A pass only
authorizes a multi-seed replication request. It does not authorize promotion.

## Boundaries

- Local Apple Silicon only, one seed-0 treatment run, hard stop at 3,600
  seconds.
- No AWS or paid compute.
- Frozen C2 initialization with fresh AdamW state.
- Frozen 37,768-pack C5.1 training view and frozen development validation.
- C5.2 test content stays absent and sealed.
- No symbolic serialization is imported or claimed.
- Corpus, checkpoints, raw logs, generations, and results stay private.
- No independent retry, publication, promotion, or test access is authorized.

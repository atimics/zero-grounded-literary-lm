# ZERO.5 C4.3 specification

## Status

**Primary contract frozen; training blocked.** Braid C4.3 v0.1.1 is pinned,
both private imports match, and the development pilot selected
`cloze-plus-five-v1`. This specification does not authorize primary training,
AWS use, paid compute, promotion, or test access.

C4.2 remains a no-go under its original frozen contract. C4.3 is a new
experiment; it does not re-score C4.2 under easier rules.

## Objective

Test whether broader exact-cloze coverage and harder evidence-dependent
retrieval examples can clear the two real C4.2 weaknesses without losing its
claim discrimination, pair accuracy, retention, or position robustness.

## Fixed controls

C4.3 keeps these values fixed:

- the 4,852,992-parameter ZERO.5 architecture
- the 512-token context and 512-token vocabulary
- the lossless tokenizer and its C4.2 hash
- the selected C2 initialization checkpoint and fresh AdamW state
- seed 0
- pair-atomic optimizer groups for mirrored records
- no more than 19,337,216 primary compute-token exposures
- the C4.2 validation artifacts, evaluator semantics, and C2 baseline scores
- the C4.2 sealed-test identity and hash-only policy
- no publication of private corpus data or checkpoints

Only the governed training view, its task mixture, and the resulting frozen
answer weights may change.

## Braid C4.3 training view

The requested release must satisfy all of the following:

### Exact cloze coverage

- At least 406,932 raw cloze answer-target tokens, three times the C4.2 count.
- Cloze must be at least 15% of all raw answer-target tokens.
- The release report must show counts for target lengths 1-4, 5-8, 9-16, and
  17 or more tokens.
- Repeated target text, repeated context, and source concentration must be
  reported so raw volume cannot be created by simple duplication.
- Cloze answers must be recoverable from their supplied context without task
  markers or answer leakage.

### Hard retrieval discrimination

- Each item must have one evidence-supported answer and one plausible but
  unsupported or contradicted alternative.
- The release must label and count entity, relation, numeric, temporal, and
  lexical-confounder negative types. Multi-label items are allowed.
- No single negative type may account for more than 50% of retrieval pairs.
- At least 25% of retrieval pairs must be lexical confounders: alternatives
  with strong surface overlap that still require the evidence to resolve.
- Alternative construction must not introduce position, length, punctuation,
  source, or template shortcuts detectable from the answer span alone.

### Mirroring and grouping

- Every claim and retrieval pair must include both answer orientations.
- Both orientations must carry the same stable pair ID.
- The pack plan must keep both orientations in one optimizer update.
- Correct-answer position counts must differ by no more than one record per
  task after filtering.

### Development and governance

- Provide a development slice for recipe checks. It must not overlap the
  primary training records, frozen C4.2 validation records, or sealed test
  records at record, normalized-text, or source-document level.
- Preserve attribution, provenance, rights, source balance, split membership,
  and all artifact hashes in the governed release.
- Keep the test set hash-only. Its content must remain absent from the ZERO
  checkout and runtime.

## Import and preflight

Before any training authorization, ZERO must:

1. Pin the Braid source commit, release ID, manifest, membership digest,
   pack-plan digest, tokenizer digest, and every generated artifact hash.
2. Produce two independent imports with identical output hashes.
3. Verify task counts, cloze coverage, length bands, negative-type counts,
   pair grouping, position balance, source overlap, and duplicate reports.
4. Recompute answer weights so weighted answer-target mass differs by no more
   than 10% across claim, cloze, and retrieval, with every weight at most 8.
5. Verify the primary pack plan uses exactly 19,337,216 compute-token
   exposures and zero wraps.
6. Run importer, evaluator, runner, and failure-path self-tests without opening
   the sealed test.

## Pilot

C4.3 has one non-promotional pilot before its primary run:

- use at most 2,800 optimizer groups
- use only the Braid development slice for selection
- compare no more than two preregistered answer-weight variants
- do not score the frozen C4.2 validation set or sealed test
- select the variant by development cloze exact match first, then retrieval
  choice accuracy, subject to no claim-choice regression

The pilot cannot promote a model. Its only output is the exact weight choice
for the final contract.

## Primary training

The final executable contract must be frozen after the pilot and before the
primary run. The primary run starts from the same selected C2 checkpoint, not
from C4.2 or the pilot. It uses one ordered pass, seed 0, fresh AdamW state,
pair-atomic groups, and at most the C4.2 compute exposure.

Paid compute requires a new explicit cost-ceiling approval. The launch must
fail closed on source, asset, contract, budget, instance-count, or test-policy
mismatch and must terminate the instance automatically.

## Promotion gates

All gates are conjunctive. C4.3 is a no-go if any one fails.

| Gate | Requirement |
| --- | --- |
| Combined validation | At least 10% lower nats/token than frozen C2 |
| Evidence retention | No more than 10% regression from frozen C2 |
| Atlas retention | Nats/token at most 2.50646 |
| C1 anchor retention | Nats/token at most 4.06362 |
| Claim choice | At least 55% and at least +2 points over C2 |
| Retrieval choice | At least 55% and at least +2 points over C2 |
| Position accuracy | At least 50% in each position |
| Position gap | At most 10 points for claim and 15 for retrieval |
| Claim swap | At least 95% and no more than 1 point below C2 |
| Retrieval swap | At least 95% and no more than 1 point below C2 |
| Pair-exact | At least +3 points over C2 for each task |
| Cloze exact | At least +1 point over C2 |
| Metric validity | Every required metric is finite |
| Test policy | Test metrics remain unopened |

For the frozen C2 baselines, the effective swap thresholds are 95.36% for
claim and 95.00% for retrieval. Both are within the possible 0-100% range.

Any future gate on a metric bounded to `[0, 1]` must pass a feasibility check:
`baseline + required improvement <= 1`. An absolute floor must also be within
the metric bounds. The machine-readable proposal enforces this rule.

## Decision procedure

The evaluator scores the selected primary checkpoint once on the frozen C4.2
validation views. If every gate passes, a separate authorization is still
required before opening the sealed test. If any gate fails, the test remains
closed and C4.3 is recorded as a no-go.

## Remaining freeze

Braid supplied the source commit, release ID, immutable artifacts, exact task
counts, group plan, data report, and rights record in PR #15. ZERO has frozen
the matching imports, pilot selection, implementation hashes, weights, and
update count. The two pilot timings select local Apple Silicon execution with
a one-hour hard stop; the slower observed rate projects about 31.2 minutes for
the primary exposure. Primary compute remains blocked until training is
explicitly authorized. Scale is a fallback, and any paid venue would need an
explicit cost ceiling.

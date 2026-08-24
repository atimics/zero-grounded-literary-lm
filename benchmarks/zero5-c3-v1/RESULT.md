# ZERO.5-C3 result

## Decision

**No-go under the frozen C3 gates.** The fixed 4,852,992-parameter model
learned the C3 distribution strongly and retained C2 Atlas and C1 anchors, but
it did not pass the answer-level claim, cloze, or retrieval-choice gates. All
C3 test records remained sealed.

This is a seed-0 pilot. It does not authorize model promotion, replication,
publication, or a claim that task structure beats more prose.

## Results

| Measure | C2 checkpoint | C3 selected checkpoint | Change | Gate |
| --- | ---: | ---: | ---: | --- |
| Combined C3 validation nats/token | 2.7818 | **1.6933** | **-39.13%** | pass |
| Claim answer nats/target token | 2.4356 | **2.2669** | **-6.93%** | **fail**: needed -10% |
| Cloze answer nats/target token | 2.9207 | **3.1171** | **+6.72%** | **fail**: needed -10% |
| Retrieval answer nats/target token | 2.8284 | **0.1177** | **-95.84%** | pass |
| Retrieval A/B choice accuracy | 0.00% | **52.05%** | +52.05 points | **fail**: needed 55% |
| Atlas validation nats/token | 2.2786 | **2.3498** | +3.12% | pass |
| C1 anchor validation nats/token | 3.6942 | **3.8640** | +4.60% | pass |

The retrieval choice result is 1,053/2,023. Its post-decision 95% Wilson
interval is 49.87% to 54.22%, which includes chance and remains below the
preregistered 55% gate. The validation labels are nearly balanced: 1,002
Passage A and 1,021 Passage B records.

Training completed exactly 7,589 updates, 15,542,272 token exposures, and one
ordered C3 stream pass. The selected checkpoint came from update 6,500. The
run took 2,558.38 seconds on the Accelerate backend.

The selected checkpoint is 58,236,384 bytes with SHA-256:

`ff19965c63db19fda3f179d9ab33b51ce40b3867f288a456a813f9bf4359487d`

The frozen `result.json` has SHA-256:

`b3770868cb30017649f5dc662e5a8487c96cf9bb8132ebdcc81817501fef3421`

The checkpoint remains a local build artifact and is not committed or
published.

## What it means

C3 produced a large compression gain, but the answer metrics show why ordinary
loss was not enough. Retrieval answers share the highly predictable text
`Passage `; the model learned that shell extremely well while the final A/B
decision stayed near chance. Claims improved, but not by the declared margin.
Cloze answer loss became worse even though whole-record cloze loss improved.

The curve and post-decision generations point to sequential-stage
interference. Validation dropped sharply when retrieval began, and the final
model often continues cloze prompts with retrieval-shaped text such as
`Passage B`. See `GENERATION.md`. This is useful evidence: the corpus contains
learnable task signal, but the blocked claims-to-cloze-to-retrieval order does
not preserve all three answer behaviours in this small model.

## Integrity and rights

- Trainer, importer, runner, tokenizer, initialization checkpoint, collection,
  token streams, and schedule are hash-bound in `contract.json`, `import.json`,
  and `result.json`.
- The official long retrieval records were audited before training. The model
  view retained the full instruction, query, answer, and equal exact
  210-code-point prefixes from both passages so every record fit context 512.
- The 4,585 claim, 3,556 cloze, and 2,026 retrieval test records were not
  evaluated. No compact retrieval test view was created.
- C3 is CC BY-SA 4.0-derived. Dataset and checkpoint publication remain
  disabled pending a separate rights review.

## Next

Stay at the fixed model size. Build a C3.1 control that uses the same records
and token budget but interleaves the three tasks with explicit replay instead
of presenting them as three solid blocks. Weight or mask the short answer span
so cloze and A/B decisions cannot be hidden by easy prompt tokens. Preregister
per-task answer loss, balanced A/B accuracy, and C2/C1 retention again.

Only if that fixed-size control passes should the project spend tokens on
replication or compare C3 structure with a token-matched extra-Atlas pass.

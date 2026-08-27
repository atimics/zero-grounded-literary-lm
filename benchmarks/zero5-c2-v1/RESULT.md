# ZERO.5-C2 result

## Decision

**Pass the fixed-model corpus-scale pilot.** One complete ordered pass over
Corpus 2 Atlas produced a large held-out improvement and also improved the C1
anchor validation distribution. Both test splits remained sealed.

This is a seed-0 pilot, not a three-seed promotion or an intelligence claim.

## Results

| Measure | C1 checkpoint | C2 selected checkpoint | Change |
| --- | ---: | ---: | ---: |
| Atlas validation nats/token, 128 windows | 4.9819 | **2.2786** | **-54.26%** |
| Atlas validation bits/raw byte | 4.0313 | **1.8438** | **-54.26%** |
| C1 anchor validation nats/token, 19 windows | 4.7048 | **3.6942** | **-21.48%** |

Every declared gate passed. The selected checkpoint came from the final report
at update 10,425. Training consumed exactly 21,350,400 token exposures, or
1.0000838 Atlas stream equivalents, with the one declared tail-covering wrap.
The run took 3,711.52 seconds on the Accelerate backend.

The selected checkpoint is 58,236,384 bytes with SHA-256:

`d6ca2c804f6aded47262060b30ba19e579ec2737e3fab5d0caf40a075148f849`

It remains a local build artifact and is not committed or published.

## What it means

The 4,852,992-parameter C model was strongly data-limited after Corpus 1. A
larger prose corpus taught the unchanged model and tokenizer much more without
catastrophic forgetting. The monotonically improving curve and the large
held-out margin make this a real in-distribution language-modeling result.

It is not yet a useful language model. Post-decision samples contain headings,
phrases, punctuation, and longer sentence-like structures, but still lose
word integrity and semantic continuity. See `GENERATION.md`.

## Integrity and rights

- Trainer, importer, runner, tokenizer, initialization checkpoint, collection,
  token streams, and schedule are hash-bound in `contract.json`, `import.json`,
  and `result.json`.
- Atlas training followed Braid's complete source-document curriculum order.
- The 101 C1 anchor test records and 641 Atlas test chunks were not evaluated.
- Atlas is CC BY-SA 4.0-derived. Dataset and checkpoint publication remain
  disabled pending a separate rights decision.
- Replication seeds 1 and 2 were not authorized by this pilot.

## Next

Use the selected C2 checkpoint as the fixed initialization for a separately
preregistered C3 task-curriculum pilot. Keep model size and byte-BPE512 fixed,
measure C3 task learning and both C2/C1 retention, and report gain per admitted
token. A later token-matched Atlas continuation control is required before
claiming that task structure itself beats additional prose exposure.

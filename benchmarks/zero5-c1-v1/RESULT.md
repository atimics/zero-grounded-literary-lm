# ZERO.5-C1 result

## Decision

**Pass the C training-signal gate.** All three seeds learned the governed
Corpus 1 validation distribution under the frozen schedule, and the seed-0
repeat produced a byte-identical checkpoint.

This is not a model promotion. Corpus 1 is too small and narrow for broad
pretraining, and the sealed test split was not opened.

## Results

The uniform 512-token baseline is 6.2383 nats per token, or 3.9031 bits per
raw validation byte under the frozen byte-BPE stream.

| Seed | Best update | Validation nats/token | Bits/raw byte | Reduction from uniform | Final train/validation gap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 300 | 4.7048 | 2.9437 | 24.58% | +0.0053 |
| 1 | 300 | 4.7382 | 2.9646 | 24.05% | +0.0207 |
| 2 | 300 | 4.8010 | 3.0039 | 23.04% | -0.0203 |
| **Mean** | — | **4.7480** | **2.9707** | **23.89%** | — |

The seed spread was 0.0962 nats per token against the frozen maximum of 0.25.
Every seed passed the per-seed 5.4 ceiling, and the mean passed the 5.2
ceiling. Train and validation loss remained close at the end of the schedule,
so this run does not show an obvious train-only memorization gap.

## Reproducibility

Seed 0 was trained twice from scratch. Both executions produced this exact
checkpoint SHA-256:

`551db1c441068196ee95c697477dd414fc1df267c17fa38c2f79f211092fc569`

The checkpoints are 58,236,384 bytes each. They are build artifacts and are
not committed. `result.json` binds all three checkpoint hashes, the C0 input
artifacts, trainer source, runner source, and frozen contract.

## What it means

ZERO.5 can now learn a stable held-out signal end to end in dependency-free C
using a governed Braid release and the selected lossless tokenizer. The curves
also show that it learned the shared Wikidata record format and vocabulary.

It did not become a useful generator. Fixed validation-prefix samples learned
surface markers such as `Description:` and `Aliases:` but remained mostly
gibberish. See `GENERATION.md`. That is consistent with only 80,352 unique
training tokens and 614,400 token exposures per seed.

## Integrity note

The first execution was rejected because it accidentally retained learned
position embeddings and exceeded the parameter contract. The runner stopped
after one invalid seed and published no result. The corrected full execution
uses rotary positions and exactly 4,852,992 parameters. See
`EXECUTION-NOTICE.md`.

## Next

This next step is now complete. ZERO.5-C2 kept the exact model and tokenizer,
continued seed 0 over one ordered Corpus 2 Atlas pass, and reduced final Atlas
validation loss by 54.26% while improving anchor validation by 21.48%. See
`../zero5-c2-v1/RESULT.md`. C2 passes as a single-seed corpus-scale pilot; it
does not retroactively promote C1 or authorize broader model claims.

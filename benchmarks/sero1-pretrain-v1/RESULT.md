# Sero 1 pretraining result

## Decision

**Promote Sero 1 as the first dense base-model artifact in the Sero lineage.**

All three frozen seeds passed every preregistered gate. This decision promotes
the model as a reproducible pretrained baseline. It does not claim that Sero 1
is yet a useful assistant.

## Final held-out results

| Seed | Validation BPB | Test BPB | Epoch-1 validation BPB | Decision |
| ---: | ---: | ---: | ---: | :--- |
| 0 | 1.6074 | 1.6143 | 1.8296 | go |
| 1 | 1.6101 | 1.6180 | 1.8309 | go |
| 2 | 1.6177 | 1.6219 | 1.8416 | go |
| Mean | 1.6117 | 1.6181 | 1.8340 | promote |

Population standard deviation was 0.00437 validation BPB and 0.00309 test
BPB. The worst seed remained well below the frozen 2.10 BPB ceiling, and every
seed improved after epoch 1.

The mean validation curve was:

| Epoch | Mean validation BPB |
| ---: | ---: |
| 0.25 | 2.4957 |
| 0.50 | 2.2282 |
| 0.75 | 1.9796 |
| 1.00 | 1.8340 |
| 1.50 | 1.7132 |
| 2.00 | 1.6573 |
| 2.50 | 1.6261 |
| 3.00 | 1.6117 |

The curve improved at every frozen measurement. There is no sign of late-run
validation regression.

## Source balance

Mean final BPB by held-out source was:

| Source | Validation BPB | Test BPB |
| :--- | ---: | ---: |
| English Wikibooks | 1.6400 | 1.6580 |
| English Wikinews | 1.5778 | 1.5915 |
| Simple English Wikipedia | 1.6162 | 1.6055 |

Wikibooks is the hardest of the three sources, but no source is failing. The
small gap also shows that the balanced corpus did not produce a single-source
shortcut.

## Scale and execution

- Parameters: 6,021,312
- Locked tokenizer vocabulary: 4,096
- Unique training bytes: 123,153,182
- Training tokens per epoch: 45,161,159
- Full token exposure: 135,483,477
- Tokens per parameter: 22.5007
- Mean training throughput: 103,354 tokens/second on one NVIDIA A10G
- Mean GPU training time: 1,311 seconds per seed
- Mean end-to-end trainer time: 1,444 seconds per seed
- Calibration cost: $0.1042
- Three full seeds: $1.4743
- Total measured EC2 cost: $1.5786

Every run used the same corpus, tokenizer, model shape, package versions, and
source commit. The three training schedules have distinct seed-bound hashes.
All instances ended cleanly, and the result and model artifacts are bound to
their private S3 objects by SHA-256.

## What still fails

Greedy samples show real local language structure but collapse into repeated
phrases. For example, all three completions of `In` repeat `Introduction.`.
Across those three 128-token continuations, only 4% of four-token sequences are
distinct. Other prompts also loop on phrases such as `The Supreme Court` or
`Australian Airlines`.

This is an important failure, not a reason to reject the pretraining result.
BPB proves that the model learned the held-out byte distribution. It does not
prove long-range coherence, factuality, instruction following, or healthy
free generation. The narrow three-source corpus, small model, lack of an
end-of-document token, and greedy decoding are all plausible contributors;
this experiment does not isolate them.

Sero 1 therefore succeeds as a real pretrained base model and as the baseline
for the next model. The next step should target corpus breadth and generation
quality while keeping this checkpoint as an untouched control.

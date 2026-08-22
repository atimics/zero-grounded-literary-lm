# Sero 1 pretraining preregistration

## Question

Can the first real Sero language model learn a stable base-language model from
the promoted, source-balanced corpus using the locked lossless byte-BPE
tokenizer?

This is a base-model experiment, not another tokenizer experiment. The
tokenizer, corpus, architecture, seeds, optimizer, epochs, checkpoints, and
decision gates are frozen before paid training.

## Data and tokenizer

The run is bound to `sero-pretrain/2026-08-22.v1`, digest
`6919a2a55495ff3364381d0861f6295412362f6dcf5fff46fda751b779a6d6b6`.
Its training split contains 123,153,182 unique bytes balanced across Simple
English Wikipedia, English Wikibooks, and English Wikinews.

Every document is encoded independently with the canonical 4,096-entry Sero 1
byte-BPE artifact, SHA-256
`59d13ac8133835e85b3414df5ec06c9145c860ceb1e7cc65efc90f50acc7caf1`.
Tokens are split into non-overlapping 512-token windows inside each document.
No window crosses a document boundary. Tail windows are padded and excluded
from loss. Every document and token is used once per epoch.

## Model and optimization

Sero 1 is a dense causal Transformer with tied input/output embeddings, a
private input-only beginning vector, width 256, eight heads, six layers,
feed-forward width 1,056, zero dropout, learned positions, pre-norm blocks, and
a final RMS normalization. It predicts only the 4,096 locked tokenizer ids.

Each seed trains for exactly three complete corpus epochs with batch size 16.
AdamW uses learning rate 0.0003, betas 0.9 and 0.95, epsilon 1e-8, weight decay
0.1, gradient clipping at 1.0, 2% linear warmup, and cosine decay to 10% of the
peak rate. CUDA runs use bfloat16 autocast with float32 parameters and optimizer
state.

Seeds are 0, 1, and 2. Seed 0 is the prospectively named canonical artifact;
seeds 1 and 2 test replication and cannot replace it by post-hoc selection.

## Evidence and decision

Complete validation is measured every quarter epoch. The complete test split
is measured once after the final update. Results must record raw-byte and token
exposure, source exposure, document-safe schedule hashes, tokenizer and model
hashes, package versions, wall time, throughput, and deterministic samples.

Sero 1 establishes the baseline only if every seed:

1. passes corpus, tokenizer, causality, finite-value, and accounting checks;
2. completes exactly three corpus epochs without crossing documents;
3. reaches at most 2.10 validation bits per raw byte;
4. reaches at most 2.10 test bits per raw byte; and
5. finishes with lower validation BPB than its one-epoch checkpoint.

There is no aggregate override, optional stopping, seed replacement, or
architecture change after calibration. A failure does not authorize a new
tokenizer; it sends the project back to model optimization or corpus quality.

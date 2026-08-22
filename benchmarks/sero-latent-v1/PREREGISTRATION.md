# Sero Latent v1 preregistration

## Question

At the same downstream neural-model size, initialization, optimizer, update
count, patch positions, and padded decoder work, do causal learned boundaries
improve held-out loss over a conventional 4,096-entry byte-BPE tokenizer?

This is the first end-to-end language-model ablation. It is deliberately not a
claim that tokenizer construction has equal cost: byte-BPE training time and
latent boundary-model training/scoring time are reported separately. If the
latent arm wins, a later experiment must fuse the boundary model with the local
encoder before making a system-throughput claim.

## Frozen inputs

The input is sealed dataset `zero-literary/2026-08-12.v1`, digest
`9ac3fcfd15e9e4cea44c0b8504799c9de33672fb0561d620bc1959b27b6ec736`.
Files are concatenated in lexical path order. Training is capped at 1,048,576
bytes; the disjoint validation split is capped at 131,072 bytes. Neither
tokenizer sees validation while fitting or calibrating.

## Arms

The static arm trains a lossless 4,096-entry byte-BPE with every byte in its
initial alphabet and an eight-byte maximum token length.

The latent arm trains a 32-dimensional tied-embedding GRU next-byte model for
200 updates. Entropy before byte *i* is computed strictly from bytes before
*i*. A single threshold is calibrated on the first 262,144 training bytes to
match the static control's training bytes per patch; patches are capped at
eight bytes.

Both segmentations feed the same model: tied byte embeddings, a local GRU byte
encoder, a two-layer causal patch Transformer, and an autoregressive local GRU
decoder. The decoder predicts bytes plus an explicit end-patch symbol, making
boundary cost visible in the primary metric. Each arm uses the identical
initial state, 300 updates, seed 0, 128 patch positions per update, and the same
number of padded decoder positions.

## Decision

The primary metric is validation total bits per raw byte, including end-patch
probability. Advance the latent design only if:

1. both representations reconstruct every input byte exactly;
2. downstream parameter counts and scheduled patch/decoder work are equal;
3. sampled training bytes differ by no more than 5%;
4. evaluated validation bytes differ by no more than 1%; and
5. latent validation total bits per byte is at least 1% below static byte-BPE.

Byte-only loss, boundary cost, patch-length distributions, model throughput,
and tokenizer construction time are mandatory diagnostics but cannot override
the frozen primary gate.

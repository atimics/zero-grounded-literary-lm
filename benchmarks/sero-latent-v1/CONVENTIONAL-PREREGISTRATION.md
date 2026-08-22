# Sero Latent v1 conventional-control preregistration

The first frozen ablation compares two segmentations under one local/global
architecture. Its seed-0 result is now immutable. This confirmation asks the
remaining system question: does that latent architecture beat a conventional
Transformer that predicts the 4,096 byte-BPE tokens directly?

No conventional-control validation result was inspected before this document.
The control is bound to byte-BPE artifact
`59d13ac8133835e85b3414df5ec06c9145c860ceb1e7cc65efc90f50acc7caf1`
and the same train/validation byte digests as the frozen latent result.

The control has dimension 48, four attention heads, four Transformer layers,
feed-forward dimension 192, context 16, tied input/output token embeddings,
seed 0, 300 updates, batch size 8, and learning rate 0.001. It sees the same
38,400 patch positions. At the frozen architectures and observed training
patch length, its analytic multiply-add estimate per patch position must be
within 10% of the latent arm; sampled raw bytes must be within 5%.

The primary metric is direct next-token negative log likelihood divided by the
exact number of raw bytes represented. Byte-BPE receives no artificial
end-patch symbol because its predicted token identity already determines both
content and length. Retain the conventional tokenizer if its validation bits
per raw byte matches or beats the frozen latent seed-0 value. Advance the
latent architecture over the conventional baseline only if exactness, compute,
exposure, and quality gates all pass.

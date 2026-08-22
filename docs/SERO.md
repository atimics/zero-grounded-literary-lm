# Sero model lineage

Sero is the successor research lineage to the historical ZERO experiments.
ZERO checkpoints, claims, and reproducibility hashes retain their existing
names. New tokenizer and base-model work begins with Sero; it does not rewrite
the evidence trail of the earlier models.

## Sero 0

Sero 0 is the lossless-byte reference contract. It reserves ids 1 through 7
for the existing channel protocol without sacrificing arbitrary binary input:
literal byte values 1 through 7 receive ids 257 through 263, id 256 is a
document boundary, and all other bytes retain their numeric ids. Learned merge
ids begin at 264. Raw inputs are never Unicode-normalized and have no unknown
token.

The reference architecture remains the audited 512-context, 256-dimension,
eight-head, six-layer, 1,056-wide rotary decoder. With the 264-entry tied
embedding it has 4,887,808 parameters. The machine-readable contract is
[`sero0-contract.json`](../sero0-contract.json).

Build and verify the canonical Sero 0 tokenizer with:

```sh
make sero0-check
make sero0-tokenizer
```

The check round-trips every byte value, Unicode, and deliberately malformed
byte sequences; proves deterministic artifacts and token streams; rejects raw
structural tokens; and verifies that the frozen historical trainer source hash
has not moved.

## Sero Latent v1

Sero Latent v1 tests the intersection of embeddings and tokenization directly:
a causal tied-embedding byte model chooses patch boundaries, a local byte
encoder maps each patch into the global stream, a patch Transformer models
long context, and a local autoregressive decoder restores exact bytes.

The experiment uses the sealed `zero-literary/2026-08-12.v1` train/validation
split. Its first ablation found that learned boundaries reduce explicit patch
termination cost consistently across three seeds. The preregistered seed
improved 4.198 to 4.071 total bits per raw byte under an identical local/global
model.

That was not enough to replace conventional tokenization. A separately frozen,
compute-matched Transformer predicting 4,096 lossless byte-BPE tokens directly
reached 4.004 bits per byte. It won all three seeds. Static byte-BPE therefore
remains the Sero control.

## Next lineage step

Sero Latent v2 should learn discrete patch codes. The global Transformer would
predict one code containing both patch content and length; a local residual
decoder would preserve exact bytes. This directly targets the v1 failure: the
latent model discovered useful boundaries but paid too much to regenerate
their contents and end markers byte by byte.

Any v2 promotion must again bind raw-data digests, fit only on training data,
round-trip every byte, and beat the conventional control at matched raw bytes
and analytic compute. Parameter counts, tokenizer construction cost, and
measured throughput remain mandatory diagnostics.

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

## Sero Latent v2

Sero Latent v2 tested that discrete-code repair. Its exact 4,095-entry patch
dictionary plus one residual escape code passed the data, reconstruction, and
compute gates, but lost to byte-BPE on all three seeds. Mean validation loss was
4.171 versus 3.993 bits per raw byte. Rare escaped patches covered about a
quarter of validation bytes and added 1.191 bits per byte of residual cost.

The later audit narrowed that result. V2 tested a top-frequency patch
dictionary, not a jointly learned continuous tokenizer. V1 and V2 also trained
on only about 132,000 to 139,000 sampled bytes and inherited a sorted-prefix
source imbalance. V1's explicit end-patch target was redundant under its
causal boundary rule. The old measurements remain valid for those exact
systems, but their broad hard-stop interpretation is retired.

## Sero Latent v3

V3 is the corrected learned-tokenizer test. A local causal encoder produces
contextual byte embeddings. Adjacent projected embeddings choose hard chunk
boundaries by cosine distance. Selected continuous embeddings enter a larger
global Transformer, then a causal smoothing and upsampling path returns them
to byte resolution for local decoding.

The output space is exactly 256 bytes. BOS is input-only. There is no
end-patch target, unknown byte, discrete codebook, or escape stream. Its H-Net
ratio target is measured from a training-only 4,096-entry byte-BPE tokenizer.
Both arms receive exactly the same manifest-sampled raw windows, and the
result records their schedule digest, source exposure, validation bytes,
compute estimate, wall time, and artifact hashes.

The model, control, invariant tests, smoke route, aggregation, and frozen
result checker are implemented. The smoke test is mechanics only. The real
three-seed experiment remains unrun and cannot promote until the corpus has at
least 100 million unique training bytes. See
[`PREREGISTRATION.md`](../benchmarks/sero-latent-v3/PREREGISTRATION.md) and
[`contract.json`](../benchmarks/sero-latent-v3/contract.json).

Sero 1's lossless 4,096-entry byte-BPE remains the current control, not a claim
that learned tokenization is hopeless. Its canonical artifact and dataset
binding are in
[`tokenizers/sero1-tokenizer.json`](../tokenizers/sero1-tokenizer.json); verify
the locked digest with `make sero1-tokenizer-check`.

# Sero Latent v3 preregistration

## Question

Can a causal byte language model learn useful, context-dependent chunks from
embedding changes and beat a strong byte-BPE Transformer as training data
grows?

V3 corrects two problems in the earlier experiments. Patch boundaries are
control-flow decisions, not language targets, so V3 has no end-patch symbol.
V3 also uses continuous learned chunk representations instead of an exact
frequency dictionary.

## Frozen representation

The model predicts exactly 256 raw byte values. A private beginning-of-stream
embedding may be used as input, but it is not an output class. There is no
unknown byte, end-patch output, codebook, escape code, or reconstruction loss.
Held-out quality is the ordinary autoregressive byte cross-entropy divided by
the number of raw bytes.

A causal local encoder maps the byte prefix at position `t` to `h_t`. The
router projects adjacent representations and assigns the boundary probability

```
p_t = 0.5 * (1 - cosine(Wq h_t, Wk h_(t-1)))
```

with `p_0 = 1`. A hard boundary is selected when `p_t >= 0.5`. Selected
representations form the continuous input sequence for the large global
Transformer. Its outputs are smoothed, causally repeated to byte resolution,
and combined with a projected local residual before a causal local decoder.
The complete system is trained jointly from next-byte loss plus the H-Net
ratio loss with weight 0.03. The target compression ratio is measured from the
training-only BPE sample and is never calibrated on validation.

The self-test must prove that changing a future byte cannot alter earlier
logits or boundaries and that language loss sends a gradient through the
router.

## Data and the conventional control

Input is read from the dataset manifest's document JSONL files, not from a
sorted concatenation of source files. Training windows are sampled with
probability proportional to their number of valid raw-byte starts multiplied
by the source sampling weight. Validation walks every held-out document in
raw-byte windows. Document boundaries are never crossed.

For each seed, V3 and the conventional control train on the exact same raw-byte
windows in the same order. A digest of that schedule and per-source byte counts
are mandatory evidence. Their raw-byte exposure must be exactly equal.

The promotion run is bound to `sero-pretrain/2026-08-22.v1`, dataset digest
`6919a2a55495ff3364381d0861f6295412362f6dcf5fff46fda751b779a6d6b6`.
Its training split contains 123,153,182 unique bytes across three equally
weighted sources. A different manifest is a different experiment.

The control is a tied-embedding causal Transformer that predicts byte-BPE token
identities directly. Its loss is converted to bits per raw byte using the exact
decoded byte length of every target token. The lossless 4,096-entry byte-BPE
tokenizer is retrained on a deterministic, representative training-only sample
from the same manifest. It is not copied from V1.

## Frozen scale and checkpoints

The promotion run uses seeds 0, 1, and 2, a raw-byte context of 256, batch size
8, and checkpoints after 10 million, 30 million, and 100 million raw training
bytes per arm. The full corpus must contain at least 100 million unique
training bytes. Runs on smaller corpora are useful smoke or calibration runs,
but cannot promote V3.

The default V3 model uses local width 48, two local encoder layers, two local
decoder layers, global width 88, four global layers, and global feed-forward
width 240. The BPE control uses width 96 and four layers. A training-only
calibration found 3.356 bytes per BPE token; the declared inference
multiply-add estimator gives a 1.001 latent-to-control ratio at that target.
The learned chunk rate is not forced, so the final observed rate must still
pass the 15% gate. Both models use zero dropout. Exact hyperparameters are also
frozen in `contract.json`.

## Compute and evidence

Compute estimates include local encoding, both router projections, continuous
chunk projection, global processing, smoothing/upsampling projections, local
decoding, and the 256-byte output projection. The control estimate includes
its vocabulary projection. Parameter counts, model wall time, tokenizer time,
validation throughput, observed bytes per chunk/token, package versions, and
artifact digests are mandatory.

The estimated inference multiply-adds per raw byte must be within 15% for every
seed. The wider tolerance acknowledges that the chunk rate is learned; the
actual ratio and wall time remain visible and cannot be hidden by the gate.

## Decision

V3 is a promotion candidate only if every seed:

1. passes causal, byte-only, finite-value, and data-integrity checks;
2. uses a corpus with at least 100 million unique training bytes;
3. has exactly matched raw-byte exposure and validation bytes;
4. stays within the compute gate; and
5. reaches at least 1% lower validation bits per raw byte than BPE at the
   100-million-byte checkpoint.

The 10M and 30M checkpoints are required to show the learning curve. There is
no aggregate override and no fourth tuning seed. A failed V3 run rejects this
one-stage embedding-router configuration; it does not prove that all learned
chunking is hopeless.

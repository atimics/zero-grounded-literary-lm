# Sero Latent v1 results

**Decision: retain the 4,096-entry static byte-BPE tokenizer for the current
Sero model, while advancing learned boundaries as a research mechanism.**

The seed-0 preregistered segmentation ablation passed. With the same
88,257-parameter local/global model, initialization, 38,400 patch positions,
and 345,600 decoder slots, learned causal patches reached 4.071 total bits per
raw byte versus 4.198 for static byte-BPE patches, a 3.04% reduction.

| Seed-0 segmentation ablation | Static patches | Latent patches |
| --- | ---: | ---: |
| Total bits/raw byte | 4.198 | **4.071** |
| Byte-only bits/raw byte | **3.765** | 3.811 |
| Boundary bits/raw byte | 0.433 | **0.259** |
| Validation bytes/patch | 3.291 | 3.324 |
| Training raw bytes sampled | 139,437 | 132,802 |
| Downstream parameters | 88,257 | 88,257 |

The gain is real but narrow in mechanism: latent boundaries make patch
termination much easier to predict, while byte-only prediction is 1.22% worse.
Exploratory untouched seeds 1 and 2 reproduced the total improvement; across
three seeds, latent patches improved over static patches in the same
architecture by 2.15% to 3.04% (mean 2.65%).

## Strong conventional control

The follow-up control predicts the same 4,096 byte-BPE tokens directly with a
tied-embedding Transformer. It uses the same 38,400 positions, 4.996% more raw
training bytes, and 94.53% of the latent arm's frozen analytic multiply-add
estimate. This is an intentionally strong compute-matched control with 314,704
parameters, versus 88,257 downstream latent parameters plus a 14,784-parameter
boundary model.

| Seed | Conventional BPE | Latent local/global | Winner |
| ---: | ---: | ---: | --- |
| 0 (preregistered) | **4.004** | 4.071 | Conventional |
| 1 (exploratory) | **3.964** | 4.055 | Conventional |
| 2 (exploratory) | **4.013** | 4.091 | Conventional |
| Mean | **3.993** | 4.072 | Conventional by 1.98% |

The conventional result closes the interpretation: learned segmentation is
not the weak point. The current latent architecture spends its advantage on an
autoregressive byte decoder and explicit end-patch code, while a static token
identity communicates content and length in one prediction.

## Next hypothesis

Sero Latent v2 should not merely make better spans. It should learn a discrete
patch code that the global model predicts directly, with a local residual byte
decoder for exact reconstruction. A finite codebook folds content and length
into the global prediction as BPE does, while retaining embedding-driven,
context-sensitive segmentation. Promotion still requires a fixed-data,
fixed-compute win over the conventional byte-BPE Transformer.

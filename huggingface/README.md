---
license: cc-by-sa-4.0
language:
  - en
pipeline_tag: text-generation
tags:
  - custom-code
  - character-level
  - c
  - wasm
  - tiny-language-model
  - literary
---

# ZERO.4

ZERO.4 is a 4,852,992-parameter, character-level decoder-only language model
with a 512-token context. Its 4.9 MB release artifact uses signed 8-bit matrix
rows with floating-point row scales. It has a dependency-free C inference
runtime and can also run locally in a browser through the upstream WebAssembly
build.

This is a small research model with an intentionally narrow literary lineage,
not a general-purpose assistant. Its unusual scale and inspectable runtime are
the point.

## Files and integrity

| File | Purpose |
| --- | --- |
| `model.litq8` | Quantized ZERO.4 weights |
| `model.json` | Architecture, promotion, and artifact metadata |
| `literary_infer.c`, `literary_infer.h`, `channel_protocol.h` | Minimal C runtime |
| `CORPUS_RIGHTS.md` | Source-level provenance, attribution, and jurisdiction notes |
| `zero4-memorization-v1.json` | Deterministic prompted-continuation release evaluation |

Expected model SHA-256:
`44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50`.

## Run locally

This custom format is not directly compatible with `transformers.AutoModel`.
Compile the included inference runtime:

```sh
cc -O2 -std=c11 -Wall -Wextra -Wpedantic literary_infer.c -o literary_infer -lm
./literary_infer model.litq8 "The zero opened its eyes, and" 240
./literary_infer model.litq8 --chat D "What walks beneath the moon?" 240
```

Inference is local; the runtime does not make network requests.

## Training lineage

ZERO.4 was initialized from the immutable ZERO.3 teacher and trained with
immutable ZERO.1, ZERO.2, and ZERO.3 teachers. The replay mixture comprised:

- project-authored foundation statements;
- Shakespeare and Blake editions identified by Project Gutenberg as public
  domain in the USA;
- Crowley works from Project Gutenberg and CC BY-SA Wikisource transcription
  contributions;
- a deliberately low-weight King James Bible stream;
- literary dialogue records derived only from those literary sources; and
- project-generated typed quantity-operation records.

No human chat export appears in the bound training lineage. Training text and
token streams are intentionally excluded from this model repository. Exact
sources, permanent Wikisource revisions, transformations, hashes, and caveats
are in `CORPUS_RIGHTS.md`.

## Evaluation

The promoted artifact was selected prospectively from Q2.6 seed 2 at update
500, then passed the frozen three-seed replication contract. On the bounded
1,000-case-per-task external screen, ZERO.4 scored 0.537 raw accuracy on BLiMP,
0.266 normalized accuracy on HellaSwag, 2.570353 bits/byte on TinyStories, and
zero exact matches on the project's adapted LAMBADA task. These results are
weak by modern general-language-model standards and should not be overstated.

The training experiment also validated quantity-operation routing when paired
with the upstream controller and deterministic arithmetic kernel. Those
components are not integrated into this standalone model artifact; the neural
model should not be described as performing reliable arithmetic by itself.

The included memorization report tests evenly stratified, deterministic
prompted continuations against every bound training stream. No protected
third-party stream reached the 32-token warning threshold across 80 probes;
the longest exact greedy prefix was 16 of 64 tokens. Eight of sixteen
first-party CC0 foundation probes were reproduced for all 64 tokens,
consistent with that small source's deliberate inspectability. Passing this
finite test does not prove that no training expression can ever be reproduced
under another prompt or decoding policy.

## Limitations and content warning

ZERO.4 is prone to incoherence, imitation of source style, confabulation, and
repetition. Its corpus includes archaic language and sexual, violent,
coercive, discriminatory, religious, and drug-related passages. Outputs may be
offensive or unsuitable for children. Do not rely on it for factual, medical,
legal, religious, historical, identity-related, or safety-critical guidance.

## Licenses

- Model weights: **CC BY-SA 4.0**, to the extent controlled rights apply.
- Included C runtime: **Apache 2.0**.
- Training sources: mixed, source-specific status; see `CORPUS_RIGHTS.md`.

When sharing weights or adaptations, retain the ZERO.4 attribution, upstream
repository link, model license, corpus-rights notice, and an indication of
changes. The CC BY-SA choice is a conservative response to ShareAlike
transcription contributions in the lineage; it is not a claim that model
weights are necessarily copyrightable adaptations in every jurisdiction.

Upstream project: <https://github.com/atimics/zero-grounded-literary-lm>

# Zero-grounded language models in C

Read [**The ZERO Manifesto**](MANIFESTO.md) and the
[mathematical foundations](FOUNDATIONS.md).

This project contains two dependency-free neural language models and a
mechanically checked synthetic-corpus generator:

- `zero_lm`: a 7,436-parameter character MLP that makes the construction easy
  to inspect.
- `literary_lm`: a configurable decoder-only transformer designed to train on
  collections such as Shakespeare, William Blake, and Aleister Crowley.
- `logic_corpus`: a reproducible generator for compact natural-deduction
  proofs over hereditarily finite sets.
- `channel_corpus`: a converter that turns scripts, verse, and consented chat
  exports into multi-speaker channels with explicit reply edges and learned
  lossy-memory transitions.

Both are written in C11. On macOS, `literary_lm` automatically uses Apple's
built-in Accelerate framework for matrix multiplication. Other platforms use a
portable C fallback.

The `docs/` directory contains a static chat interface for GitHub Pages. It
runs a row-wise int8 export of the trained model entirely in the browser using
the same C inference code compiled to WebAssembly. No prompt or generated text
is sent to a server.

`bpe_tokenizer` is the companion corpus normalizer and experimental byte-pair
trainer. Tests at 256, 512, and 2,048 vocabulary entries overfit fragments on
this corpus, so the final preset uses its cleaned 128-character ASCII stream
with no merges. The smaller vocabulary reallocates capacity to the transformer
while keeping the total parameter count unchanged.

## Build

```sh
make
make check
```

`make check` includes finite-difference checks of the hand-written transformer
backward pass as well as short end-to-end training runs.

## Run the browser chat

Build the 4.7 MB inference model and WebAssembly runtime from the recommended
checkpoint:

```sh
make web
python3 -m http.server 8000 --directory docs
```

The checked-in browser artifact is frozen ZERO.3-final at update 16,600
(`SHA-256 05b9824d54f9d290ea472c3da8f9791c3d18fb3775419bd408a7e803012c7c24`).
It is exported from `teachers/zero3-balanced-final.teacher`; override
`ZERO_WEB_ARTIFACT` only when deliberately testing another model.

Then open `http://localhost:8000`. The first visit downloads `model.litq8`;
after that, inference and conversation memory remain within the page. The UI
shows the model's evolving lossy channel memory and any recalled holographic
echo. It offers mixed, Shakespeare, Blake, and Crowley opening voices, together
with temperature, top-k, repetition, and output-length controls.

The standalone quantized C engine can also be tested without a browser:

```sh
./literary_infer docs/model.litq8 "The zero opened its eyes, and" 240
./literary_infer docs/model.litq8 --chat D "What walks beneath the moon?" 240
./literary_infer docs/model.litq8 --memory D "old memory" "new message" "reply" 100
node tests/test_web_model.mjs
```

GitHub Pages serves directly from `docs/`; no backend, API key, JavaScript
framework, or hosted inference service is required.

## Train the channel-native model

The original literary checkpoint is a useful language base, but raw dramatic
text does not identify which participant the model should speak as. Build the
structured channel data first:

```sh
make channel-data
```

Records contain a compact channel memory or vibe, up to three recent messages,
locally anonymized speaker roles, and either ZERO's target reply or an updated
lossy-memory target. The learned loop is `old memory + recent messages -> new
memory`, followed by `memory + recent messages -> reply`. Control values 1–7
reuse otherwise dormant rows in the existing 128-token vocabulary, so this
representation does not increase model size.

The browser also includes a 256-dimensional, 32-entry episodic index in the C
inference runtime. It follows `holostuff`'s `LocalAgentCore` contract:
deterministic text hypervectors plus exact cosine recall. Each completed
exchange is stored under its lexical content with the learned compressed memory
as its value. A later prompt can recall one sufficiently similar old episode as
an `echo`; the learned memory update then decides whether to retain it. The
index adds roughly 32 KiB of runtime state but no transformer parameters, model
weights, network service, or browser persistence.

Continue training from the literary checkpoint with the channel file weighted
more heavily than any individual author:

```sh
./literary_lm \
  --resume literary-v6.ckpt \
  --tokenizer corpus/literary.bpe \
  --text corpus/bpe/shakespeare.tok \
  --text corpus/bpe/blake.tok \
  --text corpus/bpe/crowley.tok \
  --channel corpus/channel/literary-dialogue.tok \
  --channel-weight 6 \
  --steps 4000 --batch 2 --lr 0.00005 \
  --dropout 0.1 --cosine \
  --report 100 --validation 20 \
  --best literary-v8.ckpt --patience 20 \
  --save literary-v8-last.ckpt --save-every 500 \
  --tokens 0
```

For channel records, training and validation use only the target reply or
memory span for cross-entropy. Headers and previous messages still condition
that target through attention. Sampling begins at record boundaries, and
validation begins on whole held-out records rather than an arbitrary byte
inside a conversation. After every exchange, the browser generates a new
memory and drops that completed pair from its working context.
The import format for consented human channel data is documented in
[`corpus/channel/README.md`](corpus/channel/README.md).

## Try the transformer

With no `--text` arguments, the program trains on a small embedded corpus. This
is useful for verifying the implementation:

```sh
./literary_lm --steps 2000 --batch 2 --save tiny.ckpt
```

The default `tiny` preset has a 64-byte context, two layers, and 119,104
parameters. It is a functional test and experimentation model, not the intended
author-corpus configuration.

## Train the literary model

Verified training editions are included under `corpus/`; their sources,
transformations, and checksums are documented in `corpus/README.md`. Build the
balanced literary tokenizer and encoded corpus first:

```sh
mkdir -p corpus/bpe
./bpe_tokenizer \
  --vocab corpus/literary.bpe \
  --text corpus/shakespeare.txt --out corpus/bpe/shakespeare.tok \
  --text corpus/blake.txt       --out corpus/bpe/blake.tok \
  --text corpus/crowley.txt     --out corpus/bpe/crowley.tok
```

Then train the fixed-budget model:

```sh
./literary_lm \
  --preset literary \
  --tokenizer corpus/literary.bpe \
  --text corpus/bpe/shakespeare.tok \
  --text corpus/bpe/blake.tok \
  --text corpus/bpe/crowley.tok \
  --steps 30000 \
  --dropout 0.1 \
  --cosine \
  --report 100 \
  --validation 12 \
  --best literary-v6.ckpt \
  --patience 50 \
  --save literary-v6-last.ckpt \
  --save-every 1000 \
  --tokens 0
```

The `literary` preset has:

- 512-character context
- 128-character normalized ASCII vocabulary
- 256-dimensional embeddings
- 8 attention heads
- 6 transformer blocks
- 1,056-dimensional feed-forward layers
- parameter-free rotary positions
- 4,852,992 trainable parameters

This is exactly the same parameter count as the original 256-byte literary
preset. The context is twice the original model's length, and corpus cleanup
removes typographic and editorial noise before training. It
is still a small specialist model—not a generally knowledgeable modern LLM.

With multiple `--text` arguments, the program chooses a file uniformly for each
training sequence, regardless of file size. It holds out the final 5% of every
file and averages validation across files. This prevents the much larger
Shakespeare collection from overwhelming Blake and Crowley.

Long training runs can be stopped with Ctrl-C. The current update is saved when
`--save` is present.

### Trained result

The final run stopped automatically at update 16,600 after 50 validation
reports without improvement. `literary-v6.ckpt` preserves update 11,600, the
best state, with held-out loss 1.6641. `literary-v6-last.ckpt` preserves the
later optimizer state for experiments but is not the recommended generation
checkpoint.

## Resume and generate

Resume for additional updates:

```sh
./literary_lm \
  --resume literary-v6-last.ckpt \
  --tokenizer corpus/literary.bpe \
  --text corpus/bpe/shakespeare.tok \
  --text corpus/bpe/blake.tok \
  --text corpus/bpe/crowley.tok \
  --steps 5000 \
  --tokens 0
```

Generate without training:

```sh
./literary_lm \
  --resume literary-v6.ckpt \
  --tokenizer corpus/literary.bpe \
  --generate-only \
  --prompt "To see a World" \
  --tokens 600 \
  --temperature 0.75 \
  --top-k 40 \
  --repetition 1.1
```

A checkpoint contains the architecture, weights, AdamW moments, update number,
and random-generator state. Resumed training therefore continues from the
saved optimizer state rather than merely loading weights. Use the same training
files in the same order when resuming so the restored random sequence selects
the same corpus ranges.

Run `./literary_lm --help` for every architecture, training, checkpoint, and
generation option.

## Generate a formal-logic corpus

`logic_corpus` produces an unbounded family of finite proof records without
changing the transformer architecture. Its small trusted checker combines:

- intuitionistic implication and conjunction rules;
- de Bruijn-indexed hypotheses, avoiding variable-capture ambiguity;
- canonical hereditarily finite sets built with empty set, pairing, union,
  and von Neumann successor; and
- exact evaluation of atomic membership, equality, and subset claims.

Generate and independently re-read/check a corpus:

```sh
./logic_corpus \
  --output corpus/logic/hf.txt \
  --examples 100000 \
  --seed 1 \
  --max-depth 3 \
  --max-chars 480

./logic_corpus --verify corpus/logic/hf.txt
```

Every record is kept below 480 ASCII characters by default, so a complete
problem and proof fit within the literary model's 512-token character context.
The final 5% of records use proof shapes absent from the earlier records,
providing a structural validation tail. The model's own split is measured in
tokens rather than records, so the boundaries are approximate.

Encode and train it through the existing pipeline:

```sh
./bpe_tokenizer \
  --vocab corpus/logic/hf.bpe \
  --text corpus/logic/hf.txt --out corpus/logic/hf.tok

./literary_lm \
  --preset literary \
  --tokenizer corpus/logic/hf.bpe \
  --text corpus/logic/hf.tok \
  --steps 30000 \
  --dropout 0.1 --cosine \
  --best logic.ckpt \
  --save logic-last.ckpt \
  --tokens 0
```

The concrete syntax, proof rules, held-out templates, and limitations are
documented in [`corpus/logic/README.md`](corpus/logic/README.md).

### Trained logic-v1 result

The first formal run used 250,000 generated records (46,955,875 character
tokens) and completed all 30,000 updates. `logic-v1.ckpt` preserves update
26,600, the best state, with held-out next-character loss 0.1491.
`logic-v1-last.ckpt` preserves the completed update-30,000 optimizer state.

A small deterministic proof probe on fresh formulas produced kernel-valid
proofs for all six proof shapes present in the training region. It produced one
valid proof out of four structurally held-out shapes: duplication succeeded,
while implication composition, conjunction reassociation, and nested
projection failed. This is a diagnostic rather than a statistically complete
benchmark, but it shows that low character loss does not imply general proof
search at this model size.

## Architecture

`literary_lm` implements, including its backward pass:

1. normalized-character embeddings and parameter-free rotary positions;
2. pre-RMS-normalized multi-head causal self-attention;
3. residual connections;
4. pre-RMS-normalized GELU feed-forward blocks;
5. final RMS normalization;
6. tied embedding/output weights and next-character cross entropy;
7. residual dropout, mini-batch gradient accumulation, gradient clipping,
   AdamW, cosine decay, early stopping, and best-validation checkpoints.

There is no external tensor, automatic-differentiation, tokenizer, or machine-
learning library. The tokenizer and every model operation are implemented in
C; Accelerate supplies optimized matrix multiplication on macOS.

## What “grounded in zero” means here

The full set-theoretic construction, transformer equations, channel objective,
recurrent-memory system, holographic index, and formal claims are given in
[`FOUNDATIONS.md`](FOUNDATIONS.md).

The finite mathematical ladder is represented concretely:

| Foundational idea | C representation |
| --- | --- |
| `0` / empty initial state | `calloc`-allocated storage |
| finite ordinals | array indices and dimensions |
| ordered sequences | byte-token arrays |
| finite functions | tables, matrices, and C functions |
| real-valued vectors | arrays of `float` approximations |
| function composition | transformer forward pass |
| parameter selection | backpropagation and AdamW |

Model storage begins zero-filled. Index-dependent deterministic initialization,
tokens, attention relations, and gradient updates then introduce structure. A
seed of zero is valid and is first taken through a successor-like `+1` operation.

This distinction matters: setting every weight to exactly zero would make
neurons permutation-symmetric, causing them to receive identical gradients.
Grounding means that the constructed objects have a common empty basis;
collapse means erasing the relations that distinguish those objects. The model
does the former without doing the latter.

C does not execute the ZFC axioms or construct exact set-theoretic real numbers.
It implements a finite encoding whose mathematical specification can be
formalized within ZFC.

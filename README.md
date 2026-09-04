# ZERO — a language model built from zero, in C

This is a from-scratch neural language model project with a thesis:
**start from nothing, account for everything.**

- Two dependency-free C11 language models. No PyTorch, no autodiff, no
  tokenizer or ML library — the transformer backward pass is hand-written and
  verified by finite differences in `make check`.
- A 4,852,992-parameter transformer trained on Shakespeare, Blake, Crowley,
  the King James Bible, and structured multi-speaker channels, then quantized
  to a 4.7 MB artifact that runs **entirely in your browser** — no server, no
  API key, no framework.
- A small model that learned exact arithmetic (99.6% exact commits) not by
  memorizing numbers, but by learning **when to delegate to a deterministic
  kernel** — after six preregistered experiments that failed and were
  published anyway.

The philosophy is in [The ZERO Manifesto](MANIFESTO.md); the mathematics is
in [FOUNDATIONS.md](FOUNDATIONS.md). Read them when you want the depth, not
before you're allowed to be curious.

## Try it in 60 seconds

```sh
make            # build everything, C11, no dependencies
make check      # finite-difference gradient checks + smoke training runs
make web        # build the 4.7 MB browser model and WebAssembly runtime
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`. The first visit downloads
[`docs/model.litq8`](docs/model.litq8) — the promoted ZERO.4 artifact — after
which inference and conversation memory stay inside the page. The UI shows the
model's evolving lossy channel memory and any recalled holographic echo, with
mixed / Shakespeare / Blake / Crowley opening voices, temperature, top-k,
repetition, and length controls.

Or skip the browser and talk to the quantized engine directly:

```sh
./literary_infer docs/model.litq8 "The zero opened its eyes, and" 240
./literary_infer docs/model.litq8 --chat D "What walks beneath the moon?" 240
node tests/test_web_model.mjs
```

## What's in the box

| Component | What it is |
| --- | --- |
| `zero_lm` | A 7,436-parameter character MLP — the smallest construction that is still fully inspectable (ZERO.1). |
| `literary_lm` | A configurable decoder-only transformer with hand-written forward and backward passes. Presets range from a 119K-parameter test model to the 4.85M-parameter literary model. |
| `bpe_tokenizer` | Corpus normalizer and experimental byte-pair trainer. The final preset uses a cleaned 128-character ASCII stream with no merges — reallocating capacity to the transformer at a fixed parameter count. |
| `logic_corpus` | A reproducible generator for compact natural-deduction proofs over hereditarily finite sets, with an independent checker. |
| `brainfuck_corpus` | An interpreter-checked generator for program execution, trace-composition, repair, and synthesis records. |
| `channel_corpus` | Converts scripts, verse, and consented chat exports into multi-speaker channels with explicit reply edges and learned lossy-memory transitions. |
| `state_corpus`, `modal_corpus` | Experimental generators for state composition and finite-world reachability; not yet in the training pipeline. |

On macOS the transformer uses Apple's Accelerate framework for matrix
multiplication; Linux uses OpenBLAS when installed, otherwise a portable C
fallback. Set `LITERARY_BACKEND=portable`, `openblas`, or `accelerate` to be
explicit.

## The idea: grounded in zero

The full set-theoretic construction, transformer equations, channel
objective, memory system, and formal claims are in
[FOUNDATIONS.md](FOUNDATIONS.md). Concretely, the finite mathematical ladder
looks like this in C:

| Foundational idea | C representation |
| --- | --- |
| `0` / empty initial state | `calloc`-allocated storage |
| finite ordinals | array indices and dimensions |
| ordered sequences | byte-token arrays |
| finite functions | tables, matrices, and C functions |
| real-valued vectors | arrays of `float` approximations |
| function composition | transformer forward pass |
| parameter selection | backpropagation and AdamW |

Model storage begins zero-filled; deterministic initialization, tokens,
attention relations, and gradient updates then introduce structure. A seed of
zero is valid and is first taken through a successor-like `+1` operation.

One distinction matters: setting every weight to exactly zero would make
neurons permutation-symmetric and collapse them into identical gradients.
**Grounding** means the constructed objects share a common empty basis;
**collapse** means erasing the relations that distinguish them. The model does
the former without the latter. C does not execute the ZFC axioms — it
implements a finite encoding whose specification can be formalized within ZFC.

## The lineage

| Model | What it is | The new idea |
| --- | --- | --- |
| ZERO.1 | `zero_lm`, 7,436 parameters | The zero-grounded construction itself. |
| ZERO.2 | Literary transformer, 4.85M parameters | Author corpora + channel-native training with lossy memory. |
| ZERO.3 | Distilled from both predecessors | Two frozen teachers replayed on every sequence to prevent catastrophic forgetting. |
| ZERO.4 | The current deployed model | Learned *when* to delegate arithmetic to a deterministic kernel, trained under preregistered gates. |

The promoted ZERO.4 checkpoint is the Q2.6 seed-2 update-500 artifact, SHA-256
`44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50`.
[`docs/model.json`](docs/model.json) binds the deployment to the three-seed
aggregate, AWS completion record, and source result.

## The ZERO.4 experiment arc

The question: **can a 4.85M-parameter model learn exact quantity behavior
without forgetting its language?** Every attempt was preregistered with
frozen gates, evaluated on declared seeds, and published — including the
failures.

The arc, in one breath:

1. **Q1–Q2:** the model can name operations perfectly but cannot copy
   arguments exactly. Lesson: route, don't compute.
2. **Q2.1:** move argument binding into the controller. Seed 2 hit 500/500
   exact commits — and missed the replay ceiling by 0.011 percentage points.
3. **Q2.2–Q2.2-R:** better measurement and repair; the family still split
   one-go/two-no-go. Lesson: the optimizer itself interferes with replay.
4. **Q2.3–Q2.5:** transactional AdamW with rollback, then a cumulative
   replay budget, then step-size backtracking. Each no-go, each narrowing the
   problem: the budget controlled, but no scalar step was small enough to
   learn under it.
5. **Q2.6:** change the *direction* of each update instead of its size —
   project out the component that points uphill on the replay surface. 700/700
   attempts committed, 99.8% limiting quantity rates, 1.1833% replay
   regression. **Go.**
6. **Q2.6-R:** seeds 1 and 3 replicated on AWS (after an infrastructure failure
   that invalidated a first passing run and was itself published). Three-seed
   conjunction: **go**. ZERO.4 promoted.

The authoritative decision lineage, with what changed, what was tested, and
what was decided, is in [`EXPERIMENTS.md`](EXPERIMENTS.md). Per-experiment
details live under `benchmarks/`:

| Experiment | Result | Details |
| --- | --- | --- |
| Q1, Q2, Q2.1 | Learned routing, not exact argument copying | [RESULTS](benchmarks/zero4-q1-v1/RESULTS.md), [RESULTS](benchmarks/zero4-q2-v1/RESULTS.md), [AGGREGATE](benchmarks/zero4-q21-v1/AGGREGATE.md) |
| Q2.2 / Q2.2-R | One go, two no-go; family **no-go** | [AGGREGATE](benchmarks/zero4-q22r-v1/AGGREGATE.md) |
| Q2.3 | Local per-attempt budget did not control cumulative drift | [contract](benchmarks/zero4-q23-v1/contract.json) |
| Q2.4 | Cumulative budget held, but blocked learning entirely | [RESULTS](benchmarks/zero4-q24-v1/seed2/RESULTS.md) |
| Q2.5 | Step-size backtracking bought 5 updates, then exhausted | [RESULTS](benchmarks/zero4-q25-v1/seed2/RESULTS.md) |
| Q2.6 | Direction-changing projection — **go** | [RESULTS](benchmarks/zero4-q26-v1/seed2/RESULTS.md) |
| Q2.6-R | Seeds 1 and 3 replicated — **ZERO.4 promoted** | [AGGREGATE](benchmarks/zero4-q26r-v1/AGGREGATE.md) |
| Q2.7 | Language-preservation repair: train only 11.15% of weights; AWS path staged, budget unauthorized | [contract](benchmarks/zero4-q27-v1/contract.json) |

Every go directory publishes its selected `selected.litq8` model, and the
results-integrity check fails closed if the model is missing, has the wrong
byte count, or does not match the SHA-256 frozen in `manifest.json`.

### Run the faculty gates

The gates are measured experiments, not promoted models. Commands reproduce
the recorded seed-2 lineage; new seeds require their own source frontiers
before repair runs:

```sh
make zero4-q1
make zero4-q2
make zero4-q21
make zero4-q22 ZERO4_Q22_SEED=2
make zero4-q22r ZERO4_Q22R_SEED=2
make zero4-q23-check
make zero4-q23-observer ZERO4_Q23_SEED=2
# Only after the observer result passes:
make zero4-q23-train ZERO4_Q23_SEED=2
make zero4-q24-check
# Only from the merged preregistered implementation:
make zero4-q24-train ZERO4_Q24_SEED=2
make zero4-q25-check
# Only from the merged preregistered implementation:
make zero4-q25-train ZERO4_Q25_SEED=2
make zero4-q26-check
# Only from the merged preregistered implementation:
make zero4-q26-train ZERO4_Q26_SEED=2
make zero4-q27-check
# Q2.7's AWS path is staged but its budget remains unauthorized.
```

Verify the frozen promotion record:

```sh
make experiment-budget-check
make zero4-promotion-check
```

Quantity JSON evaluation uses deterministic worker processes (default: online
CPU count, capped at 32) with copy-on-write model sharing; serial and parallel
output are byte-identical. `--jobs N` selects the degree,
`ZERO_QUANTITY_JOBS=N` works for existing drivers, `--jobs 1` is the serial
reference path. This is an execution optimization, not new evidence; the
calibration record is in
[`benchmarks/parallel-quantity-eval-calibration-v1/`](benchmarks/parallel-quantity-eval-calibration-v1/README.md).

### External language evaluation

[`ZERO-EVAL-1`](benchmarks/zero-eval-1/README.md) froze an evaluation-only
comparison of ZERO.3 versus ZERO.4 on BLiMP, HellaSwag, adapted LAMBADA, and
TinyStories bits/byte. The bounded 1,000-case AWS screen came back mixed:
+0.5 points BLiMP, worse TinyStories bits/byte, -0.5 points HellaSwag, zero
adapted-LAMBADA exact matches. The proposed full run is closed as
`do_not_run`.

Future training candidates use the
[`ZERO language-preservation gate v1`](benchmarks/zero-language-gate-v1/README.md)
(candidate-only BLiMP and TinyStories, frozen ZERO.3 aggregates reused,
~305s observed / 600s ceiling). Mechanics checks:

```sh
make external-eval-check
make zero-language-gate-check
```

## Measure channel behavior

The frozen [`zero-channel-v1`](benchmarks/zero-channel-v1/README.md) benchmark
tests matched coherent/incoherent continuations and deterministic episodic
recall on the deployed checkpoint, without sampling:

```sh
make zero-benchmark
make zero-benchmark-check
```

The current baseline and its interpretation are in
[`benchmarks/zero-channel-v1/results/BASELINE.md`](benchmarks/zero-channel-v1/results/BASELINE.md);
the four-way training comparison is frozen in
[`ablation-contract.json`](benchmarks/zero-channel-v1/ablation-contract.json).
The browser exposes the same bounded runtime policies: a recent transcript
window, recurrent lossy memory, memory with flat Holo recall, and an
experimental partitioned Holo index.

## Train the models

### Quick verification

With no `--text` arguments, `literary_lm` trains on a small embedded corpus —
useful for verifying the implementation:

```sh
./literary_lm --steps 2000 --batch 2 --save tiny.ckpt
```

The default `tiny` preset (64-byte context, 2 layers, 119,104 parameters) is a
test model, not the intended configuration.

### The literary model (ZERO.2 lineage)

Verified training editions are in `corpus/`; sources, transformations, and
checksums are documented in [`corpus/README.md`](corpus/README.md). Build the
tokenizer and encoded corpus:

```sh
mkdir -p corpus/bpe
./bpe_tokenizer \
  --vocab corpus/literary.bpe \
  --text corpus/shakespeare.txt --out corpus/bpe/shakespeare.tok \
  --text corpus/blake.txt       --out corpus/bpe/blake.tok \
  --text corpus/crowley.txt     --out corpus/bpe/crowley.tok
```

Train the fixed-budget model:

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

The `literary` preset: 512-character context, 128-character ASCII vocabulary,
256-dimensional embeddings, 8 attention heads, 6 transformer blocks,
1,056-dimensional feed-forward layers, parameter-free rotary positions, and
4,852,992 trainable parameters — the same parameter count as the original
256-byte preset, with twice the context.

With multiple `--text` files, each training sequence picks a file uniformly
regardless of size, and the final 5% of every file is held out for validation.
This keeps the much larger Shakespeare collection from overwhelming Blake and
Crowley. It is still a small specialist model, not a generally knowledgeable
modern LLM.

**Result:** the final run stopped at update 16,600 after 50 validation reports
without improvement; `literary-v6.ckpt` preserves the best state (update 11,600)
with held-out loss 1.6641.

### The channel-native model

Raw dramatic text does not identify which participant the model should speak
as. `make channel-data` builds structured records: a compact channel memory,
up to three recent messages, locally anonymized speaker roles, and either a
target reply or an updated memory target. The learned loop is
`old memory + recent messages -> new memory`, then
`memory + recent messages -> reply`. Control values 1–7 reuse otherwise
dormant vocabulary rows, so this adds no model size.

The browser runtime adds a 256-dimensional, 32-entry episodic index on top of
the C engine: deterministic text hypervectors with exact cosine recall. A
sufficiently similar later prompt recalls an old exchange as an `echo`, and
the learned memory update decides whether to keep it — roughly 32 KiB of
state, no extra parameters, no network, no browser persistence. The consented
human-data import format is documented in
[`corpus/channel/README.md`](corpus/channel/README.md).

Continue training from the literary checkpoint:

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

For channel records, cross-entropy is computed only on the target reply or
memory span; headers and previous messages still condition the target through
attention.

### ZERO.3: distillation with permanent teachers

ZERO.3 is a single parameter set distilled from both earlier models — not by
averaging incompatible arrays. Instead:

- the ZERO.2 transformer checkpoint initializes the student and stays loaded
  as a frozen teacher over every training sequence;
- `zero_lm` exports its deterministic ZERO.1 network as a frozen
  character-distribution teacher, applied only to the explicit foundation
  stream;
- ordinary next-character loss keeps learning Shakespeare, Blake, Crowley,
  the King James Bible, and structured channel replies.

For one foundation sequence, ZERO.3 minimizes the weighted cross entropy

```text
0.60 * observed target + 0.15 * ZERO.2 distribution
                       + 0.25 * ZERO.1 distribution
```

Outside that stream: `0.85` observed, `0.15` ZERO.2. The frozen ZERO.2 target
is replayed on all sources to limit catastrophic forgetting. The bridge
statements in `corpus/zero-foundation.txt` are new hard targets; ZERO.1's
embedded corpus and weights remain untouched.

```sh
make zero3-data    # teachers + all token streams, incl. cleaned KJB
make zero3-train   # absorption -> consolidation -> retention-balance
```

The recommended mix gives the Bible one-twelfth of sequences, channels
one-half, and the foundation stream one-sixth, keeping repetitive verse from
dominating the small model. Override the input or stage lengths as needed:

```sh
make zero3-train \
  ZERO2_CHECKPOINT=another-zero2.ckpt \
  ZERO3_STEPS=8000 \
  ZERO3_CONSOLIDATION_STEPS=1600 \
  ZERO3_BALANCE_STEPS=600
```

The stages produce `zero3.ckpt`, `zero3-consolidated.ckpt`, and
`zero3-balanced.ckpt`; the last is the recommended result. The later stages
exist because mixed-corpus validation alone did not fully preserve the frozen
channel benchmark.

**Historical result (update 16,300):**

| Stage | Update | Validation loss |
| --- | ---: | ---: |
| Broad absorption | 16,100 | 1.7540 |
| ZERO.2 consolidation | 16,200 | 1.7387 |
| Retention balance | 16,300 | 1.7347 |

On the frozen channel benchmark the final int8 export scored 13/18 transcript
and 17/24 recurrent wins versus 14/18 and 18/24 for the exact ZERO.2 teacher,
but with better mean positive-token bits and equal-or-better margins — a real
tradeoff, not an unqualified win. The subsequently frozen teacher is a
distinct update-16,600 artifact whose authoritative metrics are in
[`teachers/registry.json`](teachers/registry.json) and
[`TEACHERS.md`](TEACHERS.md).

### Resume and generate

A checkpoint contains the architecture, weights, AdamW moments, update number,
and RNG state, so resumed training continues from the saved optimizer state.
Use the same training files in the same order so the restored random sequence
selects the same corpus ranges.

Resume:

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

Generate:

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

Run `./literary_lm --help` for every option.

## Generate a formal-logic corpus

`logic_corpus` produces an unbounded family of finite proof records without
changing the transformer architecture. Its small trusted checker combines:

- intuitionistic implication and conjunction rules;
- de Bruijn-indexed hypotheses, avoiding variable-capture ambiguity;
- canonical hereditarily finite sets built with empty set, pairing, union,
  and von Neumann successor;
- exact evaluation of atomic membership, equality, and subset claims.

Generate and independently re-read a corpus:

```sh
./logic_corpus \
  --output corpus/logic/hf.txt \
  --examples 100000 \
  --seed 1 \
  --max-depth 3 \
  --max-chars 480

./logic_corpus --verify corpus/logic/hf.txt
```

Every record stays below 480 ASCII characters by default, so a full problem
and proof fit the model's 512-character context; the final 5% of records use
proof shapes absent from earlier records, giving a structural validation
tail. The concrete syntax and held-out templates are documented in
[`corpus/logic/README.md`](corpus/logic/README.md).

Encode and train through the existing pipeline:

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

**What the model learned — and didn't:**

- `logic-v1` (250,000 records, 30,000 updates): best held-out character loss
  0.1491. A deterministic proof probe on fresh formulas produced kernel-valid
  proofs for all six trained proof shapes, but only one of four structurally
  held-out shapes. Low character loss does not imply general proof search at
  this model size.
- `logic-shakespeare-v1` (+20,000 mixed updates, loss 0.8828): five of six
  trained shapes stayed kernel-valid, none of the held-out shapes succeeded,
  and Shakespeare-prompted output gained real dramatic cadence — a usable
  hybrid model with measurable formal-logic forgetting.

## Train the Infinite Monkey curriculum

The Brainfuck faculty extends the checked-corpus idea from proof terms to
program execution: bounded terminating programs, run under a strict 8-bit
interpreter, emitted as both a readable audit and a target-masked channel
stream. The held-out tail uses loop and data-movement shapes absent from
training.

```sh
make brainfuck-data     # build and independently verify the corpus
make monkey-smoke       # short end-to-end check of all transitions
make monkey-train       # cumulative stages, replaying every earlier corpus
make monkey-eval
```

Each stage gives the newly introduced language additional sampling weight but
continues replaying earlier corpora, finishing at `3/3/2/2/2` for Brainfuck,
logic, Shakespeare, Blake, and Crowley — all on the fixed 128-character
tokenizer and the same 4,852,992-parameter transformer. `make monkey-eval` writes the
completed seed-89 baseline and capacity verdict to
`benchmarks/infinite-monkey-v1/RESULTS.md`.

For the systematic-execution experiment, generate grouped state traces and
train the 9,876,800-parameter specialist:

```sh
make brainfuck-trace-data
make monkey-trace10m-smoke
make monkey-trace10m-train
make monkey-trace10m-eval
```

Each six-record `bf2` episode teaches two primitive transitions, a composed
block, completion, whole-program behavior, and synthesis or repair — the
compact state emitted as one chunk's channel summary becomes the next chunk's
channel memory exactly. Validation withholds program compositions while
retaining the primitive instruction vocabulary. Exact semantics, split
policy, options, and stage overrides are documented in
`corpus/brainfuck/README.md` (written by `make brainfuck-data`).

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

There is no external tensor, automatic-differentiation, tokenizer, or
machine-learning library. Everything is C; Accelerate and OpenBLAS only
supply optimized matrix multiplication.

## Documentation map

| Document | What it covers |
| --- | --- |
| [MANIFESTO.md](MANIFESTO.md) | The philosophy: why begin at zero. |
| [FOUNDATIONS.md](FOUNDATIONS.md) | Set-theoretic construction, transformer equations, channel objective, memory, formal claims. |
| [FACULTY.md](FACULTY.md) | The faculty-controller design behind the quantity experiments. |
| [TEACHERS.md](TEACHERS.md) | Frozen teacher registry and authoritative metrics. |
| [EXPERIMENTS.md](EXPERIMENTS.md) | The authoritative experiment decision lineage. |
| [ZERO4.md](ZERO4.md) | ZERO.4 proposals and design rationale. |
| [ZEROADMAP.md](ZEROADMAP.md) | The longer roadmap and frozen comparisons. |
| [SATURATION.md](SATURATION.md) | Capacity analysis. |
| [PROPOSALS.md](PROPOSALS.md) / [ENG.md](ENG.md) | Open proposals and engineering notes. |
| [`benchmarks/`](benchmarks) | Per-experiment contracts, results, and promotion records. |

GitHub Pages serves directly from `docs/` — no backend, API key, JavaScript
framework, or hosted inference service is required.

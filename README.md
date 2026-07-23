# Zero-grounded language models in C

Read [**The ZERO Manifesto**](MANIFESTO.md) and the
[mathematical foundations](FOUNDATIONS.md).

This project contains two dependency-free neural language models together with
checked corpus generators, validators, faculty-controller experiments, and a
small browser runtime:

- `zero_lm`: a 7,436-parameter character MLP that makes the construction easy
  to inspect.
- `literary_lm`: a configurable decoder-only transformer designed to train on
  collections such as Shakespeare, William Blake, and Aleister Crowley.
- `logic_corpus`: a reproducible generator for compact natural-deduction
  proofs over hereditarily finite sets.
- `brainfuck_corpus`: an interpreter-checked generator for execution,
  trace-composition, repair, and synthesis records.
- `state_corpus` and `modal_corpus`: experimental generators for
  modality-neutral state composition and finite-world reachability. They are
  not yet part of the Makefile training pipeline.
- `channel_corpus`: a converter that turns scripts, verse, and consented chat
  exports into multi-speaker channels with explicit reply edges and learned
  lossy-memory transitions.

Both are written in C11. On macOS, `literary_lm` automatically uses Apple's
built-in Accelerate framework for matrix multiplication. Linux uses OpenBLAS
when its development package is installed and otherwise retains the portable C
fallback. Set `LITERARY_BACKEND=portable`, `openblas`, or `accelerate` to make
the intended build explicit where supported.

The `docs/` directory contains a static chat interface for GitHub Pages. It
runs a mixed-format export—row-wise int8 matrices with floating-point scales
and normalization gains—entirely in the browser using the same C inference
code compiled to WebAssembly. No prompt or generated text is sent to a server.

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

Build the 4.7 MB inference model and WebAssembly runtime from the deployed
browser checkpoint:

```sh
make web
python3 -m http.server 8000 --directory docs
```

`make web` expects the local weight source `literary-v8-last.ckpt`. That binary
checkpoint is not stored in Git. The checked-in `docs/model.litq8` is the
frozen browser baseline at update 14,500, SHA-256
`63ccb24611e851aafc14905f8ca01cded5336a4cd755a420248e87abdf9bde89`.
It is distinct from both the historical ZERO.3 training run and the frozen
update-16,600 ZERO.3 teacher.

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

## Run the ZERO.4 faculty gates

ZERO.4-Q1, Q2, and Q2.1 are measured experiments, not promoted models. Q2.2 is
the frozen follow-up instrumentation experiment. Q1
tests neural arithmetic artifacts. Q2 keeps the three historical teachers
immutable, routes them by corpus, trains typed quantity requests as hard
targets, and lets an input-bound deterministic kernel alone calculate and
commit exact results. Q2.1 moves source-argument binding into the controller so
the student selects only the typed operation:

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
```

The paired Q2.2/Q2.2-R commands above reproduce the recorded seed-2 lineage.
New seed-1 and seed-3 replications require their own Q2.2 source frontiers
before Q2.2-R can repair them.

The frozen seed-1 reports are in
[`benchmarks/zero4-q1-v1/RESULTS.md`](benchmarks/zero4-q1-v1/RESULTS.md) and
[`benchmarks/zero4-q2-v1/RESULTS.md`](benchmarks/zero4-q2-v1/RESULTS.md). The
Q2.1 multi-seed result is in
[`benchmarks/zero4-q21-v1/AGGREGATE.md`](benchmarks/zero4-q21-v1/AGGREGATE.md).
Q2 learned closure, grammar, and operation routing perfectly, but not exact
numeric argument copying; bound-request commit therefore remained closed. Q2.1
fixed that responsibility boundary: seed 2 reached 500/500 exact commits with
controller-bound arguments, deterministic arithmetic, and zero rejected-state
mutations. The two-seed run still failed promotion because seed 2 replay loss
regressed 2.011%, just above the frozen 2.000% ceiling. Seed 3 was not run and
no ZERO.4 checkpoint replaces ZERO.3.

Q2.2 freezes the Q2.1 architecture and teacher weights, evaluates quantity and
replay jointly every 100 updates, and retains a feasibility-aware Pareto
frontier. Its first seed-2 replay report was invalidated because the evaluation
adapter accidentally restored a 2x foundation weight. The corrected adapter
preserves equal historical-source weights and reproduces the declared `1.6310`
baseline.

Q2.2-R repaired retained updates 400 and 300 using replay only. Seed 2 selected
update 400 plus 100 repair updates and passed: 488/500 promotion operations and
commits (97.6%), zero state mutations, and 1.919% replay regression. Seeds 1 and
3 then completed under the frozen acquisition policy and both stopped after
replay exceeded 2% on two consecutive full evaluations. Their strongest
retained diagnostics also missed the operation, exact-request, commit, and
exact-artifact gates. The final family decision is therefore **no-go** (one go,
two no-go); the failed seeds never touched the disjoint promotion split and no
ZERO.4 checkpoint replaces ZERO.3. The multi-seed report is in
[`benchmarks/zero4-q22r-v1/AGGREGATE.md`](benchmarks/zero4-q22r-v1/AGGREGATE.md).
Every Q2.2-R seed-level go directory also publishes its selected `selected.litq8`
model. The results-integrity check fails closed if that model is absent, has the
wrong byte count, or does not match the SHA-256 frozen in `manifest.json`.

Q2.3 is the preregistered lower-level follow-up. It makes each AdamW attempt a
transaction, measures faculty/replay conflict globally and by tensor, and
commits or rejects weights and optimizer moments together. Checkpoint v4 keeps
the committed counter separate from attempt, RNG, and rejection state. The
observer command runs a matching unguarded trajectory and requires the learned
checkpoint payload to remain byte-identical; its frozen calibration rule then
sets the nonzero guard band. The full seed-2 observer passed: 200/200 attempts
committed with byte-identical learned state, calibrating a 0.25% hard direct
functional-probe budget. Its first-order replay predictor was non-predictive,
so projection remains disabled. The guarded seed-2 run was a no-go: all 200
attempts committed, quantity reached the frozen threshold, and public replay
regressed 2.685%. No local probe increase reached the hard band, demonstrating
that the per-attempt budget did not control cumulative drift. Promotion and
seeds 1 and 3 remain sealed; the next design target is a preregistered
cumulative direct functional budget. See the machine-readable
[`contract.json`](benchmarks/zero4-q23-v1/contract.json),
[`ZERO4.md`](ZERO4.md#18-design-proposal--zero4-q23-transactional-optimizer),
and [`ZERO4-BACKLOG.md`](ZERO4-BACKLOG.md).

Q2.4 is that cumulative follow-up. Every candidate is evaluated
on the fixed validation window of all six replay sources and compared with the
same composite evaluated by immutable ZERO.3. A candidate above the frozen
1.5% cumulative budget is rolled back, leaving 0.5 percentage points of reserve
below the 2% public balanced-replay ceiling. The prospective seed-2 run was a
no-go: 66 candidates committed, then attempts 67–74 all exceeded the hard
budget and rolled back. The frozen eight-rejection fallback stopped the run
before its first 100-commit public checkpoint. Promotion was never evaluated,
and seeds 1 and 3 remain sealed. See
[`contract.json`](benchmarks/zero4-q24-v1/contract.json) and
[`RESULTS.md`](benchmarks/zero4-q24-v1/seed2/RESULTS.md).

Q2.5 kept every Q2.4 authority and gate fixed, but retried a rejected outer
attempt at deterministic learning-rate scales from 1 through 1/128. Each retry
restored the same pre-attempt weights and AdamW moments, reused the frozen
minibatch and clipped gradient, and committed the first trial at or below the
unchanged 1.5% cumulative replay ceiling. The prospective seed-2 run was a
**no-go**: 66 full-scale updates and five backtracked updates committed, with a
minimum accepted scale of 1/128 and a maximum committed replay increase of
1.49944%. Attempts 72–79 then exhausted every scale, stopping at 71 commits
before the first 100-commit public checkpoint. Promotion was never evaluated,
and seeds 1 and 3 remain sealed. Scalar step reduction was therefore
insufficient; the next proposal must change update direction or optimization
geometry without weakening the gates. See
[`contract.json`](benchmarks/zero4-q25-v1/contract.json) and
[`RESULTS.md`](benchmarks/zero4-q25-v1/seed2/RESULTS.md).

Q2.6 is the direction-changing follow-up. At each committed pre-attempt state
it forms the arithmetic-mean gradient of the same six frozen replay windows.
For every registered Q2.5 learning-rate scale, it removes only the component
of the candidate weight displacement that points uphill on that mean replay
surface, then submits the projected candidate to the unchanged direct 1.5%
cumulative functional guard. Candidate moments commit with selected weights;
weights and both moment arrays restore together before retries or rejection.
The gradient is candidate construction, never authority. The prospective
seed-2 run resolved **go**: 700/700 attempts committed, 423 selected candidates
were projected, and six of seven public checkpoints were jointly feasible.
Update 500 was selected with 99.8% limiting quantity rates and 1.1833% replay
regression; the one-time promotion evaluation passed at 99.6%. The quantized
model is published, but ZERO.3 remains current until seeds 1 and 3 replicate.
See
[`contract.json`](benchmarks/zero4-q26-v1/contract.json) and
[`RESULTS.md`](benchmarks/zero4-q26-v1/seed2/RESULTS.md).

Q2.6-R prospectively authorizes those two replications without altering the
diagnostic record. Its scientific contract remains frozen, but execution is
cancelled for cost: AWS seed 1 used the frozen portable-C Linux source and
reached its 11-hour wall limit without publishing a valid result; seed 3 was
not launched. This changes no scientific evidence. Seeds 1 and 3 remain
unobserved, family promotion remains unresolved, and ZERO.3 remains current.
See the [`replication contract`](benchmarks/zero4-q26r-v1/contract.json) and
[`execution cancellation`](benchmarks/zero4-q26r-v1/CANCELLATION.md).

The one-time
[`openblas-pilot-v1`](benchmarks/openblas-pilot-v1/README.md) completed 97
diagnostic attempts in 776 seconds at a sustained 0.125 attempts/second. It
projects the full 1,400-attempt workload at 3h06m40s and $2.12, excluding an
89-second cold start and driver evaluation overhead. The pilot is consumed and
its output cannot support a scientific decision.

The authorized
[`openblas-e2e-calibration-v1`](benchmarks/openblas-e2e-calibration-v1/README.md)
measures that missing baseline, recovery, and full-evaluation overhead on AWS
under a 25-minute/$0.29 ceiling. Seed 89 and a separate diagnostic driver keep
the output outside the frozen Q2.6-R scientific record. Run the local contract
checks with:

```sh
make experiment-budget-check
```

## Measure channel behavior

The frozen [`zero-channel-v1`](benchmarks/zero-channel-v1/README.md) benchmark
tests matched coherent/incoherent continuations and deterministic episodic
recall. It evaluates the deployed 4.85M-parameter checkpoint without sampling:

```sh
make zero-benchmark
make zero-benchmark-check
```

The browser exposes the same bounded runtime policies: a recent transcript
window, recurrent lossy memory, recurrent memory with flat Holo recall, and an
experimental partitioned Holo index. The current checked-in result and its
interpretation are in
[`benchmarks/zero-channel-v1/results/BASELINE.md`](benchmarks/zero-channel-v1/results/BASELINE.md).
The architecture stays fixed; the four-way training comparison is frozen in
[`ablation-contract.json`](benchmarks/zero-channel-v1/ablation-contract.json),
and the larger sequence of work is tracked in [`ZEROADMAP.md`](ZEROADMAP.md).

## Build ZERO.3

ZERO.3 is a single literary-transformer parameter set distilled from both
earlier models. It does not average their incompatible arrays. Instead:

- the ZERO.2 transformer checkpoint initializes the student and remains loaded
  as a frozen teacher over every training sequence;
- `zero_lm` exports its deterministic 7,436-parameter ZERO.1 network as a
  frozen character-distribution teacher;
- the ZERO.1 teacher is applied only to the explicit foundation stream; and
- ordinary next-character loss continues to learn Shakespeare, Blake,
  Crowley, the King James Bible, and structured channel replies.

The bridge statements in `corpus/zero-foundation.txt` do not modify ZERO.1's
embedded corpus or weights. They are new hard targets presented to ZERO.3 while
the original ZERO.1 function remains frozen.

For one sequence, ZERO.3 minimizes the weighted cross entropy

```text
0.60 * observed target + 0.15 * ZERO.2 distribution
                       + 0.25 * ZERO.1 distribution
```

on foundation examples. Outside that stream, the observed target receives
weight `0.85` and ZERO.2 receives `0.15`. The frozen ZERO.2 target is replayed
on all sources to limit catastrophic forgetting while the new corpus is
absorbed.

Prepare the teachers and all token streams:

```sh
make zero3-data
```

This includes the existing Shakespeare, Blake, Crowley, and channel data. It
also prepares a cleaned King James Bible from Project Gutenberg eBook 30. The
Bible is sampled as one ordinary text file, independently of its byte size; in
the recommended mix it receives one-twelfth of training sequences, while the
channel stream receives one-half and the foundation stream one-sixth. This
keeps its repetitive verse structure from dominating the small model.

Train from the consolidated ZERO.2 checkpoint:

```sh
make zero3-train
```

The target runs three deterministic stages: broad absorption, higher-weight
ZERO.2 consolidation, and a short retention-balance pass. The later stages
were added because mixed-corpus validation alone did not fully preserve the
frozen channel benchmark.

The default input is `literary-v8-consolidated.ckpt`; override it or the number
of updates when needed:

```sh
make zero3-train \
  ZERO2_CHECKPOINT=another-zero2.ckpt \
  ZERO3_STEPS=8000 \
  ZERO3_CONSOLIDATION_STEPS=1600 \
  ZERO3_BALANCE_STEPS=600
```

The stage checkpoints are `zero3.ckpt`, `zero3-consolidated.ckpt`, and
`zero3-balanced.ckpt`; the last is the recommended result. Teacher checkpoints
affect only training. ZERO.3 uses the unchanged 4,852,992-parameter transformer
and the existing WebAssembly export/runtime.

### Historical ZERO.3 training result

The completed run selected these hard-target validation states:

| Stage | Update | Validation loss |
| --- | ---: | ---: |
| Broad absorption | 16,100 | 1.7540 |
| ZERO.2 consolidation | 16,200 | 1.7387 |
| Retention balance | 16,300 | 1.7347 |

On the frozen `zero-channel-v1` benchmark, the final int8 export scored 13/18
transcript and 17/24 recurrent contrastive wins, compared with 14/18 and 18/24
for the exact ZERO.2 teacher. The binary counts are each one lower, but ZERO.3
has better mean positive-token bits (`2.3612` vs `2.3831` transcript and
`2.4835` vs `2.5004` recurrent) and equal or better mean margins. Flat and
partitioned holographic recall are unchanged at 7/8 and 5/8 because that index
is parameter-free. This is a real tradeoff rather than an unqualified channel
win, so the checked-in browser model was not replaced automatically. This
table describes the historical update-16,300 run. The subsequently frozen
teacher is a distinct update-16,600 artifact whose authoritative metrics are
recorded in `teachers/registry.json` and `TEACHERS.md`.

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

### Continued logic + Shakespeare result

`logic-shakespeare-v1` resumed the best pure-logic checkpoint for 20,000
additional updates, sampling logic and Shakespeare with equal probability. The
phase used a `1e-4` peak learning rate with cosine decay. The selected
`logic-shakespeare-v1.ckpt` is global update 43,300 with equal-weighted mixed
validation loss 0.8828; `logic-shakespeare-v1-last.ckpt` preserves the completed
global update 46,600 state.

On the same small deterministic proof probe, five of six trained proof shapes
remained kernel-valid, while none of the four structurally held-out shapes
succeeded. Shakespeare-prompted output gained recognizable dramatic cadence
and vocabulary. This demonstrates a usable hybrid model, but also measurable
formal-logic forgetting and continued weak proof-schema generalization.

## Train the Infinite Monkey curriculum

The Brainfuck faculty extends the same checked-corpus idea from proof terms to
program execution. `brainfuck_corpus` constructs bounded terminating programs,
runs every record under a strict 8-bit interpreter, and emits both a readable
audit and a target-masked channel stream. Its held-out tail uses loop and data
movement shapes absent from training.

Build and independently verify the program corpus:

```sh
make brainfuck-data
```

Run a short end-to-end check of all curriculum transitions:

```sh
make monkey-smoke
```

Then train Brainfuck, the generated finite-set logic language, Shakespeare,
Blake, and Crowley in cumulative stages:

```sh
make monkey-train
make monkey-eval
```

Each stage gives the newly introduced language additional sampling weight but
continues replaying every earlier corpus. Formal consolidation is followed by
a literature-heavy polish and a final rebalance at `3/3/2/2/2` for Brainfuck,
logic, Shakespeare, Blake, and Crowley. All stages
share the fixed 128-character tokenizer and the existing 4,852,992-parameter,
512-character transformer. Exact semantics, split policy, options, and stage
overrides are documented in
[`corpus/brainfuck/README.md`](corpus/brainfuck/README.md).

The completed seed-89 baseline and its measured capacity verdict are in
[`benchmarks/infinite-monkey-v1/RESULTS.md`](benchmarks/infinite-monkey-v1/RESULTS.md).

For the systematic-execution experiment, generate grouped state traces and
train the 9,876,800-parameter specialist:

```sh
make brainfuck-trace-data
make monkey-trace10m-smoke
make monkey-trace10m-train
make monkey-trace10m-eval
```

Each six-record `bf2` episode teaches two primitive transitions, a composed
multi-instruction block, completion from that state, whole-program behavior,
and synthesis or repair. The compact state emitted as one chunk's channel
summary becomes the next chunk's channel memory exactly. Validation withholds
program compositions while retaining the primitive instruction vocabulary.

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

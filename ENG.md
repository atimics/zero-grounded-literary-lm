# A Mathematician's Strategy Guide to ZERO Engineering

This document is for someone who has read `FOUNDATIONS.md` and wants to
understand how the mathematics maps to the C implementation—and how to
extend it. It assumes comfort with the ZFC ladder, the transformer equations,
and the channel protocol, and focuses on the *engineering* of those ideas:
data structures, invariants, build patterns, and the strategies that make a
4.85M-parameter, dependency-free C codebase tractable.

---

## 1. The Engineering Thesis

ZERO is built on one engineering bet:

> A hand-written C11 transformer with no external libraries, no automatic
> differentiation, and a 128-token vocabulary is small enough that one person
> can hold the whole system in their head and verify it by inspection.

Every engineering decision follows from this bet:

- **No tensor library.** Forward and backward passes are explicit loops or
  BLAS calls (Accelerate on macOS, portable C elsewhere). You can trace a
  gradient from the softmax back to the embedding table by reading one file.
- **No Python.** Training, inference, tokenization, and evaluation are all C
  binaries. The only JavaScript is the browser chat UI and a few data
  generation/evaluation scripts.
- **Preallocated core model buffers.** Forward, backward, and optimizer working
  memory is allocated in `model_create` and reused. Balanced validation and the
  optional faculty/replay gradient-cosine probe allocate temporary masks and,
  for the probe, a full replay-gradient copy when invoked.
- **Deterministic within a fixed build and backend.** Given the same executable,
  seed, corpus bytes, and update schedule, tested runs and resumes reproduce.
  Cross-platform BLAS implementations are not claimed to be bit-identical.
- **Finite-domain validators remain outside the learned model.**
  `logic_corpus` and `channel_corpus` are generator/checker binaries;
  `quantity_oracle` is a linked deterministic library used by the faculty
  controller and evaluators. The trainer does not call these validators to
  manufacture a correct neural target at inference time. This keeps
  "fluency ≠ validity" honest.

---

## 2. Source Map

### 2.1 Core training engine

| File | Lines | Purpose |
|---|---|---|
| `literary_lm.c` | 3,473 | Complete transformer trainer: forward, backward, AdamW, checkpointing, generation, tokenization, multi-teacher distillation, channel masking |
| `zero_lm.c` | 649 | Tiny 7,436-parameter MLP (ZERO.1). Pedagogical: you can read it in one sitting |
| `literary_infer.c` | 888 | Quantized inference + Holo episodic recall. Compiles to native and WASM |

### 2.2 Data generators and validators

| File | Lines | Purpose |
|---|---|---|
| `bpe_tokenizer.c` | 586 | BPE training and encoding. The `literary` preset uses no merges (128-char vocab) |
| `logic_corpus.c` | 1,306 | Intuitionistic natural deduction proofs over hereditarily finite sets. Has `--verify` mode |
| `channel_corpus.c` | 894 | Converts plays/verse/chat to multi-speaker channel records with reply edges |
| `brainfuck_corpus.c` | 1,501 | Brainfuck program and trace-composition generator/verifier |
| `state_corpus.c` | 813 | Experimental modality-neutral transition-composition generator; not yet a Make target |
| `modal_corpus.c` | 684 | Experimental finite-world reachability/modal generator; not yet a Make target |
| `quantity_oracle.c` | 177 | Exact rational arithmetic oracle for the quantity faculty |

### 2.3 Faculty and evaluation

| File | Lines | Purpose |
|---|---|---|
| `faculty_controller.c` | 400 | Atomic channel state machine (IDLE→EMITTING→CLOSED→COMMIT/REJECT) |
| `faculty_eval.c` | 683 | Quantized model evaluator: runs promotion samples through `literary_infer` + validators |
| `zero_eval.c` | 662 | Channel benchmark evaluation (transcript, recurrent, Holo modes) |
| `quantity_request_eval.c` | 411 | Operation-selection, controller binding, kernel, and atomic-commit evaluator |
| `export_literary.c` | 223 | Row-wise int8 quantization and weight-only export |
| `freeze_literary_teacher.c` | 162 | Extract weights from checkpoint (strip optimizer state) |

### 2.4 Headers (the contracts)

| File | Lines | Purpose |
|---|---|---|
| `channel_protocol.h` | 15 | The 7 control tokens. This is the *only* shared vocabulary contract |
| `faculty_protocol.h` | 71 | Channel state machine types and capacity constants |
| `literary_infer.h` | 31 | Inference + Holo API (the WASM boundary) |
| `zero1_protocol.h` | 29 | ZERO.1 architecture constants |

### 2.5 Scripts

| File | Purpose |
|---|---|
| `scripts/generate_zero4_faculty.mjs` (21KB) | Generates quantity, geometry, art, and protocol corpora |
| `scripts/evaluate_zero4_q*.mjs` | Compares quantity/replay candidates against declared gates |
| `scripts/train_zero4_q22*.mjs` | Joint-frontier training and replay-repair orchestration |
| `scripts/render_zero_results.mjs` | Renders benchmark results to Markdown with hash checking |

---

## 3. The Core Data Structures

### 3.1 The Model struct (`literary_lm.c` lines 87–117)

```
Model {
    Config cfg;                    // context, dim, heads, layers, ff, rotary, vocab
    Parameter token_embedding;     // V × d, tied to output
    Parameter position_embedding;  // T × d (only when !rotary)
    TransformerLayer layer[L];     // 6 copies of {norm1, wq, wk, wv, wo, norm2, w1, w2}
    Parameter final_norm;          // d
    Parameter **parameters;        // flat array of pointers (for iteration)
    int parameter_count;
    LayerCache cache[L];           // forward activations (needed for backward)
    float *final_x;                // d × T after last layer
    float *final_n;                // d × T after final RMSNorm
    float *probs;                  // V × T output probabilities
    float *rope_cos, *rope_sin;    // precomputed rotary trig tables
    Work work;                     // backward-pass gradient buffers
}
```

Key invariant: `parameters` is a flat array of `parameter_count` pointers,
used for bulk gradient, optimizer, checkpoint, and diagnostic iteration. Adding
a parameter requires appending to this array and updating checkpoint, teacher,
export, inference tensor-order/shape, and compatibility tests. The flat array
alone is not a complete serialization contract.

### 3.2 The Parameter struct

```
Parameter {
    const char *name;   // for checkpoint diagnostics
    size_t count;       // number of floats
    int decay;          // 1 = apply weight decay, 0 = skip (gains, biases)
    float *w;           // weights
    float *g;           // gradients (accumulated over batch)
    float *m;           // AdamW first moment
    float *v;           // AdamW second moment
}
```

**Rule**: every `Parameter` has `w`, `g`, `m`, `v` allocated together.
`freeze_literary_teacher.c` copies only `w` to produce a teacher artifact.
`--init` loads weights into `w`; freshly allocated `m` and `v` remain zero and
the seeded RNG remains fresh. `--resume` loads `w`, `m`, and `v` plus saved RNG
and update state. Gradients are transient and are not stored in checkpoints.

### 3.3 The Work struct (backward-pass scratch)

```
Work {
    float *dy;                  // gradient w.r.t. final hidden state
    float *dx;                  // gradient w.r.t. layer input (swapped with dy between layers)
    float *dr1;                 // gradient w.r.t. first residual
    float *dn2, *datt;          // gradients w.r.t. norm2 output, attention output
    float *dq, *dk, *dv;        // gradients w.r.t. query, key, value
    float *dn1, *dact, *dfpre;  // gradients w.r.t. norm1, GELU, pre-GELU
    float *tmp_td;              // T×d temporary
    float *attention_matrix;    // T×T attention score gradients
}
```

All are `calloc`'d once. The backward pass writes into them and reads from
`LayerCache`. No allocation during training.

### 3.4 The tokenizer

The tokenizer is a character-level normalizer with no BPE merges in the
literary preset. Vocabulary 128 = normalized ASCII. The mapping from raw bytes
to tokens is a lookup table built at startup. Tokenization is deterministic:
same input → same token sequence.

**Why 128?** The parameter count is fixed at 4,852,992. A smaller vocabulary
means more capacity goes to the transformer (bigger `d`, `f`, or `L`). The
tradeoff: each token carries fewer bits (7 vs 8), but the model can attend
over more characters per context window. For literary text, character-level
modeling at 512 chars works better than subword modeling at 256 tokens.

---

## 4. The Architectural Invariants

### 4.1 The parameter count is fixed

$P = Vd + L(4d^2 + 2df + 2d) + d = 4{,}852{,}992$

This is not a budget constraint—it's a *scientific* constraint for the ZERO.4
faculty experiments, so improvements there can be attributed to data,
objectives, or architecture rather than scale. The Infinite Monkey 9.88M trace
specialist is separately declared as a scale experiment. The Makefile's
`--preset literary` hardcodes the 4.85M dimensions.

You can change the architecture for exploration, but any result that adds
parameters must be declared as a *scale experiment*, not a ZERO.4 result.

### 4.2 Checkpoints are architecture-locked

A checkpoint stores the config struct plus all `Parameter` arrays. On load,
the config must match exactly (context, dim, heads, layers, ff, rotary, vocab)
or the program exits with an error. This prevents silent architecture drift.

### 4.3 The RNG is splitmix64, seeded as `seed + 1`

`rng_seed` applies `seed + 1` then a mixing function. Seed 0 is valid.
The internal state is saved in checkpoints, so `--resume` continues the
exact random sequence for the same executable and backend. This means:
- Corpus sampling order is reproducible.
- Dropout mask sequence is reproducible.
- Tested runs with the same build, backend, seed, schedule, and files reproduce;
  cross-platform BLAS bit identity is not part of the contract.

### 4.4 Training files are sampled uniformly, not by byte count

Multiple `--text` arguments each get weight 1 by default. The program chooses
a file, then a random position within that file's training region. This
prevents Shakespeare (5.4MB) from dominating Blake (66KB). Override with
`--sample-weight`.

### 4.5 Validation uses the tail of every file

The final 5% of each file is held out. Validation loss is averaged across
files. A model that memorizes Shakespeare but can't complete Blake will show
high validation loss.

---

## 5. How the Forward/Backward Pass Works

### 5.1 Forward pass (`model_forward_masked`, line 916)

For each token position $t=0,\ldots,T-1$:

```
1. h_t = token_embedding[input_t]           // V×d lookup
2. For layer ℓ = 0..L-1:
   a. n1 = RMSNorm(h_t, g1[ℓ])              // pre-norm
   b. q,k,v = W_Q*n1, W_K*n1, W_V*n1
   c. If rotary: RoPE(q), RoPE(k)           // in-place
   d. attention: softmax(q·k^T/√d_h) · v   // causal mask
   e. h_t += dropout(W_O · concat(heads))   // residual + dropout
   f. n2 = RMSNorm(h_t, g2[ℓ])
   g. h_t += dropout(W_2 · GELU(W_1 · n2))  // FFN residual
3. final_n = RMSNorm(h_t, g_f)
4. logits = token_embedding^T · final_n     // tied weights
5. probs = softmax(logits)
6. loss = -mean(log(probs[target_t]))       // only at masked positions
```

The `loss_mask` parameter is crucial for channel training: positions outside
the target span have `loss_mask[t]=0` and contribute zero to the loss and
zero to the initial gradient signal.

### 5.2 Backward pass (`model_backward_blended_masked`, line 1111)

The backward pass is the exact reverse:

```
1. dlogits = probs - target_distribution     // blended: hard target + teacher mixture
2. d(final_n) = token_embedding · dlogits   // linear backward (tied weights)
3. d(final_x) = RMSNorm_backward(d(final_n))
4. For layer ℓ = L-1..0:
   a. d(r1) = d(h_{ℓ+1})                     // residual gradient passes through
   b. FFN backward: GELU derivative → W_1^T → RMSNorm_backward → add to d(r1)
   c. Attention backward: W_O^T → softmax Jacobian → RoPE inverse → add to d(r1)
   d. RMSNorm_backward → d(h_ℓ)
5. token_embedding.gradient += d(h_0)        // accumulate for input tokens
```

The softmax Jacobian is the standard $J = \operatorname{diag}(p) - pp^T$.
The implementation computes this efficiently:

```
weighted = Σ p_j · dscore_j              // one per query position
dscore_j = p_j · (dscore_j - weighted) / √d_h   // in-place
```

### 5.3 Multi-teacher blending

When teachers are present, the target distribution at each output position is:

```
target_prob[token] = hard_weight * (token == observed)
                     + Σ soft_weight[t] * teacher_prob[t][token]
```

where `hard_weight + Σ soft_weight = 1`. This is a probability mixture, not
logit averaging. The gradient `probs - target_prob` flows through the same
backward pass regardless of how many teachers contributed.

**Key property**: if a teacher is ineligible for a position, its mass returns
to the hard target. The code enforces this with `teacher_mask`.

### 5.4 The optimizer (`optimizer_update`, near line 1267)

Standard AdamW with:
- `β₁=0.9, β₂=0.999, ε=10⁻⁸`
- Decoupled weight decay (only on parameters with `decay=1`)
- Global gradient norm clipping
- Linear warmup + optional cosine decay
- `model_zero_grad` called between batches

The optimizer iterates over `model->parameters[0..parameter_count-1]`, so
adding a parameter to that array is sufficient to include it in training.

### 5.5 Transactional optimizer boundary (ZERO.4-Q2.3 design)

Q2.2 measures the faculty/replay frontier after groups of updates. Q2.3 moves
the guard to the optimizer boundary. It does not checkpoint or perturb every
scalar weight independently. A backward pass exposes gradients for all weights
at once; separate faculty and replay probes therefore require separate
backward passes, not one perturbation run per weight. Diagnostics are
aggregated by the existing `Parameter` entries and by layer.

For every guarded attempt the trainer will:

1. compute separate faculty and fixed replay-probe gradients;
2. record global and per-parameter-group norms, gradient cosine, and
   `replay_gradient dot proposed_displacement`;
3. construct candidate weights and AdamW moments in preallocated shadow
   storage;
4. optionally project or backtrack a candidate that exceeds its local replay
   budget;
5. run the declared small functional probe against the shadow weights; and
6. atomically commit or reject weights and optimizer moments together.

The committed learned state is `(weights, first moments, second moments,
committed update)`. The orchestration state is `(attempt, sampler/RNG state,
adaptive guard state)`. A rejected attempt restores the learned state but
advances orchestration, avoiding an infinite retry of the same rejected batch.
Both states must be serialized for exact resume.

The disabled path must remain bit-identical to the current optimizer. The
guarded path may not allocate memory inside the training loop. A rejected
attempt must leave a byte-identical learned-state digest, and the sum of
per-group drift contributions must reproduce the global dot product within a
declared floating-point tolerance.

---

## 6. Patterns for Adding a New Faculty

### 6.1 The pipeline

A new faculty requires four artifacts:

```
[Generator] → token stream (.tok) → [Trainer] → checkpoint (.ckpt)
                    ↓
           promotion samples (.tsv)
                    ↓
              [Evaluator] → report
```

Every file below shows the pattern. Let's trace the Quantity faculty:

**Step 1: Generator** (`scripts/generate_zero4_faculty.mjs`)
- Generates canonically correct quantity chunks.
- Assigns latent units to train/validation/promotion splits *before* rendering.
- Writes three views: JSON Lines manifest, target-masked `.tok` file, promotion `.tsv`.
- Controlled negatives are generated by traceable mutation and independently rejected.

**Step 2: Token stream format**

```
@enter quantity solve
@memory
the current quantity summary
@input
add 3 7
@output
@artifact
result 10
@summary
kernel committed result 10
@close
```

Only the `@output` span has `loss_mask[t]=1`. The `--artifact-weight` flag
multiplies the loss on artifact lines specifically, useful for domains where
the artifact must be exact.

**Step 3: Training**

```
./literary_lm --init teachers/zero3-balanced-final.teacher \
    --hard-channel corpus/faculty/generated/quantity.tok --sample-weight 34 \
    --artifact-weight 4 \
    ... (literary/channel replay files) ...
```

`--hard-channel` means no teacher logits for this file (weight returns to hard
target). `--sample-weight 34` means 34× more quantity sequences than any
single literary file.

**Step 4: Evaluation** (`faculty_eval.c`)

The evaluator:
1. Loads the quantized model via `literary_infer`.
2. Feeds each promotion sample (up to the `@output` tag).
3. Generates tokens until `@close` or max length.
4. Parses the `@artifact` line.
5. Runs the domain validator (e.g., `quantity_oracle_execute`).
6. Reports: close rate, syntax rate, exact artifact rate, target bits.

### 6.2 The validator contract

A validator is a C function with signature:

```
int quantity_oracle_execute(const char *request, char *artifact,
                            size_t artifact_capacity, char *summary,
                            size_t summary_capacity);
```

Returns 1 if the `request` is valid and the result is correct, 0 otherwise.
The validator is an *oracle*: it computes the correct answer from the request,
then compares against the model's output. The model never calls it during
training.

### 6.3 Adding a new domain validator

1. Create `zero_Y.c` / `zero_Y.h` with an `execute` function.
2. Create a generator (JavaScript or C) that produces `.tok` + `.tsv` files.
3. Add targets to the Makefile following the `zero4-q1-*` pattern.
4. Add the validator to `faculty_eval.c` following the quantity pattern.
5. Add the channel to `zero4-contract.json` and `faculty-v1.json`.
6. Run `make zero4-smoke` to verify the pipeline with 20 training steps.

### 6.4 The split-before-surface rule

This is the hardest rule to get right and the easiest to violate:

> Assign the latent object (proof, scene, equation) to train/val/test *before*
> generating any natural-language surface forms.

Violating this rule creates leakage. The `generate_zero4_faculty.mjs` script
enforces it by assigning splits at latent-object creation time.

---

## 7. How the Channel Protocol Works

### 7.1 The seven control tokens

Defined once in `channel_protocol.h`:

| Token | Value | Role |
|---|---|---|
| `CHANNEL_START_TOKEN` | 1 | Record begins |
| `CHANNEL_MESSAGE_TOKEN` | 2 | Message begins |
| `CHANNEL_REPLY_TOKEN` | 3 | Reply edge (next token = addressed role) |
| `CHANNEL_MESSAGE_END_TOKEN` | 4 | Message ends |
| `CHANNEL_RECORD_END_TOKEN` | 5 | Record ends |
| `CHANNEL_TARGET_TOKEN` | 6 | Supervised span begins |
| `CHANNEL_SUMMARY_TOKEN` | 7 | Memory summary begins |

These are `unsigned char` values 1–7, which are normally unused ASCII control
characters. They don't collide with printable text (32–126) or newline (10).

### 7.2 How target masking works

`weight_artifact_span` (line 1411) scans the target token sequence:

1. Finds `CHANNEL_TARGET_TOKEN` → marks everything until `CHANNEL_RECORD_END_TOKEN`
   as a target position (`loss_mask[t]=1`).
2. Within the target span, if `--artifact-weight` > 0, positions inside
   `@artifact` lines get multiplied by `artifact_weight`.
3. Outside the target span, `loss_mask[t]=0`.

For a channel record, only the target reply or target memory contributes to
the loss. The header (channel style, old memory, previous messages, reply
edges) conditions the target through attention but is not itself supervised.

### 7.3 The faculty controller state machine

```
IDLE
  │
  ├── ENTER(faculty, task) → EMITTING
  │     │
  │     ├── EMIT(artifact, summary, request) → EMITTING (can call multiple times)
  │     │
  │     └── CLOSE → CLOSED
  │           │
  │           ├── VERIFY(valid=1) → IDLE  (commit: artifact + summary stored)
  │           └── VERIFY(valid=0) → IDLE  (reject: old state preserved)
  │
  └── (any other transition) → error, return 0
```

**Switch lock**: `faculty_enter` returns 0 unless `state == IDLE`.
**Atomic commit**: artifact and summary are written together only on valid
verification.
**Channel isolation**: channels are indexed by id; no channel can write to
another channel's state.

---

## 8. The Holo Episodic Recall

### 8.1 The encoding function

`holo_add_feature` in `literary_infer.c` implements a deterministic sparse
hypervector encoder:

1. Find word boundaries.
2. Skip a fixed list of 20 stopwords.
3. Hash whole words, selected prefixes, and adjacent-word pairs.
4. Expand each feature into 16, 6, or 8 deterministic signed coordinates with
   feature-specific weights.
5. Accumulate those sparse signed features.
6. Normalize to unit L2 norm.

This is parameter-free, deterministic, and produces approximately orthogonal
vectors for unrelated texts (~0 cosine) and positive cosine for related texts.

### 8.2 Partitioned mode

`LM_HOLO_PARTITIONED` divides the 32-slot buffer into 4 partitions of 8 slots
each. The partition is selected by maximum dot product with four deterministic
anchor vectors. This prevents one high-frequency topic from evicting all
entries. The frozen small benchmark scored 5/8 partitioned versus 7/8 flat;
robustness under adversarial eviction remains a design motivation, not a
measured claim in that benchmark.

### 8.3 The abstention threshold

The browser policy threshold `η=0.22` was chosen empirically. The C index always
returns its best available slot and score; `docs/app.js` discards that result
below the threshold so the model generates without an echo. Abstention is a
caller policy, not part of `lm_holo_recall` itself.

---

## 9. Build System Patterns

### 9.1 The two architectures

The Makefile distinguishes macOS (Accelerate) from everything else (portable C):

```makefile
ifeq ($(UNAME_S),Darwin)
LITERARY_CFLAGS := -DUSE_ACCELERATE -DACCELERATE_NEW_LAPACK
LITERARY_LDLIBS := -framework Accelerate -lm
else
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
endif
```

The `#ifdef USE_ACCELERATE` blocks in `literary_lm.c` call `cblas_sgemm` for
matrix multiplication. The portable fallback uses explicit triply-nested loops.
Both are in the same file; the preprocessor selects one.

### 9.2 Checkpoint formats

There are three model artifact formats:

**Full checkpoint** (`.ckpt`): Architecture config + weights + AdamW first and
second moments + RNG state + update count. Used for
`--resume`. ~58MB.

**Teacher artifact** (`.teacher`): Architecture config + weights only. Used
for `--init` and `--teacher`. ~19MB. Produced by `freeze_literary_teacher`.

**Quantized model** (`.litq8`): Row-wise int8 weights + architecture header.
~4.7MB. Loaded by `literary_infer` in browser and CLI. Produced by
`export_literary`.

### 9.3 The `--init` vs `--resume` distinction

- `--init`: Load weights from a teacher artifact or compatible full checkpoint.
  Optimizer moments and the deterministically seeded RNG are fresh.
- `--resume`: Load everything from a full checkpoint. Continues training from
  the exact optimizer state and RNG sequence.
- `--eval-only`: Load weights, run validation, exit. No training.

The ZERO.4 contract requires `--init` from ZERO.3, never `--resume`. This
ensures the student's optimizer and data order are independent of the
teacher's training history.

### 9.4 The smoke test pattern

Every pipeline has a smoke test:

```makefile
zero4-smoke: literary_lm zero4-faculty-check
    ./literary_lm --init teachers/zero3-balanced-final.teacher \
        ... --steps 20 --batch 1 ...
    ./literary_lm --resume /tmp/zero4-smoke-best.ckpt --eval-only ...
```

20 training steps. If it doesn't crash and validation loss is finite, the
pipeline is wired correctly. Full training with `--steps 4000` follows only
after smoke passes.

---

## 10. The Corpus Contract

### 10.1 Provenance

Every corpus file has a documented provenance chain:

```
Source edition (URL, access date)
  → cleaned text (script, normalization rules)
    → tokenized file (.tok, SHA-256)
      → train/validation split boundaries
```

`corpus/SHA256SUMS` and `corpus/README.md` record the pinned literary and core
derived-data pipeline. Generated experiment directories carry their own
manifests or reports. Experimental `state_corpus.c` and `modal_corpus.c` do not
yet have frozen generated artifacts or manifest hashes and must not be described
as frozen corpora.

### 10.2 Split integrity

The fundamental rule:

> A latent source unit (play, poem, channel, proof template, scene graph)
> belongs entirely to train, validation, public test, or hidden test.

Random token-level splitting is forbidden. `logic_corpus` implements
structural holdout: 95% of proof templates appear in training, 5% are
reserved. The model sees the held-out templates only at evaluation.

### 10.3 Channel-level splitting

For consented human channels, the split unit is the *whole channel*—all
messages from a group or conversation. One participant's conversation cannot
have messages in both train and validation.

---

## 11. The Checkpoint Lifecycle

### 11.1 How checkpoints are created

`checkpoint_save` writes to a temporary path, then `rename`s to the final
path. This is atomic on POSIX filesystems: the final path either contains a
complete checkpoint or doesn't exist. A Ctrl-C during save leaves the
temporary file, not a corrupted checkpoint.

### 11.2 Best vs last

- `--best literary-v6.ckpt --patience 50`: Before each save, compare
  validation loss. If it's the best seen, copy to `literary-v6.ckpt`. If
  `patience` validations pass without improvement, stop training.
- `--save literary-v6-last.ckpt --save-every 1000`: Save full state every
  1000 updates, overwriting. This is the fallback for resuming.

The recommended generation checkpoint is `--best`, not `--last`. The last
checkpoint may already be overfitting.

### 11.3 The teacher freeze protocol

1. Train to completion, identifying the best-validation update.
2. `./freeze_literary_teacher best.ckpt teacher.teacher`
3. Record the SHA-256 of `teacher.teacher` in `teachers/registry.json`.
4. The `.teacher` file is now immutable. Training continues from it with
   `--init`, never `--resume`.

### 11.4 Proposed Q2.3 checkpoint granularities

The following is the transactional optimizer design, not behavior implemented
by the current trainer or Q2.2-R orchestration:

- **Attempt transaction:** an in-memory shadow state for every guarded
  optimizer attempt. This is the rollback unit.
- **Recovery checkpoint:** an exact full checkpoint every 25 committed
  updates, containing weights, moments, committed/attempt counters, RNG, and
  guard state.
- **Selection checkpoint:** a quantized and fully evaluated candidate every
  100 committed updates, retained only when feasible or Pareto-nondominated.

Per-attempt JSONL diagnostics are an audit log, not a replacement for exact
checkpoints. Saving weights without their matching AdamW moments is forbidden.

---

## 12. Debugging and Verification

### 12.1 Finite-difference gradient check

`make check` includes a finite-difference check of the hand-written backward
pass. For a tiny model (context=8, dim=8, heads=2, layers=1), it:

1. Computes the analytic gradient via `model_backward`.
2. For each parameter tensor, perturbs three representative scalar indices
   (and every value of the tiny position embedding) by ±ε and recomputes loss.
3. Asserts that the finite-difference gradient matches within tolerance.

This is a strong sampled check of the backward pass, supplemented by masked-loss
and distillation probes. It is not an exhaustive proof that every scalar path is
correct.

### 12.2 Self-tests

Core generators, controllers, evaluators, and inference paths expose self-tests:

```
./logic_corpus --self-test         # generates, verifies, and mutates
./channel_corpus --self-test       # verifies channel structure
./faculty_controller --self-test   # tests all state machine transitions
./zero_eval --self-test            # tests metric computation
./literary_infer --holo-self-test  # tests Holo encode/recall determinism
./state_corpus --self-test          # experimental state algebra checks
/tmp/modal_corpus --self-test       # after compiling experimental modal source
```

### 12.3 Determinism as a debugging tool

Since the system is deterministic given seed + corpus, you can:

1. Run training for N steps.
2. Hash the checkpoint.
3. Make a change.
4. Run training for N steps.
5. If the hash differs, the change affected training.
6. If the hash matches, the change is a no-op (removed dead code, refactored
   without behavioral change).

### 12.4 Benchmark hash checking

`make zero-benchmark-check` verifies that the deployed model's SHA-256 matches
the frozen benchmark manifest. If it doesn't, the benchmark is stale and
results can't be compared.

---

## 13. Common Pitfalls

### 13.1 Forgetting to add a parameter to the parameters array

When adding a new `Parameter` to `Model`, you must also add it to the
`model->parameters` array in `model_create`. Otherwise:
- `model_zero_grad` won't zero its gradients.
- `optimizer_update` won't apply weight decay.
- The checkpoint won't save or load it.

The symptom: a parameter that never changes from its initial value.

### 13.2 Mixing up row-major and column-major

The C code uses row-major storage everywhere. A matrix `W[r][c]` is stored as
`W[r*cols + c]`. The BLAS calls use `CblasRowMajor`. Mixing row/column major
produces silently wrong results rather than crashes.

### 13.3 Dropout at inference time

`model_forward` applies inverted dropout when `dropout > 0`. The caller is
responsible for passing `dropout=0.0` during validation and generation.
`literary_infer` never applies dropout.

### 13.4 The RNG state after sampling

When `--generate-only` uses `sample_row` (temperature, top-k, repetition
penalty), it consumes RNG state. Two calls to `generate` with the same prompt
but different preceding RNG state produce different outputs. This is expected.

### 13.5 Tokenizer mismatch

The tokenizer file (`corpus/literary.bpe`) must match the vocabulary size in
the checkpoint. A 256-token tokenizer loaded with a 128-vocab model will
produce token IDs ≥ 128, which are out of bounds for the embedding table. The
program will either crash or produce garbage.

---

## 14. Extension Points

### 14.1 New domain faculty (the standard path)

Follow §6. The key design constraint: the domain validator must be an
independent oracle. The model generates; the oracle checks. Never the reverse.

### 14.2 Learned registrar (faculty v2)

The current registrar is the deterministic Holo encoder (§8). A learned
registrar would:

1. Take the student's hidden state at the `@close` position.
2. Project it to a 256-dimensional space.
3. Train with contrastive loss: same latent object → nearby, different
   faculty → far apart, different latent object → far apart.

This requires careful architecture: the close-state encoding must not leak
information that would make the token-level loss trivial. Start with a frozen
student, train only the projection.

### 14.3 Continuous latent prefix tokens (faculty v2)

Instead of serializing faculty summaries as text, encode them as continuous
vectors prepended to the transformer input:

```
input = [RMSNorm(z_f + e_f), RMSNorm(z_g + e_g), ..., text tokens]
```

where `z_f` is the faculty's latent vector and `e_f` is a learned faculty
embedding. The first experiment should compare this against text-serialized
summaries on the same data, using ≤4 faculty states.

### 14.4 Larger architecture experiments

If the representation is exhausted (all 4.85M parameters measurably used, no
remaining interference between faculties), a scale experiment is warranted.
The contract: declare it as a scale experiment, double one dimension at a time
(e.g., `d=512` or `L=8`), and measure the gain per parameter.

### 14.5 Non-English literary corpora

The 128-character ASCII vocabulary is inherently English-biased. Supporting
another language requires either:
- A transliteration scheme into ASCII, or
- A larger vocabulary (which changes the parameter budget).

The latter is a scale experiment. The former preserves the architecture but
may lose phonemic distinctions.

---

## 15. The Key Numbers

| Quantity | Value | Why it matters |
|---|---|---|
| Parameter count | 4,852,992 | Fixed budget for all experiments |
| Context length | 512 chars | ~80 words; fits a complete proof or exchange |
| Vocabulary | 128 tokens | 7 bits/token; control chars reused for channel |
| Memory length | ≤80 chars | Lossy bottleneck: ≤560 bits per exchange |
| Episodic capacity | 32 entries | Ring buffer; oldest overwritten |
| Holo dimension | 256 | Powers of 2 for fast modulo via bitwise AND |
| Abstention threshold | 0.22 | Empirically tuned; controls false recall |
| Dropout range | 0.02–0.10 | Higher for early training, lower for consolidation |
| Learning rate range | 3×10⁻⁶–3×10⁻⁴ | Higher for broad absorption, lower for retention |
| Batch size | 1–2 | Context is 512; batch=2 means 1024 tokens/step |
| Checkpoint size (full) | ~58 MB | Weights + optimizer moments + RNG |
| Checkpoint size (teacher) | ~19 MB | Weights only |
| Browser model size | ~4.7 MB | Row-wise int8 quantized |
| WASM runtime size | ~36 KB | Compiled `literary_infer.c` |

---

## 16. The Engineering Discipline

ZERO's engineering is defined as much by what it refuses as by what it builds:

- **No framework.** There is no PyTorch, no TensorFlow, no NumPy. The
  mathematical operations are explicit C loops.
- **No automatic differentiation.** The backward pass is handwritten. It is
  200 lines of matrix multiplies and activation derivatives. You can verify it
  with finite differences.
- **Bounded core allocations.** Model forward/backward/optimizer buffers are
  allocated once. Validation and optional diagnostics make explicit temporary
  allocations whose peak cost must also be counted.
- **No hidden state.** Checkpoints are complete. Teacher artifacts are
  weight-only. The RNG state is saved and restored.
- **No macro-averaging over failures.** Every seed, every task family, every
  channel is reported separately. A single failed gate blocks promotion.
- **Version artifacts before promotion.** Promoted teachers, tokenizers,
  deployed models, and benchmark inputs carry schemas, hashes, and provenance.
  Experimental state/modal generators are source-only and not yet promoted
  artifacts.

The result is a system where a single person can trace a bug from a
validation-loss regression through the backward pass, through the corpus
generator, to a specific commit. That traceability is the engineering
foundation of the mathematical claim: *this model was constructed from these
observations by these operations, and we can prove it.*

# Zero-grounded language models in C

Read [**The ZERO Manifesto**](MANIFESTO.md) and the
[mathematical foundations](FOUNDATIONS.md).

This project contains dependency-free neural language models together with
checked corpus generators, validators, faculty-controller experiments, and a
small browser runtime:

- `zero_lm`: a 7,436-parameter character MLP that makes the construction easy
  to inspect.
- `literary_lm`: a configurable decoder-only transformer designed to train on
  collections such as Shakespeare, William Blake, and Aleister Crowley.
- `zero5_lm`: the active C transformer fork for lossless byte tokenizers and
  immutable Braid corpus releases. The hash-pinned `literary_lm.c` remains
  unchanged.
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
- `reasoner0`: a reason-first Cartan-matrix enumerator with exact integer
  verification, canonical deduplication, sealed Answer IR, and language as the
  final tool.
- `reasoner1`: an integer graph-recurrent proposer that learns which canonical
  node-and-bond actions should reach the Reasoner-0 verifier.
- `reasoner2`: a counterexample-conditioned integer policy that repairs
  rejected Cartan matrices with exact minimum-edit supervision.
- `reasoner3`: an exact ICE learner that synthesizes bounded integer
  invariants from positive, negative, and implication counterexamples.
- `reasoner31`: Reasoner (3,1), a progress-constrained 3D ICE learner with a
  sealed stage-6 generalization test and exact coordinate-permutation
  interventions.
- `reasoner32`: Reasoner (3,2), which behaviorally prunes the passing (3,1)
  policy to a direct 87-byte sparse artifact and proves exact equivalence over
  the complete finite world.
- `reasoner33`: Reasoner (3,3), a capacity-matched dimension-transfer test
  whose 64-byte semantic policy trained below 3D and passed all 4,095 programs
  in the sealed 4D cloud evaluation; the fixed hash control solved only 31.
- `reasoner34`: Reasoner (3,3,2), an exact non-monotonic courier planner that
  must open and later restore goal-correct gates; its sealed five- through
  seven-gate evaluation passed all 5,880 worlds exactly.
- `reasoner333`: Reasoner (3,3,3), a sealed composition-transfer test that
  trains a 64-byte shared policy only on isolated relation modules before
  joining unseen modules with bridge constraints; all 63 sealed compositions
  and 252 relabelings passed.
- `reasoner34_witness`: Reasoner (3,3,4), an independently sealed test of
  robustness to every allowed counterexample source; all 4,095 sealed programs
  and 4,877,336 alternate-counterexample decisions passed.
- `reasoner35`: Reasoner (3,4), a 64-byte joint-policy screen across planning,
  composition, and witness reasoning with no task label or weight-bank switch;
  its combined sealed gate passed.
- `reasoner36`: Reasoner (3,5), one task-blind 64-byte policy that selects
  `QUERY`, `APPLY`, and `COMMIT` calls from a common integer tool record.
- `reasoner37`: Reasoner (3,6), a causally downstream language readout whose
  output cannot change the completed nonverbal reasoning trace.
- `reasoner38`: Reasoner (3,7), the raw-observation transfer test that kept
  481,968 of 482,304 sealed decisions exact but correctly resolved no-go.
- `reasoner39`: Reasoner (3,8), exact minimum-description law induction over a
  fixed raw polynomial feature family.
- `reasoner310`: Reasoner (3,9), an active integer-program learner that builds
  laws from raw comparisons, queries until one canonical program remains, and
  keeps language reporting behind a final tool call; its fresh compositional
  seal passed all 744 episodes.
- `reasoner40`: Reasoner 4.0, an exact active learner for reversible raw-input
  adapters feeding the frozen (3,9) core; all 6,432 fresh three-operation
  sealed episodes passed exactly.
- `reasoner41`: Reasoner 4.1, a factorized joint-transfer learner that commits
  separately to a fresh adapter and a fresh law; all 33,232 sealed episodes
  over 4,154 fresh three-by-three pairs passed exactly.
- `reasoner42`: Reasoner 4.2, an exact library learner that discovers three
  reusable adapter subprograms, freezes them, and solves held-out
  four-operation classes inside a 100-program search budget using affine proof
  certificates rather than sampled behavioral identity.

They are written in C11. On macOS, the transformer trainers automatically use Apple's
built-in Accelerate framework for matrix multiplication. Linux uses OpenBLAS
when its development package is installed and otherwise retains the portable C
fallback. Set `LITERARY_BACKEND=portable`, `openblas`, or `accelerate` to make
the intended build explicit where supported.

The `docs/` directory contains a static chat interface for GitHub Pages. It
runs a mixed-format export—row-wise int8 matrices with floating-point scales
and normalization gains—entirely in the browser using the same C inference
code compiled to WebAssembly. No prompt or generated text is sent to a server.

`bpe_tokenizer` is the historical corpus normalizer and experimental byte-pair
trainer. Tests at 256, 512, and 2,048 vocabulary entries overfit fragments on
that small literary corpus, so its final preset uses a cleaned 128-character ASCII stream
with no merges. The smaller vocabulary reallocates capacity to the transformer
while keeping the total parameter count unchanged.

## ZERO.5 corpus and tokenizer gate

ZERO.5-C0 establishes the new data path before model training. A C reader
verifies a released `braid.release/v2` manifest and its governed train,
validation, and test artifacts, checks every decoded document against its
content hash, preserves the official splits, and emits exact little-endian token streams. The
lossless C tokenizer then compares raw bytes with a frozen 512-entry byte-BPE
vocabulary. End-of-document and channel tokens cannot be merged.

The 512-token arm keeps the historical 4,852,992-parameter budget exactly by
using a 1,024-wide feed-forward layer. The governed Corpus 1 run is complete:
byte-BPE512 reduced validation content tokens by 57.07% versus byte264 and is
the selected ZERO.5 tokenizer. Corpus 1 is still too small for broad
pretraining. The separate three-seed C1 run reached a mean 2.9707 validation
bits per raw byte and reproduced seed 0 byte for byte, but generations remained
mostly gibberish. See [the C0 tokenizer result](benchmarks/zero5-c0-v1/RESULT.md)
and [the C1 training result](benchmarks/zero5-c1-v1/RESULT.md).

The fixed-size C2 Atlas continuation passed. One ordered pass reduced Atlas
validation loss from 4.9819 to 2.2786 nats per token and also improved the C1
anchor distribution. Generation became more prose-shaped but was not coherent.
See [the C2 result](benchmarks/zero5-c2-v1/RESULT.md) and
[generation samples](benchmarks/zero5-c2-v1/GENERATION.md).

The fixed-size C3 task continuation is complete with a no-go. Combined C3
validation loss improved 39.13%, but claim-answer improvement missed its gate,
cloze-answer loss became worse, and retrieval A/B accuracy reached only 52.05%
against a frozen 55% gate. C2 and C1 retention passed. The evidence points to
interference from presenting claims, cloze, and retrieval as three solid
blocks. See [the C3 result](benchmarks/zero5-c3-v1/RESULT.md) and
[task samples](benchmarks/zero5-c3-v1/GENERATION.md).

The fixed-size C3.1 braid is also complete with a no-go under its conjunctive
gate, but it produced a large curriculum result. Smoothly interleaving the
exact same packs improved combined validation loss by 41.75% versus C2 and
fixed the C3 cloze regression. Four-times answer weighting improved cloze
answer loss by 26.80% and retrieval answer loss by 95.97%, while retaining C2
Atlas and C1 anchors. Claim improvement reached only 7.28%, and retrieval
choice reached 54.77% against the frozen 55% gate, so no arm was eligible for
promotion or replication. See [the C3.1 result](benchmarks/zero5-c31-v1/RESULT.md)
and [generation diagnostic](benchmarks/zero5-c31-v1/GENERATION.md).

## Sero model lineage

Historical ZERO names remain attached to their released experiments and
artifacts. New base-model research is named **Sero**. Sero starts from exact raw
bytes and makes tokenizer/model tradeoffs explicit rather than inheriting the
old 128-character normalization contract.

**The Sero series is frozen as of 2026-08-23.** Its PyTorch/CUDA code and
evidence remain reproducible, but it is no longer the active model line. The
terminal 20M run passed every frozen source gate and reduced matched-token test
bits per raw byte by 9.56% versus the 6M model. Generation still looped and was
not reliably correct. The project now returns to the dependency-free C ZERO
engine; larger Sero runs require a separate paid scope. See the
[Sero closure and scale costs](benchmarks/sero-series-closure-v1/README.md)
and [active model-line boundary](docs/LINEAGE-BOUNDARY.md).

The final scale test trained a 20,011,136-parameter model on the same total
377,031,062-token schedule. It reached 1.2008 test BPB for a measured two-stage
EC2 cost of $2.75. This closes Sero with positive scaling evidence and a clear
generation-quality limitation. See
[the final 20M result](benchmarks/sero20m-consolidation-v1/RESULT.md).

The first integrated **Sero Latent v1** experiment is complete. Causal learned
patches beat static patches inside the same local/global architecture, but a
compute-matched conventional 4,096-token byte-BPE Transformer remained 1.64%
better on the preregistered seed. The static tokenizer therefore remains the
current control while the latent arm advances to discrete-code research. See
[`docs/SERO.md`](docs/SERO.md) and
[`benchmarks/sero-latent-v1/RESULTS.md`](benchmarks/sero-latent-v1/RESULTS.md).

**Sero Latent v2 is complete, but it does not end learned tokenization.** Its
frequency dictionary remained 4.44% worse than byte-BPE on average across the
three frozen seeds. A later audit found that V1 and V2 were both too small and
used a source-biased corpus prefix; V1 also charged a causally predictable
end-patch output. Those runs reject their tested designs, not the larger idea.
The lossless 4,096-entry byte-BPE tokenizer stays as the Sero control.

**Sero Latent v3 is complete and does not promote.** The project built and
promoted a licensed, source-balanced corpus with 123,153,182 unique training
bytes, then ran the frozen 10M/30M/100M-byte experiment on seeds 0, 1, and 2.
V3 was 14.53% worse than byte-BPE on average at 100M. All seeds failed the
quality gate, and two also failed compute parity because the learned chunks
became too short. This rejects the tested one-stage embedding-router design,
not all learned tokenization. See
[`benchmarks/sero-latent-v3/RESULTS.md`](benchmarks/sero-latent-v3/RESULTS.md).

**Sero 1 is the first promoted dense base model in the Sero lineage.** Its
three 6.02M-parameter seeds reached a mean 1.6181 test BPB after 135.5M token
exposures each. A post-training generation diagnostic found that 128 tokens of
real held-out context reduced continuation loss by 0.1135 BPB versus one token,
but greedy generation still looped in 91.7% of those cases. Sampling sharply
reduced repetition without making the content reliable. See
[`benchmarks/sero1-pretrain-v1/RESULT.md`](benchmarks/sero1-pretrain-v1/RESULT.md)
and
[`benchmarks/sero1-generation-eval-v1/RESULT.md`](benchmarks/sero1-generation-eval-v1/RESULT.md).
The next diagnostic rebuilds the corpus with original articles as documents,
adds an explicit end-of-document target, doubles the training schedule, and
branches after epoch 5 to test a small repeated-four-gram unlikelihood loss.
Its frozen seed-0 contract is in
[`benchmarks/sero1-optimized-v1/contract.json`](benchmarks/sero1-optimized-v1/contract.json).

The next fixed-capacity pilot tests a larger, cleaner curriculum before scaling
the model. It adds MDN technical writing, reviewed OpenAssistant dialogue, and
GSM8K worked math to the Wikimedia base. Training moves through foundations,
breadth, and application while replaying general language in every stage. The
corpus is over 161 MB of unique text and has no exact 12-word training overlap
with its held-out sets. See
[`benchmarks/sero2-curriculum-v1/contract.json`](benchmarks/sero2-curriculum-v1/contract.json)
and [`corpus/SERO_CURRICULUM_RIGHTS.md`](corpus/SERO_CURRICULUM_RIGHTS.md).
The seed-0 run plus retention consolidation passed every frozen source gate at
1.3278 test BPB, 22.4% below the control on the expanded held-out set. Longer
context also helped, but greedy generation still looped on 90% of the prompt
panel and sampled answers were not reliable. See
[`benchmarks/sero2-curriculum-eval-v1/RESULT.md`](benchmarks/sero2-curriculum-eval-v1/RESULT.md).

## Reason-first runtime

Reasoner-0 is a working mechanics slice for training control before language.
Its seed task enumerates connected finite-type Cartan matrices through rank 8.
Every proposal is canonicalized, then checked with exact fraction-free integer
determinants. Affine determinant-zero matrices are high-weight counterexamples.
An accepted answer is sealed before the policy may call `language.render`.
This builds a complete training environment, not a general reasoning claim.

```sh
make reasoner0-check
./reasoner0 demo
./reasoner0 train /tmp/reasoner0.r0p
./reasoner0 enumerate /tmp/reasoner0.r0p 8
./reasoner0 dataset /tmp/reasoner0.r0p 8 /tmp/reasoner0.jsonl
./reasoner0 verify /tmp/reasoner0.r0p 2 2 -1 -1 2 --trace
make reasoner1-check
./reasoner1 demo
./reasoner1 train /tmp/reasoner1.r1p 8
./reasoner1 eval /tmp/reasoner1.r1p 8
make reasoner2-check
./reasoner2 demo
./reasoner2 train /tmp/reasoner2.r2p 8
./reasoner2 eval /tmp/reasoner2.r2p 2 8
./reasoner2 ablate /tmp/reasoner2.r2p 2 8
make reasoner3-check
./reasoner3 demo
./reasoner3 train /tmp/reasoner3.r3p 4
./reasoner3 eval /tmp/reasoner3.r3p 1 4
./reasoner3 ablate /tmp/reasoner3.r3p 1 4
./reasoner3 render /tmp/reasoner3.r3p 167
make reasoner31-check
./reasoner31 demo
./reasoner31 train /tmp/reasoner31.r31p
./reasoner31 eval /tmp/reasoner31.r31p 6 full
./reasoner31 eval /tmp/reasoner31.r31p 6 ranker-masked
./reasoner31 eval /tmp/reasoner31.r31p 6 tool-only
./reasoner31 render /tmp/reasoner31.r31p 510
make reasoner32-check
./reasoner32 demo
./reasoner32 build /tmp/reasoner32.r32p
./reasoner32 verify /tmp/reasoner31.r31p /tmp/reasoner32.r32p
./reasoner32 render /tmp/reasoner32.r32p 510
make reasoner33-check
./reasoner33 development
make reasoner34-check
./reasoner34 development
make reasoner333-check
./reasoner333 development
make reasoner34-witness-check
./reasoner34_witness development
make reasoner35-check
./reasoner35 development
make reasoner36-check reasoner37-check reasoner38-check reasoner39-check
make reasoner310-check
make reasoner40-check reasoner40-contract-check
make reasoner41-check reasoner41-contract-check
make reasoner42-check reasoner42-contract-check
```

See [`docs/REASONER0.md`](docs/REASONER0.md) for the interfaces, guarantees,
and verifier contract. See [`docs/REASONER1.md`](docs/REASONER1.md) for the
learned proposer and rank curriculum. See
[`docs/REASONER2.md`](docs/REASONER2.md) for exact repair supervision, the
feedback ablation, and its failed causal-use gate. See
[`docs/REASONER3.md`](docs/REASONER3.md) for hidden transition systems,
counterexample interventions, and its 1,738/1,740 minimum-edit holdout no-go.
See [`docs/REASONER31.md`](docs/REASONER31.md) for the exact progress contract
and the passing 1,674/1,674 sealed 3D test. See
[`docs/REASONER32.md`](docs/REASONER32.md) for the 16-weight sparse policy and
its exhaustive action-and-trace equivalence proof. See
[`docs/REASONER33.md`](docs/REASONER33.md) for the frozen cross-dimension
transfer contract and sealed cloud result. See
[`docs/REASONER34.md`](docs/REASONER34.md) for the exact BFS planning task,
matched controls, relabeling intervention, and unopened 5-7 gate seal.
[`docs/REASONER333.md`](docs/REASONER333.md) for the independent composition
branch and its unopened three-by-three seal.
[`docs/REASONER34-WITNESS.md`](docs/REASONER34-WITNESS.md) for the independent
counterexample-order branch and its unopened 4D seal.
See [`docs/REASONER.md`](docs/REASONER.md) for the complete evidence map,
current claim boundary, and next research question. The version-specific
documents remain the detailed source for each frozen experiment.
See [`docs/REASONER40.md`](docs/REASONER40.md) for the active adapter language,
frozen-core certificate, exact public screen, and passed three-operation seal.
See [`docs/REASONER41.md`](docs/REASONER41.md) for the joint-transfer protocol,
separate commitment certificate, exact public cross-product, and passed seal.
See [`docs/REASONER42.md`](docs/REASONER42.md) for learned abstraction-library
growth, exact affine canonicalization, the passing public development gate,
and the locked three-abstraction seal.

## Build

```sh
make
make check
make sero-latent-v1-result-check
make sero-latent-v2-result-check
make sero-latent-v3-contract-check
make sero-latent-v3-result-check
make sero1-generation-eval-result-check
make sero1-optimized-check SERO1_OPTIMIZED_MANIFEST=/path/to/manifest.json
make sero2-curriculum-check SERO2_CURRICULUM_MANIFEST=/path/to/manifest.json
make sero2-curriculum-result-check
make sero-series-closure-check
make zero5-c0-check
make zero5-c1-check
make zero5-c2-check
make zero5-c3-check
make zero5-c31-check
# For another verified RELEASED Braid collection:
make zero5-c0-run BRAID_RELEASE=/path/to/release \
  ZERO5_BRAID_COLLECTION_ID=collection-id ZERO5_BRAID_COMMIT=commit
```

`make check` includes finite-difference checks of the hand-written transformer
backward pass as well as short end-to-end training runs.

## Licenses and release provenance

This is a mixed-material repository. Project code is Apache 2.0, trained model
artifacts are CC BY-SA 4.0 to the extent controlled rights apply, eligible
first-party generated data is CC0 1.0, and literary sources retain their own
source-specific status. See [LICENSES.md](LICENSES.md) for the exact boundary.

ZERO.4's source-level audit, permanent attribution links, transformations,
jurisdiction notes, and no-human-chat lineage statement are in
[CORPUS_RIGHTS.md](CORPUS_RIGHTS.md). The checked
[`huggingface/release-manifest.json`](huggingface/release-manifest.json) is the
only approved model-repository upload set; it deliberately excludes all
training text and token streams. Run the release checks with:

```sh
make corpus-rights-check
make zero4-memorization-check
```

The second command reconstructs the bound token streams, evaluates prompted
continuation overlap, and writes a non-corpus JSON report. It is a release
gate, not proof that memorization is impossible.

## Run the browser chat

Build the 4.7 MB inference model and WebAssembly runtime from the deployed
browser checkpoint:

```sh
make web
python3 -m http.server 8000 --directory docs
```

The checked-in `docs/model.litq8` is the promoted ZERO.4 artifact selected
prospectively from Q2.6 seed 2 at update 500, SHA-256
`44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50`.
`make web` reproduces it directly from the content-identical checked-in
candidate. [`docs/model.json`](docs/model.json) binds the deployment to the
three-seed aggregate, AWS completion record, and source result.

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
make zero4-q27-check
# Q2.7's AWS path is staged but its budget remains unauthorized.
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
regression; the one-time promotion evaluation passed at 99.6%. This
prospectively selected quantized model became ZERO.4 only after seeds 1 and 3
passed the unchanged replication contract.
See
[`contract.json`](benchmarks/zero4-q26-v1/contract.json) and
[`RESULTS.md`](benchmarks/zero4-q26-v1/seed2/RESULTS.md).

Q2.7 is the preregistered language-preservation repair. It starts from
immutable ZERO.3 and changes only the trainable boundary: `layer.5.norm2`,
`layer.5.w1`, `layer.5.w2`, and `final_norm`, totaling 541,184 parameters
(11.151554%). The trainer computes clipping and tangent projection only in
that subspace, protects every frozen weight and AdamW moment byte-for-byte,
and binds the scope into checkpoints so mismatched resume fails closed.
`make zero4-q27-check` validates those mechanics plus the proposed $1.17
seed-2 AWS ceiling and non-waiting dispatch/collector path; it launches no
scientific compute. A candidate-ready quantity result would still require a
separate candidate-bound $0.12 language-gate authorization. See the frozen
[`contract.json`](benchmarks/zero4-q27-v1/contract.json).

Q2.6-R prospectively authorized those two replications without altering the
diagnostic record. After the portable-backend cancellation and two
infrastructure-only recovery failures, the bounded OpenBLAS recovery-3 run
completed both declared seeds. Seed 1 resolved **go** with 98.0% limiting
quantity rates and 1.0423% replay regression; seed 3 resolved **go** with
96.0% limiting rates and 1.2753% replay regression. Both exactly-once
promotion evaluations passed. Together with seed 2, the frozen conjunction is
**go**, so the seed-2 candidate is promoted as ZERO.4. See the
[`replication contract`](benchmarks/zero4-q26r-v1/contract.json),
[`aggregate`](benchmarks/zero4-q26r-v1/AGGREGATE.md), and
[`AWS completion record`](benchmarks/zero4-q26r-v1/aws-v2/COMPLETED).

## Evaluate ZERO.4 on external language tasks

[`ZERO-EVAL-1`](benchmarks/zero-eval-1/README.md) freezes an evaluation-only
comparison of the bare ZERO.3 and ZERO.4 models on BLiMP, HellaSwag, adapted
LAMBADA, and TinyStories bits per byte. Upstream revisions, source and prepared
data hashes, ASCII normalization, the 512-character context policy, task order,
models, metrics, and interpretation limits are all preregistered. The suite
does not train or invoke the quantity controller.

The bounded 1,000-case-per-task AWS screen is complete. ZERO.4 versus ZERO.3
was +0.5 points on BLiMP raw accuracy (0.537 versus 0.532), worse on
TinyStories bits/byte (2.570353 versus 2.527861), -0.5 points on HellaSwag
normalized accuracy (0.266 versus 0.271), and tied at zero adapted-LAMBADA
exact matches. It completed in 2,502 launch-relative seconds for $0.4726.
These mixed results do not justify the proposed 8h30m/$5.78 full run, which is
now explicitly closed as `do_not_run`.

Future training candidates use the
[`ZERO language-preservation gate v1`](benchmarks/zero-language-gate-v1/README.md):
candidate-only BLiMP and TinyStories, with the frozen ZERO.3 aggregates reused.
The observed candidate runtime is about 305 seconds; the proposed ceiling is
600 seconds/$0.12. The gate emits non-copyright per-case correctness/score
traces for future paired comparisons, but no execution is authorized yet.
Local commands test mechanics and the consumed evidence:

```sh
make external-eval-check
make experiment-budget-check
make zero-language-gate-check
```

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
the output outside the frozen Q2.6-R scientific record. The one-time run
completed 100/100 accepted optimizer updates and all four sentinel evaluations,
then exhausted the budget during the first 500-case full evaluation. Its
component timings project about 7h46m/$5.28 per seed before contingency, making
the serial quantity evaluator the next engineering bottleneck.

Quantity JSON evaluation now uses deterministic worker processes, defaulting
to the machine's online CPU count (capped at 32). Workers inherit the loaded
model through copy-on-write, evaluate independent cases, and return per-case
records that the parent reduces in original corpus order; serial and parallel
JSON therefore remain byte-identical. Use `--jobs N` for an individual
evaluation or `ZERO_QUANTITY_JOBS=N` for existing drivers; `--jobs 1` selects
the serial reference path. Sample-printing mode remains serial.

This is an execution optimization, not new scientific evidence. The
[`parallel-quantity-eval-calibration-v1`](benchmarks/parallel-quantity-eval-calibration-v1/README.md)
completed one diagnostic AWS execution under the same 25-minute/$0.29 ceiling.
The 16-worker evaluator was 13.52× faster on 64 cases and 13.62× faster on 500,
with byte-identical serial/parallel JSON. The component projection is now
3h09m08s/$2.14 per seed before contingency, or 7h34m/$5.16 for both remaining
seeds with 20% contingency. The run did not train or open promotion data, and
the [`combined Q2.6-R AWS budget`](benchmarks/zero4-q26r-v1/aws-v1/README.md)
authorized one bounded execution. Both instances published complete,
in-budget `go` candidates, but the frozen collector ran after AWS had purged
the terminated instance records and could no longer reproduce the mandatory
venue identity checks. The candidates are therefore unaccepted, no family
inference is made, and ZERO.3 remains current. The authorization is consumed;
see the
[`execution failure record`](benchmarks/zero4-q26r-v1/aws-v1/execution-failure-30047634061.json).
The
[`aws-v2 replacement registration`](benchmarks/zero4-q26r-v1/aws-v2/README.md)
kept the frozen science unchanged and made launch-time EC2 identity durable.
Its recovery-3 execution finished seeds 1 and 3 for $1.8817 combined, below
the $2.34 recovery ceiling; all execution attempts together cost about
$1.9359, below the approved $2.3942 all-in cap. Run the contract and promotion
checks with:

```sh
make experiment-budget-check
make zero4-promotion-check
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

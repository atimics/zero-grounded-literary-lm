# ZEROADMAP

ZERO should become a better participant in a channel, not merely a stronger
imitator of literary surfaces. Its unit of experience is therefore a bounded
channel: speakers, reply relations, recent turns, a channel vibe, and a lossy
memory transition.

The parameter budget remains fixed at 4,852,992 until evidence says the
representation and objective have been exhausted. Runtime memory may add
bounded state, but it must be declared separately from learned parameters.

The active faculty-training decision is tracked in `PROPOSALS.md`, with the
completed lineage in `EXPERIMENTS.md`. `ZERO4.md` describes the architecture;
`ZERO4-BACKLOG.md` is subordinate engineering work.

## State of the system — 2026-08-29

| Layer | Concrete artifact | State |
| --- | --- | --- |
| Empty basis | zero-filled storage, finite indices, deterministic seed | built |
| Literary prior | Shakespeare, Blake, Crowley; optional KJV continuation | built |
| Channel representation | speaker roles, reply edges, vibe, summary targets | built |
| Learned memory loop | old memory + recent turns → new lossy memory | built |
| Episodic recall | deterministic 256D flat and partitioned Holo indices | built, partitioned experimental |
| Frozen measurement | `zero-channel-v1`, `zero_eval.c`, pinned hashes | built |
| Browser comparison | transcript, recurrent, flat, partitioned modes | built |
| Logic and Brainfuck curricula | checked logic records plus trace/composition execution records | built, experimental |
| State-composition curriculum | modality-neutral finite-state transition generator | built, experimental |
| Modal curriculum | finite-world reachability and possibility records | built, experimental; follows state composition |
| Quantity faculty | operation-only routing with controller-bound arguments | promoted after three-seed Q2.6 go |
| External language evaluation | completed four-task screen plus candidate-only BLiMP/TinyStories preservation gate | Q2.8 candidate gate completed no-go; expensive full run retired |
| Language-preserving quantity repair | Q2.7 top-FFN and Q2.8 fixed graded-plasticity interventions from immutable ZERO.3 | both resolved no-go; no follow-up training authorized |
| Dialogue training ablation | fixed contract for A/B/C/D candidates | specified, not trained |
| Hidden human channel evaluation | consented, channel-level split | not yet collected |
| Braid-to-C corpus contract | verified release, governed split preservation, lossless byte streams | Corpus 1 verified and evaluated |
| Lossless C tokenizer | byte264 and parameter-matched byte-BPE512 | C0 complete; byte-BPE512 selected at 57.07% fewer validation content tokens |
| Native C training proof | three seeds plus exact determinism repeat | C1 passed at 2.9707 mean validation bits/raw byte; generation still incoherent |
| Atlas corpus scale | one ordered C2 pass at fixed 4.85M parameters | C2 passed; Atlas validation loss fell 54.26% and C1 anchors improved |
| Evidence-task curriculum | claims, cloze, retrieval with answer-only gates | C3 no-go; combined loss improved 39.13%, but cloze regressed and retrieval choice stayed at 52.05% |
| Record-safe task braid | same C3.1 packs under blocked order, smooth interleaving, and 4x answer loss | C3.1 no-go; interleaving improved combined loss 41.75% and fixed cloze, while the best retrieval choice reached 54.77% and claim gain reached 7.28% |
| Reason-first runtime | canonical Cartan matrices, learned control policy, exact Bareiss verifier, sealed Answer IR, language renderer tool | Reasoner-0 enumerates all 31 connected finite types through rank 8 with exact precision/recall and affine boundary negatives; not a base-model capability claim |
| Learned reason proposer | four-round graph recurrence, integer perceptron, structured verifier feedback, rank curriculum | Reasoner-1 reaches exact supervised rank-8 precision/recall; the rank-7 holdout finds all five rank-8 types with 96.7% precision, so compression remains blocked |
| Counterexample repair | learned node/bond edits, exact minimum-distance teacher, two-step verifier loop, feedback ablation | Reasoner-2 is exact on 267 supervised cases; its rank-7 policy solves 69/69 unseen rank-8 cases but only 66 optimally, while masked feedback still solves 66, so causal use and compression do not pass |
| Hidden invariant synthesis | bounded integer transition systems, exact ICE witnesses, learned atom edits, causal interventions, sealed language output | Reasoner-3 solves all 1,740 unseen stage-4 cases and 1,738 minimally; all 396 witness-interchange pairs pass, but the conjunctive exact holdout gate fails, so compression remains blocked |
| Progress-constrained 3D synthesis | exact witness-resolving action set, learned legal-edit ranking, all-coordinate symmetry, development and sealed holdouts | Reasoner-3.1 is exact on 6,066/6,066 stage-5 cases and 1,674/1,674 sealed stage-6 cases; tool-only and witness-masked controls fail, so exact trace-preserving compression is authorized |

The deployed model is ZERO.4: the prospectively selected Q2.6 seed-2
update-500 artifact at `docs/model.litq8`, SHA-256 `44b32f22...`. It was
initialized from the frozen update-16,600 ZERO.3 teacher and promoted only
after seeds 1, 2, and 3 all passed the unchanged quantity and replay gates.
The earlier channel benchmark remains historical evidence for its pinned
ZERO.3 artifact; it has not been relabelled as a ZERO.4 measurement.

The external screen found a small BLiMP gain but worse TinyStories compression
and HellaSwag accuracy, with zero adapted-LAMBADA exact matches for either
model. It therefore does not support a general language-improvement claim for
ZERO.4. Q2.7 then rejected hard top-FFN isolation because it preserved replay
but learned none of the new quantity behavior. Q2.8's fixed cross-layer graded
plasticity did produce a quantity/replay candidate, but the exactly-once
language gate passed BLiMP at 0.539 and failed TinyStories at 2.675123
bits/byte against the frozen 2.553140 ceiling.

Q2.8 is therefore no-go: seeds 1 and 3 remain sealed, the candidate is not
promoted, and no more training is authorized. The next decision is to analyze
the matched Q2.6/Q2.7/Q2.8 evidence and preregister the cheapest disconfirming
repair from the remaining distributed-sparse and adapter families.
[`SAT-1`](benchmarks/sat1-v1/PREREGISTRATION.md) remains staged behind a
three-seed language-preserving five-operation anchor.

## Active direction

The Sero PyTorch/CUDA series is now frozen at its successful 20M scale result.
It remains evidence that conventional dense training scales compression, but
its looping generations do not support an intelligence claim. Further Sero
scale work requires a separate paid scope.

ZERO returns to the main line as a dependency-free C11 model. Work should
improve the small C model, its corpus, its training loop, and its native/WASM
runtime before increasing parameter count. The .litq8 deployment uses int8
matrix weights with floating-point scales and activations; it is quantized, not
integer-only.

ZERO.5-C0 through C3.1 are complete. `zero5_lm.c` is separated from the
hash-pinned historical `literary_lm.c`. C2 proved that corpus scale produces a
large gain in the unchanged 4.85M model. C3 showed that easy whole-record loss
can hide weak answers and that solid task blocks cause interference. C3.1 then
showed that a smooth braid fixes the cloze regression and improves combined
loss by more than 40%; explicit answer weight raised retrieval choice to
54.77%, five correct choices short of the frozen gate. The next gate is a Braid
data-definition repair at the same model size: evidence-grounded short claim
targets, passage-order-paired retrieval, and task-balanced answer loss. No
C3.2 training or parameter-scale run is authorized yet.

Reasoner-0 now provides a separate mechanics path for the longer-term
reason-first architecture. Its seed task starts at the Cartan integer condition
rather than following formal-definition dependencies. A tiny learned control
policy routes canonical matrix proposals through an exact connected finite-type
verifier, commits a sealed Answer IR, and calls language rendering last. The
deterministic baseline recovers the four families and five exceptional types
through rank 8, while weighting affine determinant-zero near-misses as the most
useful negative signal. It also emits a structured JSONL corpus with no
rendered-text targets. It does not change the active C3 data repair, authorize a
ZERO.5 run, or claim that a neural proposer has learned Lie theory. See
[`docs/REASONER0.md`](docs/REASONER0.md).

Reasoner-1 learns the proposal boundary rather than another language target. A
fixed four-round graph recurrence converts canonical diagrams, attachment
actions, directed bond multiplicities, and the last verifier failure into
sparse integer features. A curriculum-trained integer perceptron selects which
actions may call the exact verifier. Training through rank 8 reaches the full
31-type census without an invalid verifier call. More importantly, the model
trained only through rank 7 recovers `A8`, `B8`, `C8`, `D8`, and `E8`, but also
makes one invalid proposal. This is 100% held-out recall and 96.7% precision,
not an exact generalization pass. No distillation or quantization is authorized.
See [`docs/REASONER1.md`](docs/REASONER1.md).

Reasoner-2 turns a rejection into another structured action rather than a
language explanation. Its exact teacher finds minimum one- or two-edit repairs
over node deletion and directed-bond changes. The fully supervised rank-8
curriculum repairs all 267 cases minimally. Frozen after rank 7, it solves all
69 unseen rank-8 cases, but only 66 use the minimum edit count. Masking the
verifier fields still solves 66 cases and repairs 63 minimally. Feedback helps,
but it is not causally dominant, so this is a no-go for the feedback-use gate
and no compression is authorized. See
[`docs/REASONER2.md`](docs/REASONER2.md).

Reasoner-3 changes the object instead of tuning Cartan repair. The verifier
keeps a bounded integer transition system hidden and returns only positive,
negative, or implication counterexamples to a learned atom-edit policy. The
stage-3 policy solves all 1,740 unseen stage-4 repair states and passes 396
disjoint witness-interchange tests, while an exact no-feedback calculation
caps a fixed first edit at 50%. Two holdout traces are non-minimal, so the
frozen conjunctive causal gate remains a no-go. The fully supervised policy is
exact on all 6,428 repair states, but that replay does not authorize
compression or language training. See
[`docs/REASONER3.md`](docs/REASONER3.md).

Reasoner-3.1 resolves the two Reasoner-3 misses without adding memory. An edit
may reach the verifier only when it resolves the current witness; the learned
policy ranks the remaining legal edits. The new 3D world has 511 hidden
programs and six exact complexity stages. Training stops at stage 4 before a
6,066-case development holdout, then stops at stage 5 before the 1,674-case
sealed test. Both pass with minimum-length traces, including every unseen
learner observation. The exact tool alone repairs only 139 sealed-test cases,
the witness-masked ranker repairs 1,189, and the full learner repairs all
1,674. All 27 equal-admissibility witness pairs and all coordinate
permutations pass. Exact trace-preserving compression is now authorized, but
language training is not. See [`docs/REASONER31.md`](docs/REASONER31.md).

Solomon in NSRL remains the separate integer-only Rust research line. ilXyr is
the evidence plane, not a model implementation. See docs/LINEAGE-BOUNDARY.md.

## The channel object

A training record has one declared target and a bounded causal history:

```text
channel(style, vibe or old memory)
  message(speaker, optional reply-to, text)
  message(speaker, optional reply-to, text)
  -> ZERO reply

channel(style, old memory, completed recent turns)
  -> new lossy memory
```

Whole channels are assigned to train or validation before records are cut.
An author, play, poem, or channel cannot leak across the split through random
token slicing. Public benchmark prompts never enter training.

## Four-way experiment

The next checkpoint decision is the fixed comparison in
`benchmarks/zero-channel-v1/ablation-contract.json`:

| Candidate | Added relation | Question |
| --- | --- | --- |
| A-flat | none | Is normalized literary text enough? |
| B-turns | speaker-tagged chronological turns | Do explicit speakers help? |
| C-replies | explicit reply edges | Does addressee structure help? |
| D-channel | vibe plus lossy-memory targets | Does the full channel loop help? |

Every candidate starts from the same checkpoint and uses the same architecture,
optimizer budget, held-out source units, and three seeds. Report every seed;
do not promote a lucky run. D-channel advances only if it clears the declared
automatic thresholds, wins a blinded human comparison, and preserves literary
validation quality.

## Execution order

1. Collect a small, consented, multi-speaker channel corpus and freeze its
   channel-level split plus source manifest.
2. Materialize all four representations from those same source channels.
3. Train A/B/C/D for seeds 1, 2, and 3 under the frozen contract.
4. Run `zero_eval` on best and final checkpoints and generate the comparison
   report without hiding failed seeds.
5. Conduct the blinded 200-prompt human reply comparison on held-out channels.
6. Promote only the candidate that clears the contract. If none does, improve
   data relations, memory targets, or routing before adding parameters.

## Commands available now

```sh
make zero-benchmark
make zero-benchmark-check
make web
node tests/test_web_model.mjs
```

`make zero-benchmark` is intentionally slower than sampling because it scores
both alternatives byte by byte through the real quantized C inference path.
The manifest checker refuses to render a report if the benchmark or deployed
model hashes have changed.

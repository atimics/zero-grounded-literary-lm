# Experiment Registry

Every training experiment, in order, with what was changed, why, and what
decision followed. This is the authoritative record. Individual RESULTS.md
files contain per-seed gate tables and model hashes; this document traces
the decision lineage.

Schema: `zero.experiment_registry.v1`.

---

| ID | Benchmark | Date | Proposal | Changed from previous | What was tested | Result | Decision | Next |
|---|---|---|---|---|---|---|---|---|
| **smoke-v1** | `benchmarks/zero4-smoke-v1` | 2026-07-16 | `FACULTY.md` mechanics gate | — (mechanics only) | Twenty-update multi-faculty pipeline and controller self-tests | Loss moved in the expected direction; the exact generation probe failed. | **No-go for promotion.** Mechanics passed, but this was not a capability experiment. | Pilot with frozen task gates |
| **pilot-v1** | `benchmarks/zero4-pilot-v1` | 2026-07-16 | `FACULTY.md` §6–8 | — (first ZERO.4 capability training) | 3 faculties (quantity, geometry, art), model generates full artifacts including arithmetic, 4,000 updates, seed 1 only | 0/20 exact artifacts each. Replay +3.52%. | **No-go.** Model learned target probabilities but produced zero verifiable artifacts. Do not add data or parameters. | Q1: single faculty, increase artifact signal |
| **q1** | `benchmarks/zero4-q1-v1` | 2026-07-16 | Pilot RESULTS.md recommendation | Dropped geometry and art. Single faculty (quantity). `--artifact-weight 4`. Controller-owned grammar + independent semantic validator. 3,000 updates. Seed 1 only. | Can one faculty with heavier artifact weighting produce exact results? | 4.0% exact (20/500). Closure and syntax 100%. Replay +2.7%. | **No-go.** This configuration did not generate exact arithmetic results reliably. Split routing from computation. | Q2: model emits typed request, controller handles arguments |
| **q2** | `benchmarks/zero4-q2-v1` | 2026-07-16 | Q1 RESULTS.md recommendation | Model emits typed request with arguments (e.g., `quantity.add 3 7`). Controller rejects changed args. Kernel computes result. 2,000 updates. Seed 1 only. | Can the model learn to emit correct operation + argument pairs? | 0.2% argument extraction. Operation extraction 100%. Closure/syntax 100%. Replay +2.7%. | **No-go.** This seed named operations but did not reliably extract arguments from source text. | Q2.1: operation-only, controller binds source arguments |
| **q21** | `benchmarks/zero4-q21-v1` | 2026-07-17 | Q2 RESULTS.md recommendation | Model emits only operation type (e.g., `quantity.add`). Controller independently parses source, binds arguments, rejects mismatches. Kernel computes. Seeds 1 and 2. | Can one faculty with operation-only routing pass all gates on multiple seeds? | Seed 1: 499/500 exact (99.8%), replay 1.864%. Seed 2: 500/500 exact (100%), replay **2.011%**. Seed 3 not run. | **No-go.** Operation-only routing passed quantity gates in two tested seeds; replay was seed-variable and seed 2 missed the frozen gate by 0.011 percentage points. | Q2.2: larger curriculum and joint checkpoint evaluation |
| **q22** | `benchmarks/zero4-q22-v1` | 2026-07-17 | Q2.1 AGGREGATE.md recommendation | Expanded quantity curriculum. Sentinel evaluations during training. Structured promotion/public/sentinel split. Constraint-aware training stopped at 400 updates (300 acquisition + 100 consolidation). Seed 2 only. | Can a larger curriculum and better measurement produce feasible checkpoints? | Quantity passed at updates 300 and 400. The replay adapter incorrectly stripped `--sample-weight`, restoring default 2x foundation weight. | **No-go due to invalid evaluation.** The trajectory is retained, but its recorded replay values are inadmissible. | Q2.2-R: correct and repeat the evaluation |
| **q22r** | `benchmarks/zero4-q22r-v1` | 2026-07-17–19 | Q2.2 EVALUATION-NOTICE.md | Corrected eval adapter (preserve `--sample-weight 1`, remove only `--distill`). Measured replay-only repair branches from retained Q2.2 frontiers. Frontier selection: feasibility → max margin → min replay. Seeds 1, 2, and 3. | Can corrected evaluation, with measured repair branches, produce a jointly feasible checkpoint on all three declared seeds? | Seed 1: no-go, 81.8% exact and 2.685% replay. Seed 2: go, 97.6% exact and 1.919% replay. Seed 3: no-go, 76.4% exact and 2.587% replay. Rejected state mutations: 0. Teacher hashes unchanged. | **No promotion: one go, two no-go.** ZERO.3 remains current. Activate optimizer-boundary interference controls instead of scaling quantity. | Q2.3 observer → transactional AdamW → local replay guard, diagnostic seed 2 |
| **q23** | `benchmarks/zero4-q23-v1` | 2026-07-19 | `ZERO4-BACKLOG.md` P0–P4 | Preregistered checkpoint-v4 transactional AdamW, per-attempt faculty/replay diagnostics, exact learned-state rollback, observer-derived guard calibration, and seed/promotion sealing. Student, teachers, corpora, routing, and public thresholds remained fixed from Q2.2. | Can optimizer-boundary observation and rollback prevent replay interference without weakening the quantity or 2% replay gates? | Observer seed 2 passed mechanics and calibrated a 0.25% hard band. Guarded seed 2 accepted all 200 attempts: 5 exceeded the warning band, none exceeded the hard band, and the maximum local increase was 0.2013%. Update 200 passed quantity exactly at threshold but replay regressed 2.685%. | **No-go.** The per-attempt local budget did not bind or control cumulative replay. Promotion and replication seeds 1 and 3 remained sealed; ZERO.3 remains current. | Q2.4 design: preregister a cumulative direct functional replay budget |
| **q24** | `benchmarks/zero4-q24-v1` | 2026-07-19 | Q2.3 no-go and `benchmarks/zero4-q24-v1/PREREGISTRATION.md` | Replaces the local one-step guard authority with an immutable ZERO.3 baseline over all six fixed replay slices. Every candidate is checked before commit; the 1.5% cumulative ceiling leaves 0.5 percentage points of reserve below the public gate. All other Q2.3 design choices remain fixed. | Can direct cumulative replay authority preserve the 2% public replay ceiling without closing the quantity-learning path? | Seed 2 committed 66 of 74 attempts. The first reject was attempt 67; eight consecutive candidates exceeded the hard budget and rolled back. No 100-commit public checkpoint was reached. | **No-go.** The guard bound before the first public quantity evaluation, so promotion and seeds 1 and 3 remained sealed. ZERO.3 remains current. | Q2.5 proposal: budget-aware continuation without weakening the replay or quantity gates |
| **q25** | `benchmarks/zero4-q25-v1` | 2026-07-19 | Q2.4 no-go and `benchmarks/zero4-q25-v1/PREREGISTRATION.md` | Keeps the immutable six-slice baseline and 1.5% authority, but retries each outer attempt at frozen scales 1, 1/2, …, 1/128. Every retry restores weights and AdamW moments and reuses the same minibatch, gradient, and proposed update. | Can deterministic first-feasible backtracking preserve replay safety while reopening the quantity-learning path? | Seed 2 committed 66 full-scale and 5 backtracked updates, then exhausted all eight scales on attempts 72–79. The smallest accepted scale was 1/128 and the maximum committed replay increase was 1.49944%. No 100-commit public checkpoint was reached. | **No-go.** Scalar continuation bought five updates but did not reopen the learning path. Promotion and seeds 1 and 3 remained sealed; ZERO.3 remains current. | Q2.6 proposal: change update direction or optimization geometry without weakening the frozen gates |
| **q26** | `benchmarks/zero4-q26-v1` | 2026-07-19 | Q2.5 no-go and `benchmarks/zero4-q26-v1/PREREGISTRATION.md` | Computes the mean gradient of the same six frozen replay slices at the pre-attempt state, projects only the replay-increasing component out of each scaled AdamW weight displacement, and retains the unchanged direct cumulative evaluation as sole commit authority. | Can a global replay-tangent projection change update direction enough to reopen the quantity-learning path under the same gates? | Seed 2 committed all 700 attempts at full scale; projection applied on 423. Six of seven public checkpoints were jointly feasible. Update 500 was selected with 99.8% limiting quantity rates and 1.1833% replay regression; the one-time promotion evaluation passed at 99.6%. | **Go.** Direction-changing projection reopened the constrained path without weakening any gate. The seed-2 model is published; ZERO.3 remains current pending the preregistered seed-1/3 replication decision. | Freeze the Q2.6 replication adapter and execute seeds 1 and 3 without changing the seed-2 contract |
| **q26r** | `benchmarks/zero4-q26r-v1` | 2026-07-19–24 | Q2.6 seed-2 go and `benchmarks/zero4-q26r-v1/PREREGISTRATION.md` | Executes only seeds 1 and 3 through the frozen Q2.6 driver while inheriting its intervention, initialization, corpora, optimizer, budgets, scales, authorities, gates, promotion split, and stop rules. OpenBLAS parallelizes deterministic evaluation without changing scientific outputs. | Does the accepted Q2.6 intervention reproduce on both remaining declared seeds without post-hoc selection or optional stopping? | Recovery-3 completed both seeds under independent caps. Seed 1: go, 98.0% exact, 1.0423% replay, $0.9373. Seed 3: go, 96.0% exact, 1.2753% replay, $0.9444. Both exactly-once promotion evaluations passed; the three-seed aggregate is go. | **Promote ZERO.4.** The prospectively selected seed-2 update-500 model becomes current; replication checkpoints remain evidence and cannot replace it post hoc. | Separately preregister SAT-1 operation-count scaling; no follow-up compute is authorized by promotion |
| **q27** | `benchmarks/zero4-q27-v1` | 2026-08-08 | Q2.6 language-preservation result and the authorized Q2.7 scope-ablation design | Restricted training to the top FFN and associated normalization while retaining the same seed-2 initialization, data, optimizer, replay projection, gates, selector, and historical Q2.6 full-model control. | Can top-FFN isolation acquire quantity routing while preserving the inherited behavior more tightly? | All 300 updates committed at full scale, but syntax, operation, and exact-request rates remained zero at updates 100, 200, and 300. No quantity/replay candidate was selected; the conditional language gate did not run. Observed quantity cost: $0.484688888889. | **No-go.** Retire hard top-FFN isolation as the next default intervention; no model or promotion follows. | Research the minimum distributed trainable subspace from matched Q2.6/Q2.7 traces and primary literature |
| **q30** | `benchmarks/zero4-q30-v1` | 2026-08-12 | Q2.9 no-go and the routed-adaptation literature review | Froze ZERO.3 and trained a rank-4, Q-only low-rank adapter on all FFN matrices for 200 updates; non-Q execution bypassed every adapter operation. | Can a small routed adapter recover at least 80% of quantity training loss while leaving the base and non-Q replay exactly unchanged? | Quantity loss fell monotonically from 3.8250 to 3.3955, an 11.23% reduction. Base state and non-Q replay were bit-identical. | **No-go; no candidate.** Isolation worked, but the factorized generative objective achieved only 14.0% of the required improvement. | Q3.1: train a discriminative five-way operation head over frozen representations |
| **q31** | `benchmarks/zero4-q31-v1` | 2026-08-12 | Q3.0 no-go and the operation-head mechanism audit | Replaced autoregressive target learning with a 7,685-parameter all-layer linear classifier and deterministic request renderer. | Does a frozen-feature head provide the step change while preserving exact non-Q identity? | The float selector reached 99.6% overall and at least 98% per class, but the packaged quantized runtime fell to 73.4%, including 0/100 add. | **Runtime no-go.** The head found signal, but float/batched training features did not match deployment features. | Q3.2: train and select on the deployment-exact quantized streaming representation |
| **q32** | `benchmarks/zero4-q32-v1` | 2026-08-12 | Q3.1 runtime mismatch | Kept the same 7,685-parameter head and budget, but extracted every feature from the exact packaged quantized streaming runtime. | Can deployment-exact feature training remove the packaging collapse? | The private feature and packaged-runtime gates both reached 500/500 at update 100; non-Q probability probes remained identical. | **Private go; candidate frozen.** This is reliable decoding on the explicit-operation distribution, not semantic intent inference. | Run the disjoint public quantity gate |
| **q32-public** | `benchmarks/zero4-q32-public-v1` | 2026-08-12 | Frozen Q3.2 candidate | Evaluated the immutable package once on 500 disjoint public cases with zero training updates. | Does deployment-exact routing generalize beyond its private selector? | 499/500 exact requests and artifacts (99.8%); the sole error was rejected solve-linear routing. All safety and identity gates passed. | **Go.** | Run the separately authorized disjoint promotion split |
| **q32-promotion** | `benchmarks/zero4-q32-promotion-v1` | 2026-08-12 | Q3.2 public go | Opened the 500-case promotion split exactly once with the same frozen package and zero training updates. | Does the public result survive the final disjoint quantity gate? | 500/500 exact; combined private, public, and promotion evidence was 1,499/1,500 (99.93%). | **Quantity promotion go.** The claim remains limited to explicit operation names. | Test paraphrased and implicit semantic routing before any broader capability claim |
| **q33-semantic** | `benchmarks/zero4-q33-semantic-v1` | 2026-08-12 | Q3.2 explicit-operation promotion go | Evaluated the frozen head on 500 balanced lexical paraphrases and implicit descriptions without retraining. | Did the explicit-operation head learn operation concepts rather than a surface cue? | 130/500 (26.0%): above 20% chance but far below the 80% gate; multiply dominated 72.4% of predictions and add scored 0/100. | **No-go for semantic generalization.** | Q3.4: retrain the deployment-exact head on a balanced canonical/semantic mixture with sealed template families |
| **q34-semantic-head** | `benchmarks/zero4-q34-semantic-head-v1` | 2026-08-12 | Q3.3 semantic-routing no-go | Trained the same frozen-base 7,685-parameter linear head on 4,500 canonical and 4,500 semantic records, with disjoint private and confirmation families. | Can mixed supervision produce a reliable semantic router inside 100 updates? | Final private accuracy was 208/500 (41.6%) with large per-class swings; only 6,400 batch examples were consumed, less than one pass through the pool. | **No-go; no candidate.** Semantic signal improved but never reached the 80% overall/60% per-class selector, so packaging and all later gates remained sealed. | Build the immutable corpus pipeline, then compare adequate exposure and a small nonlinear probe before training a larger routed expert |
| **sero-latent-v1** | `benchmarks/sero-latent-v1` | 2026-08-21 | Learned causal byte patches | Added a local/global byte model with learned boundaries and compared it with static patches and a byte-BPE Transformer. | Can learned boundaries beat static patching and direct BPE at pilot scale? | Learned boundaries beat static patches, but total loss lost to BPE on all three seeds. A later audit found a redundant end-patch target and too little, source-biased training data. | **Reject V1; retain its narrow result.** Do not treat it as a general learned-tokenizer no-go. | Test a corrected representation without redundant boundary output |
| **sero-latent-v2** | `benchmarks/sero-latent-v2` | 2026-08-21 | Direct discrete patch codes | Replaced V1's patch decoder with a 4,095-entry frequency dictionary plus one residual escape path. | Does a direct patch code remove V1's local reconstruction cost? | Mean validation loss was 4.171 versus 3.993 BPE bits per byte. Removing the redundant end-patch charge diagnostically did not reverse the result. | **Reject the V2 frequency dictionary.** Its result does not test a jointly learned continuous tokenizer. | Build a causal embedding-routed continuous hierarchy |
| **sero-latent-v3** | `benchmarks/sero-latent-v3` | 2026-08-22 | H-Net-inspired continuous causal chunking | Removed end-patch, codebook, unknown, and escape outputs; added an adjacent-embedding cosine router, continuous global chunks, exact shared-window accounting, representative manifest sampling, and a compute-matched BPE control. | Can a learned byte hierarchy deliver at least 1% lower bits per byte than BPE at equal data and estimated compute? | A licensed, source-balanced corpus supplied 123,153,182 unique training bytes. At the frozen 100M checkpoint, mean latent quality was 2.5009 versus 2.1835 BPE bits per byte. All seeds failed quality; seeds 0 and 1 also exceeded the compute ceiling. | **Do not promote V3.** Reject this one-stage embedding-router design, not all learned tokenization. | Train the actual Sero language-model baseline on the promoted corpus with locked byte-BPE; keep latent tokenization as a separate research branch |
| **sero1-pretrain-v1** | benchmarks/sero1-pretrain-v1 | 2026-08-22 | First dense Sero language model | Trained three 6.02M-parameter PyTorch seeds with the locked 4,096-token lossless byte-BPE tokenizer. | Does the promoted tokenizer/corpus support stable dense pretraining? | Mean test quality reached 1.6181 bits per raw byte. Real context helped continuation loss, but greedy generation looped in 91.7% of tested cases. | **Promote as baseline evidence, not a reliable generator.** | Improve document boundaries, curriculum, and exposure |
| **sero2-curriculum-v1** | benchmarks/sero2-curriculum-eval-v1 | 2026-08-23 | Cleaner source-balanced curriculum | Added MDN, reviewed OpenAssistant, and GSM8K; added end-of-document targets and retention consolidation. | Can better data and order improve the same 6M model before scale? | The consolidated seed reached 1.3278 test bits per raw byte and passed every source gate. Generation still looped and reasoning was not reliable. | **Curriculum works; do not claim intelligence.** | Hold the total token schedule fixed and test 20M parameters |
| **sero20m-consolidation-v1** | benchmarks/sero20m-consolidation-v1 | 2026-08-23 | Dense parameter scale | Increased the model to 20,011,136 parameters while keeping the Sero 2 total 377,031,062-token schedule. | Does conventional PyTorch/CUDA scale improve held-out compression? | Final test quality was 1.200848 bits per raw byte, 9.56% below the matched-token 6M model. Every frozen gate passed for $2.7475 measured EC2 cost. Samples still looped and contained locally false arithmetic. | **Scale pass; no intelligence claim.** | Freeze Sero; price any larger scale work separately |
| **sero-series-closure-v1** | benchmarks/sero-series-closure-v1 | 2026-08-23 | Research-line closure | Bound the terminal result, AWS status, checkpoint hashes, claim limits, and dense scale cost formula. | Is the Sero evidence complete enough to preserve while returning to C ZERO? | The closure checker binds the 20M result and prices 100M through 1P under declared assumptions. | **Sero frozen. ZERO C active.** | Improve ZERO and Braid; keep Solomon as the separate integer-only Rust line |
| **zero5-c0-v1** | benchmarks/zero5-c0-v1 | 2026-08-23 | C corpus/tokenizer gate | Added a C Braid release verifier, governed split preservation, lossless byte streams, deterministic C byte-BPE training, and a separate ZERO.5 trainer while preserving the historical trainer hash. | Can the C model consume a verified immutable corpus without Unicode loss, boundary leakage, or parameter-budget drift, and which lossless tokenizer wins? | The adversarial mechanics gate passed. The real Corpus 1 run verified 797 train, 101 validation, and 101 sealed test records. Byte-BPE512 used 9,790 validation content tokens versus byte264's 22,807, a 57.07% reduction at the exact historical parameter budget. | **C0 complete; select byte-BPE512. No training authority.** | Preregister a small C factual-grounding experiment; expand Braid before broad pretraining |
| **zero5-c1-v1** | benchmarks/zero5-c1-v1 | 2026-08-23 | Native C training proof | Trained the exact 4,852,992-parameter rotary byte-BPE512 model from scratch for 300 updates on seeds 0, 1, and 2, then repeated seed 0. | Can the governed C path learn a stable held-out Corpus 1 signal without an obvious train-only gap? | Mean validation reached 4.7480 nats/token or 2.9707 bits/raw byte, 23.89% below uniform. The seed spread was 0.0962, seed 0 reproduced byte for byte, and test remained sealed. Post-decision generations learned record markers but were mostly gibberish. | **C training-signal pass; no model promotion.** | Expand Braid at fixed model size before broad pretraining |
| **zero5-c2-v1** | benchmarks/zero5-c2-v1 | 2026-08-23 | Fixed-size Atlas scale pilot | Continued the selected C1 checkpoint through one complete ordered pass over Braid Corpus 2 Atlas without changing the 4,852,992-parameter model or byte-BPE512 tokenizer. | Does a much larger factual prose corpus improve held-out modeling before parameter scale? | Atlas validation fell from 4.9819 to 2.2786 nats/token, a 54.26% gain, while the C1 anchor also improved 21.48%. Test stayed sealed. Generations became prose-shaped but remained incoherent. | **Pass the corpus-scale pilot; no intelligence or model-promotion claim.** | Test the evidence-linked C3 curriculum at fixed model size |
| **zero5-c3-v1** | benchmarks/zero5-c3-v1 | 2026-08-23 | Evidence-linked task curriculum | Continued the selected C2 checkpoint through claims, cloze, and context-safe retrieval, with exhaustive answer-only validation and C2/C1 retention gates. | Does one ordered C3 pass create a step change in answer completion without forgetting earlier corpora? | Combined validation improved 39.13% and retention passed. Retrieval answer loss improved 95.84%, but A/B choice was only 52.05%; claim improvement was 6.93% and cloze answer loss worsened 6.72%. All test records stayed sealed. | **No-go.** Whole-record gains hid weak decisions and blocked stage order caused interference. | Compare a same-token interleaved replay braid with explicit answer weighting at fixed model size |
| **zero5-c31-v1** | benchmarks/zero5-c31-v1 | 2026-08-24 | Record-safe task braid and answer weighting | Repacked the locked 512-token C3 view without splitting records; compared blocked V, exact-pack interleaved A, and exact-pack interleaved B with 4x answer-token loss. | At fixed model, tokenizer, data, seed, and compute, do richer evidence, smooth task replay, or answer weighting produce balanced answer gains while retaining C2 and C1? | V improved combined loss 35.41% but retained cloze interference. A improved combined loss 41.75% and cloze answers 21.93%. B improved cloze 26.80%, retrieval answer loss 95.97%, and retrieval choice to 54.77%; claim improvement reached 7.28%. All retention gates passed and test stayed sealed. | **No-go under the conjunctive gate.** No arm passed both claim and retrieval-choice thresholds; no promotion or replication. Interleaving and answer weighting are supported as curriculum mechanisms. | Repair the Braid task definitions: evidence-grounded short claims, passage-order-paired retrieval, and task-balanced answer loss before any C3.2 training |
| **zero5-c61-shared-state-v1** | `benchmarks/zero5-c61-shared-state-v1` | 2026-09-01 | Shared-state bottleneck | Added a 152-wide factor head and answer bridge beside the fixed language model. The final recovery evaluated the selected private checkpoint across 18 frozen tasks. | Does a learned state bottleneck improve grounded retrieval and show a causal bridge contribution? | The state-learning and retention gates passed. Retrieval, paired-choice, and bridge-contribution gates failed. The evaluation recovery used 3,800 instance seconds and $0.717777777778. | **No-go.** The terminal result is hash-bound and the sealed test stayed closed. | Start HT1 implementation review |
| **zero5-ht1-mergetree-v1** | `benchmarks/zero5-ht1-mergetree-v1` | 2026-09-01 | Tokenizer merge-tree embeddings | Keeps the exact byte-BPE512 stream and adds zero-initialized depth gates over recursively composed merge descendants. | Does the tokenizer's existing merge tree improve byte compression, especially for deeper merges, without hurting tasks or retention? | The trainer and evaluator are implemented. Synthetic ten-update checks pass for one and two workers. Gate-off state, exact restart, byte round trip, gradients, causality, and depth accounting pass. The experiment run count is zero. | **Implementation ready for artifact preflight.** | Run the actual C2/C5.1 ten-update comparison and measure the 1.03 compute and wall-time limits |
| **zero5-ht2-blockstate-v1** | `benchmarks/zero5-ht2-blockstate-v1` | 2026-09-01 | Fixed eight-token recurrent block state | Adds a 128-wide recurrent summary of completed eight-token blocks and compares it with a parameter-matched one-block control. | Does hierarchy across fixed token blocks improve retrieval beyond the most recent block alone? | Not run. The two-arm design, distance analysis, and gates are frozen; implementation and compute are not authorized. | **Preregistered only.** It follows HT1 and requires separate authority. | If later authorized, run the matched control and treatment once each |
| **zero5-ht3-answerroot-v1** | `benchmarks/zero5-ht3-answerroot-v1` | 2026-09-01 | Prompt-predicted answer root | Replaces a changing answer-position state with one prompt-only semantic root, held fixed through the answer and tested with zero, wrong-root, and bridge-off interventions. | Can one predicted high-level answer representation improve factor prediction and grounded retrieval over C6.1? | The design now binds the terminal C6.1 result and checkpoint hashes. | **Preregistered.** It follows HT1 and HT2 in the frozen order. | Seek implementation review after the earlier studies resolve |

---

## Evaluation studies

| ID | Date | Scope | Result | Decision |
| --- | --- | --- | --- | --- |
| **q22-shared-task-v1** | 2026-08-30 | Family-neutral Q22 bridge surface in `benchmarks/zero4-q22-shared-task-v1` | Materialized 9,500 training-only JSONL rows and froze a disjoint 500-row promotion TSV without changing the historically locked Q22 generator. | **Infrastructure pass only.** Solomon may encode and verify these exact bytes; no cross-family run or scientific result exists yet. |
| **q22-compositional-shared-task-v1** | 2026-08-31 | Shortcut-resistant Q22 successor surface in `benchmarks/zero4-q22-compositional-shared-task-v1` | Froze 10,000 training rows and 1,000 promotion rows with one common prefix, balanced wrong-operation distractors, and disjoint training/promotion sentence templates. | **Infrastructure pass only.** A prefix-only classifier is fixed at 20%; Solomon may train on the frozen training rows after preregistration, but no promotion score or capability result exists yet. |
| **zero-eval1-screen** | 2026-07-24–25 UTC | Frozen ZERO.3 and ZERO.4 on 1,000-case BLiMP, TinyStories, HellaSwag, and adapted LAMBADA screens | ZERO.4: BLiMP +0.005 raw accuracy, TinyStories +0.042492 bits/byte (worse), HellaSwag -0.005 normalized accuracy, adapted LAMBADA tied at zero. AWS: 2,502 seconds/$0.4726. | **Do not run the proposed 8h30m/$5.78 full suite.** Replace it with a candidate-only BLiMP/TinyStories preservation gate; do not claim general language improvement. |
| **post-q27-plasticity** | 2026-08-08 | Research-only matched trace analysis and 12-paper primary review in `benchmarks/zero4-post-q27-v1` | Q2.7's top FFN moved more than the corresponding Q2.6 groups but learned far less; Q2.6's successful trajectory had distributed cross-layer movement. The literature supports graded consolidation, distributed sparse changes, and adapters as testable families but does not establish a safe Zero boundary. | **Lead with a no-update shadow audit, then—only under separate authorization—one 200-update fixed graded-plasticity pilot against the frozen Q2.7 control.** No compute or promotion is authorized. |
| **q28-shadow-audit** | 2026-08-08 | Training-only, four-sample gradient audit in `benchmarks/zero4-q28-v1` over the frozen Q2.6 quantity and six replay training sources | All 50 groups received fixed coefficients from 0.1572 to 0.7887. The weighted projection reduced positive first-order replay drift from 0.0001500 to 7.51e-10. All weights and AdamW moments were byte-identical before and after; zero updates committed and no evaluation inputs were used. | **Mechanics pass; freeze profile `de858b2c…`.** A 200-update diagnostic pilot is eligible for a separate exact, cost-bounded approval. No training, language gate, or promotion is authorized by this audit. |
| **q28-pilot-activation** | 2026-08-08 | Implementation-only activation in `benchmarks/zero4-q28-v1` bound to audited merge `ea5242d0…` and profile `de858b2c…` | The seed, data, 200-update ceiling, 0/100/200 measurements, complete-displacement scaling, weighted replay projection, candidate-selection rule, and $0.50 + conditional $0.12 ceilings are fail-closed. The tracked run budget remains unauthorized with zero executable caps. | **Prepare for exact-head review and merge.** No pilot, language gate, workflow, AWS compute, or promotion may run until a separate one-execution authorization binds the merged activation commit. |
| **q28-seed2-pilot** | 2026-08-08 | One authorized local execution at merge `606e1ab6…`, fixed profile `de858b2c…`, seed 2, and exactly 200 updates | Update 200 was prospectively selected: quantity training loss improved 98.2847% and replay training loss regressed 1.94345%, inside the 2% ceiling. The frozen checkpoint is `a5bad72e…`; paid compute was $0.00. | **Candidate frozen; language gate eligible.** This is a small fixed training measurement, not a generalization result. No language evaluation or promotion occurred. |
| **q28-language-gate-route** | 2026-08-08 | Implementation-only candidate binding in `benchmarks/zero4-q28-v1/language-gate` for deterministic artifact `ffc9a4aa…` | The route reuses unchanged `zero-language-gate-v1`, fixes AWS to `c6i.4xlarge`/`us-east-1`, caps the instance at 600 seconds/$0.12, exits GitHub Actions after launch, and uses one-time execution and collector locks. The tracked template remains non-executable. | **Prepare for protected review and merge.** No dispatch, AWS compute, evaluation, threshold change, candidate substitution, or promotion is authorized by this implementation. |
| **q28-language-gate** | 2026-08-10 | Exactly-once, candidate-bound 1,000-case BLiMP and TinyStories preservation gate for Q2.8 update 200 (`ffc9a4aa…`) | BLiMP raw accuracy was 0.539 against the ≥0.522 floor (pass). TinyStories was 2.675123 bits/byte against the ≤2.553140 ceiling (fail). Evaluation took 281.811 seconds; the terminated AWS instance cost an estimated $0.071211. Zero training updates occurred. | **No-go.** The conjunctive language gate failed. Keep seeds 1 and 3 sealed, do not promote the candidate, and leave SAT-1 blocked behind a language-preserving five-operation anchor. |
| **post-q28-conservative** | 2026-08-10 | Frozen update-100/update-200 comparison and decision in `benchmarks/zero4-post-q28-v1` | Update 100 retained 94.7272% quantity recovery with 0.94218% replay regression and was better than update 200 on all 1,000 paired TinyStories cases, although both checkpoints failed the TinyStories ceiling. BLiMP had no reliable paired direction (exact McNemar p=0.2295). | **Preregister Q2.9 conservative exposure.** Keep the Q2.8 profile fixed, cap exposure at 100 updates, measure every 25, enforce a 0.75% replay guard, and freeze the first checkpoint reaching 80% quantity recovery. The fixed 5% coordinate mask moves to fallback. |
| **q29-pilot-activation** | 2026-08-10 | Implementation-only activation in `benchmarks/zero4-q29-v1`, bound to issue #83 and the unchanged Q2.8 profile `de858b2c…` | The seed-2 trajectory, 100-update cap, 0/25/50/75/100 measurements, replay-first stopping rule, first-hit selection, input hashes, and one-shot authorization consumption are fail-closed. The tracked budget has zero executable caps. | **Prepare for protected review and merge.** No pilot, language gate, seed expansion, promotion, or deployment is authorized by this implementation. |
| **q29-seed2-pilot** | 2026-08-10 | One authorized local execution at merge `c4f682c0…`, fixed Q2.8 profile `de858b2c…`, seed 2, and a maximum of 100 updates | Update 25 recovered 53.1581% of quantity loss with 0.20106% replay regression and continued. Update 50 was the first hit: 81.0518% quantity recovery and 0.12325% replay regression. The run stopped immediately; raw checkpoint `b996514d…` and quantized candidate `018efb11…` were frozen. Observed wall time was 36 seconds and paid compute was $0.00. | **Candidate frozen; unchanged language gate eligible but not authorized.** No updates 51–100, language evaluation, seed expansion, promotion, or deployment occurred. |

---

## Decision trace

```
pilot-v1 (3 faculties, full artifacts)
  "0/20 exact, model can't generate arithmetic"
  → Q1: single faculty, artifact-weight 4x

q1 (1 faculty, full artifacts, heavy weighting)
  "4% exact, model can't generate numbers"
  → Q2: typed request with arguments

q2 (operation + args in model output)
  "0.2% arguments, model can't extract from source"
  → Q2.1: operation-only, controller binds args

q21 (operation-only, 2 seeds)
  "Seed 1 go, seed 2 replay 2.011%"
  → Q2.2: larger curriculum, better measurement

q22 (expanded curriculum, sentinel evals)
  "Evaluation bug: sample-weight stripped"
  → Q2.2-R: corrected eval, replay repair

q22r (corrected eval, measured repair branches, 3 seeds)
  "Seed 2 go; seeds 1 and 3 fail quantity and replay."
  → Q2.3: measure and control interference at the optimizer boundary

q23 observer (transactional instrumentation, seed 2)
  "Learned state identical; direct guard calibrated; first-order signal non-predictive."
  → Q2.3 guarded seed 2 under the frozen 0.25% functional budget

q23 guard (local direct functional budget, seed 2)
  "200 accepts, 0 rejects; quantity passed; cumulative replay +2.685%."
  → Q2.4: budget direct functional drift cumulatively, not independently per attempt

q24 (immutable six-slice cumulative budget)
  "66 accepts, then 8 consecutive rejects above 1.5%; no public checkpoint."
  → Q2.5: change the candidate update when the budget binds; do not relax the gate

q25 (deterministic cumulative-guard backtracking)
  "66 full-scale + 5 backtracked commits; then 8 exhausted attempts, no public checkpoint."
  → Q2.6: change update direction or optimization geometry; do not relax the gates

q26 (global all-slice replay-tangent projection)
  "700/700 commits; 423 projected; update 500 public + promotion pass."
  → Q2.6 replication seeds 1 and 3 under the unchanged contract

q26r AWS execution
  "After bounded infrastructure recovery, seeds 1 and 3 both pass public and promotion gates."
  → Three-seed family go; promote the prospectively selected seed-2 update-500 artifact as ZERO.4
```

---

## Key findings across experiments

1. **Full artifact generation was not reliable in the tested 4.85M configurations** for exact arithmetic (pilot: 0/20, q1: 4%). The operation-only controller boundary is the supported path; these runs do not prove that every full-generation configuration is infeasible.

2. **Argument extraction was much weaker than operation classification in Q2 seed 1** (0.2% args vs 100% ops). The current contract therefore lets the controller parse while the model classifies.

3. **Operation-only routing passed the quantity gates in both tested Q2.1 seeds** (99.8–100%). Seed 3 and the replay constraint still prevent calling the overall quantity faculty solved.

4. **Replay regression is the binding constraint**, not routing accuracy (q21 seed 2: 2.011%, q22r seed 2: 1.919%). The model learns quantity easily; it forgets Shakespeare slowly.

5. **The tested repair phase had little effect in seed 2.** The Q2.2-R events log shows replay changes on the order of 0.0003 over 100 updates and a 0.2 percentage-point quantity change. That is evidence about this seed and setting, not a general conclusion about replay repair.

6. **Q2.2-R did not replicate.** Only seed 2 passed. Seeds 1 and 3 both
missed quantity and replay, so the next experiment changes optimizer safety,
not capability scope or model size.

7. **Q2.3 observer mechanics passed, but the linear drift diagnostic did not.**
The learned state remained byte-identical while observation was enabled, but
predicted and realized replay changes had Pearson 0.0076. The guarded run must
therefore rely on its direct functional probe, not the first-order estimate.

8. **A safe-looking local step does not imply a safe trajectory.** Q2.3's
largest local replay-probe increase was 0.2013%, below its 0.25% hard band, so
all 200 attempts committed. Public replay nevertheless accumulated to 2.685%.
The next guard must track cumulative direct drift rather than independent
per-attempt quantiles.

9. **Direct cumulative authority worked as a safety boundary but closed the
learning path.** Q2.4 accepted 66 updates, with a maximum accepted composite
increase of 1.4253%, then rolled back eight consecutive candidates above the
1.5% hard ceiling. The run stopped before its first 100-commit public
checkpoint, so promotion and replication correctly stayed sealed. A follow-up
must change how a rejected candidate is constructed or scaled, not weaken the
frozen replay or quantity gates.

10. **Scalar continuation did not resolve the constrained optimization
boundary.** Q2.5 accepted five additional updates by shrinking the same
candidate direction, including one at 1/128, and held every commit below the
1.5% authority. It then exhausted all eight scales on eight consecutive outer
attempts. The next proposal must change the update direction, objective, or
optimization geometry rather than only reduce step length; the frozen replay
and quantity gates remain unchanged.

11. **Direction-changing projection reopened the constrained path.** Q2.6
committed all 700 attempts without backtracking or rejection while the direct
six-slice authority remained unchanged. Projection applied to 423 candidates;
the largest committed composite increase was only 0.05089%. Six public
checkpoints were jointly feasible, update 500 dominated the frontier with
99.8% limiting quantity rates and 1.1833% replay regression, and the one-time
promotion evaluation passed at 99.6%. This was the prospective seed-2
candidate; its later promotion did not change after the replication results
were observed.

12. **Runtime and cost are preregistration inputs.** The first AWS Q2.6-R
execution reached an 11-hour cap without a result because its frozen Linux
source used the portable backend. That is an execution failure, not a no-go.
The replacement OpenBLAS calibration is diagnostic-only, capped at five EC2
minutes and $0.06, and must publish throughput before a larger budget can be
authorized.

13. **The replay-safe quantity result replicated.** Under the unchanged Q2.6
contract, seed 1 passed at 98.0% limiting quantity rates and 1.0423% replay
regression; seed 3 passed at 96.0% and 1.2753%. Both exactly-once promotion
evaluations passed, so the all-three-seed conjunction resolved go. The frozen
seed-2 update-500 artifact is promoted as ZERO.4. The measured capability is
operation routing with controller-bound arguments and deterministic kernel
arithmetic; it is not evidence of neural arithmetic or untested faculties.

14. **External preservation is a separate promotion axis.** The bounded
ZERO-EVAL-1 screen found a small BLiMP improvement but a 1.681% TinyStories
bits/byte regression for ZERO.4, above the prospectively frozen 1% candidate
ceiling. Q2.7 therefore isolates quantity learning to the top FFN and final
normalization. This is a registered hypothesis with a zero-compute firewall,
not a completed experiment or a claim that isolation will succeed. Its
machine-readable authority is `benchmarks/zero4-q27-v1`.

15. **Evidence work is part of the experiment budget.** Prospective and live
experiments must register primary literature, limiting evidence, cheaper
alternatives, design and review cost, total incremental cost, and the decision
that each possible outcome changes. Compute authorization alone is
insufficient. Completed historical results are not rewritten; Q2.7 is the
first live experiment governed by `EXPERIMENT-EVIDENCE.md`.

16. **The Q2.7 literature gate completed and requires revision.** One
read-only GPT-5.6 Terra pass reviewed five registered primary full texts with
no subagents. It found replay-guided projection defensible but found no
literature basis for treating top-FFN-only training as a safe preservation
boundary; the closest causal-localization evidence points to middle-layer
MLPs, and registered counterevidence shows that reduced trainable scope need
not reduce forgetting. BLiMP and TinyStories remain bounded conjunctive
screens rather than general-language proof. The review reported 78,046
aggregate tokens, conservatively bounded at 0.4877875–29.26725 credits.
Recommendation: revise; run no Q2.7 compute unchanged.

17. **Q2.7 is redesigned as a paid-for-control scope ablation.** The frozen
Q2.6 seed-2 result supplies the hash-bound full-scope control because seed,
initialization, teachers, data, optimizer, direct replay authority, quantity
gates, selection, and language cases match; only the prospective trainable
scope changes. Reusing it avoids up to $1.29 of duplicate control
training/evaluation. No second broad review is needed unless a new
intervention family is proposed or comparability fails. The redesign
authorizes zero compute and awaits explicit experiment approval.

18. **Q2.7 rejected the hard top-FFN boundary, not replay projection.** The
completed run accepted all 300 updates at full scale and selected no candidate.
At the matched update-200 checkpoint, Q2.6 had 95.4% operation and exact-request
success while Q2.7 remained at zero. Q2.7's active `layer.5.w1` and
`layer.5.w2` accumulated more displacement than the same groups in Q2.6, so
insufficient top-FFN movement is contradicted by the trace. The post-Q2.7
research review ranks a fixed, training-only, cross-layer graded-plasticity
profile as the next intervention to test, preceded by a no-update shadow audit.
This is a research recommendation, not compute authority.

---

## Schema

Every completed capability result contains sibling `RESULTS.md` and
`manifest.json` files. Non-capability mechanics gates use a stage-specific
report such as `OBSERVER.md`. Experiment directories may additionally retain
invalidated trajectories, frontier checkpoints, or notices:

| File | Required | Content |
|---|---|---|
| `RESULTS.md` | Yes | Decision, gate table, model SHA-256, teacher hashes |
| `manifest.json` | Yes | Machine-readable result with schema version, all metrics, all hashes |
| `FRONTIER.md` | If multi-checkpoint | Frontier table with per-checkpoint feasibility |
| `frontier.json` | If multi-checkpoint | Machine-readable frontier |
| `selection.json` | If checkpoint selected | Selection policy, selected checkpoint, metrics |
| `events.jsonl` | If multi-phase | Append-only training/evaluation event log |
| `EVALUATION-NOTICE.md` | If errata | Corrections, caveats, known issues |
| **zero4-retention-controls-v1** | `benchmarks/zero4-retention-controls-v1` | 2026-09-05 | Matched replay, guard, and projection controls | Adds a five-arm runner with complete process costs, sample traces, and saved checkpoints. | Does the runner preserve matched work and score complete final artifacts? | All five known toy arms complete; each scores 0/5 final artifacts and 5/5 oracle arithmetic. | Engineering checks pass; zero final answers and inactive projection remain recorded. | Freeze fresh cohorts and the cloud package |
| **zero4-retention-source-losses-v1** | `benchmarks/zero4-retention-source-losses-v1` | 2026-09-05 | Retention loss and coverage by source | Records each source's loss, weight, windows, and change during the existing evaluation forwards. | Can the runner reveal damage to one source when the combined mean stays steady? | Eleven focused checks, 35 native numerical checks, and the 79-process smoke pass; six mixed-source losses match separate evaluations exactly. | Engineering checks pass; the vocabulary fixture and missing registry entry failures are retained. | Freeze fresh source limits and a separate language screen |

---

## Current state (2026-08-24)

- **Current and deployed model**: ZERO.4, the Q2.6 seed-2 update-500 artifact at `docs/model.litq8` (SHA-256 `44b32f22...`)
- **Frozen initialization teacher**: ZERO.3 (`teachers/zero3-balanced-final.teacher`, source update 16,600, SHA-256 `c8657694...`)
- **Latest completed capability experiment**: Q3.4 mixed canonical/semantic operation-head pilot
- **Latest mechanics outcome**: ZERO.5-C3.1 completed three exact record-safe pack passes with all test records sealed
- **Evaluation decision**: C3.1 proved a large interleaving benefit and fixed cloze interference, but no arm passed both the claim and retrieval-choice gates
- **Next experiment**: Build and verify evidence-grounded short claim targets, paired retrieval order, and task-balanced answer accounting before preregistering C3.2
- **Active proposals**: See `PROPOSALS.md`
- **Promotion status**: ZERO.4 remains current; Q3.2's separate routed quantity package passed its narrow quantity gates but did not replace `docs/model.json`

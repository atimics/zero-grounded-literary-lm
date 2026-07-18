# Model Saturation: How Many Verifiers Fit in 4,852,992 Parameters?

This document defines the measurement protocol for empirically
determining the compositional-verification capacity of the ZERO
architecture without speculating about what "probably" fits.

Status: **proposal** — no saturation experiments have been run.
Q2.2-R establishes that one faculty (quantity) with ~5 operation types
passed one seed-level joint gate. Its `0.096` target-bits metric measures
prediction quality on that evaluation; it is not a measurement of parameter
capacity consumed.

---

## 1. What "saturation" means

Let the architecture be fixed at $(T,d,H,L,f,V)=(512,256,8,6,1056,128)$
with $P=4{,}852{,}992$ parameters. We progressively add verifiers—first
within a faculty (more operation types), then across faculties—and
measure three signals until one crosses a predefined threshold:

| Signal | Definition | Threshold | Interpretation |
|---|---|---|---|
| **Routing accuracy** | Fraction of chunks where the model emits the correct operation request | <95% | The model cannot reliably distinguish which verifier to invoke |
| **Composition coherence** | Held-out loss on a future shared-synthesis corpus referencing K faculty summaries | Proposed: >5% relative increase over K=1 baseline | Cross-faculty interference may degrade synthesis quality; corpus and threshold are not frozen |
| **Replay regression** | Relative increase in historical validation loss vs the frozen ZERO.3 baseline | >2% | New verifiers are overwriting prior capabilities |

**Definition 1.1** (Observed saturation point). On a predeclared increasing
grid of verifier counts, the observed saturation point $N^*$ is the first tested
count at which at least one frozen signal crosses its threshold on two or more
seeds. This is an empirical boundary for that grid, corpus, optimizer, and
budget—not a proof that all larger counts must fail.

**Definition 1.2** (Hard saturation). The model is *hard-saturated under a
declared search budget* when routing accuracy falls below 95% and every
predeclared training configuration fails within the same update and tuning
budget. Unbounded hyperparameter search cannot be ruled out empirically.

**Definition 1.3** (Soft saturation). The model is *soft-saturated* when
composition coherence or replay regression crosses its threshold. Soft
saturation may be recoverable through repair phases or sampling-weight
rebalancing, but not without cost.

Training-set metrics diagnose retention but cannot establish saturation.
Checkpoint selection and early stopping use public validation only. The
predeclared scaling grid is evaluated on a disjoint test panel after training;
any final promotion panel is opened only once after the study configuration and
selection policy are frozen.

---

## 2. Syntactic bounds and empirical hypotheses

Only the request-string cardinality result below is a hard syntactic bound. The
residual, attention, and feed-forward sections state diagnostics or hypotheses;
they do not yield a faculty-capacity theorem.

### 2.1 Output-channel bound (routing)

The model emits an operation request as a token sequence $r\in\Sigma^L$
with $L\ge1$. For a request of length $L$, the channel capacity is
$C_{\text{out}}=L\cdot\log_2 V=L\cdot 7$ bits.

Let $N_{\text{ops}}$ be the number of distinct operation types. Each
requires $\lceil\log_2 N_{\text{ops}}\rceil$ bits to identify uniquely.

**Proposition 2.1** (Output routing bound). $N_{\text{ops}}\le 2^{7L}$.
For the current design $(L\approx 2)$, $N_{\text{ops}}\le 16{,}384$.

*Proof.* $L$ tokens each from a vocabulary of $V=128$ produce $V^L$
distinct sequences. Fewer if the request must conform to a structured
grammar (e.g., `faculty.operation`). With the current grammar
`domain.operation` using 2 tokens, $N_{\text{ops}}\le 128^2/|\text{domains}|$.
For 12 domains with ~10 operations each, $N_{\text{ops}}\approx 120\ll 16{,}384$.

This bound is loose: the output channel is not the bottleneck for any
reasonable faculty roster.

### 2.2 Residual-stream distinguishability bound (routing)

At the final layer (before the output projection), the model must encode
the routing decision in the 256-dimensional residual stream. Two distinct
operations $a\neq b$ must produce distinguishable representations
$h_a\neq h_b$ at the position where the request is emitted.

**Proposition 2.2** (Linear separability). For the output projection
$E\in\mathbb R^{V\times d}$, the set of logit vectors
$\{Eh_a: a\in\{1,\ldots,N\}\}$ must be such that the maximum-value index
identifies the correct operation token. With tied embeddings, $E$ is also
the input embedding matrix. The model's ability to route correctly depends
on whether the residual-stream representations $\{h_a\}$ are linearly
separable by the columns of $E$.

**Diagnostic 2.3** (Representation confusion). As $N$ increases, measure the
pairwise cosine distribution of residual states at request positions and test
whether high-similarity pairs correlate with routing confusion. No random
assignment model is assumed, and cosine similarity alone does not prove that
the tied output projection cannot separate two states.

### 2.3 Attention composition bound

For synthesis chunks referencing $K$ distinct faculty summaries, the
model must attend to $K+1$ distinct positions (input + K summaries).

Softmax can assign nonzero weight to all 512 positions. Head dimension limits
the query/key representation and score-matrix structure, not the number of
positions with weight above an arbitrary threshold. Consequently there is no
valid $O(d_h)$ or $O(Hd_h)$ summary-count bound here. Composition depth must be
measured while also respecting the 512-token context budget.

### 2.4 Feed-forward composition bound

The FFN at each layer $(256\to1056\to256)$ is where attended information
is integrated. With hidden dimension $f=1056$ and GELU activation, the
FFN can approximate functions of the attended context.

FFN width does not correspond to a count of independent semantic features, and
$f^L$ is not a justified capacity bound. Parameter count, residual width,
context, data coverage, and optimization can all constrain the result.

One measured constraint is interference during gradient-based training. The
model must simultaneously:

1. Route to the correct verifier (classification loss)
2. Generate syntactically valid output (language modeling loss)
3. Preserve historical literary/channel quality (replay loss)
4. Compose multiple verifier outputs (synthesis loss)

These four objectives compete for the same gradient steps. The saturation
point is where the multi-objective optimization problem becomes infeasible
under the chosen optimizer, learning rate schedule, and update budget.

---

## 3. Measurement protocol

### 3.1 Single-faculty scaling (within-domain)

**Goal**: determine how many operation types a single faculty can support
before routing accuracy drops below 95%.

**Method**:

1. Start with the Q2.2-R quantity faculty (~5 operation types, 97.6%
   routing accuracy, 0.096 target bits).
2. Generate quantity corpora with $N_{\text{ops}}\in\{5,10,20,40,80,160\}$
   operation types. Each operation type must have:
   - A distinct textual signature (different input patterns)
   - Equal representation in training, public-validation, and disjoint test sets
   - Independent verifier coverage
3. For each $N_{\text{ops}}$: train from ZERO.3 initialization (fresh
   optimizer) for the frozen update budget. Run three seeds and select
   checkpoints using public validation only.
4. After all training and selection policies are frozen, evaluate the entire
   predeclared grid once on each 500-case disjoint test set. Report the routing
   accuracy vs $N_{\text{ops}}$ curve for every seed.
5. The observed saturation point is the largest $N_{\text{ops}}$ where all three
   seeds pass the 95% routing gate *and* replay regression ≤2%.
6. Open a separate promotion panel once, after the study has selected its
   claimed boundary and all analysis code is frozen. Promotion confirms the
   claim; it is not used to choose checkpoints or grid conditions.

No passing operation count is predicted in advance. The experiment should
separate operation classification, request syntax, and output formatting so
their failure points are not conflated.

### 3.2 Multi-faculty scaling (cross-domain)

**Goal**: determine how many *faculties* can coexist before cross-faculty
interference degrades routing, composition, or replay.

**Method**:

1. Begin with 2 faculties (quantity + literary replay). Train and measure.
2. Add one faculty at a time in this order: foundation, logic, channel,
   geometry, art, physics, epistemics, code, music, systems.
3. Each faculty initially contributes 5 operation types.
4. For each faculty count $F\in\{2,3,\ldots,12\}$: train from ZERO.3
   initialization for a fixed update budget. Run three seeds.
5. After each addition, measure:
   - Per-faculty routing accuracy (each faculty's 500-case disjoint test set)
   - Cross-faculty interference: does adding geometry reduce quantity
     routing accuracy?
   - Synthesis coherence: held-out loss on chunks referencing all F
     faculty summaries
   - Replay regression: historical validation loss vs ZERO.3 baseline
   - Faculty isolation: do separate channels maintain distinct summaries?

**Stopping rule**: stop adding faculties when any of these occur on ≥2
seeds:
- Any existing faculty's routing accuracy drops below 95%
- Synthesis held-out loss increases >5% relative over the $F=2$ baseline
- Replay regression exceeds 2%
- Pairwise registrar cosine changes sharply relative to the single-faculty
  baseline (diagnostic only; a fixed cosine threshold does not prove collapse)

### 3.3 Composition depth scaling

**Goal**: determine how many faculty summaries can be composed in a
single synthesis chunk before coherence degrades.

**Method**:

1. Generate synthesis chunks referencing $K\in\{1,2,4,8,16\}$ faculty
   summaries. Each summary is a 30-token text string.
2. For each $K$, train and measure synthesis held-out loss and human
   preference against a baseline that receives the same summaries.
3. Report the synthesis loss vs $K$ curve. The saturation point is where
   loss increases >5% relative or human judges prefer the K=1 baseline
   over the K-faculty synthesis >60% of the time.

### 3.4 Latent-prefix scaling (v2 candidate)

**Goal**: compare text-serialized summaries against continuous latent
prefix tokens for multi-faculty composition.

**Method**:

1. For the faculty count $F$ where text-based synthesis saturates, compare
   two representations:
   - **Text**: each faculty summary serialized as 30 tokens
   - **Latent**: each faculty summary encoded as one 256-dim virtual
     prefix token (RMSNorm($z_f+e_f$) where $z_f$ is the registrar vector
     and $e_f$ is a learned faculty embedding)
2. Train both variants for the same update budget, three seeds.
3. Measure synthesis coherence, replay regression, and faculty isolation.
4. If latent prefixes improve composition coherence without increasing
   replay regression, they are a capacity-expanding technique (more
   faculties fit in the same parameter budget).

---

## 4. Provisional saturation budget

The proposed saturation study requires:

| Phase | Faculties | Ops/faculty | Total chunks | Updates | Seeds |
|---|---|---|---|---|---|
| 3.1 (ops) | 1 | 5,10,20,40,80,160 | 6 × 100k | 6 × 500 | 3 |
| 3.2 (faculties) | 2–12 | 5 | 11 × 150k | 11 × 500 | 3 |
| 3.3 (composition) | 4 | 5 | 5 × 50k | 5 × 400 | 3 |
| 3.4 (latent) | varies | 5 | 2 × 100k | 2 × 500 | 3 |

Wall-clock and compute estimates must be measured on the declared machine and
backend before scheduling. Accelerate use alone does not establish GPU-days or
a stable tokens-per-second figure.

---

## 5. What this study will answer

1. **Does routing accuracy degrade gracefully or catastrophically?** If
   routing stays >95% past 100 operation types, classification is not the
   bottleneck. If it drops sharply at some $N_{\text{ops}}$, there is a
   phase transition that bounds the architecture.

2. **Does interference grow linearly or superlinearly with faculty count?**
   If adding faculty $F$ reduces faculty $F-1$'s accuracy by a constant
   amount, interference is additive and the model can support many
   faculties. If interference is superlinear (each new faculty disrupts
   all existing ones), the model saturates quickly.

3. **Is composition or routing the bottleneck?** If synthesis coherence
   degrades before routing accuracy, the model can *distinguish* more
   faculties than it can *compose*. Fix: improve the synthesis training
   objective. If routing degrades first, the model cannot distinguish
   enough faculties for composition to matter. Fix: increase routing
   signal (e.g., per-faculty embedding prefixes).

4. **Does the saturation point vary across seeds?** If seed 1 saturates
   at 8 faculties and seed 2 at 12, the variation is noise or a training
   instability. If all three seeds agree within ±1 faculty, the saturation
   point is a property of the architecture, not the random seed.

5. **Can repair phases recover soft-saturated models?** If a model with
   $F$ faculties regresses on replay, can replay-only repair (§6 of
   ENG.md) restore replay without losing faculty accuracy? If yes, soft
   saturation is recoverable and the hard-saturation point is the true
   limit.

---

## 6. Decision tree

```
Run 3.1 (ops scaling) on quantity
  │
  ├── Routing >95% at N=160? ──► Classification is not the bottleneck.
  │                              Proceed to 3.2.
  │
  └── Routing <95% at some N ──► Report the phase transition point.
                                  Consider per-operation embedding prefixes.
                                  Proceed to 3.2 with N at the transition.

Run 3.2 (faculty scaling) with 5 ops each
  │
  ├── All faculties >95% routing at F=12? ──► Architecture supports at
  │   least 12 faculties. Run 3.3 to test composition depth.
  │
  ├── Some F where routing or replay fails ──► Report F* as the
  │   saturation point. Run 3.4 (latent prefixes) at F* to test
  │   whether latent representation recovers capacity.
  │
  └── Replay regression >2% before routing fails ──► Soft saturation.
      Test repair phases. If recoverable, continue adding faculties.
      If not recoverable, replay is the binding constraint.

Run 3.3 (composition depth) at the faculty count where 3.2 stopped
  │
  ├── Synthesis coherence OK at K=16? ──► Attention/FFN composition is
  │   not the bottleneck. Model can compose many summaries.
  │
  └── Synthesis degrades at some K ──► Report K* as composition limit.
      This bounds the number of faculties that can contribute to a
      single shared-synthesis response.

Run 3.4 (latent vs text) at the worst-case faculty count from 3.2
  │
  ├── Latent improves over text ──► Adopt latent prefixes for v2.
  │   Re-measure saturation with latent representation.
  │
  └── Latent no better or worse ──► Text summaries are sufficient.
      Saturation is determined by routing/composition capacity, not
      summary encoding format.
```

---

## 7. Reporting requirements

The saturation report must include, for every experiment:

- Seed(s) used, with per-seed results (no averaging over seeds)
- Training, public-validation, disjoint-test, and final-promotion corpus
  identifiers with SHA-256 hashes
- Immutable teacher hashes (proving ZERO.1/2/3 were not modified)
- Per-faculty routing accuracy, target bits, and close rate
- Replay validation loss vs the frozen ZERO.3 baseline
- Cross-faculty interference matrix: $M_{ij}=$ (faculty $i$ routing accuracy
  when trained with faculty $j$) minus (faculty $i$ routing accuracy when
  trained alone)
- Synthesis coherence: held-out loss per composition depth $K$
- Faculty isolation: pairwise cosine similarity of Holo registrar vectors
  for each faculty pair
- Selected checkpoint SHA-256 and training curve (loss vs update)

No macro-average over faculties, seeds, or depths is permitted. The
saturation point is determined by the *worst* faculty, not the mean.

---

## 8. What we know now (pre-saturation baseline)

From [Q2.2-R seed 2](benchmarks/zero4-q22r-v1/seed2/RESULTS.md) ([registry](EXPERIMENTS.md)):

- **1 faculty** (quantity) with **~5 operation types**
- Routing accuracy: **97.6%** (488/500)
- Target bits: **0.096**
- Replay regression: **1.919%**
- Controller argument binding: **100.0%**
- Kernel arithmetic: **100.0%**
- Rejected state mutations: **0**

This is the $F=1$, $N_{\text{ops}}\approx5$ data point. It tells us nothing
about scaling except that the floor is low. The saturation study begins
from here.

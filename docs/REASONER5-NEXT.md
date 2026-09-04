# Reasoner 5: next research set

Status: researched design proposal

Date: 2026-09-03

Base evidence: Reasoner 5.0 through 5.4 at commit
`9930d057b2285972b63596eb568c6d0ad8b45d28`

This document designs the next five Reasoner experiments. It is a design
record. A later preregistration will freeze each implementation, data
generator, seed set, budget, gate, and hash. Each sealed run begins after its
own explicit approval.

The core decision is:

| Version | Question | Main transfer artifact | Dependency |
| --- | --- | --- | --- |
| 5.5 | Does semantic adaptation preserve a guide across many unseen primitive families? | Semantic role guide plus exact adapter | Shared harness |
| 5.6 | Does a learned observation model help under varied noise and missing data? | Frozen channel likelihood | Shared harness |
| 5.7 | Does transferred knowledge choose better evidence under a fixed query budget? | Frozen query policy plus the 5.6 channel | 5.6 channel-readiness gate |
| 5.8 | Do behavior features transfer across nonlinear compositional shifts? | Partial-execution guide | Shared harness |
| 5.9 | Does the same prior help through an ambiguous symbolic and pixel channel? | Concept prior plus calibrated scene parser | Shared harness; 5.9b after 5.9a pass |

Bounded recursion becomes Reasoner 6.0 after 5.8 passes. This keeps nonlinear
composition and recursive control flow as separate claims.

```text
shared generated-family harness
       |             |              |
       v             v              v
     R5.5           R5.6           R5.8 --------> R6.0
                      |
                      v
                    R5.7

shared object-scene generator ------------------> R5.9
```

The machine-readable [plan](../benchmarks/reasoner5-next-set-v1/PLAN.json)
records this order.

## What the first five experiments show

| Result | Direct evidence | Reading for the next set |
| --- | --- | --- |
| 5.0 | Full used 229 candidate checks. Target-only used 248. Source-only used 187. | A target residual can weaken useful source state. Every new test needs a strong source-free adaptation control. |
| 5.1 | Full and oracle used 45 checks. Target-only used 105. All 24 answers were exact. | Exact semantic adaptation is the strongest lead. It now needs generated families and independent splits. |
| 5.2 | Full used 30 checks. Target-only used 44. Full won only 8 of the required 16 rows. | Nonlinear transfer has an aggregate signal. A larger family test must show broad gains across registered shift types. |
| 5.3 | Full used 48 checks. Its untrimmed channel control used 50. Target-only used 66. | The run supports one fixed outlier rule plus a source prior. A learned noise model remains open. |
| 5.4 | The decoder recovered 288 of 288 symbols. Full, target-only, and oracle all used 24 checks. | The channel worked. The search task sat at the one-check floor. Ambiguity must come before a stronger visual test. |

Reasoner 5.1 through 5.4 each used 12 target programs under two tie orders.
Those tie orders are repeated measurements. They are not 24 independent target
families.

Two local code facts sharpen the design:

- The [Reasoner 5.3 implementation](../reasoner5_followup.c) reused the
  Reasoner 5.2 source artifact. Its score removed one mismatch when the
  registered condition was active. Every corrupt episode changed the second
  observation by plus one modulo 17. The
  [published result](../benchmarks/reasoner53-evidence-transfer-v1/RESULT.md)
  shows only a two-check gap from the untrimmed arm. Version 5.6 must learn its
  channel from source episodes and must randomize the error process.
- Reasoner 5.4 trained one template for every value in its 17-symbol alphabet.
  The decoder then recovered every target value. Its
  [published result](../benchmarks/reasoner54-pixel-transfer-v1/RESULT.md)
  shows the one-check floor. Version 5.9 must leave several concept programs
  consistent with the support evidence before pixels are introduced.

## Research basis

The design follows five well-supported ideas.

First, learned models should order search while an exact checker decides
acceptance. [DeepCoder](https://www.microsoft.com/en-us/research/publication/deepcoder-learning-write-programs/)
and [neural-guided deductive search](https://arxiv.org/abs/1804.01186) show this
division in bounded program synthesis. Reasoner keeps one grammar, one
candidate set, one budget, and one verifier across all arms.

Second, behavior is a better bridge than token identity. [Property
Signatures](https://research.google/pubs/learning-to-represent-programs-with-property-signatures/),
[BUSTLE](https://arxiv.org/abs/2007.14381), and
[CrossBeam](https://arxiv.org/abs/2203.10452) use input-output behavior or
partial execution to guide synthesis. Version 5.8 therefore learns from exact
behavior signatures. Raw-token and shuffled-signature arms test whether the
gain truly comes from semantics.

Third, transfer must be compared with learning that happens inside the target
episode. [Just-in-time bottom-up synthesis](https://doi.org/10.1145/3428295)
shows that an online source-free guide can be strong. Reasoner will select its
primary source-free comparator on development families, then freeze that
choice before the sealed set.

Fourth, compositional shifts need separate names and separate results.
[ExeDec](https://proceedings.iclr.cc/paper_files/paper/2024/file/c43b2989b1ba055aa713a4abbe4a8b05-Paper-Conference.pdf)
separates length, concept combination, concept order, use in a new
composition, and added functionality. The
[CFQ split method](https://research.google/pubs/measuring-compositional-generalization-a-comprehensive-method-on-realistic-data/)
holds atomic parts steady while changing compounds. Version 5.8 registers
each supported shift as its own stratum.

Fifth, generator design is part of the experiment. Research on
[synthetic data for program synthesis](https://research.google/pubs/synthetic-datasets-for-neural-program-synthesis/)
shows that generated programs and generated examples can create shortcuts.
The [few-shot program synthesis benchmark](https://proceedings.mlr.press/v139/alet21a/alet21a.pdf)
also shows the value of grouping related tasks before episode creation. The
next set splits primitive and generator families first. It then creates
episodes. Program generators and input generators vary independently.

## Shared scientific protocol

### 1. One capability packet

Every experiment uses a versioned packet with these parts:

```text
manifest
  experiment ID, schema version, source commit, generator hashes
  development seed family, sealed seed family, rejection counts
  grammar hash, candidate budget, verifier hash, metric definitions

source artifact
  learned bytes, schema, training split hash, build receipt, digest

episode
  family ID, shift stratum, observations, allowed actions, budget
  hidden exact target, tie salt, nested repeat IDs

trace
  proposed candidate, score parts, query actions, verifier result
  final Answer IR, certificate, cost counters

result
  exactness, search costs, family effects, confidence limits
  controls, failure class, runtime, artifact size, provenance
```

The ranker reads only public episode fields and the frozen source artifact.
The evaluator owns the hidden target, hidden corruption labels, clean values,
and exact test domain. Family ID, shift stratum, generator seed, tie salt,
renderer or corruption family, response-tape index, and latent state are
evaluator metadata by default. An experiment must list any exception in its
public whitelist. The serialized ranker view omits evaluator metadata.

### 2. Split families before episodes

Each experiment has four disjoint task-family lanes:

1. Source training families build the transferred artifact.
2. Calibration families set probabilities or confidence thresholds.
3. Development families set task difficulty, choose the source-free
   comparator, and run power analysis.
4. Sealed families produce the published decision once.

The task-family key is the primitive, program, or concept family. The episode
seed comes after that split. Complete target abstract syntax trees, exact
complete-program semantic signatures, and complete episode specifications are
deduplicated across lanes. Atomic primitives may cross lanes when a registered
compositional split requires familiar atoms. Allowed atom and typed-subtree
overlap are measured and published.

Shift axes use their own split rule. For an ID channel or renderer result, the
same named mechanism template may appear across lanes with disjoint parameter
families and seeds. A mechanism-OOD result holds out the whole mechanism
template. Program families are crossed with corruption families in 5.6.
Concept families are crossed with renderer families in 5.9. The manifest says
which axis is sampled and which registered mechanisms are fixed environments.

The sealed manifest records:

- source and target generator commits and file hashes;
- independent program and input generator IDs;
- every seed family and rejected sample count;
- atom and typed-subtree compound frequencies;
- semantic collision counts;
- version-space size for ambiguous tasks;
- the chosen development rule and final sample size.

At least two independent program generators feed 5.5 and 5.8. At least two
independent concept and support generators feed 5.9. One generator
samples syntax first. The other samples a semantic skeleton first and then
chooses legal primitives. Cross-generator strata train on one generator and
test on the other in both directions. They test whether a guide learned a
generator signature. Claims stay limited to these registered generator
mechanisms.

### 3. Qualify search headroom on development data

One-check episodes remain useful correctness checks. Ranking claims use
families with measurable room for improvement.

The development generator targets a target-only median between 16 and 64
verifier checks when the domain supports it. It also creates easy, medium, and
hard strata. The final threshold comes from the development distribution.
The sealed set keeps the frozen generator and accepts the resulting mix.

This 16-to-64 range is a project design choice. Research on
[benchmark saturation](https://www.nature.com/articles/s41467-022-34591-0)
supports the need for headroom, but it supplies no universal threshold.

### 4. Keep exact verification authoritative

The learned artifact may order candidates, predict a channel, or select a
query. Only the exact verifier may commit an answer.

Finite field, list, and scene domains use exhaustive evaluation over stated
bounds. A mutation-only lane is labelled empirical verification. It does not
carry an exact-equivalence claim. [EvalPlus](https://proceedings.neurips.cc/paper_files/paper/2023/hash/43e9d647ccd3e4b7b5baab53f0368686-Abstract.html)
shows why small visible test sets are weak evidence of program correctness.

Every run includes an adversarial self-test. It places a high-scoring invalid
candidate first. The verifier must reject it. The primary verifier returns one
accept-or-reject bit to the ranker. It stores a first counterexample only in
the evaluator trace. Any arm that receives a counterexample declares it as a
target evidence query and pays for both the verifier check and the evidence.

### 5. Use causal controls

Every experiment includes:

- the complete transferred system;
- a target-only enumerator;
- a source-free just-in-time guide when the domain supports one;
- a source ablation that must match the source-free implementation path;
- a shuffled source artifact with matched size and value frequencies;
- the main mechanism ablation;
- an oracle artifact that measures remaining room;
- a source-only arm that measures prior fit without target evidence.

Every arm receives the same grammar, candidate universe, initial evidence,
allowed action set, latent episode, potential-response noise function,
verifier, and wall-clock cap. An experimental intervention may change the
realized query or input channel. Tuning budgets are also equal.

### 6. Treat designed families as the evidence unit

The sampling frame is the explicit set of generated task families. Tie salts,
episode seeds, repeated renders, and repeated queries are nested measurements.
Two designed generator algorithms are fixed test environments. Results do not
claim a random population of all possible generators.

R5.5 and R5.8 use task family as the highest independent unit within each
fixed generator environment. R5.6 uses a complete program-family by
corruption-family crossing. R5.9 uses a complete concept-family by
renderer-family crossing. The crossed experiments use a two-way cluster
bootstrap that resamples each family axis independently and rebuilds their
crossing. Main effects, intervals, and win rates are also shown for each
marginal axis. The method follows the product reweighting idea in
[Owen and Eckles](https://projecteuclid.org/journals/annals-of-applied-statistics/volume-6/issue-3/Bootstrapping-data-arrays-of-arbitrary-order/10.1214/12-AOAS547.pdf)
for crossed data arrays.

For each independent family or crossed family cell, compute the mean paired
log cost ratio:

```text
log((full cost + 1) / (frozen comparator cost + 1))
```

Report:

- exact final answers and valid certificates;
- premature commit count;
- verifier checks and partial program expansions;
- observation queries and their channel;
- wall time and peak memory;
- source training cost and artifact bytes;
- break-even target count for amortized source cost;
- family wins, ties, and losses;
- family-weighted median and geometric mean paired cost ratios;
- a one-way or two-way family-clustered confidence interval;
- family win rate and its one-sided Wilson lower limit;
- solve-versus-budget and performance-profile curves;
- every shift stratum and the worst family.

[Performance profiles](https://doi.org/10.1007/s101070100263) and
[paired benchmark statistics](https://www.jmlr.org/papers/v7/demsar06a.html)
motivate this view. Aggregate checks remain useful as a secondary operational
measure.

### 7. Set sample size with a development power simulation

The minimum useful effect is a 20 percent reduction in the primary cost. A
fixed simulation replays the full decision procedure. It includes comparator
selection, crossed family structure, heavy-tailed costs, timeouts, exhaustive
fallback, the family win gate, every conjunctive gate, and every primary
stratum. It reports power under useful-effect generators and type-I error under
null generators. It then selects the smallest count from 32, 64, 96, or 128
families per primary stratum that reaches at least 90 percent power while
meeting the registered type-I error bound.

Five independent generator seeds form the planning envelope. The power result
sets the sealed count. Seeds stay nested inside their family block.

The values above are project choices. They become fixed only in the later
preregistration.

### 8. Use one common decision language

Each experiment ends in one of four states:

- **Pass:** every exactness and mechanism gate passes.
- **No-go:** the run is valid and one or more scientific gates miss.
- **Measurement floor:** the run is valid and the primary comparator leaves too
  little headroom for the registered effect.
- **Invalid run:** data integrity, implementation, or infrastructure breaks the
  frozen contract before a scientific decision can be made.

Every primary episode must end with an exact result. An abstention or proposal
budget limit starts the same canonical exhaustive fallback for every arm. All
fallback expansions and verifier checks count toward cost. An episode that
remains unsolved receives a frozen cap-plus-one cost and fails the exact-result
gate. Its receipt distinguishes a global-cap stop from complete fallback
exhaustion. Solve-versus-budget curves use the same censoring rule.

The common pass gate is conjunctive:

1. Every primary episode returns an exact answer and valid certificate within
   the common global cap.
2. Every injected invalid first candidate is rejected.
3. The family-weighted geometric mean primary-cost ratio is at most 0.80.
   Pooled total cost is secondary.
4. The allocated one-sided family-clustered upper confidence limit for that
   ratio is below 1.0.
5. At least 60 percent of independent families win, and the one-sided 95
   percent Wilson lower limit for the family win rate is above 0.50. Crossed
   designs apply this rule to both marginal family axes.
6. Each named primary shift stratum has a family-weighted ratio at most 0.90
   and a one-sided 95 percent upper confidence limit below 1.0.
7. Each preregistered formal mechanism ablation, with at most two per
   experiment, has a ratio of at least 1.10 against full and a Holm-adjusted
   one-sided 95 percent interval above 1.0.
8. Thirty-one frozen, frequency-preserving source derangements form the
   shuffle reference. Full must beat their median, with a randomization
   p-value at most 0.05.
9. Source ablation matches the registered source-free implementation path.

The primary directional error budget is 0.01 each for R5.5 through R5.8. R5.9
uses 0.005 for its symbolic decision and 0.005 for its grounded decision. This
keeps the total one-sided allocation at 0.05. Each preregistration names one
primary contrast and at most two formal mechanism contrasts. Other controls
remain diagnostic.

## R5.5: generated unseen-primitive replication

### Question

Does an exact semantic adapter make a frozen source guide useful across many
unseen primitive families and two independent generator designs?

### Domain

Use vectors over a prime field, with a development modulus chosen for useful
search depth. Each primitive has an exact affine meaning. Target primitive
IDs, order, and surface encoding are new. Semantic families include:

- coordinate permutations;
- translations;
- nonzero scales;
- shears and coordinate mixes;
- short typed compositions of those families.

The source and sealed lanes hold out whole parameter families and surface-ID
maps. A primitive appears in the target lane only through demonstrations and
the registered adapter interface.

### Factorial design

The primary four arms are:

| Exact adapter | Frozen source guide | Meaning |
| --- | --- | --- |
| Off | Off | Raw target-only enumeration |
| On | Off | Semantic adaptation without transferred ranking |
| Off | On | Raw lexical guide without semantic alignment |
| On | On | Complete transfer system |

Additional controls are an oracle adapter, a shuffled semantic guide, a
frequency-matched lexical guide, and a source-free just-in-time grammar.

The source guide is a smoothed integer table of semantic-role frequencies and
typed adjacent-role transitions learned from source solutions. It extends the
small Reasoner 5.1 artifact across generated source families. In the
adapter-off and guide-on arm, the exact same table is applied directly to the
target surface IDs. This preserves the factorial while testing the value of
semantic alignment.

The registered generator declares that each 5.5 primitive is affine. The
adapter reconstructs its matrix and bias from the zero vector and basis
vectors. The evaluator compares those recovered coefficients directly with
the hidden generator coefficients. It also exhausts the finite vector domain
when the development cost bound permits it. Fresh challenge vectors remain an
interface-integrity test. The output is a canonical matrix, bias, type, and
proof receipt. The oracle adapter measures the cost of adapter errors. The
guide then sees semantic roles rather than target token IDs.

### Primary gate

The primary cost is the number of distinct complete semantic program classes
submitted to the exact verifier from first proposal through charged fallback.

The primary simple effect is adapter-plus-guide against adapter-only. This
changes only the frozen source guide after semantic alignment. The registered
factorial interaction is:

```text
log_cost(adapter on, guide on) - log_cost(adapter on, guide off)
  - log_cost(adapter off, guide on) + log_cost(adapter off, guide off)
```

A useful interaction is below zero. The strongest source-free method selected
on development families is a mandatory operational comparator. Pass uses an
intersection-union rule at the allocated one-sided 0.01 level. The primary
simple effect must pass the common gate, the interaction confidence limit must
be below zero, and complete transfer against the frozen source-free comparator
must pass the common gate. It also requires:

- exact adapter reconstruction on every sealed challenge;
- an adapter-plus-guide family-weighted cost at most 80 percent of
  adapter-only;
- the common confidence gate;
- a negative interaction with its allocated family-clustered confidence
  limit below zero;
- a gain on both generator designs and the cross-generator stratum;
- a raw-lexical-to-complete-transfer cost ratio of at least 1.10 with its
  Holm-adjusted one-sided 95 percent lower limit above 1.0;
- complete transfer beating the registered shuffled-guide median with the
  common randomization test.

The raw lexical guide is the one formal mechanism contrast for R5.5.

An exposure sweep of 1, 2, 4, and 8 primitive demonstrations is secondary. It
reports where semantic adaptation starts to work. The main contrast freezes
one exposure level before the seal.

### Claim if it passes

The source guide transfers across many generated unseen primitive interfaces
after exact semantic adaptation. The claim remains inside the registered
finite primitive and program generators.

## R5.6: passive learned-noise transfer

The development implementation and frozen local fixtures live in
`reasoner56.c`, `reasoner56.h`, and
`benchmarks/reasoner56-passive-noise-development-v1/`. This implementation is
development-only. Shared-harness integration and preregistration remain the
next boundary.

### Question

Can source episodes teach a small observation model that reduces exact search
under new target programs, corruption draws, and missingness patterns?

### Learned artifact

Source episodes provide paired clean and observed evidence. Each source
program is read at all 17 field inputs through each of three observable sensor
IDs. The source builder adds direct clean-value probes until every supported
leaf cell has at least 32 observations. The fixed context backoff is:

```text
(sensor, exact input, candidate value)
-> (sensor, candidate value)
-> sensor
-> global
```

The deepest cell with at least 32 source observations is used. The result
reports target observations at every backoff level.

The learned likelihood has two fixed parts. The first is a smoothed integer
count table for:

```text
P(observed delta, missing mask |
  candidate value, sensor ID, public input)
```

The second has a smoothed initial-state table
`P(error_1, mask_1 | sensor_1)` and a first-order table for the current error
and mask state given the previous state plus current and previous sensor IDs.
This fixed Markov factor represents burst errors and block missingness. Source
observation order is a fresh public random permutation of all 51 input-sensor
cells per program. Extra source sequences are generated until every legal
ordered sensor-pair and prior-state transition cell has at least 32 examples.
Target passive observations carry their true acquisition order. A seed that is
independent of the target program and hidden channel parameters chooses that
public order. The likelihood consumes the order, and the proxy audit covers it.

Transition backoff is `(previous sensor, current sensor, previous state)`, then
`(current sensor, previous state)`, then `previous state`, then global. A
plus-one pseudocount smooths every legal outcome. There is no optional model
choice after development. The artifact stores initial counts, transition
counts, legal outcomes, order rules, support counts, backoff thresholds,
integer log scores, source hashes, and calibration receipt. A Markov-off arm
is a registered ablation.

Candidate semantic classes receive normalized probability:

```text
p(class | evidence) proportional to
  p_frozen_guide(class) * p_frozen_channel(evidence | class)
```

A softmax over complete semantic classes performs normalization. Score ties
share probability equally. A single temperature is selected from the fixed
grid `{0.25, 0.5, 1, 2, 4, 8}` on a calibration-fit sublane, then frozen. A
disjoint calibration-coverage sublane sets the 99 percent split-conformal
cumulative-mass threshold. Log loss, multiclass Brier score, and coverage use
this one probability definition.

The ranker receives candidate semantics, public inputs, sensor IDs,
observations, masks, and the frozen artifact. Hidden clean values, corruption
family, rate, location, and direction stay inside the evaluator. Each sensor
is a registered mixture of at least three channel templates and a severity
range. Public order, seeds, and episode IDs are randomized or opaque. A static
interface audit, runtime taint test, and development proxy audit check that
public metadata does not reveal a hidden template or severity beyond the
declared sensor mixture. The proxy audit uses a multinomial classifier on
static metadata before observations. Its classifier and thresholds freeze on
development data. The evaluator repeats the audit on sealed static metadata
before target observations open. Episode ID, order, and seed fields may add at
most two percentage points of balanced accuracy over a sensor-only baseline,
and no public cell may identify one hidden template with certainty. A sealed
breach invalidates the run.

Research on [loss correction under label noise](https://openaccess.thecvf.com/content_cvpr_2017/html/Patrini_Making_Deep_Neural_CVPR_2017_paper.html)
supports a learned transition model. Research on
[missing data](https://doi.org/10.1093/biomet/63.3.581) and
[robust contamination](https://doi.org/10.1214/aoms/1177703732) supports
treating the channel as a data process rather than one fixed mismatch rule.

### Corruption matrix

Randomize count, position, direction, and severity per episode. The primary ID
mixture contains mechanisms represented by the fixed local and first-order
likelihood:

- symmetric replacement;
- asymmetric value-dependent replacement;
- input-dependent errors;
- burst errors within an episode;
- missing completely at random;
- missing at random from public context;
- value-dependent missingness;
- block missingness.

Stale rows and swapped observations need longer-range state. They form a
mechanism-OOD stress lane for this version. They do not enter the R5.6 pass
decision.

Publish three result strata:

1. Primary ID: new target programs and disjoint parameters and seeds from the
   modeled mechanism templates.
2. Mechanism OOD: whole stale-row, swap, and other registered templates held
   out from source training.
3. Severity OOD: registered rates outside the development range.

The distinction follows robust benchmark practice from
[WILDS](https://proceedings.mlr.press/v139/koh21a.html) and
[ImageNet-C](https://arxiv.org/abs/1903.12261). The primary pass and transfer
claim use the ID mixture. Each OOD lane reports its own effect and a two-way
program-by-mechanism interval. Those OOD results are descriptive stress
evidence in 5.6. Any calibrated guarantee applies only to its stated
exchangeable lane.

### Controls

- untrimmed exact Hamming or distance loss;
- the Reasoner 5.3 one-trim rule;
- source-free robust consensus;
- shuffled sensor IDs within the declared sensor mixture;
- 31 frozen channel derangements that permute outcome labels within each
  conditioning row while preserving row totals, marginals, sparsity,
  smoothing mass, entropy, normalization, and artifact size;
- value-likelihood-only, mask-likelihood-only, and Markov-off arms;
- channel-only and program-prior-only arms;
- oracle channel and clean-evidence oracle.

Every channel arm uses the same program guide. This holds program transfer
constant while the learned observation model changes.

If a later real source lacks clean truth, the collection protocol must provide
at least three conditionally independent noisy views or a stronger identified
model. [Identifiability work](https://proceedings.mlr.press/v202/liu23g.html)
supports that requirement under its assumptions.

### Metrics and gate

The primary cost is the number of distinct complete semantic program classes
submitted to the exact verifier from first proposal through charged fallback.

Add truth rank before verification, top-one truth rate, normalized log loss,
multiclass Brier score, reliability bins, 99 percent candidate-set size and
coverage, exact fallback rate, backoff-level use, and worst
corruption-family cost. The search-cost result uses two-way program-by-
corruption resampling. Calibration treats the registered ID corruption mixture
as one fixed environment. It forms one family-mean log loss and one worst-draw
conformal nonconformity score per program family. Its intervals and threshold
therefore resample program families only, and its coverage claim stays scoped
to that fixed mixture.

The primary contrast is the learned channel against the development-selected
rule-based robust scorer on the primary ID mixture. Pass requires the common
gate. The two formal mechanism contrasts are the 5.3 one-trim rule and the
Markov-off ablation. Each uses the common 1.10 effect and Holm-adjusted
confidence gate. The frozen derangement distribution supplies the common
median and randomization test. Locations, directions, masks, and severities
vary inside every program family.

R5.7 may begin when the published R5.6 bytes pass a separate channel-readiness
gate: valid normalization on every candidate set; ID log loss below uniform,
program-prior-only, and the derangement median with a one-sided 95 percent
paired program-family interval; a family-weighted candidate-set size at most
80 percent of program-prior-only at matched 99 percent coverage; 99 percent
candidate-set coverage with a one-sided 95 percent lower limit of at least 97
percent; and clean development and sealed interface and proxy audits. This
readiness result is separate from the R5.6 search-cost decision.

### Claim if it passes

A small source-learned likelihood transfers useful information about an
observation process to new program families. ID, mechanism-OOD, and
severity-OOD findings remain separate.

## R5.7: active evidence selection

### Dependency

R5.7 starts after the R5.6 channel-readiness gate passes. It consumes the exact
published R5.6 artifact bytes even when the R5.6 search-cost decision is
no-go. This separates a calibrated observation model from the question of
which observation to buy.

Policy training, policy calibration, development, and sealed task families are
fresh. They are disjoint from every R5.6 source, calibration, development, and
sealed task family. Every primary policy arm uses identical R5.6 bytes,
program guide, semantic classes, posterior update, temperature, initial
evidence, and exact verifier. Only the action selector changes.

The primary channel lane uses the same modeled templates as R5.6 with fresh
parameter families and seeds and severities inside the learned range.
Mechanism-OOD and severity-OOD are named secondary lanes. Every episode starts
with exactly three reads at inputs 0, 1, and 2, one through each sensor. An
episode hash chooses one of the six sensor-to-input permutations. This initial
distribution is identical across policies.

The policy-visible whitelist is the public input-sensor action set, ordered
observations and masks, action history, remaining budget, candidate semantic
summaries, and frozen artifacts. Family ID, shift stratum, generator seed,
tie salt, response-tree indices, mechanism parameters, severity, and latent
channel state stay evaluator-only. A classifier frozen on development metadata
repeats the proxy audit on sealed static metadata. A failed sealed audit marks
the run invalid.

### Question

Does a source-learned policy choose more useful input and sensor queries on new
target program families under a fixed evidence budget?

### Episode and action model

Every arm begins with the same incomplete or corrupt passive evidence. One
action buys exactly one sensor read and chooses:

```text
(input, sensor)
```

Choosing the same pair again is a repeat and costs another read. Every sensor
has unit cost in the primary lane. A secondary lane uses registered real-cost
weights.

A sealed structural response function returns the observation:

```text
response(episode root seed, full action-observation history, next input, next sensor)
```

It uses evaluator-only innovations keyed by the canonical history hash and
next action. Two policies with the same history and next action receive the
same result. Different histories may lead to different burst states and valid
different results. This matches the first-order R5.6 channel. The manifest
states whether a lane is independent, sensor-correlated, or episode-burst.
Future branches, innovations, and latent state stay evaluator-only.

The transferred query table is learned from source search states. Its public
state key includes version-space size, posterior mass, behavior disagreement,
sensor reliability, remaining budget, and action type. It never receives the
hidden target or corruption label.

Source states come from a frozen equal mixture of seeded-random and EC2 logging
policies. At each logged state, the trainer evaluates every legal action under
the same remaining horizon, potential-response function, and fixed EC2
continuation. The exact source target labels the action by later
verifier-check reduction. State bins, action bins, smoothing, canonical
input-then-sensor tie order, and the logging mixture are frozen. An unseen
state backs off to EC2 and increments a fallback counter.

The R5.6 channel source build must cover every allowed R5.7 input-and-sensor
cell at a registered non-global emission backoff level. It must also cover
every ordered sensor pair and prior-state transition at a non-global
transition backoff level. The R5.7 action set and sensor sequences are limited
to that registered support.

### Fair primary test

Every arm receives exactly four observation queries in the primary test. This
isolates query choice. Every selector has the same candidate-update and
wall-time caps. Posterior updates, candidate scoring, and policy-table reads
are metered. Secondary curves use budgets 1, 2, 4, and 8.

Before a seal is made, the development oracle policy must use at most 80
percent of the verifier checks used by the strongest policy-source-free
selector at budget four. These selectors may use the common R5.6 channel but
have no R5.7 policy artifact. A smaller gap records a query-choice measurement
floor and stops the seal.

Controls include:

- fixed Reasoner 5.3-style schedule: `(0, sensor 0)`, `(1, sensor 1)`,
  `(2, sensor 2)`, then a registered repeat of `(1, sensor 1)`;
- seeded random queries;
- maximum candidate disagreement;
- noisy generalized binary search;
- EC2 posterior edge cutting;
- repeat-and-vote;
- a shuffled transferred policy;
- an oracle action policy.

The shuffle reference uses 31 frozen derangements of action scores within each
state bin. It preserves sensor and input frequencies, score marginals, tie
counts, backoff rows, and artifact size. Full must beat their median with the
common randomization p-value. R5.7 has no extra formal mechanism ablation.

A verifier-counterexample policy is reported in a separate evidence-oracle
lane. Each attempt pays one verifier check. Each returned counterexample also
pays one exact target-evidence query. It never enters the equal four noisy-read
contrast.

[Noisy generalized binary search](https://papers.neurips.cc/paper_files/paper/2009/file/556f391937dfd4398cbac35e050a2177-Paper.pdf)
and [EC2 active learning](https://proceedings.neurips.cc/paper/2010/hash/1e6e0a04d20f50967c64dac2d639a577-Abstract.html)
are the strong analytic baselines. They use the same R5.6 channel bytes. The
primary policy-source-free comparator is selected on development families and
frozen.

### Metrics and gate

Keep observation queries, verifier checks, policy candidate updates, and wall
time as separate axes. Publish the query-versus-check Pareto curve. Secondary
cost scenarios use the stated formula
`verifier checks + lambda * reads + rho * policy updates`, with `lambda` and
`rho` frozen from declared acquisition settings. They do not drive the pass
decision.

The primary gate asks whether the transferred policy reduces verifier checks
after the same four sensor reads. Every arm then ranks semantic classes and
submits them to the verifier until acceptance; the primary lane uses no
policy-specific routing threshold. The primary comparator is the strongest
policy-source-free selector chosen on development families. Pass requires
exact final answers, the common family-weighted cost and confidence gates, and
the frozen policy derangement test. Every exhaustive fallback check is charged.

A fresh R5.7 calibration lane is generated after the channel and policy are
frozen. It keeps the R5.6 temperature unchanged. Policy-specific candidate-set
thresholds appear only in secondary risk-coverage reports and never change the
primary checking order or fallback. Adaptive extra-query routing belongs to
the secondary variable-budget lane. [Selective prediction](https://papers.nips.cc/paper_files/paper/2017/file/4a8423d5e91fda00bb7e46540e2b0cf1-Paper.pdf)
and [conformal risk control](https://research.google/pubs/conformal-risk-control/)
motivate the risk-versus-coverage report. ID calibration and OOD stress remain
separate results.

### Claim if it passes

Source experience improves evidence choice on new program families under a
fixed query budget and a frozen observation model.

## R5.8: nonlinear compositional transfer

### Question

Can a frozen behavior guide reduce exact search across registered nonlinear
composition shifts?

### Domain

Use a unary typed finite program language from `GF(17)` to `GF(17)`. Start from
the existing translate, scale, negate, square, cube, and mixed polynomial
families. Source programs have shorter composition trees. Target programs have
longer or novel unary compositions. A later version may add extra arities with
its own complete domain bound.

Every candidate has an exact 17-value truth table. Canonical semantic
deduplication merges candidates with the same full behavior. The exact table
also drives verification.

### Transfer artifact

The source guide uses semantic properties of complete and partial programs:

- output value histogram;
- fixed points and collisions;
- degree and invertibility class where exact;
- partial-execution tables;
- typed subtree roles;
- behavior transitions when a legal operation is added.

For each bounded source task, exact enumeration labels a partial program as
positive when it lies on a shortest exact solution path. Other reached partial
programs are negative. Smoothed integer log-odds are learned for each feature
and typed transition. The frozen sum ranks bottom-up partial programs. A
raw-token guide and the Reasoner 5.2 class-transition guide are registered
controls.

### Registered shift strata

1. A known operation used in a new composition.
2. A changed semantic class order.
3. A new cross-class composition with familiar atoms.
4. A longer tree and deeper partial-execution chain.

For each split, publish atom divergence and typed-subtree compound divergence.
Use at least three generated split instances. Keep each result visible next to
the pooled result.

### Controls

- target-only size enumeration;
- source-free just-in-time grammar update;
- Reasoner 5.2 transition-only guide;
- raw token guide;
- behavior-off guide that preserves types, role counts, training labels,
  transition features, artifact size, and the implementation path;
- shuffled behavior signatures;
- an episode-level token permutation applied consistently to grammar,
  examples, target, and verifier;
- source-only guide;
- oracle truth-rank guide.

Every arm uses the same bottom-up enumerator, semantic deduplication, candidate
budget, and exact checker. A separate on-policy guide may appear as a secondary
arm with an equal source training budget.

### Primary gate

The primary R5.8 cost is the number of unique canonical semantic partial
programs popped from the bottom-up priority queue through charged fallback.
Complete candidate verifier checks, generated nodes, and wall time are
secondary.

The main contrast is the frozen behavior guide against the
development-selected source-free guide. Pass requires the common gate and a
registered stratum effect in all four composition shifts. The formal mechanism
contrast is full versus behavior-off. The Reasoner 5.2 transition-only,
token-permuted, and shuffled-signature results test lexical and generator
shortcuts.

### Claim if it passes

Exact behavior features transfer useful search order across several finite
nonlinear composition shifts. This pass unlocks the Reasoner 6.0 recursion
implementation.

## R5.9: ambiguous grounded concepts

### Question

Does source knowledge reduce exact concept-program search when one ambiguous
episode arrives first as a symbolic scene graph and then through held-out pixel
renderings?

### Build ambiguity first

Two independent concept generators create typed programs. One samples syntax
first. The other samples a target behavior constraint first and then finds a
short legal program. Both use the same exact interpreter. Training on either
generator and testing on the other forms two cross-generator strata.

Two independent support builders also run. The first greedily chooses scenes
that split the current version space while retaining the registered ambiguity.
The second starts from nearby hard-negative concepts and uses rejection
sampling to find a balanced support set. Concept generator and support builder
form a complete two-by-two mechanism matrix.

The finite scene universe is fixed as follows:

- one, two, or three objects;
- four distinct cells in a two-by-two grid, with at most one object per cell;
- three colors, three shapes, and two sizes per object;
- left, right, above, below, same-row, and same-column relations derived from
  cells;
- object IDs removed before canonical encoding;
- objects sorted by cell in the canonical graph.

There are 18 attribute combinations. The complete scene count is:

```text
C(4,1) * 18 + C(4,2) * 18^2 + C(4,3) * 18^3
= 72 + 1,944 + 23,328
= 25,344 scenes
```

The concept grammar has at most seven AST nodes. The complete joint universe of
canonical `(AST, legend map)` pairs must contain at most 16,384 candidates
before semantic deduplication. The grammar is narrowed during development to
meet this bound; the enumerator never truncates the candidate list. The hidden
target is sampled from that complete joint universe. Exhaustive verification
is therefore capped at 25,344 scene executions per submitted semantic class.
A development cost simulation must show that the full candidate universe fits
the local cap before the grammar is frozen.

The concept language includes bounded forms of:

- object attributes;
- counts and comparisons;
- spatial relations;
- Boolean composition;
- variable binding;
- episode-local symbol meanings.

An episode-local legend has two surface symbols. Each maps injectively to one
of the eight atomic color, shape, or size predicates. The hidden target
contains both its canonical concept AST and legend map. Canonical `(AST,
legend map)` pairs are grouped by their joint behavior over all 25,344 scenes.
Any canonical pair in the correct joint behavior class is an exact answer.

For each episode, a support-set builder finds sparse positive and negative
examples. At least eight distinct full-universe behavior classes must remain
consistent. Nearby candidate concepts supply hard negatives. This follows the
version-space design of [CURI](https://proceedings.mlr.press/v139/vedantam21a.html).

The primary headroom and cost unit is the number of distinct semantic classes
submitted to the exact verifier. Development targets a symbolic target-only
median between 16 and 64 such checks. Joint graph-program expansions, parser
calls, and wall time stay separate. Tie salts order only distinct semantic
classes with equal scores. Behaviorally equal ASTs are deduplicated before
ranking.

### Pair symbolic and pixel episodes

Each latent scene is stored once as an exact object graph. The same graph is
then rendered as an image. [CLEVR](https://cs.stanford.edu/people/jcjohns/clevr/)
shows the value of paired scenes, attributes, relations, images, and executable
programs. The public boundary is:

```text
image -> unordered object and relation hypotheses -> concept search
scene graph --------------------------------------> concept search
```

The scene parser emits raw graph logits. A softmax temperature is chosen from
the fixed grid `{0.25, 0.5, 1, 2, 4, 8}` by minimum family-mean graph log loss
on a parser-calibration-fit lane. The temperature then freezes. A disjoint
parser-calibration-coverage lane chooses top-k and measures reliability. The
parser's training families, both calibration lanes, and OOD renderer families
are disjoint and hashed.

The parser chooses the smallest `k` up to 32 that reaches at least 99 percent
exact-graph coverage on the coverage lane, with a one-sided 95 percent
family-clustered lower limit of at least 97 percent. Its calibrated ID graph
log loss must beat uniform graph probability with a one-sided 95 percent
family interval. Failure records a channel measurement floor before sealing.
The chosen temperature, `k`, graph log loss, exact graph coverage, Brier score,
and reliability bins are frozen. The same temperature and `k` are used on OOD
renderers, where calibration and coverage are empirical stress evidence.

Every pixel arm receives the exact same frozen parser bytes, graph hypotheses,
and calibration rule. The source concept prior is the only primary pixel
factor. Parser transfer is a channel measurement rather than an R5.9 causal
claim.

The renderer also has an identifiability screen. Scene families are rendered
and accepted before a target concept or support set is chosen. A render is
rejected when any object has less than 60 percent visible area, fewer than 64
visible pixels, or an ambiguous grid cell. It exhaustively checks for exact
pixel collisions between distinct graphs within each deterministic renderer
setting. A privileged ceiling parser trained and calibrated on each
development renderer family must reach at least 99.9 percent exact graph
match. These thresholds are project choices and freeze before the sealed
renderer families are drawn.

Joint search combines graph likelihood with the frozen concept prior. For each
concept behavior class, it marginalizes the registered graph-hypothesis
probabilities across every support image, then multiplies by the concept prior.
The resulting normalized class probability defines truth rank. Joint
graph-concept pair expansions are counted separately.

The concept prior is a smoothed integer table over normalized typed AST
productions, subtree roles, and variable-binding patterns learned from source
concepts. Its artifact contains counts, smoothing, type schema, source hashes,
and build receipt. The parser artifact separately contains model bytes, label
schema, renderer-training hashes, calibration thresholds, and receipt.

### Primary factorial

| Source concept prior | Input channel | Meaning |
| --- | --- | --- |
| Off | Exact scene graph | Symbolic target-only |
| On | Exact scene graph | Pure reasoning transfer |
| Off | Pixels | Grounded target-only |
| On | Pixels | Complete grounded transfer |

The symbolic contrast measures prior transfer. The paired pixel contrast
measures whether that same prior remains useful through the common parser. An
exact-parser subset is reported only as a diagnostic decomposition. Every
causal estimate and pass decision uses the full paired family set.

### Shift strata and controls

Keep atomic attributes visible in source training. Hold out:

- color-by-shape bindings;
- relation-by-attribute bindings;
- operation-by-attribute compounds;
- episode-local legend meanings;
- renderer domains with new texture, light, camera, background, blur, and
  occlusion.

Pixel evaluation uses an orthogonal four-cell matrix:

| Concept distribution | Renderer distribution |
| --- | --- |
| ID compounds | ID renderer |
| Held-out compounds | ID renderer |
| ID compounds | Held-out renderer |
| Held-out compounds | Held-out renderer |

Each concept-family by renderer-family cell is complete and paired. This
separates semantic shift, sensor shift, and their interaction. Texture,
lighting, camera, background, blur, and occlusion also keep separate
single-factor results.

Add paired counterfactual scenes that swap attributes between two objects
while preserving the attribute inventory. Research from
[PGM](https://proceedings.mlr.press/v80/barrett18a.html),
[gSCAN](https://proceedings.neurips.cc/paper/2020/hash/e5a90182cc81e12ab5e72d66e0b46fe3-Abstract.html),
and [CLEVRTex](https://datasets-benchmarks-proceedings.neurips.cc/paper/2021/hash/e2c420d928d4bf8ce0ff2ec19b371514-Abstract-round2.html)
supports these separate binding, context, and sensor tests.

Controls include an exact scene-graph oracle, uniform parser likelihoods,
graph-likelihood derangements within graph-cardinality strata, source-prior
ablation, type-and-frequency-preserving prior derangements, and oracle program
order. A visual-only arm means support consistency and parser likelihood with
a uniform concept prior.

A surface-label control applies one bijection consistently to the concept
artifact, scene graph, renderer labels, episode legend, target, and verifier.
Every control transformation preserves types, answer behavior, frequency
marginals, normalization, and artifact size. Its exact mapping is stored in
the manifest.

### Metrics and gate

Report each boundary:

- object detection and optimal set-matched attributes;
- relation precision, recall, and F1;
- exact scene-graph match and graph top-k coverage;
- semantic-class truth rank after graph marginalization;
- exact predictive accuracy over the full registered finite scene universe;
- exact final behavior class and semantic certificate;
- semantic-class verifier checks, joint graph-program hypotheses expanded,
  parser calls, and wall time.

R5.9 has two ordered decisions.

1. R5.9a compares prior-on with prior-off on exact scene graphs. It uses a
   one-sided error allocation of 0.005 and the full common gate.
2. R5.9b executes only after R5.9a passes. It compares prior-on with prior-off
   on pixels through the shared parser. It has its own 0.005 allocation,
   two-way concept-by-renderer interval, family-axis win gates, and full common
   gate.

Before the R5.9a sealed manifest is opened, the full R5.9b parser bytes,
renderer code and settings, paired pixel-family manifest, controls, analysis,
and hashes are also frozen. The conditional rule controls execution only. No
R5.9b design field can change in response to the R5.9a result.

The grounded benefit must also retain at least half of the symbolic paired
log-cost benefit as a point estimate. This retention threshold is a project
choice. Both decisions use semantic-class verifier checks as primary cost.
Joint hypotheses and channel costs remain secondary.

The primary verifier returns accept or reject only. The first counterexample
stays evaluator-only. The evaluator exhaustively compares the proposed class
and target over all 25,344 scenes. The sparse support set stays public while
the complete universe stays evaluator-only.

### Claim if it passes

A source concept prior transfers through a registered object-scene interface.
If both ordered decisions pass, at least half of its measured symbolic benefit
survives the registered synthetic pixel channel. Each binding and sensor shift
keeps its own result.

## R6.0: bounded structural recursion

R6.0 is designed now and implemented after 5.8 passes and its own development
readiness gates.

### Question and exact domain

Does a frozen source guide for base-case, reduction, recursive-call, and
combination structure reduce exact synthesis cost on new list functions and
longer input traces?

The sealed universe is every list over `{0, 1, 2}` with length zero through
eight:

```text
sum(3^n for n = 0..8) = 9,841 lists
```

Source artifact building may inspect only the 40 lists through length three.
Development may inspect only the 364 lists through length five. The sealed
verifier compares depth-only and combined targets on all 9,841 lists through
length eight. It compares composition-only targets on all 40 source-range
lists through length three. Trees and graphs move to later versions after this
list result. Fold,
repeat-until, and worklist operators also move to separate control-flow
strata. The primary grammar contains true call and return only.

The recursive grammar contains typed base predicates, `head`, `tail`, scalar
and Boolean constants, one self-call on `tail`, and registered scalar,
Boolean, or list combination operators. It forbids a self-call on the same or
larger list. Generated tasks use the structural form:

```text
f([]) = base
f(head :: tail) = combine(local(head), f(tail))
```

Source and target families cover count, modular sum, any, all, map, and filter
forms. Every atomic predicate, local transform, and combination appears in
source training. Target families hold out complete typed compounds. The
planning limit is nine AST nodes. The final AST bound, type rules, and output
range freeze after development cost simulation.

The proposed length bands are source traces 0 through 3, development traces 4
through 5, and sealed traces 6 through 8. These are project choices. A
development headroom and cost simulation may narrow them before the contract
freezes.

### Source artifact and ranker

Source tasks provide exact shortest programs and complete traces. Exact source
enumeration labels a partial AST as positive when it lies on a shortest exact
solution path. The frozen integer artifact contains smoothed log-odds for:

- base predicate and return-value type;
- structural reduction type;
- recursive-call position;
- result-combination role;
- partial execution behavior on source lists;
- typed parent-child transitions.

The target ranker reads public input-output examples, the partial candidate
AST, types, public partial executions, the evaluator fuel limit, and the
frozen artifact. It cannot read the hidden target table or semantic
certificate. The primary contrast is this guide against the identical
recursive grammar and enumerator with the source artifact zeroed. A
source-free just-in-time guide is the secondary operational comparator.

### Separate shift strata

1. Depth-only: familiar program compounds, longer input traces.
2. Composition-only: new typed compounds, source-range input traces.
3. Combined: new typed compounds and longer traces.

All three strata are formal. With one exact tail call per frame, input length
and call depth are equal by construction. The report shows both and scopes the
claim to list-depth extrapolation. A later tree version can separate node count
from structural depth. AST size and candidate search depth stay separate. All
target arms receive the same registered number of public examples drawn only
from list lengths zero through two. The preregistration freezes that count.

### Fuel and replay contract

The evaluator sets initial natural-number fuel to `list length + 1`. A
candidate cannot choose it. Every frame, including the base frame, consumes
exactly one unit. A recursive call must receive the exact `tail` and reduce
list length by one. A successful trace ends with fuel zero. Exhaustion before
the base case, underflow, extra calls, cycles, a false base case, a
nondecreasing argument, and unused fuel are invalid.

Every call record contains:

- schema version, trace ID, call ID, parent call ID, and preorder index;
- stack depth and candidate AST hash;
- canonical input bytes or a manifest reference plus its SHA-256 hash;
- branch choice, typed local values, and base-case result;
- canonical child input bytes and hash;
- fuel before and after;
- typed child return value and final return value;
- canonical output bytes and SHA-256 hash.

The contract defines a length-prefixed canonical binary encoding for every
type. Hashes support integrity. The trace also carries the state needed for an
independent replay.

The checker emits two separate certificates:

1. An execution certificate replays every call, type, state transition, fuel
   step, base case, and return.
2. A semantic certificate records exact equality with the target on all 9,841
   lists for depth-bearing strata, or all 40 source-range lists for the
   composition-only stratum.

The target verifier returns accept or reject only. A first failing input is
stored in the evaluator trace and stays hidden from the ranker.

### Controls and pass gate

Controls include source ablation, target-only, source-free just-in-time,
31 type-and-frequency-preserving guide derangements, an oracle guide, and an
equivalent fixed-depth unrolled grammar. The unrolled comparison measures the
value of recursive representation. It is separate from the primary transfer
contrast.

Before sealing, target-only development search must meet the registered
headroom band. Every base case, reduction, return type, and combination must
appear in source and development coverage reports. Golden checker tests inject
wrong types, bad returns, false base cases, cycles, nondecreasing calls, fuel
underflow, unused fuel, missing records, and record reordering. Every injected
case must fail at the intended trace step.

The primary cost is candidate verifier checks, with partial AST expansions and
trace replay operations reported separately. Pass requires the full common
gate on each formal shift stratum, valid execution and semantic certificates
for every primary episode, and the registered guide derangement test.

Research on [recursive generalization](https://arxiv.org/abs/1704.06611) and
[Neural Programmer-Interpreters](https://arxiv.org/abs/1511.06279) supports
depth extrapolation with explicit subroutine structure. The exact depth bands,
finite list universe, fuel equation, and pass threshold are Reasoner design
choices.

## Build and seal order

### Phase A: shared harness

Build one generator and evaluation library before any experiment-specific
ranker. It owns family splits, semantic deduplication, episode manifests,
nested repeat IDs, arm parity checks, metrics, confidence intervals, and
provenance.

The development implementation and its executable acceptance checks are
defined in the [generated-family harness specification](../benchmarks/reasoner5-generated-family-harness-v1/SPEC.md).

The harness must pass these tests:

- replay from a manifest yields byte-identical episodes;
- changing a sealed seed changes the output digest;
- no complete target AST, exact complete-program behavior signature, or
  complete episode specification crosses split lanes;
- registered atom and subtree overlap matches each compositional split;
- every arm receives the same eligible candidate multiset;
- fallback follows one digest-bound canonical order and links each expansion
  to its verifier row;
- source ablation matches the full source-free operational row apart from its
  registered arm name;
- hidden fields fail the ranker interface audit;
- an injected invalid top candidate is rejected;
- nested repeats collapse to one family block in the statistics;
- registered evidence units use only family-level axes;
- raw trace rows use the fixed shared schema;
- all result hashes reproduce from raw traces.

### Phase B: two independent early tracks

Implement R5.5 and R5.6 on separate branches after the shared harness lands.
Both are small finite-domain tests and can run locally during development.
Freeze R5.6 and pass its channel-readiness gate before R5.7 begins.

### Phase C: harder domains

Implement R5.8 after the generated-family and metric code is stable. Build
R5.9a and the full R5.9b parser, renderer, paired manifest, controls, and
analysis before either sealed result opens. Freeze and hash both stages
together. R5.9b execution remains conditional on the R5.9a pass.

### Phase D: prospective contracts

Each experiment gets its own pull request with:

- research question and scoped claim;
- generator and split report;
- power simulation and selected family count;
- complete arm table;
- exact pass equation;
- source artifact schema;
- code, data, and evaluator hashes;
- local development-test report;
- sealed execution lock and publication rule.

The contract freezes only after review. The sealed lane runs once under fresh
approval. Its result is published whether it passes, reaches no-go, or exposes
a measurement floor.

## Scale roadmap

| Stage | Capability | Evidence needed to enter | Practical scale |
| --- | --- | --- | --- |
| 0 | Shared generated-family harness | Reproducible splits, exact replay, family statistics | Local CPU |
| 1 | Semantic and evidence transfer | R5.5 and R5.6 mechanism gates | Hundreds of finite families |
| 2 | Active evidence | R5.6 channel-readiness, then R5.7 | Tool and sensor query budgets |
| 3 | Composition and grounding | R5.8 and R5.9a symbolic pass | Larger CPU search, parallel families |
| 4 | Bounded recursive programs | R5.8 pass, then R6.0 trace gate | Lists, trees, graphs, bounded plans |
| 5 | Multi-domain capability packets | Replication across at least three DSL families | Data transforms, grids, graph tasks, formal statements |
| 6 | Language proposals behind exact IR | Stable exact interfaces and broad hidden tests | LLM proposes; verifier commits |
| 7 | Evaluator-grounded discovery | Positive transfer curves and measured amortization | Formal math and scientific program search |

The long path is credible because verified search has already scaled in other
domains. [AlphaGeometry](https://www.nature.com/articles/s41586-023-06747-5),
[AlphaProof](https://www.nature.com/articles/s41586-025-09833-y), and
[FunSearch](https://www.nature.com/articles/s41586-023-06924-6) combine learned
proposal systems with symbolic or formal feedback. Their compute and data are
far larger than Reasoner's current setting. They show a direction, not a
current Reasoner claim.

Reasoner should scale compute only when a capability curve supports it. For
each source artifact, report:

```text
source build cost
target inference cost per episode
target-only cost per episode
break-even target count
effect by family and difficulty
effect after a new generator or sensor shift
```

The first useful applications are bounded and checkable:

- verified data transforms;
- small formal algebra and proof search;
- constrained planning with tool receipts;
- program repair with exact counterexamples;
- scientific search with a deterministic evaluator.

Natural language can propose tasks and programs later. The committed result
continues to pass through typed IR, tools, and exact checks.

## Main risks and stop rules

| Risk | Early signal | Stop or repair rule |
| --- | --- | --- |
| Generator shortcut | Guide wins on one generator and loses cross-generator | Stop the broad claim. Add another generator before a new seal. |
| Semantic collision | Distinct ASTs share sampled behavior | Use full finite behavior or exact symbolic equivalence. |
| Hidden-label leak | Channel scorer changes when hidden metadata is masked | Mark the run invalid. Repair the interface before resealing. |
| Measurement floor | Comparator median falls below the frozen headroom band | Publish measurement floor. Increase difficulty only in a new contract. |
| Few-family aggregate win | Total cost improves while most families do not | Record no-go under the family confidence gate. |
| Perception masks reasoning | Pixels fail while exact graphs pass | Keep the symbolic result. Improve the channel in a new version. |
| Prior memorizes IDs | Raw lexical or surface-label control matches full | Stop the semantic-transfer claim. |
| Source cost never amortizes | Break-even count exceeds the target program | Keep the result scientific. Hold deployment scaling. |
| Recursive trace fails replay | Final answer is right and any trace step is invalid | Reject the candidate and record no-go. |

## Final recommendation

Build the shared harness first. Then preregister R5.5 and R5.6. They test the
two strongest open mechanisms from the first series: semantic adaptation and
learned evidence. R5.7 begins after channel readiness, which can pass
separately from the R5.6 search-cost gate. R5.8 tests the compositional bridge
needed for recursion. R5.9b tests grounded transfer only after R5.9a symbolic
transfer passes.

This order turns each earlier result into a precise next question. It also
keeps the Reasoner line centered on useful transfer under exact verification.

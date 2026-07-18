# The ZERO Faculty

Status: mixed implementation and design document, version 1, 2026-07-18.

The faculty is a system of persistent specialist channels. Each channel has a
set of eligible teacher models, a corpus, grammar, validator or critic, local memory, and promotion
contract. A faculty speaks in complete typed chunks. Only after a chunk closes
may it be checked, summarized, committed to shared state, or followed by a
different faculty.

The faculty produces one bounded student. The three historical teachers do not ship in
the browser, do not vote on every token, and do not acquire authority outside
the channels and tasks named in their manifests.

The first objective is not to fit every discipline into 4,852,992 parameters.
It is to discover which distinctions a small student can preserve, which
relations need explicit representations, and which operations should remain in
external kernels or simulators.

The second objective is to determine **how many** such distinctions fit before
the architecture saturates — measured rigorously, per seed, per faculty, with
no macro-averaging. The saturation protocol is defined in
[`SATURATION.md`](SATURATION.md).

The machine-readable companion to this document is `faculty-v1.json`.

### Implementation boundary

| Capability | Current status |
| --- | --- |
| Fixed-capacity controller with 16 present channel states | Built and self-tested in `faculty_controller.c` |
| Close, verified commit, rejection without committed-state mutation, and switch locking | Built and self-tested |
| Quantity source parsing, controller-bound arguments, exact kernel execution, and atomic commit | Built and evaluated through Q2.2-R seed 2 |
| Three-teacher routed training and feasibility-first checkpoint selection | Built for the recorded quantity experiments |
| Quantity, geometry, art, and protocol pilot corpora | Generated and independently checked by the current scripts |
| Per-faculty episodic history, dependency scheduler, and shared-synthesis runtime | Proposed; not implemented in the controller |
| Durable artifact-reference store and faculty-controller browser integration | Proposed; not deployed |
| Transactional optimizer shadow state | Q2.3 design; not implemented |

The checked-in browser model is the earlier literary channel runtime. References
below to a default faculty deployment, council history, scheduling, or shared
synthesis describe the target architecture unless explicitly marked built.

## 1. Commitments

1. **One deployed student.** ZERO.4 research and distillation use exactly the
   three frozen ZERO.1, ZERO.2, and ZERO.3 artifacts; faculty channels do not
   create hidden specialist variants. The browser receives one quantized
   student plus small, declared validators where useful.
2. **Routed authority.** A teacher is consulted only for a compatible domain,
   curriculum, and target span. There is no undifferentiated global vote.
3. **Hard targets remain primary.** Teacher probabilities regularize a student;
   they do not replace checked records or observed text.
4. **Synthetic means closed-world.** Synthetic corpora describe generated
   mathematical objects, scenes, programs, or simulated worlds. They do not
   manufacture claims about history, people, medicine, law, or current events.
5. **Verification is external and compositional.** A proof kernel, interpreter,
   unit checker, geometry checker, or simulator decides its formal question.
   Fluency is not accepted as validity. Domains without atomic kernels
   (literary quality, humor, emotional authenticity) are not domains where the
   model "computes internally" — they are domains where verification decomposes
   into finer-grained sub-checks composed through learned weighting. The model
   routes; kernels compute; the composition function weights. No domain is
   kernel-free; some domains merely await finer-grained kernels.
6. **Preference is not truth.** Art, music, and literary teachers report
   dimensions, comparisons, and alternatives. Their judgments remain
   attributable preferences.
7. **Splits precede surfaces.** A latent object, channel, generator family, or
   source work is assigned to a split before records or paraphrases are made.
8. **Failures stay visible.** Faculty reports show every domain, task family,
   seed, best checkpoint, and final checkpoint. An average cannot hide a failed
   discipline.
9. **Scale follows evidence.** Data relations, curricula, and validators are
   improved before context or parameter count is enlarged.
10. **Provenance is structural.** Every artifact has a generator or source
    identity, version, seed or source unit, split, license or consent status,
    and content hash.
11. **A faculty is a channel.** It has persistent local state and an explicit
    lifecycle. It is not merely a label attached to a batch.
12. **Switches are atomic.** The controller can switch faculties only after a
    complete chunk has closed. A model may request another faculty inside a
    chunk, but the request is queued until the boundary.
13. **Roll-up preserves identity.** Shared state retains tagged faculty
    summaries. It never averages them into one anonymous vector.
14. **Latent summaries are not artifacts.** Proofs, equations, constructions,
    programs, verifier results, and source citations remain explicit and
    recoverable. Latent state is used for memory, routing, and synthesis.

## 2. Kinds of channel authority

| Kind | Legitimate authority | Examples | Required check |
| --- | --- | --- | --- |
| Kernel | Exact result in a declared formal system | logic, arithmetic, algebra, geometry | independent parser and verifier |
| Simulator | Evolution inside a declared model | mechanics, circuits, control systems | units plus exact or tolerance-bounded simulation |
| Interpreter | Behavior of a declared program | stack machine, restricted C experiments | execution and tests |
| Corpus | Observed or authored language | literary, consented channels, foundation | provenance, split integrity, held-out loss |
| Critic | Attributable preference and revision | art, music, literary criticism | rubric consistency and blinded human comparison |
| Anchor | Functional preservation during training | ZERO.1, ZERO.2, promoted ZERO.3 | regression suite and checkpoint hash |

No faculty channel is promoted merely because it generates convincing samples.

## 3. Faculty-channel system

### 3.1 State

The runtime distinguishes four objects:

```text
FacultyChannel {
  id
  grammar and allowed tasks
  eligible teacher set with channel-specific roles
  explicit rolling summary text
  latent summary z_f in the common registrar space
  bounded references to committed exact artifacts
  last verifier or critic status
  channel epoch
}

CouncilState {
  current goal
  current open channel or idle
  tagged set of committed faculty summaries
  bounded shared transcript and artifact references
}

Chunk {
  faculty id and task
  previous faculty rolling summary
  input references
  complete explicit artifact or response
  proposed updated rolling summary
  optional queued faculty requests
  close marker
}

Commit {
  closed chunk
  external verdict and authority kind
  common-space latent encoding
  resulting faculty-state update
}
```

The tagged set of faculty summaries is the shared roll-up. A single mean vector
would erase which faculty established which relation and would reproduce the
collapse ZERO is intended to resist.

The implemented v1 controller representation is a fixed table keyed by faculty
id. Each registered faculty has one current rolling summary, artifact,
authority, verdict, revision, and 256-dimensional vector. The separate 32-slot
literary Holo index is not wired to faculty history. A bounded per-faculty
episodic index for older committed chunk digests remains proposed.

### 3.2 Atomic lifecycle

The controller, not sampled prose, owns the state machine:

```text
IDLE
  -> ENTER(faculty, task)
  -> EMIT(faculty-locked chunk)
  -> CLOSE
  -> VERIFY or CRITIQUE
  -> COMMIT | REJECT
  -> IDLE
  -> ENTER(next faculty or shared synthesis)
```

- `ENTER` selects one faculty grammar and exposes its old rolling summary plus
  only committed upstream artifacts and summaries.
- `EMIT` is locked to that faculty. A mid-chunk faculty marker is invalid.
- `CLOSE` is a model target, but a maximum length also guarantees termination.
- `VERIFY` is performed outside the model where a kernel or simulator exists.
- `COMMIT` updates the exact artifact store and replaces that faculty's rolling
  summary only after closure and validation. The artifact and proposed summary
  commit or reject together.
- `REJECT` leaves shared state unchanged. A bounded repair is a new complete
  chunk in the same faculty.
- A request such as `@request geometry` is data, not an immediate switch. The
  controller may schedule it only after the current chunk closes.

In the target design, the shared synthesis voice is itself a channel. It would
receive selected committed faculty summaries and the exact artifacts needed for
the answer, emit one complete user-facing chunk, and then close. This runtime is
not yet implemented.

### 3.3 Dependency scheduling

Faculty dependencies form a directed graph at chunk granularity. For example:

```text
quantity -> geometry -> physics -> shared synthesis
geometry -> art ------^          -> shared synthesis
```

The proposed initial scheduler is deterministic and derived from task metadata.
No dependency scheduler currently exists in `faculty_controller.c`. A learned
scheduler would confound routing quality with faculty quality too early.

### 3.4 Common latent registrar

Raw hidden states from independently trained teachers are not directly
comparable. Neural representations may rotate, permute, or otherwise diverge
while producing similar token distributions. Teacher latent vectors therefore
must never be averaged or inserted directly into shared state.

Every closed chunk is re-encoded by one shared **registrar**. The registrar
produces the common-space chunk vector, and the faculty channel stores the
result under its identity. Exact artifacts remain alongside it.

Faculty v1 currently uses a controller-specific deterministic 256-dimensional
encoder over faculty id, summary, artifact, authority, and verdict. It is not
the same feature encoder as `literary_infer`'s word-based Holo recall. It gives
each current channel state a stable parameter-free coordinate, but the proposed
bounded council index and retrieval policy are not implemented.
The old summary is an input to the next chunk, reusing ZERO's existing learned
pattern `old memory + new event -> new lossy memory`. A rejected chunk retains
the old summary unchanged.

In v1, latent vectors select and index memory; the transformer is conditioned
on the selected explicit summary text. The current inference engine does not
accept continuous memory vectors as attention inputs. This separation keeps v1
honest about what is latent retrieval and what the model actually reads.

Faculty v2 may add a learned registrar:

1. the shared student re-encodes completed teacher chunks;
2. the hidden state at a declared close/summary position becomes the chunk
   vector;
3. contrastive targets bring alternate surfaces of the same latent object
   together while separating different results and faculties; and
4. faculty memories enter later generations as continuous virtual prefix
   tokens.

A learned registrar requires explicit architecture and ablation work. Until it
passes alignment, retrieval, and regression tests, the deterministic Holo
space remains authoritative for channel roll-up.

When continuous prefixes are tested, each selected faculty state occupies its
own virtual token. Conceptually the input is `RMSNorm(z_f + e_f)`, where `z_f`
was produced by the common registrar and `e_f` identifies the faculty. A single
anonymous global-memory token is forbidden. The first experiment exposes no
more than four selected faculty states and compares it with the same summaries
serialized as text.

### 3.5 Training and deployment planes

During ZERO.4 training, the three immutable historical teachers are routed
only to compatible faculty chunks. New exact domains obtain authority from
their generators, kernels, simulators, and checked hard targets, not from new
specialist checkpoints. The common registrar encodes committed chunks, and the
student learns the same channel grammar, summary transition, and boundary
behavior under hard targets and routed distillation.

In the target deployment, the one student reenacts those faculty channels under
the same controller. Specialist weights are absent; faculty independence
survives as channel identity, grammar, local summary state, validators,
artifacts, and commit rules. The current browser does not yet do this. A
laboratory committee runtime may load several specialists for comparison, but
it is a separate proposed product mode with separately declared memory and
compute.

## 4. Shared corpus contract

Every generator emits complete faculty chunks and, where useful, multi-faculty
episodes. It produces three views of the same latent objects:

1. a canonical JSON Lines archive containing metadata, input, target, and
   verifier information;
2. a compact target-masked token stream for `literary_lm`; and
3. held-out benchmark rows consumed by a domain evaluator.

A canonical chunk has this logical shape:

```json
{
  "schema": "zero.faculty_chunk.v1",
  "id": "geometry/euclid2d/construct/000042",
  "domain": "geometry",
  "curriculum": "euclid2d",
  "task": "construct",
  "channel_epoch": 0,
  "split": "train",
  "source": {
    "kind": "synthetic",
    "generator": "geometry_corpus",
    "version": 1,
    "seed": 42
  },
  "authority": "kernel",
  "previous_summary": "no construction has yet been committed",
  "input": "point A 8 8\npoint B 48 32\ngoal perpendicular-bisector A B",
  "artifact": "midpoint M A B\nline L through M perpendicular A B",
  "summary": "the perpendicular bisector passes through midpoint M",
  "requests": [],
  "verification": {
    "status": "valid",
    "checker": "geometry_check",
    "checker_version": 1
  }
}
```

The model-facing form stays short enough for the 512-character context. The
model produces the artifact, inspectable summary, optional requests, and close
marker. The controller attaches verdict and commit metadata afterward:

```text
@enter geometry construct
@memory
no construction has yet been committed
@input
point A 8 8
point B 48 32
goal perpendicular-bisector A B
@output
@artifact
midpoint M A B
line L through M perpendicular A B
@summary
the perpendicular bisector passes through midpoint M
@close
```

Only the output span contributes directly to cross-entropy. Metadata such as
split, seed, consent, license, and hashes remains in the sidecar manifest and
does not consume model context. Visible ASCII tags are used in faculty v1 for
inspectability. Compact control tokens may be tested later under a frozen
ablation contract.

The summary is a proposed rolling faculty state, not a self-issued verdict. On
successful external validation, the controller binds the validator result to
the registration payload and commits the artifact and summary together. On
failure, neither enters shared state.

A multi-faculty episode references several chunks derived from one latent
problem or shared goal:

```text
episode goal
  -> quantity chunk -> verify -> commit
  -> geometry chunk reading the quantity artifact -> verify -> commit
  -> physics chunk reading both committed artifacts -> simulate -> commit
  -> shared synthesis chunk -> close
```

Episode corpora teach dependency use, requests, abstention, chunk closure, and
switch timing. Single-faculty corpora remain necessary for measuring each
specialist without orchestration confounds.

### 4.1 Record constraints

- A record must fit within the active context plus its predicted next token.
- Longer derivations are divided at declared semantic boundaries, never at an
  arbitrary byte offset.
- Inputs and targets use the common 128-byte vocabulary unless a new faculty
  version explicitly changes it.
- Negative examples are made by controlled mutation and are retained only when
  the checker independently rejects them.
- Rejection sampling counts and reasons are reported by each generator.
- A model-generated synthetic record is never accepted solely because another
  language model approves it.
- An exact downstream faculty receives the required upstream artifact, not
  merely its latent summary.
- Faculty switches occur only between records in an episode; a generated
  mid-record switch is an explicit negative case.
- Summaries must be entailed by or attributable to their chunks. Formal
  summaries are checked against the artifact when a checker can do so.

## 5. Split and leakage policy

Random record splitting is forbidden. Each curriculum declares a latent split
unit and at least one structural generalization split.

| Domain | Primary split unit | Structural holdout examples |
| --- | --- | --- |
| Logic | proof-template family and generator seed range | unseen composition and nesting templates |
| Quantity | expression AST family and coefficient range | unseen operator combinations and magnitudes |
| Geometry | construction family and scene graph | unseen construction compositions and depth |
| Physics | world topology and parameter regime | unseen force layouts, masses, and time horizons |
| Code | program AST or algorithm family | unseen compositions and mutation classes |
| Epistemics | latent causal world | unseen claim forms over held-out worlds |
| Channel | whole source channel, play, poem, or participant group | held-out participant groups and reply structures |
| Art | scene graph, layout family, and source work | held-out compositions, palettes, and public-domain works |
| Music | motif family, harmonic plan, and source work | held-out transformations and phrase structures |

The generator assigns the latent unit to train, validation, public test, or
hidden test before producing language variants. A paraphrase inherits its
parent unit's split.

## 6. Faculty roster

### 6.1 Existing channels and anchors

#### Foundation — ZERO.F

- Existing artifact: `teachers/zero1-foundation.teacher`.
- Authority: authored foundation corpus and preservation anchor.
- Tasks: local continuation of the explicit ZERO.1 foundation.
- Limitation: it does not confer general set-theoretic reasoning.
- Corpus: authored, not synthetic.

#### Literary — ZERO.L

- Existing lineage: the literary and consolidated transformer checkpoints.
- Authority: public-domain literary usage and style.
- Tasks: continuation, voice, metaphor, dialogue form, and critique.
- Corpus: public-domain sources with pinned editions and transformations.
- Limitation: literary plausibility is not factual or formal authority.

#### Logic — ZERO.Logic

- Existing generator and checker: `logic_corpus`.
- Authority: intuitionistic natural deduction over the declared finite-set
  fragment.
- Tasks: prove, check, complete, reject, and repair.
- Corpus: fully synthetic and mechanically checked.
- Next requirement: an evaluator that parses sampled proof spans and reports
  exact theorem validity rather than next-character loss alone.

#### Channel — ZERO.Channel

- Existing generator: `channel_corpus`.
- Authority: reply structure, bounded memory transitions, and consented channel
  observations.
- Tasks: reply, address, remember, forget, recall, abstain, and repair.
- Corpus: synthetic dramatic/verse channels plus consented human channels.
- Human conversations may never be replaced by synthetic conversations in the
  hidden promotion set.

### 6.2 Faculty v1 additions

#### Quantity, algebra, and units — ZERO.Q

This faculty precedes physics. It is a checked hard-target channel, not a fourth
teacher model.

Implemented quantity curriculum in the current Q2 family:

- integer and rational arithmetic;
- addition and multiplication;
- rational addition;
- bounded linear equations; and
- three declared unit-conversion families.

Expression equivalence, systems, ratios, sequences, probability, and general
dimensional analysis remain planned extensions and must not be credited to the
current student.

Synthetic method:

1. Generate a typed expression or equation AST.
2. Evaluate it with exact integer or rational arithmetic.
3. Render multiple surface forms only after split assignment.
4. Create negative answers by traceable mutations.
5. Check the answer and, when requested, every derivation step.

Initial tasks are `solve`, `evaluate`, `equivalent`, `check`, and `repair`.
Calculus is excluded from v1.

#### Geometry — ZERO.G

Geometry uses an inspectable scene language with integer or rational
coordinates. The scene language compiles locally to SVG but remains independent
of SVG syntax, floating-point rendering, and browser layout.

Primitive objects:

- point, segment, line, ray, circle, polygon, and axis-aligned canvas;
- incidence, intersection, midpoint, distance, angle, parallel, and
  perpendicular relations; and
- translation, rotation by declared exact angles, reflection, and rational
  scale.

Tasks:

- construct a scene satisfying a goal;
- derive a relation from givens;
- classify a configuration;
- check a proposed construction;
- repair one invalid operation; and
- translate between scene code and a bounded natural-language description.

Synthetic method:

1. Generate a valid latent construction graph.
2. Solve coordinates with exact arithmetic where the curriculum permits.
3. Render scene code and descriptions.
4. Mutate one relation or operation for negative examples.
5. Parse and verify independently.

The checker is authoritative about the declared construction, not about visual
beauty.

#### Physics — ZERO.P

Physics v1 is a simulator teacher for small, closed Newtonian worlds. It does
not attempt to represent all physical science.

Curriculum order:

1. dimensions, units, and measurement;
2. one-dimensional constant-acceleration motion;
3. two-dimensional vectors and projectiles;
4. force composition and Newton's laws;
5. work, energy, momentum, and ideal collisions;
6. simple harmonic motion; and
7. ray optics and ideal DC circuits as optional, separately scored modules.

A record declares its model, assumptions, coordinate system, units, initial
state, interventions, and query. Exact formulas use rational arithmetic where
possible. Numerical integration declares method, step size, and tolerance.

```text
@zero physics predict
@input
model constant-acceleration
body A mass 2 kg position 0 m velocity 3 m/s
force A -4 N duration 1 s
@target
acceleration -2 m/s2
velocity 1 m/s
position 2 m
@end
```

The simulator checks state evolution and conservation claims within the
declared idealization. Passing the simulator is not evidence about an
undeclared real-world system.

#### Art — ZERO.A

Art v1 operates on the same scene language as geometry, extended with layers,
strokes, fills, palette roles, value, and simple symbolic figures. The local
renderer produces SVG.

Tasks:

- compose a scene under explicit constraints;
- describe visual structure without inventing hidden objects;
- critique along named dimensions;
- compare two alternatives;
- revise one dimension while preserving others; and
- repair invalid scene code.

Corpus sources:

- synthetic scene programs with mechanically checked constraints;
- procedurally generated composition pairs;
- descriptions and metadata for pinned public-domain works;
- authored rubrics; and
- consented, blinded human pairwise preferences.

Mechanical checks cover syntax, bounds, declared constraints, contrast
measurements, and geometry. They do not label an image beautiful. Critiques
name dimensions such as hierarchy, balance, negative space, rhythm, value,
contrast, palette, and tension. Multiple incompatible revisions may all be
valid.

#### Epistemics — ZERO.E

This teacher calibrates the relationships between claims and evidence.

Synthetic method:

1. Generate a small causal or relational world.
2. Reveal a bounded set of observations.
3. Generate claims that are entailed, contradicted, or unresolved.
4. Ask for classification, a counterexample, or the next discriminating
   observation.
5. Verify against the latent world and the actually revealed observations.

Tasks include `classify`, `support`, `counterexample`, `unknown`, and
`experiment`. The target vocabulary distinguishes observation, assumption,
deduction, simulation, analogy, and preference. This teacher must not turn
closed-world synthetic certainty into confidence about open-world facts.

### 6.3 Faculty v2 candidates

#### Code — ZERO.Code

Begin with a small total stack machine or expression language whose interpreter
is short enough to audit. Generate typed programs, traces, tests, and
single-mutation repairs. Restricted C can follow only after the small language
establishes exact execution metrics.

#### Music — ZERO.M

Use a symbolic event language for pitch class, register, duration, meter,
voice, and dynamics. Mechanical checks cover syntax, meter, range, declared
harmony, transformations, and selected counterpoint rules. Composition quality
remains a critic and human-preference question. Use generated material and
pinned public-domain scores.

#### Systems and control — ZERO.S

Generate finite-state systems, queues, feedback loops, and small discrete-time
dynamical systems. Verify traces, invariants, stability in the declared model,
and repairs. This teacher connects physics, code, and channel coordination.

## 7. Synthetic corpus protocol

Every synthetic generator follows the same sequence:

```text
latent object
  -> split assignment
  -> canonical solution
  -> independent verification
  -> surface renderings
  -> controlled negative mutations
  -> independent rejection/acceptance
  -> manifest + hashes
  -> token stream and benchmark views
```

### 7.1 Independence requirements

- The generator may construct an answer while building its latent object.
- The checker reparses the serialized record and recomputes the result.
- Generator and checker may share a syntax definition but not a cached answer.
- At least one self-test corrupts each target field and confirms rejection.
- Numerical tolerances are part of the curriculum manifest, never chosen after
  seeing a model output.

### 7.2 Data ladder

Each new curriculum moves through three sizes:

| Tier | Intended use | Target scale per domain |
| --- | --- | ---: |
| Pilot | parser, checker, overfit, and representation tests | 10,000 records |
| Faculty v1 | three-seed teacher and student experiments | 100,000 records |
| Scale | only after a measured positive learning curve | up to 1,000,000 records |

Record counts are secondary to diversity in latent families. Generating one
million coefficient variants of one template does not constitute scale.

### 7.3 Natural-language surfaces

Formal teachers first learn canonical symbolic records. Natural-language
surfaces are then introduced as an additional task, not substituted for the
formal representation. Paraphrases must preserve a pointer to the canonical
record and pass round-trip or human checks appropriate to the domain.

### 7.4 Multi-faculty episode generation

An episode generator begins from one latent problem, scene, world, or channel
event and derives each faculty's legitimate view of it. For a mechanics-and-art
scene, one latent object may yield:

1. a quantity chunk resolving units and numeric parameters;
2. a geometry chunk constructing the spatial arrangement;
3. a physics chunk evolving the declared world;
4. an art chunk revising composition without changing checked geometry; and
5. a shared synthesis chunk that attributes conclusions to the committed
   artifacts and distinguishes verification from preference.

The episode manifest records the dependency graph and every chunk id. It also
generates controlled protocol negatives:

- a faculty switches before closing;
- a downstream faculty reads a rejected artifact;
- a summary contradicts its exact artifact;
- a requested faculty is irrelevant or a necessary dependency is skipped;
- a critic claim is presented as a kernel verdict; or
- synthesis cites a latent summary where the exact artifact is required.

Protocol negatives train rejection and boundary behavior; they are not mixed
into hard positive continuations without explicit invalid labels.

## 8. Channel curriculum and promotion

A channel curriculum is trained from a declared base checkpoint with both
domain data and replay data. Pure sequential fine-tuning is not the default.

An initial sampling proposal is:

- 60% specialist-domain batches;
- 30% general anchor replay; and
- 10% adjacent-domain bridge batches.

These ratios must be frozen in the teacher's experiment contract. Adjacent
domains are explicit: quantity for physics, geometry for art and physics,
logic for code, and literary/channel for art critique.

### 8.1 Exact/simulator channel gate

Initial gate, to be frozen before training:

- at least 99% record syntax validity;
- at least 90% exact or tolerance-bounded task success;
- at least 90% controlled-negative rejection;
- no more than 2% relative regression on the general anchor validation set;
- all task families reported for three seeds; and
- evaluator, corpus, configuration, best checkpoint, and final checkpoint
  hashes retained.

Thresholds may be changed only by creating a new contract before training.

### 8.2 Critic channel gate

- at least 99% scene or score syntax validity;
- at least 90% explicit constraint satisfaction;
- at least 60% preference in a blinded 200-item comparison against its base;
- diversity and copying diagnostics reported;
- no more than 2% relative anchor regression; and
- attributable provenance for every non-synthetic example.

## 9. Channel-routed multi-teacher distillation

Faculty v1 may route any eligible subset of ZERO.1, ZERO.2, and ZERO.3 while
training a faculty chunk. It never introduces another teacher function or
averages parameters. The same shared student learns all faculty grammars, but
a channel-lock prefix declares which complete chunk it must produce.

For a channel `c`, the loss is:

```text
h_c * hard target cross-entropy
+ z1_c * ZERO.1 cross-entropy
+ z2_c * ZERO.2 cross-entropy
+ z3_c * ZERO.3 cross-entropy
```

The weights sum to one. New channels begin with `h_c = 1`; teacher mass is
unlocked only by frozen validation and student ablations. Unsupported mass
returns to the hard target rather than flowing silently to another teacher.

Teacher loss is applied only to declared target positions. Teachers share the
same 128-token map in faculty v1. Probability mixtures are preferred to
parameter averaging or an uncalibrated product of experts.

Teacher-generated chunks are closed and then re-encoded by the common
registrar. Their native hidden states never enter the student's faculty memory.
Multi-faculty episodes add hard targets for correct closure, queued requests,
dependency order, and shared synthesis. They do not permit teacher logits from
one faculty to supervise another faculty's chunk.

If teacher distributions disagree strongly, the router does not pretend that
consensus exists. It retains the best measured eligible teacher, lowers optional
cross-domain influence to zero, and keeps the hard target primary. Teacher
entropy and specialist/anchor Jensen-Shannon divergence are recorded for
diagnosis, not used as truth metrics.

### 9.1 Efficiency

- Only eligible teachers with nonzero frozen channel weights perform forwards.
- Frozen teacher implementations should omit gradients and AdamW state.
- Teacher forwards may be sequential to bound peak memory.
- Persisted full-logit caches are avoided initially; at vocabulary 128, online
  routed inference is simpler and less storage-intensive.
- The deployed artifact contains no teacher weights.
- Faculty channels may be evaluated independently, but registrar encoding and
  episode assembly use one common coordinate system and one boundary protocol.

## 10. Student promotion

The student receives a report card, not one faculty score.

For every mandatory domain it must report:

- exact, simulated, corpus, or preference primary metric;
- every task-family result;
- syntax and termination rate;
- best and final checkpoint results for every seed;
- retained fraction of the best eligible teacher or hard-only control gain;
- general literary and channel regression;
- quantized-model regression; and
- local latency, memory, and artifact size;
- complete-chunk close rate and forced-close rate;
- illegal mid-chunk switch rate;
- request precision and dependency-order accuracy;
- verifier-pass rate before and after bounded repair;
- summary/artifact consistency; and
- synthesis attribution to committed faculty artifacts.

An initial retention gate requires the student to preserve at least 90% of the
best eligible teacher or checked-data control gain over the common anchor while not regressing
any already mandatory domain by more than 2 percentage points. A failed
mandatory discipline blocks promotion even if the macro average rises.

The first student experiments contain no more than five simultaneous new
mandatory domains, alongside foundation/literary replay and synthesis.
Additional channels enter through ablation batches. This is a
capacity experiment, not an assumption that 4.85M parameters can absorb an
unlimited faculty.

## 11. Runtime boundary

The target faculty browser runtime contains:

- one quantized student;
- a deterministic faculty-channel controller;
- one bounded summary state per active faculty;
- a bounded tagged council index rather than an anonymous average;
- explicit committed artifacts and verifier statuses;
- bounded channel memory and episodic recall;
- optional small exact validators, scene renderer, or simulator modules; and
- no network service after the static assets load.

Where a validator exists, generation may use propose/check/repair:

1. generate one bounded candidate;
2. parse and check locally;
3. return a declared failure or request one bounded repair; and
4. expose the validator result separately from model prose.

Repeated sampling until something passes is not reported as first-try model
accuracy.

## 12. Artifact layout

Current repository layout, with generated corpora and large model artifacts
normally ignored:

```text
FACULTY.md
faculty-v1.json
faculty_protocol.h
corpus/
  faculty/generated/
  faculty/q2/
  faculty/q21/
  faculty/q22/
benchmarks/
  zero4-pilot-v1/
  zero4-q1-v1/
  zero4-q2-v1/
  zero4-q21-v1/
  zero4-q22-v1/
  zero4-q22r-v1/
scripts/
  generate_zero4_faculty.mjs
  generate_zero4_q2.mjs
  generate_zero4_q21.mjs
  train_zero4_q22.mjs
  train_zero4_q22r.mjs
  evaluate_zero4_q*.mjs
```

Generated corpora, checkpoints, and optimizer states remain ignored or live in
content-addressed experiment storage. Contracts, manifests, hashes, compact
fixtures, evaluator code, and reports are tracked.

## 13. Execution order and status

Items 1–6 and 11 have partial or complete implementations in the current
pilots. Physics, epistemics, preference tooling, shared multi-faculty episodes,
and learned latent prefixes remain planned. The completed quantity experiments
do not imply completion of the full five-domain student.

1. Freeze the faculty-as-channel design and machine-readable manifest.
2. Define `zero.faculty_chunk.v1`, `zero.faculty_episode.v1`, and the atomic
   controller state machine.
3. Implement deterministic Holo registration of explicit chunk summaries,
   tagged faculty memory, commit/reject behavior, and exact artifact retention.
4. Build chunk-boundary and channel-switch fixtures before adding new subjects.
5. Build ZERO.Q first: exact rationals, units, generator, checker, and evaluator.
6. Build the shared scene language, ZERO.G generator/checker, and SVG renderer.
7. Extend the scene/world language into ZERO.P mechanics and its simulator.
8. Build ZERO.E over generated relational and causal worlds.
9. Build ZERO.A on the checked scene language plus human preference tooling.
10. Calibrate the three frozen teachers independently on every channel.
11. Add repeated channel-routed teacher support to `literary_lm`.
12. Generate multi-faculty episodes from shared latent problems and train the
    shared synthesis channel.
13. Run a five-faculty student ablation before testing learned latent virtual
    tokens or admitting further teachers.
14. Add code, music, and systems only after the first student report exposes
    remaining capacity and interference.

The recommended first five-domain student is quantity, logic, geometry, art,
and channel, with foundation/literary replay as anchors. Art enters only after
the shared scene language, checker, and renderer have proven stable. Physics
then tests composition of quantity, units, and geometry. This order makes every
new channel depend on distinctions that have already been represented and
measured.

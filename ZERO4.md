# ZERO.4 — Three Teachers, Many Channels

Status: teacher stable frozen; controller and pilot corpora implemented;
Q2.2-R seed 2 passed its joint gate, while seeds 1 and 3 and full ZERO.4
promotion remain pending, 2026-07-18.

ZERO.4 has exactly three teacher models: ZERO.1, ZERO.2, and ZERO.3.
Every faculty channel owns a channel-specific policy for consulting those same
three teachers. A channel does not create or load another mentor model. Its
**virtual mentor** is the declared combination of eligible ZERO.1, ZERO.2, and
ZERO.3 distributions plus checked or observed hard targets.

The target is one ZERO.4 student with the existing 4,852,992-parameter,
512-character transformer architecture. In the intended deployment, ZERO.4
runs locally with faculty channel state and validators; ZERO.1–3 do not ship.
The current browser instead deploys the earlier literary channel runtime and
does not yet integrate `faculty_controller` or its validators.

The general channel and corpus design is in `FACULTY.md`. The machine-readable
draft for this phase is `zero4-contract.json`.

## 1. Native objects

### Teacher model

One of the three frozen historical functions:

- **ZERO.1** — narrow foundational teacher with its existing vocabulary
  adapter and explicit scope;
- **ZERO.2** — frozen `teachers/zero2-literary.teacher` weights from update
  12,600; and
- **ZERO.3** — frozen `teachers/zero3-balanced-final.teacher` weights from
  update 16,600.

The exact artifact identities and evaluation record are frozen in
`teachers/registry.json`. Branch names and temporary best checkpoints are not
teacher identities. Student training uses `--init`, never `--resume`, so its
optimizer and RNG begin cleanly.

### Faculty channel

A persistent protocol object containing:

- channel id, grammar, and task families;
- the fixed teacher set `{ZERO.1, ZERO.2, ZERO.3}`;
- an eligibility and weight policy for each teacher;
- checked, simulated, observed, or preference-labelled hard corpora;
- a rolling explicit summary and common-space Holo encoding;
- exact committed artifacts and external verdicts; and
- atomic enter, close, verify, commit, reject, and switch rules.

### Virtual channel mentor

The virtual mentor is a probability distribution assembled for one channel and
task. It has no checkpoint and is not a fourth teacher:

```text
ZERO.1 --eligibility/adapter--\
ZERO.2 --channel reliability---+--> virtual channel mentor --> ZERO.4 loss
ZERO.3 --channel reliability---/
```

### Shared student

ZERO.4 is the only new trained model. It learns to enter a channel, read that
channel's prior summary, emit one complete typed chunk, close, survive external
verification, update only that channel's state, and synthesize committed
results across channels.

## 2. Teacher roles

The three identities are fixed, but their roles vary by channel.

| Teacher | Default role | Scope rule |
| --- | --- | --- |
| ZERO.1 | foundational constraint and historical preservation | eligible only on explicitly mapped foundation-compatible records; otherwise abstains |
| ZERO.2 | specialist or historical-capability teacher | eligible where its frozen channel evaluation demonstrates competence |
| ZERO.3 | integrator, participation teacher, and common anchor | eligible where its frozen channel evaluation demonstrates competence |

No role is inferred from a model name. The teacher-channel evaluation matrix
determines eligibility before ZERO.4 training.

ZERO.1's presence in the set does not force it to vote everywhere. Its tiny
context and vocabulary are declared limitations. Outside a compatible
foundation record its weight is exactly zero.

## 3. Combining the three teachers by channel

For channel `c`, task family `k`, and teacher `i`, the contract declares:

```text
eligible(c,k,i)
role_prior(c,k,i)
reliability(c,k,i)
```

Reliability is measured on a frozen validation split, never the hidden
promotion panel. Initial teacher weights are:

```text
raw_i = eligible_i * role_prior_i * reliability_i
w_i = raw_i / sum(raw)
```

The channel then constructs:

```text
p_channel = sum_i w_i * adapter_i(p_i)
```

This is a probability mixture. ZERO.4 never averages parameters or raw hidden
states.

### 3.1 Abstention and unsupported mass

If a teacher is ineligible, cannot represent the record, or fails a declared
coverage threshold, its allocated loss mass returns to the hard target. It is
not silently reassigned to another teacher. Thus absence of ZERO.1 outside the
foundation channel increases checked-data authority rather than ZERO.3's
authority.

### 3.2 Disagreement

Teacher entropy and pairwise Jensen-Shannon divergence are recorded by channel
and task. High disagreement:

- never reduces hard-target weight;
- can gate the least reliable teacher to zero;
- cannot remove an exact checked target;
- is retained in the report rather than hidden by the mixture; and
- triggers an ablation comparing each teacher alone with the mixture.

No learned router is introduced in ZERO.4. Eligibility and weighting are
frozen tables, making failures attributable.

### 3.3 Complete-chunk proposals

ZERO.2 and ZERO.3 may also propose complete chunks. A proposed proof,
construction, program, or simulation trace becomes an alternate hard example
only after the relevant external validator accepts it. Unchecked teacher prose
remains soft supervision, never synthetic truth.

ZERO.1 supplies only its mapped distribution in ZERO.4 v1; it is not used as a
free-running proposal model.

## 4. Channel-specific loss

ZERO.4 uses one explicit loss table rather than a universal teacher weighting:

```text
L_channel = h_c * CE(hard target, student)
          + z1_c * CE(ZERO.1, student)
          + z2_c * CE(ZERO.2, student)
          + z3_c * CE(ZERO.3, student)

h_c + z1_c + z2_c + z3_c = 1
```

Teacher terms apply only to eligible output positions. Closure, summary,
request, abstention, and repair bytes are part of the hard target.

Safe stage-zero defaults, to be calibrated and frozen before training. A new
channel begins hard-only; teacher mass is unlocked only by a channel-specific
ablation:

| Channel | Hard | ZERO.1 | ZERO.2 | ZERO.3 | Rationale |
| --- | ---: | ---: | ---: | ---: | --- |
| Foundation | 0.60 | 0.25 | 0.05 | 0.10 | preserve ZERO.1 while retaining transformer continuity |
| Logic | 1.00 | 0.00 | 0.00 | 0.00 | current proof probes do not establish held-out teacher competence |
| Literary | 0.65 | 0.00 | 0.20 | 0.15 | preserve literary history and integrated language |
| Participation | 0.70 | 0.00 | 0.10 | 0.20 | both teachers have measured channel behavior; ZERO.3 carries the larger share |
| Quantity/geometry/physics | 1.00 | 0.00 | 0.00 | 0.00 | new checked domains start hard-only |
| Art | 1.00 | 0.00 | 0.00 | 0.00 | scene constraints and attributable preferences exist before model authority |
| Epistemics | 1.00 | 0.00 | 0.00 | 0.00 | generated-world labels begin hard-only |
| Shared synthesis | 1.00 | 0.00 | 0.00 | 0.00 | unlocked only after verified multi-channel episodes exist |

These are priors, not claims that ZERO.2 or ZERO.3 already understand a new
domain. If either teacher performs below the hard-only control on a channel,
its weight becomes zero and returns to `Hard` before the contract is frozen.

## 5. Channel protocol

ZERO.4 preserves the atomic faculty lifecycle:

```text
IDLE
  -> ENTER(channel, task)
  -> EMIT(channel-locked complete chunk)
  -> CLOSE
  -> VERIFY or CRITIQUE
  -> COMMIT | REJECT
  -> IDLE
  -> ENTER(next channel or shared synthesis)
```

A chunk receives the channel's previous rolling summary and outputs:

- an exact artifact or response;
- a proposed updated rolling summary;
- optional queued channel requests; and
- a close marker.

Artifact and summary commit atomically after external validation. Rejection
keeps the old channel summary unchanged. Switching is possible only from
`IDLE`. This prevents the observed logic record from turning into Shakespeare
before the logic chunk has closed.

## 6. Shared channel state

The council stores a tagged table rather than one global average:

```text
foundation    -> summary text, z_foundation, artifact refs, verdict
logic         -> summary text, z_logic, artifact refs, verdict
literary      -> summary text, z_literary, artifact refs, verdict
participation -> summary text, z_participation, artifact refs, verdict
geometry      -> summary text, z_geometry, artifact refs, verdict
...
```

ZERO.4 v1 uses deterministic 256D Holo vectors for indexing. The transformer
reads selected summary text and exact artifacts. Raw ZERO.1/2/3 hidden states
never enter council state because the three latent spaces are not aligned.

Continuous faculty-state prefix tokens remain a later, separately measured
experiment.

## 7. Corpora

Every channel corpus emits complete chunks and, where useful, grouped
multi-channel episodes.

### 7.1 Single-channel records

```text
@enter geometry construct
@memory
the current geometry summary
@input
the bounded task
@output
@artifact
the exact construction
@summary
the proposed new geometry summary
@close
```

The model-facing record is paired with sidecar generator, split, provenance,
validator, teacher-eligibility, and hash metadata.

### 7.2 Multi-channel episodes

A synthetic latent object may generate:

```text
quantity chunk -> geometry chunk -> physics chunk -> art chunk -> synthesis
```

Each chunk remains a separate training sequence under the 512-character
context. The episode manifest records dependencies and committed artifacts.
Downstream exact channels receive exact upstream artifacts, not merely latent
summaries.

### 7.3 Protocol negatives

Generate explicit invalid cases for:

- mid-chunk switching;
- using a rejected artifact;
- mutating another channel's summary;
- summary/artifact contradiction;
- irrelevant faculty requests;
- teacher supervision outside declared eligibility;
- preference presented as proof; and
- synthesis that loses authority labels.

## 8. ZERO.4 phases

### ZERO.4-P — protocol

- freeze chunk and episode schemas;
- implement enter/close/verify/commit/reject transitions;
- add per-channel rolling summaries and artifact references;
- reproduce logic-to-Shakespeare bleed as the failing pre-protocol control;
- require zero illegal switches and zero rejected-state mutations.

### ZERO.4-T — three-teacher calibration

- use the frozen identities in `teachers/registry.json`;
- evaluate each teacher independently on every proposed channel and task;
- measure tokenizer/adapter coverage;
- freeze eligibility, role priors, reliability, disagreement gates, and the
  final channel loss table; and
- run teacher-alone, hard-only, and three-teacher-mixture ablations.

No new mentor checkpoint is trained in this phase.

### ZERO.4-E — episode construction

- convert existing foundation, logic, literary, and participation records to
  atomic channel chunks;
- create a small existing-asset cross-channel protocol suite;
- add synthetic quantity, geometry, physics, epistemic, and art episodes as
  their independent validators become available; and
- freeze latent-unit splits before rendering chunks.

The first student does not wait for every imagined faculty. Its mandatory
channels are foundation, literary, participation, logic, quantity, geometry,
art, and shared synthesis. Physics is admitted only after quantity/units and
geometry transfer pass independently. Epistemics, code, music, and control are
later capacity experiments.

### ZERO.4-S — shared student

- initialize one student from `teachers/zero3-balanced-final.teacher` with a
  fresh optimizer and RNG;
- train with hard channel targets and the three channel-weighted teachers;
- report all three seeds, best and final checkpoints;
- export and evaluate the quantized browser artifact; and
- issue a promotion or measured-capacity verdict.

## 9. Sampling proposal

The first full run samples by channel and task family:

- 50% balanced single-channel and rolling-summary chunks;
- 25% grouped episode and shared-synthesis chunks;
- 15% general literary/channel replay; and
- 10% protocol negative, repair, abstention, and boundary chunks.

The distribution must be frozen before training. Raw corpus byte size never
determines a channel's influence.

## 10. Evaluation

### Teacher-channel matrix

For every channel and task:

- ZERO.1 score and coverage;
- ZERO.2 score;
- ZERO.3 score;
- hard-only student control;
- each teacher plus hard targets;
- all-three virtual mentor; and
- teacher disagreement distribution.

### Protocol

- natural and forced close rates;
- illegal switch rate;
- rejected-state mutation rate;
- channel-summary isolation;
- request precision and dependency order;
- first-try and post-repair validator success; and
- summary/artifact consistency.

### Capability

- exact proof, arithmetic, geometry, physics, code, or epistemic checks where
  applicable;
- author-balanced literary loss and preference;
- channel reply, memory, recall, abstention, and hidden human comparison;
- art constraints, diversity, and attributable preference; and
- shared synthesis attribution and contradiction rate.

No macro score can hide a failed channel.

## 11. Promotion gate

ZERO.4 advances only if:

1. ZERO.1, ZERO.2, and ZERO.3 checkpoint identities and hashes were frozen
   before calibration;
2. every nonzero teacher weight is supported by the public validation matrix;
3. every mandatory channel reports all three seeds and every task family;
4. ZERO.4 retains at least 90% of the best eligible teacher's gain over the
   hard-only/common-anchor control for each mandatory channel;
5. no mandatory channel regresses by more than 2 percentage points;
6. literary validation regresses by no more than 2% relative;
7. at least 99% of bounded chunks close naturally;
8. illegal switches and rejected-state mutations are zero in deterministic
   tests;
9. exact artifacts remain separately verifiable and authority labels survive
   synthesis;
10. the quantized artifact passes the same report; and
11. local model size, memory, and latency remain inside the ZERO browser
    budget.

If ZERO.4 cannot preserve the calibrated channels at 4.85M parameters, that is
a measured capacity result. Parameter scaling becomes a separate frozen
experiment.

## 12. Original launch plan — historical

This was the launch checklist before the pilot and Q1–Q2.2-R experiments. It is
retained as history, not as the current next-action list. Controller fixtures,
pilot generation, initial teacher routing, and quantity experiments are now
implemented; shared multi-faculty episodes, physics, and full promotion remain
open.

1. Treat the immutable three-teacher registry as phase F, now complete.
2. Implement the atomic channel controller and its rejection/switch fixtures.
3. Convert existing foundation, literary, participation, and logic data to the
   chunk schema.
4. Generate split-first pilots: 10k exact quantity records, 10k exact geometry
   records, and 5k symbolic art scene/constraint/revision records.
5. Verify every formal record independently; render art scenes to SVG for
   inspection. Keep human preference labels separate from constraint truth.
6. Evaluate ZERO.1–3 on the frozen validation sets. New domains remain
   hard-only unless an ablation earns teacher mass.
7. Train a short three-seed ZERO.4 protocol/capacity pilot from ZERO.3-final,
   then compare hard-only, eligible single-teacher, and calibrated-mixture
   variants.
8. Add bounded Newtonian physics only if quantity, units, and geometry meet
   their promotion gates.

This pilot answers the defining ZERO.4 question: can exactly three historical
teachers be combined differently by channel while one student preserves clean
chunk boundaries and distinct channel memory, while genuinely new exact
capabilities come from verified data rather than unearned teacher authority?

## 13. Implementation checkpoint — pilot v1

The first implementation pass is complete:

- the atomic controller passes rejection, commit, switch-lock, isolation, and
  deterministic 256D registrar tests;
- 10k quantity, 10k geometry, 5k symbolic-art, and 3k protocol records are
  generated deterministically with promotion records excluded from training;
- all 29,400 canonical records pass their declared checkers and hashes;
- immutable teacher initialization, replay-only teacher eligibility,
  hard-only new channels, and per-file sampling weights are implemented; and
- a quantized promotion evaluator reports closure, grammar, artifacts, chunks,
  and target bits.

Seed 1 was not promoted. Quantity grammar reached 9/20 and geometry 5/20, but
exact artifacts remained 0/20 in every domain, art grammar remained 0/20, and
replay consolidation ended 3.52% above the historical loss baseline. Seeds 2
and 3 were intentionally not run. The next experiment must change the boundary
objective or typed decoding and pass seed 1 before replication. Full results
are in `benchmarks/zero4-pilot-v1/RESULTS.md`.

## 14. Implementation checkpoint — ZERO.4-Q1

The required quantity-only follow-up is complete. Q1 changed the experiment,
not merely its duration:

- quantity was the only new faculty and remained hard-target-only;
- historical replay received frozen ZERO.3 distillation and 15% of samples;
- artifact contents received 4x token loss;
- the decoder used a controller-owned quantity grammar; and
- a semantic arithmetic/unit/equation validator controlled atomic commit.

Seed 1 trained for 4,000 updates from ZERO.3-final; update 3,000 was selected at
weighted validation `0.4924`. On all 500 held-out quantity promotion cases, raw
decoding reached 500/500 syntax and closure but only 20/500 exact and verified
artifacts. Constrained decoding also reached 20/500: grammar eliminated malformed
chunks but did not manufacture arithmetic competence. Invalid results were
rejected rather than committed. Matched historical replay moved from `1.6310`
to `1.6745`, a 2.67% regression against the 2% limit.

Q1 is therefore a measured no-go. Seeds 2 and 3, geometry, art, and physics stay
closed. The 4.85M student learned the interface and target distribution, not a
reliable mixed arithmetic algorithm. The next experiment must be separately
frozen as either a larger student distilled from ZERO.3 or a controller-owned
quantity oracle whose executed artifacts remain explicitly distinct from model
proposals. Full results are in `benchmarks/zero4-q1-v1/RESULTS.md`.

## 15. Implementation checkpoint — ZERO.4-Q2 and teacher router v2

Q2 preserved the immutable ZERO.1, ZERO.2, and ZERO.3 artifacts and implemented
the missing three-way training interface. The trainer can now load ZERO.2 and
ZERO.3 together with the ZERO.1 vocabulary adapter, apply per-corpus routes,
and keep structured protocol tags and executable requests hard-supervised.
No historical teacher was fine-tuned or replaced.

The quantity boundary was changed from model-proposed arithmetic to an
input-bound executable request. A deterministic kernel independently
canonicalizes the source task, rejects changed operations or arguments, and
atomically commits an exact artifact plus `kernel` authority. Its generated
10,000-record train/validation corpus and 500-record promotion set cover
integer addition, multiplication, rational addition, unit conversion, and
linear equations.

Seed 1 trained for 2,000 updates with 60% request records and 40% historical
replay. The best quantized student reached 500/500 natural closes, 500/500
request syntax, and 500/500 operation selection. It copied all numeric
arguments correctly only 1/500 times. Consequently only 1/500 requests could
commit, even though the independent kernel computed 500/500 canonical answers
and all 499 mismatched requests were rejected with zero state mutations.
Historical replay moved from `1.6310` to `1.6751`, a 2.70% regression.

Q2 is a measured no-go and is not replicated. The result identifies a copying
boundary rather than an arithmetic boundary: this 4.85M student reliably
selects the operation but does not preserve arbitrary digit strings. Geometry,
art, and physics remain closed. The next frozen experiment must choose between
controller-side argument binding from the already parsed source, an explicit
copy mechanism, or a larger student; it must report those mechanisms
separately rather than crediting them to neural arithmetic. Full results are in
`benchmarks/zero4-q2-v1/RESULTS.md`.

## 16. Implementation checkpoint — ZERO.4-Q2.1

Q2.1 implemented the controller-side binding option without changing the three
teachers. The student emits a complete operation-only chunk, such as
`@request quantity.add @close`. The controller verifies that operation against
the parsed source, supplies the canonical arguments, and hands the resulting
request to the deterministic kernel. Evaluation keeps model routing,
controller binding, kernel arithmetic, and committed state as separate
channels; no controller or kernel result is credited as neural arithmetic.

The main phase ran 1,000 updates at 40% request and 60% historical replay. A
400-update low-rate consolidation phase shifted to 25% request and 75% replay.
Seed 1 selected update 1,200 and passed: 499/500 exact operation requests and
commits, 500/500 controller bindings and kernel answers, zero rejected-state
mutations, and 1.864% replay regression. Seed 2 selected update 900 and reached
500/500 on every quantity-system gate with zero mutations, but replay regressed
2.011%, above the frozen 2.000% ceiling by 0.011 percentage points. Its final
consolidation checkpoint was worse, so checkpoint substitution did not rescue
the gate.

Q2.1 is therefore a multi-seed no-go. Seed 3 was intentionally not run after
seed 2 failed. This validates the operation/controller/kernel responsibility
split but not a robust replay-preservation schedule. The next frozen experiment
must select checkpoints against both faculty and historical replay or use a
stronger replay-preserving consolidation objective. Geometry, art, and physics
remain closed; ZERO.3 remains the default. Full results are in
`benchmarks/zero4-q21-v1/AGGREGATE.md`.

## 17. Frozen experiment — ZERO.4-Q2.2

Q2.2 keeps Q2.1's 4,852,992-parameter architecture, immutable teachers,
operation-only corpus, loss routes, teacher weights, and initial acquisition
schedule. Its independent variable is checkpoint instrumentation and
constraint-aware selection. It does not introduce a larger student or change
teacher authority.

The runner records training loss plus a deterministic hard-loss
faculty/replay gradient-cosine probe every 10 updates. The probe uses the first
fixed validation record of the quantity channel and rotates across the six
historical replay sources so interference remains attributable. Every 25
updates it evaluates a quantized snapshot on a fixed 64-case validation
sentinel and a small deterministic replay sentinel. Every 100 updates it runs
the full 500-case public quantity validation and matched public replay
evaluation.

A public checkpoint is feasible only when every quantity gate passes and its
replay loss is no more than 1.02 times the immutable ZERO.3 replay baseline.
The retained frontier maximizes the minimum learned faculty-gate margin and
minimizes replay loss, with feasibility included as a non-regressing dimension.
Only feasible or nondominated checkpoints are retained; dominated checkpoint
files are deleted immediately. Final selection considers feasible checkpoints
only, then maximizes the minimum learned faculty-gate margin and breaks ties by
lower replay loss. If no feasible checkpoint exists, the seed is a no-go and
the promotion set remains untouched.

Replay regression above 1.5% raises replay pressure by ratcheting the quantity
sampling weight from 4 to 3 to 2, increasing replay share from 60% to 66.7% to
75%. Two consecutive full evaluations above 2% stop training and
roll selection back to the retained feasible frontier. Once quantity passes
while replay worsens, acquisition ends and the low-rate consolidation phase
begins. A phase also stops after 200 updates without Pareto improvement.

The 500-case promotion split is disjoint from both validation sentinels and is
opened exactly once, after a feasible public checkpoint has been selected and
quantized. To reproduce the recorded repair lineage, run Q2.2 with seed 2 and
then Q2.2-R with seed 2. Seeds 1 and 3 require independent Q2.2 frontiers before
their repair runs.

The first seed-2 report was invalidated before promotion because its replay
adapter removed both distillation and explicit sample weights, accidentally
restoring the trainer's default 2x foundation weight. The fixed adapter removes
only distillation, preserves equal weights across all six historical sources,
and reproduces Q2.1's declared `1.6310` baseline. A regression test freezes this
route. Under the corrected functional, retained updates 300 and 400 were both
jointly feasible on public validation.

### 17.1 ZERO.4-Q2.2-R replay repair

Q2.2-R branched independently from retained updates 400 and 300 with fresh
optimizer and RNG state. It used historical replay only for 100 updates at
`1e-6`, no warmup, no cosine decay, and unchanged teacher weights. Quantity was
checked every 25 updates and the joint public gate every 50.

The selected update-400 branch after 100 repair updates reached 96.6% public
operation accuracy and `1.6623` replay loss, a 1.919% regression. The lower
replay alternative was unrepaired update 300 at 95.8% quantity and 1.858%
replay regression. Feasibility-first selection chose the larger faculty-gate
margin. The disjoint promotion set was then opened once: 488/500 exact
operation requests and commits (97.6%), 500/500 controller bindings and kernel
answers, zero rejected-state mutations, and all replay and quantity gates
passed. This is a seed-2 go only; seeds 1 and 3 remain required before ZERO.4
promotion. Full results are in `benchmarks/zero4-q22r-v1/seed2/RESULTS.md`.

### 17.2 Parallel curriculum experiment — state before modality

The 9,876,800-parameter direct Brainfuck trace specialist is a measured no-go:
balanced samples from both training templates and held-out compositions scored
0/42 exact. Its low `0.4915` teacher-forced validation loss therefore did not
establish executable state composition. The frozen report is
`benchmarks/infinite-monkey-trace10m-v2/RESULTS.md`.

Two self-tested but unintegrated generators define the next controlled
curriculum:

1. `state_corpus.c` teaches modality-neutral named transitions, two-step
   composition, completion, missing-operation recovery, and reversible-state
   recovery, with adjacent operation pairs held out for validation.
2. `brainfuck_corpus --trace-composition` adds program counters, loops, tape
   state, input, output, synthesis, and repair after generic composition passes.
3. `modal_corpus.c` adds finite reachability, possibility, necessity, witnesses,
   and counterexamples only after state composition transfers.

These source files are not yet Makefile targets and have no measured student
checkpoint. They must remain labeled experimental until corpus manifests,
training commands, exact evaluators, and multi-seed results exist.

## 18. Design proposal — ZERO.4-Q2.3 transactional optimizer

Q2.2 showed that more frequent frontier checkpoints avoid a late promotion
surprise, but they still observe damage only after a block of updates. Q2.3
moves measurement to the optimizer boundary while preserving Q2.2's student,
teachers, corpora, authority split, and promotion sets. It is not frozen until
the observer and rollback tests below pass.

The unit of atomicity is a complete optimizer attempt, not an individual
scalar weight. Every attempt computes separate faculty and replay-probe
gradients, an AdamW displacement, and per-tensor contributions to predicted
replay drift:

$$
\widehat{\Delta L_R}=g_R^{\mathsf T}d
=\sum_G(g_R)_G^{\mathsf T}d_G.
$$

The groups are token embeddings, each layer's query/key/value/output
projections, each feed-forward matrix, RMS gains, and final normalization.
These measurements identify where interference occurs without pretending that
one weight has an invariant semantic interpretation.

Candidate weights and AdamW moments live in preallocated shadow storage. A
local replay budget may project or backtrack the candidate; a small functional
probe then decides whether the entire learned state commits. Rejection restores
weights, both moment arrays, and the committed-update count. Attempt count,
sampler position, and RNG advance separately so the same rejected batch is not
retried indefinitely. Exact recovery checkpoints include both learned and
orchestration state.

Q2.3 uses three cadences: an attempt log and drift decomposition every guarded
update, a small shadow functional probe at most every five attempts, and the
existing 25-update recovery / 100-update full frontier evaluations. The local
guard has a nonzero budget; it does not require monotonically improving replay
loss. The frozen 2% replay ceiling remains the final feasibility constraint.

Implementation is staged. First run an observer-only trajectory and establish
whether the first-order signal predicts measured replay changes. Then enable
atomic rollback without projection. Only after both are validated may the
projection or adaptive budget change training. Q2.3 begins with diagnostic
seed 2, and seeds 1 and 3 remain closed until seed 2 produces a jointly feasible
public-validation checkpoint. The promotion panel remains sealed until a
feasible checkpoint is selected. The executable work and acceptance criteria
are tracked in `ZERO4-BACKLOG.md`.

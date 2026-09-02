# Reasoner 5.0 contract-preserved residual-transfer preregistration

## Question

Does frozen learned ranking state reduce exact target search after a task-family
shift when the feature, scoring, and verifier interfaces remain byte-identical?

Reasoner 5.0 separates learned-state transfer from protocol reuse. The learned
artifact must move from source to target unchanged, must be on the measured
candidate-ranking path, and must improve the final deterministic search cost.
The exact verifier retains all authority.

## Frozen substrate

The experiment uses the published Reasoner 4.2 three-entry library with digest
`3cf6bb033d68d2a3`. Programs retain the six registered base operations over
`GF(257)`. Exact program identity remains coefficient-and-offset equality in
every dimension from four through twelve, followed by all 81 zero-and-basis
certificate replays.

## Deployment-exact learned interface

Every candidate is represented by the same 92 signed integer fields during
source learning, target calibration, and held-out execution:

- nine token-count fields;
- 81 ordered token-pair fields;
- one program-length field; and
- one learned-library-use field.

The source artifact is the integer count vector learned from all seven exact
Reasoner 4.2 development solutions. It is hashed and frozen before target
calibration. The target residual has the same schema and may use only the five
registered calibration programs. The deployed score is the integer dot
product of the candidate fields with the frozen source vector plus the target
residual. There is no floating-point, quantized, batched, or alternate runtime
path.

The ranker may only order candidates. It cannot legalize a candidate or commit
an answer. Each expansion performs one exact affine equality check, and only a
full exact match may be accepted.

## Prospective split

The target set is the 17 published Reasoner 4.2 semantic classes whose exact
minimum is three learned-library calls. Classes are ordered by exact semantic
digest. The five lowest digests form target calibration; the remaining twelve
form the held-out set. Each held-out class runs under two frozen tie orders,
giving 24 episodes. Target labels are unavailable to the ranker.

The candidate grammar contains the registered 820 raw three-call programs.
The full model must find every held-out class within 128 exact candidate
expansions per episode.

## Controls

The same episodes repeat with target-only, source-only, inference-time source
ablation, a 17-slot rotation of the frozen source vector, and a runtime feature
mismatch that swaps the first and third library-token fields. An exact oracle
provides the one-expansion lower bound. The raw top-ranked candidate is also
recorded without verifier protection; it must be wrong at least once, proving
that the learned scorer is not itself an authority.

## Frozen gate

A pass requires all 24 held-out identifications, affine replays, applications,
and reports to be exact, with no premature commit. It also requires:

- every full-model episode to remain within 128 expansions;
- aggregate full-model expansions to be no more than 80% of target-only;
- aggregate full-model expansions to be strictly below source-only, shuffled
  source, and runtime-mismatch controls;
- at least twelve individual wins over target-only;
- target-only and shuffled-source controls each to exceed the 128-expansion
  budget at least once;
- at least one invalid unverified top candidate; and
- exactly one oracle expansion per episode.

Failure of any conjunct resolves the experiment as no-go. The gate will not be
changed after the scientific execution opens.

## Execution and interpretation

The user authorized execution of the first five Reasoner 5 experiments. This
contract consumes that authority only for one local deterministic Reasoner 5.0
execution. It authorizes no cloud resources. The run has a 300-second cap, an
exclusive lock, no scientific retry, no post-open tuning, and must publish a
pass or no-go result.

A pass would show that a frozen source-learned ranking artifact causally
reduces verified search on a deeper target family under an identical runtime
contract. It would not show unseen primitives, non-affine transfer, noisy
learning, grounding, or open-ended reasoning.

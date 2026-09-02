# Reasoner 4.0 active-representation preregistration

## Question

Can an exact learner identify a fresh compositional input representation from
opaque raw probes, convert every record to canonical Reasoner IR, and then use
the unchanged Reasoner (3,9) core to identify and apply a familiar law?

This is a bounded representation-transfer question. It is not unsupervised
recovery of an arbitrary latent representation. The learner receives one
initial raw-to-canonical alignment example and may request more alignment
examples while several registered adapter programs remain possible.

## Frozen reasoning core

Reasoner 4.0 embeds the exact `reasoner310.c` implementation. Its development
digest must remain `c16b44a0ab50c456`, with 52 canonical law programs and six
one-fold familiar laws. The contract also pins the SHA-256 digests of
`reasoner310.c` and `reasoner310.h`.

The adapter is outside the core. Raw representation bytes, adapter identity,
and representation depth never enter the Reasoner (3,9) law engine.

## Canonical IR and adapter language

The canonical IR is one of the 32 registered nonnegative vector patterns used
by Reasoner (3,9), extended with zeros through dimensions four to twelve. This
fixes a canonical representative for the coordinate, sign, and translation
equivalences already established by the frozen core.

Raw records are vectors over the prime field 257. The typed adapter language
has six exact reversible operations:

1. reverse the coordinate sequence;
2. rotate the sequence left by one coordinate;
3. replace coordinates with modular prefix sums;
4. apply a reversible shear to adjacent coordinate pairs;
5. add 17 to every field element; and
6. multiply every field element by 3.

The inverse of each operation is exact. Adapter programs contain zero through
three operations. Programs are enumerated by length and byte order, then
canonicalized by their complete encoding behavior over all 288 registered
dimension-vector certificates.

The grammar contains 259 raw programs and 170 semantic classes: one identity,
six one-operation classes, 29 two-operation classes, and 134 three-operation
classes.

## Active alignment protocol

Each episode hides one adapter. The 288 available probes are presented in a
fresh opaque order. The learner receives one zero-vector alignment example.
If more than one adapter class remains, it must call `ALIGN` on the raw probe
whose possible canonical decodings minimize the largest remaining bucket.

An alignment response reveals canonical IR, not an adapter name or a domain
label. `ADAPTER_COMMIT` is forbidden while two adapter classes remain.

After adapter commitment, every raw probe is replayed through the selected
inverse and compared exactly with canonical IR. The selected forward adapter
must also construct every later Reasoner query exactly.

## Frozen law protocol

The target law is one of the six one-fold laws already present in the Reasoner
(3,9) curriculum. The episode supplies two raw comparison demonstrations.
The frozen core keeps its law version space, chooses the registered minimax
comparison query, applies the unique law to raw action candidates, commits,
and reports only after commitment.

This first stage deliberately does not combine unseen representation
composition with unseen law composition. That cross-product belongs to a
later experiment only after Reasoner 4.0 passes a fresh seal.

## Public development screen

The curriculum uses the six individual adapter operations, dimension four,
two opaque probe orders, and all six familiar laws: 72 episodes.

Development uses all 29 canonical two-operation adapters, dimensions five
through eight, two fresh opaque probe orders, and all six familiar laws: 1,392
episodes. Every target adapter is absent from the curriculum.

The gate requires:

- exact adapter canonicalization and a unique minimum representative;
- the frozen Reasoner (3,9) source, digest, grammar, and semantic certificates;
- every active adapter query to match the minimax rule;
- exact replay of all 288 raw probes in every episode;
- every frozen-core query, action, commit, and report to be exact;
- no ambiguous adapter or law commit;
- an oracle-adapter upper bound to pass; and
- identity, curriculum lookup, no-adapter-query, and shuffled-alignment
  controls to fail.

## Planned fresh seal

The planned seal uses all 134 canonical three-operation adapters, dimensions
nine through twelve, two fresh opaque orders, and the same six familiar laws:
6,432 episodes. Every target representation is absent from curriculum and
development as a semantic class.

The sealed evaluator is compiled but locked before evaluation. It requires a
cloud-only environment marker, the exact frozen approval ID, and a new
exclusive execution-lock path.

The user explicitly authorized the exact 50,211-byte source bundle from commit
`73b721a00f8e5737cf0fcfb47b14c90b1e832e70`, SHA-256
`06432af1ef731d637f8fb09a2aaf1d9b1929fd34a2cba40ebae5db6a7fb5afe9`,
and one capped `t3.micro` launch on 2026-09-01. The cap is 900 instance
seconds, $0.003 EC2, and $0.01 total. There is no retry or post-seal tuning.

## Interpretation

A sealed pass would show active compositional induction of an exact input
adapter feeding a frozen reasoning core inside the registered reversible
adapter language. It would not establish arbitrary representation recovery,
new adapter primitives, natural-language grounding, visual perception, or
joint transfer to unseen law compositions.

The authorized one-shot seal passed. See [`RESULT.md`](RESULT.md) and the raw
[`RESULT.json`](RESULT.json).

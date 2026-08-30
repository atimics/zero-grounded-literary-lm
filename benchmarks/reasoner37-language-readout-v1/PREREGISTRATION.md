# Reasoner (3,6) language-readout preregistration

## Question

Can language be trained as a causally downstream readout of a completed
nonverbal reasoning trace, without gaining any path back into reasoning or
tool execution?

Reasoner (3,6) freezes the sixteen Reasoner (3,5) weights:

```text
[0, 4, 0, -4, 0, 0, 0, 0, 3, -2, 0, -2, 0, 4, 4, 0]
```

Those 64 bytes create the full `QUERY`, `APPLY`, `COMMIT` trace before the
language head receives anything. The language head is a separate 96-byte
three-class linear readout. It selects a surface verb from an immutable trace
event. Numeric arguments and verified tool replies are copied into a
controlled sentence and parsed back for exact semantic comparison.

There is no language feature in the reasoner, no shared weight, no gradient
path into the reasoner, and no ability for generated text to call a tool.

## Open development screen

The language head trains only on completed Reasoner (3,5) training traces. It
is evaluated on the disjoint Reasoner (3,5) development suite:

- 216 episodes, including 144 mixed-domain episodes;
- 4,536 immutable trace events; and
- two surface lexicons, producing 9,072 utterances.

Every utterance is parsed into its verb, handle, validity, progress, remaining
obligations, cost, reversal flag, and completion flag. It is exact only if all
fields match the source event.

The development gate passes only if:

- the regenerated Reasoner (3,5) weights match the frozen vector exactly;
- the nonverbal trace is exact;
- all 9,072 parsed utterances match their trace events;
- the trace hash is identical with language disabled, enabled, and replaced
  by an adversarial zero-weight language head; and
- the adversarial language head fails semantic fidelity.

## Sealed combinations

This experiment is downstream of Reasoner (3,5). Its seal must not be
authorized unless the one-shot Reasoner (3,5) sealed gate passes.

The language seal consumes the 2,592 completed Reasoner (3,5) sealed episodes
with five through seven stages. It uses two held-out surface lexicons:

- `probe`, `use`, `answer`; and
- `examine`, `enact`, `close`.

The exact number of trace events and utterances is reported after the one-shot
cloud execution. The gate passes only if every sealed reasoning event remains
exact, both utterances for every event parse back exactly, all three reasoning
trace hashes match, and the adversarial language control fails.

## Interpretation

A pass supports the architecture claim that language can be attached after
reasoning without becoming part of the causal reasoning loop. It would not
show open-ended natural language generation or human-level explanation. The
surface grammar, numeric fields, and vocabulary registries remain controlled.

A failure is final. There is no retry or post-seal tuning.

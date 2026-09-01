# Reasoner 4.1: joint representation and law transfer

Reasoner 4.1 combines the two strongest prior transfer results without
changing either learner. In each episode it identifies a fresh reversible raw
representation and a fresh composed integer law, commits to them separately,
then acts and reports through the joint pair.

```text
opaque raw vectors
        |
        v
active adapter induction -> ADAPTER_COMMIT -> exact replay
        |
        v
active law induction     -> LAW_COMMIT
        |
        v
APPLY -> joint COMMIT -> REPORT(adapter, law)
```

The representation layer is the frozen Reasoner 4.0 learner. The law layer is
the frozen Reasoner (3,9) learner. The contract pins both source layers and
their public development digests. Law evidence is not processed until after
the adapter commitment, and all 288 raw probes must replay exactly before the
law can be accepted. This makes each identity independently testable and
prevents an adapter error from being hidden by a compensating law.

The public screen passed exactly:

- 72 curriculum episodes over 36 primitive adapter-law pairs;
- 3,480 development episodes over all 435 unseen two-by-two pairs;
- all 1,002,240 raw-to-IR replays;
- all 3,480 adapter queries and all 13,340 law queries;
- all 3,480 adapter commits and all 3,480 law commits;
- all 10,440 actions, 3,480 joint commits, and 3,480 reports;
- no premature adapter, law, or joint commitment;
- no more than one adapter query or five law queries per episode; and
- oracle adapter and oracle law controls pass, while identity adapter,
  curriculum pair, no adapter query, no law query, shuffled alignment, and
  shuffled law feedback controls fail.

Run the public gate with:

```sh
make reasoner41-check
./reasoner41 development
make reasoner41-contract-check
```

The unopened seal crosses all 134 three-operation adapters with all 31
three-fold laws in dimensions nine through twelve and two new opaque orders.
It contains 4,154 fresh pairs and 33,232 episodes. Local execution is refused,
the evaluator requires an exact approval ID and exclusive execution lock, and
no sealed case has been evaluated. The current contract still authorizes no
cloud execution.

The public result is evidence for simultaneous, factorized transfer inside
the two registered finite languages. It is not sealed evidence and does not
show transfer outside either grammar, noisy learning, new primitives,
natural-language grounding, or open-ended reasoning. See the
[`preregistration`](../benchmarks/reasoner41-joint-transfer-v1/PREREGISTRATION.md)
and [`frozen contract`](../benchmarks/reasoner41-joint-transfer-v1/contract.json).

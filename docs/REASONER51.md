# Reasoner 5.1: unseen primitives behind a verified adapter

Reasoner 5.1 asks whether source knowledge can survive new primitive names when
their behavior can be recovered exactly.

```text
known source programs -> learn semantic-class ranker -> freeze
                                                    |
opaque target primitive -> exact query adapter -----+
                                                    |
                                                    v
                                      order candidate programs
                                                    |
                                                    v
                                         exact affine verifier
```

The source artifact contains only integer counts over broad semantic classes:
bias, scale, permutation, mixing, and identity. The target adds two opaque
primitive IDs. A four-query reconstruction finds each primitive's exact affine
meaning, and three independent challenges must verify it before the ranker may
use its class. The ranker orders candidates but cannot accept one.

The [contract](../benchmarks/reasoner51-unseen-primitive-v1/contract.json) and
[preregistration](../benchmarks/reasoner51-unseen-primitive-v1/PREREGISTRATION.md)
freeze 24 episodes, seven causal controls, and a pass-or-no-go gate. The user
authorized one deterministic local execution. Ordinary self-tests do not open
the scientific target; execution also requires an approval marker and a fresh
exclusive lock.

# Reasoner 5.0: contract-preserved residual transfer

Reasoner 5.0 is the first direct learned-state transfer test in the Reasoner 5
series. It asks whether a small source-trained integer ranker remains useful on
a deeper target family when its feature and execution contracts do not change.

```text
source exact solutions -> learn integer ranker -> freeze and hash
                                               |
target calibration -> learn small residual ----+
                                               |
                                               v
                                order verified candidates
                                               |
                                               v
                                  exact affine verifier
```

This structure keeps the learned component on the measured causal path while
preventing it from accepting an invalid answer. Search cost, rather than an
internal representation score, is the transfer measurement.

The experiment is prospectively frozen in the
[`contract`](../benchmarks/reasoner50-residual-transfer-v1/contract.json) and
[`preregistration`](../benchmarks/reasoner50-residual-transfer-v1/PREREGISTRATION.md).
It is authorized for one deterministic local execution. The evaluator builds
the frozen source artifact, target residual, six causal controls, exact affine
replays, and a pass-or-no-go result record. Ordinary self-tests exercise only
the preflight; the scientific target remains behind the approval marker and an
exclusive execution lock.

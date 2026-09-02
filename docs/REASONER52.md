# Reasoner 5.2: nonlinear depth transfer

Reasoner 5.2 moves beyond affine maps. It learns a small integer ranker from
two-operation polynomial programs over the 17-element field, freezes it, then
asks whether that state reduces exact search over three-operation nonlinear
programs.

```text
short nonlinear source programs -> frozen transition ranker
                                             |
two target observations ---------------------+
                                             |
                                             v
                                order 512 candidates
                                             |
                                             v
                              exact 17-point verifier
```

The learned component only orders candidates. Exact equality across the whole
finite domain is the only acceptance rule. The
[contract](../benchmarks/reasoner52-nonlinear-depth-transfer-v1/contract.json)
and [preregistration](../benchmarks/reasoner52-nonlinear-depth-transfer-v1/PREREGISTRATION.md)
freeze 24 episodes, seven causal controls, and one pass-or-no-go execution.

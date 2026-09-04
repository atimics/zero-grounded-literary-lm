# Reasoner 5.7: active evidence selection scaffolding

Reasoner 5.7 studies whether source experience can improve the choice of four
input-and-sensor reads on new program families. It inherits the exact GF(17)
semantic universe and the frozen observation model from Reasoner 5.6. Every
answer still passes the exhaustive exact verifier.

The current branch contains development scaffolding. Its scientific
prerequisite is pending. The corrected Reasoner 5.6 assessment uses 99
independent calibration program families and reports a one-sided 95 percent
Wilson lower bound of 0.9733982695. Its development interface, template proxy,
severity proxy, and source-isolation checks pass. The prospective sealed
interface and static-metadata proxy audit remains pending. R5.7 development
fixture generation starts after that audit passes.

## Analytic query controls

Both strong analytic controls use the full R5.6 local-emission and first-order
transition scores. For a current posterior `p(h)`, action `a`, and outcome `y`,
the code first computes:

```text
r(h, y | a) = exp((local_log_q20 + transition_log_q20) /
                  temperature_q20)
L(h, y | a) = r(h, y | a) / sum_z r(h, z | a)
q(y | a) = sum_h p(h) L(h, y | a)
p(h | y, a) = p(h) L(h, y | a) / q(y | a)
```

The outcome set has 18 members: values 0 through 16 and missing as outcome 17.
Every hypothesis likelihood row is normalized across all 18 outcomes.

The multiclass noisy-GBS score is:

```text
1 - max_y q(y | a)
```

The posterior-L2 EC2 edge-cut score is:

```text
sum_y q(y | a) sum_h p(h | y, a)^2 - sum_h p(h)^2
```

Each control maximizes its score. Equal scores use canonical input-then-sensor
order. The native test has two-hypothesis examples that reverse the earlier
clean max-mass and disagreement-times-reliability proxy choices. It also tests
all 18 outcomes and rejects a likelihood row whose mass differs from one.

## Current boundary

The branch keeps sealed execution closed. It carries no R5.7 development
result, raw trace, shared-harness result, or scientific decision. After the
R5.6 prerequisite passes, the next layer will add shared-harness replay, run
the frozen development crossing, and publish its truthful pass or no-go
result. The current contract already binds the exact R5.6 artifact,
family-manifest, assessment, and channel-readiness assessment receipts.

# Reasoner (3,5) sealed result

Decision: **go** for task-blind tool routing and unlock Reasoner (3,6).

The one authorized cloud execution opened the seal once. The same 64-byte
policy selected every `QUERY`, `APPLY`, and `COMMIT` call exactly without a
task label, domain feature, task classifier, policy switch, or alternate
weight bank.

## Result

| Measure | Exact result |
| --- | ---: |
| Sealed episodes | 2,592/2,592 |
| Mixed-domain episodes | 1,728/1,728 |
| Tool decisions | 79,536/79,536 |
| Stage-level handle permutations | 15,552/15,552 |

The routed 192-byte positive control passed. The zero-weight policy and the
shuffled-tool-feedback control failed. The shared policy therefore needed
both its learned 64-byte rule and correctly bound tool replies.

The frozen weights were:

```text
[0, 4, 0, -4, 0, 0, 0, 0, 3, -2, 0, -2, 0, 4, 4, 0]
```

## Interpretation

This is positive evidence that the three finite reasoning domains can use one
task-blind nonverbal tool protocol. It closes the separate-adapter loophole in
Reasoner (3,4) for this benchmark.

The result does not establish unrestricted tool discovery or general
reasoning. The integer observation record and `QUERY`, `APPLY`, `COMMIT`
protocol remain fixed. The preregistered next test is Reasoner (3,6), which
freezes this trace and tests whether language can remain causally downstream.

## Execution receipt

- Run: `reasoner36-task-blind-20260830-b26bd62`
- Approval: `reasoner36-next-set-2026-08-30-v1`
- Source commit: `b26bd62ee11dba7341d227c2c4cb1f2a2568da65`
- Source SHA-256: `a34fb5827ee1740fc39e1e161b64512008a52b9a10219eb9844e8c4f2a737d4e`
- Contract SHA-256: `379a63b8098164f0aebfab659ef6e79c582d7fb979bf9514d74d86f5af0bd464`
- Result SHA-256: `9f00ef30e4a815bbcc88683f74a65c39d62358476f8023bc1ce3d293ccbd2597`
- Result digest: `027b957dcd200385`
- Instance: `i-02bfee853d8406ddd` (`t3.micro`, terminated)
- Elapsed instance time: 87 seconds
- Estimated EC2 compute: $0.000251333333
- Maximum authorized instance time: 1,800 seconds
- Maximum authorized EC2 compute: $0.006
- Maximum authorized total run spend: $0.01

The launch, status, result, sealed summary, and bootstrap log remain under the
private result prefix
`experiments/reasoner36-task-blind-tools-v1/reasoner36-task-blind-20260830-b26bd62/`.
The bootstrap log has SHA-256
`6fe9ba0e101b306e1416feca50ace13ce840d24998ca605bb5cd5d39d642b6fb`.

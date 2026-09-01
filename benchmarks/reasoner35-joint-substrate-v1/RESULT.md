# Reasoner (3,4) sealed result

Decision: **go** for the joint-substrate hypothesis.

The one authorized cloud execution opened the seal once. The same 64-byte
policy passed every planning, composition, and witness-repair case. It used no
task bit, task classifier, policy switch, or alternate weight bank.

## Result

| Sealed slice | Exact result |
| --- | ---: |
| Eight-gate courier worlds | 40,320/40,320 |
| Planning steps and relabeled steps | 1,330,560/1,330,560 each |
| Four-module composition programs | 63/63 |
| Composition relabelings | 252/252 |
| Four-dimensional witness programs | 4,095/4,095 |
| Witness repair decisions | 4,877,336/4,877,336 |
| Witness coordinate permutations | 471,040/471,040 |

Joint cyclic training converged in four epochs with 68 mistakes. The three
independent 64-byte policies passed as a 192-byte positive control. The
sequential no-replay control failed, and the zero policy passed zero tasks.

The shared weights were:

```text
[0, -1, -2, 3, 13, -7, -1, -2, 1, 7, 3, 2, 4, 2, 4, 2]
```

## Interpretation

This is positive evidence that these three finite reasoning abilities can
share one small learned scoring substrate without representation
interference. The sealed combinations were larger or structurally different
from the open training cases, and every exact check passed.

The result is narrower than general reasoning. Each domain still has a frozen
adapter that converts its state and candidate actions into the common sixteen
integer features. The run does not test language, task discovery, learned
routing, neural scaling, or a new fourth reasoning family. The next gate
should change one of those boundaries instead of adding more cases from the
same three finite families.

## Execution receipt

- Run: `reasoner35-joint-20260830-1e57af2`
- Approval: `reasoner35-next-set-2026-08-30-v1`
- Source commit: `1e57af2da83a76ea0fba0046b8a16fc6a9a3cda8`
- Source SHA-256: `aa6f52da4b44e4d6e302fef665e012e06405a7b34079b7db73048724f3401166`
- Contract SHA-256: `c42012a1ad593cdbb187ba02371c539ffcbc3185cd3cd8818d985f0e2e1c33af`
- Result SHA-256: `b3690448ebb3740b8d1839a3d8091e8bb60330f2c81318513c6af9b6ab901072`
- Result digest: `f047931eefa1e819`
- Instance: `i-005d04a263c87109f` (`t3.micro`, terminated)
- Elapsed instance time: 504 seconds
- Estimated EC2 compute: $0.001456
- Maximum authorized instance time: 1,800 seconds
- Maximum authorized EC2 compute: $0.006
- Maximum authorized total run spend: $0.01

The launch, status, result, sealed summary, and bootstrap log remain under the
private result prefix
`experiments/reasoner35-joint-substrate-v1/reasoner35-joint-20260830-1e57af2/`.
The bootstrap log has SHA-256
`1f038d5681e0eac94d5e9e8b6bbaac18581305230ecd29f545fd15c6dd4c2545`.

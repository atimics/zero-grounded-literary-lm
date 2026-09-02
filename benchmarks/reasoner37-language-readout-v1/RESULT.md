# Reasoner (3,6) sealed result

Decision: **go** for the causally downstream language-readout architecture.

The one authorized cloud execution opened the language seal once. The frozen
64-byte Reasoner (3,5) policy produced the complete nonverbal trace before the
96-byte language head ran. Every sealed trace event and every parsed language
rendering was exact.

## Result

| Measure | Exact result |
| --- | ---: |
| Sealed reasoning episodes | 2,592/2,592 |
| Mixed-domain episodes | 1,728/1,728 |
| Immutable reasoning events | 79,536/79,536 |
| Held-out controlled-language utterances | 159,072/159,072 |

The sealed reasoning trace hash was `81f65eb3c3d20aa4`. It was identical with
language disabled, with the trained language head enabled, and with an
adversarial zero-weight language head. The adversarial language failed
semantic fidelity while the reasoning trace remained unchanged.

## Interpretation

This is positive evidence for the tested architecture boundary: language can
be attached after verified nonverbal reasoning without gaining a causal path
back into reasoning or tool execution.

The result is not evidence for open-ended natural language generation. The
language head selects controlled verbs and copies verified integer fields from
an immutable trace. The grammar and vocabulary registries are fixed. A future
experiment must increase linguistic freedom while preserving the same trace
isolation test.

## Execution receipt

- Run: `reasoner37-language-20260830-06adde5`
- Approval: `reasoner37-next-set-2026-08-30-v1`
- Required Reasoner (3,5) result SHA-256: `9f00ef30e4a815bbcc88683f74a65c39d62358476f8023bc1ce3d293ccbd2597`
- Source commit: `06adde505c47802d80148c0b93ff70b2c749034b`
- Source SHA-256: `e43419a197ffd9e38becc30eae22de14a0b534db9b30c3ce34b597328ec76964`
- Contract SHA-256: `0d06bf02dea50b9a075d1a6897d8d6e58fbde61f07a16b631e43e0b3b1e2fd58`
- Result SHA-256: `71b49683d392228f871211ee9283207055500a9d3ea3852a9ab651ab60954b70`
- Result digest: `59494b2ef3a7bb38`
- Instance: `i-0c40258133e89909b` (`t3.micro`, terminated)
- Elapsed instance time: 208 seconds
- Estimated EC2 compute: $0.000600888889
- Maximum authorized instance time: 1,800 seconds
- Maximum authorized EC2 compute: $0.006
- Maximum authorized total run spend: $0.01

The launch, status, result, sealed summary, and bootstrap log remain under the
private result prefix
`experiments/reasoner37-language-readout-v1/reasoner37-language-20260830-06adde5/`.
The bootstrap log has SHA-256
`09e276a349ca69c236e6c61f0d640468c47651f4526f389a7291ee25f06dc8d7`.

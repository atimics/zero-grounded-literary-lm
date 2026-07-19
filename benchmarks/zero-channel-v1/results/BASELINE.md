# ZERO channel baseline

Frozen benchmark: `zero-channel-v1` (2026-07-16). Model: 4,852,992 parameters, context 512, update 14,500.

A contrast win means the checkpoint assigned fewer teacher-forced bits per target byte to the coherent continuation than to its matched negative. Holo scores exercise the deterministic external recall index and its abstention threshold; they do not alter the transformer weights.

| Runtime mode | Contrast wins | Win rate | Preferred bits/byte | Mean margin | Holo checks |
| --- | ---: | ---: | ---: | ---: | ---: |
| transcript | 13/18 | 72.2% | 2.415 | 0.408 | n/a |
| recurrent | 17/24 | 70.8% | 2.552 | 0.274 | n/a |
| flat | 17/24 | 70.8% | 2.552 | 0.274 | 7/8 |
| partitioned | 17/24 | 70.8% | 2.552 | 0.274 | 5/8 |

## Task-family wins

| Task | transcript | recurrent | flat | partitioned |
| --- | ---: | ---: | ---: | ---: |
| reply_edge | 1/3 (0.057 total margin) | 1/3 (0.051 total margin) | 1/3 (0.051 total margin) | 1/3 (0.051 total margin) |
| speaker_role | 2/3 (1.882 total margin) | 2/3 (1.835 total margin) | 2/3 (1.835 total margin) | 2/3 (1.835 total margin) |
| continuity | 2/3 (0.512 total margin) | 3/3 (0.576 total margin) | 3/3 (0.576 total margin) | 3/3 (0.576 total margin) |
| contradiction | 2/3 (0.869 total margin) | 2/3 (0.788 total margin) | 2/3 (0.788 total margin) | 2/3 (0.788 total margin) |
| style | 3/3 (2.094 total margin) | 3/3 (2.094 total margin) | 3/3 (2.094 total margin) | 3/3 (2.094 total margin) |
| abstention | 3/3 (1.935 total margin) | 3/3 (1.985 total margin) | 3/3 (1.985 total margin) | 3/3 (1.985 total margin) |
| memory_retain | n/a | 2/3 (-0.337 total margin) | 2/3 (-0.337 total margin) | 2/3 (-0.337 total margin) |
| memory_forget | n/a | 1/3 (-0.416 total margin) | 1/3 (-0.416 total margin) | 1/3 (-0.416 total margin) |

## Interpretation

The current quantized checkpoint clears most corpus-proxy dialogue contrasts, but this is not yet evidence of robust dialogue understanding. Transcript mode intentionally omits the six lossy-memory targets. Recurrent, flat, and partitioned modes share the same transformer context in this frozen pass, so their contrast scores match unless a recalled echo is injected. The separate Holo checks expose that distinction: flat recall passes more of this small suite than the first partitioned routing design.

The benchmark is public and small. Use it to catch regressions and to compare the fixed four-way training ablation; retain a separate hidden, human-reviewed channel set for promotion decisions.

## Integrity

- Cases SHA-256: `7656119216740edead8d432919fa37be1e3623cc5dee45a2bd6a75849f4b8c49`
- Holo SHA-256: `e0b6db9e5692e55f07a022cad4941b0af2be587ead0d1a2743de9380d0f18981`
- Baseline model SHA-256: `05b9824d54f9d290ea472c3da8f9791c3d18fb3775419bd408a7e803012c7c24`
- Result model FNV-1a-64: `893902e1eb27be4d`


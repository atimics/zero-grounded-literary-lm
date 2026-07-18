# ZERO.4-Q1 seed 1

Decision: **no-go**.

This experiment trains only the quantity faculty, weights artifact contents 4x,
keeps new-domain targets hard-only, distills ZERO.3 only on historical replay,
and applies a controller-owned quantity grammar plus an independent semantic
validator before commit.

| Gate | Result | Required | Pass |
| --- | ---: | ---: | :---: |
| Exact artifacts | 20/500 (4.0%) | 95.0% | no |
| Semantically verified | 20/500 (4.0%) | 95.0% | no |
| Typed syntax | 500/500 (100.0%) | 100.0% | yes |
| Controller closure | 500/500 (100.0%) | 100.0% | yes |
| Natural artifact boundary | 500/500 (100.0%) | 99.0% | yes |
| Historical replay loss | 1.6745 (2.7% vs 1.6310) | <= 2.0% regression | no |

Raw unconstrained decoding produced 20/500 exact and
20/500 semantically valid artifacts. The constrained
result is not silently accepted: invalid arithmetic is rejected and does not mutate
faculty state.

Model update: 3000; SHA-256: `791d2ce2e94abeab2f22bc76c903b6a525d0515a3506046e95daea28b624273e`.

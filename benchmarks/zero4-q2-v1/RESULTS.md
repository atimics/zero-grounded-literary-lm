# ZERO.4-Q2 seed 1

Decision: **no-go** for this seed; not promotion-eligible until all three seeds pass.

The model emits a typed request bound to the source input. The controller rejects changed operations or arguments without mutating state. A deterministic quantity kernel—not the model—computes the committed artifact.

| Gate | Result | Required | Pass |
| --- | ---: | ---: | :---: |
| Natural close | 100.0% | 99.0% | yes |
| Request syntax | 100.0% | 99.0% | yes |
| Operation extraction | 100.0% | 95.0% | yes |
| Argument extraction | 0.2% | 95.0% | no |
| Exact bound request | 0.2% | 95.0% | no |
| Oracle arithmetic | 100.0% | 100.0% | yes |
| Atomic commit | 0.2% | 95.0% | no |
| Exact committed artifact | 0.2% | 95.0% | no |
| Rejected state mutations | 0 | 0 | yes |
| Historical replay loss | 1.6751 (2.7% vs 1.6310) | <= 2.0% regression | no |

Teacher hashes remain unchanged. ZERO.1 is routed only to foundation, ZERO.2 to literary replay, ZERO.3 to compatible replay and initialization, while executable requests and protocol tags remain hard-supervised.

Model update: 2000; SHA-256: `8c514ebc6e9f43aab7c68214c14cd1bf785c375ddb2bfefff2d50f263d09595a`.

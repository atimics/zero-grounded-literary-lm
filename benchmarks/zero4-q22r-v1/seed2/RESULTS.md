# ZERO.4-Q2.2-R seed 2

Decision: **go** for this seed; not promotion-eligible until all three seeds pass.

The model emits only a typed operation. The controller independently parses and binds arguments from the source task, rejects a mismatched operation without mutation, and passes the canonical request to the deterministic kernel. Controller binding and kernel arithmetic are not credited to the model.

| Gate | Result | Required | Pass |
| --- | ---: | ---: | :---: |
| Natural close | 100.0% | 99.0% | yes |
| Request syntax | 100.0% | 99.0% | yes |
| Operation extraction | 97.6% | 95.0% | yes |
| Controller source-argument binding | 100.0% | 95.0% | yes |
| Exact model operation request | 97.6% | 95.0% | yes |
| Oracle arithmetic | 100.0% | 100.0% | yes |
| Atomic commit | 97.6% | 95.0% | yes |
| Exact committed artifact | 97.6% | 95.0% | yes |
| Rejected state mutations | 0 | 0 | yes |
| Historical replay loss | 1.6623 (1.9% vs 1.6310) | <= 2.0% regression | yes |

Teacher hashes remain unchanged. ZERO.1 is routed only to foundation, ZERO.2 to literary replay, ZERO.3 to compatible replay and initialization, while executable requests and protocol tags remain hard-supervised.

Model update: 100; SHA-256: `0fe6e507f8d8ae5bc51e615be79b72425410664976ecc4fbeebb594319f67e8d`.

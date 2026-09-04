# Reasoner 5.8 development result

This development fixture completed 12 target families and 504 arm episodes.
All answers passed the exhaustive 17-point verifier. All injected wrong first
candidates were rejected. Every primary row used its complete parent-gated
bottom-up proposal queue. The separate adversarial fixtures passed the
canonical fallback, cap-plus-one, and complete-exhaustion checks.

The frozen behavior guide used 377 semantic partial-program pops. The
source-free guide used 371. Their family-weighted geometric mean ratio was
`1.0185216404`. The 99 percent one-sided upper ratio was `1.4160032593`.
The frozen guide won six families, tied one, and lost five. Its win rate was
`0.5000000000`, with Wilson lower bound `0.2855348544`.

The source-free median was 32 pops, so the fixture cleared its measurement
floor of 16. The full median was 24.5 pops. Target-only size enumeration had a
median of 167 pops. The behavior-off arm used 524 pops. Its geometric mean
ratio over the full guide was `1.5072880390`, with one-sided lower ratio
`1.2592785059`.

The per-shift totals were:

| Shift | Full | Source-free |
|---|---:|---:|
| Known operation in a new composition | 66 | 78 |
| Changed semantic class order | 68 | 37 |
| New cross-class composition | 132 | 125 |
| Longer tree and deeper partial chain | 111 | 131 |

The common development gate returned `no-go`. The open checks were the primary
ratio, primary upper confidence limit, family win rate, Wilson lower limit,
and every-stratum effect. The behavior mechanism and 31-way derangement checks
passed. This is useful engineering evidence: the implementation, exactness,
mechanism contrast, and two shift directions are ready, while the registered
common effect needs stronger and larger development evidence before a sealed
plan.

Integrity receipts:

- source artifact SHA-256:
  `090f07100c33eee75f9d50bcb0aee9aeba6fc055758ceab229a564b6a245ce57`
- source-count receipt SHA-256:
  `b0227745fc3ac7a634593b69807507acf002466ef8e56751bdbebef989193b88`
- manifest SHA-256:
  `8c32a690a3067930b5b4ecb78658fdc161f204012521ebbf863a7625fa7f0447`
- canonical raw trace SHA-256:
  `6f543d210a559617ed3dc51ca681121043f9b44cfc9a46d7fa1068496d992ad7`
- result SHA-256:
  `c530a7c2469adf77d123f2bf9235d651cbbfa778be3b3ebbac7f41440a5e52f1`

The sealed lane remains a seed-free family registration. Scientific execution
requires a later contract and explicit approval.

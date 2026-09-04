# Reasoner 5.8 development result

This development fixture completed 12 target families and 504 arm episodes.
All answers passed the exhaustive 17-point verifier. All injected wrong first
candidates were rejected. The target-only arm entered charged fallback in all
12 families.

The frozen behavior guide used 166 semantic partial-program pops. The
source-free guide used 256. Their family-weighted geometric mean ratio was
`0.6565654090`. The 99 percent one-sided upper ratio was `1.2348172959`.
The frozen guide won seven families, tied one, and lost four. Its win rate was
`0.5833333333`, with Wilson lower bound `0.3559810149`.

The source-free median was 17 pops, so the fixture cleared its measurement
floor of 16. The behavior-off arm used 236 pops. Its geometric mean ratio over
the full guide was `1.5363147866`, with one-sided lower ratio `1.0691052089`.

The per-shift totals were:

| Shift | Full | Source-free |
|---|---:|---:|
| Known operation in a new composition | 42 | 29 |
| Changed semantic class order | 36 | 37 |
| New cross-class composition | 50 | 109 |
| Longer tree and deeper partial chain | 38 | 81 |

The common development gate returned `no-go`. The open checks were the primary
upper confidence limit, family win rate, Wilson lower limit, every-stratum
effect, and derangement randomization. This is useful engineering evidence:
the implementation, exactness, mechanism contrast, and two harder shift
directions are ready, while the registered common effect needs stronger and
larger development evidence before a sealed plan.

Integrity receipts:

- source artifact SHA-256:
  `090f07100c33eee75f9d50bcb0aee9aeba6fc055758ceab229a564b6a245ce57`
- source-count receipt SHA-256:
  `b0227745fc3ac7a634593b69807507acf002466ef8e56751bdbebef989193b88`
- manifest SHA-256:
  `e79ccf2791185bb28b6b847c60b25f388ad673bf0687fb9e129b78ddf4be5126`
- canonical raw trace SHA-256:
  `c4d697f9276dd2488e31757e64a90606a8d7407022f528660f4d06594b4d3b4b`
- result SHA-256:
  `5385c28f6ba0e01ffede7baa5c8303c9af68701e4540fa102c3d587e1a3112bb`

The sealed lane remains a seed-free family registration. Scientific execution
requires a later contract and explicit approval.

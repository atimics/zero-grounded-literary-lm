# Reasoner 4.2 public development result

The exact abstraction-library development gate **passed**.

- Result digest: `ac7837bdb3030663`
- Library digest: `3cf6bb033d68d2a3`
- Base grammar: 259 raw programs, 170 exact semantic classes
- Learned library: three entries, nine uses, net curriculum MDL gain 3
- Development grammar: 91 raw programs, 74 exact semantic classes
- Held-out development: seven target classes and 14 episodes
- Base description: 28 operation tokens
- Library description: 14 calls plus six frozen definition tokens
- Exact certificate replays: 729 curriculum and 1,134 development
- Exact applications: 27 curriculum and 42 development
- Maximum active queries: one

The exact affine certificate, frozen base, library discovery, library freeze,
compression, and search-budget certificates all passed. The semantic-oracle
control passed. No-library, shuffled-curriculum, single-use-library,
curriculum-lookup, and no-query controls all failed as required.

The library-guided search stays within 91 raw candidates. The corresponding
base-only depth-four search requires 1,555 raw candidates, so it exceeds the
frozen 100-program development budget.

The frozen seal plan has 17 target classes, 51 library calls, and 102 expanded
base operations. Its evaluator is implemented, but those targets have not
been evaluated. Sealed execution remains unauthorized, cloud-only, one-shot,
and locked.

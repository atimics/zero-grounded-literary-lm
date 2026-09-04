# Reasoner 5.5 development fixture

Status: development-only

This deterministic fixture qualifies the generated primitive domain, exact
adapter, search arms, and trace contract before preregistration.

## Checks

| Check | Development value |
| --- | ---: |
| Source families | 128 |
| Target families | 8 |
| Fixed generator environments | 4 |
| Independent source-to-target environment-family units | 16 |
| Episodes after two nested tie repeats | 32 |
| Raw arm rows | 1,280 |
| Exact adapter reconstructions | 8 / 8 |
| Adapter domain checks | 8,000 |
| Paired generator sequences that differ | 4 / 4 |
| Syntax-to-semantic collisions across target families | 8,736 |
| Unique source/development AST fingerprints | 136 / 136 |
| Unique source/development behavior fingerprints | 136 / 136 |
| Invalid-first rejections | 1,280 / 1,280 |
| Exact final answers | 1,280 / 1,280 |
| Source-ablation path matches | 32 / 32 |
| Full-to-oracle path matches | 32 / 32 |
| Target-only cost range | 2 to 29 |
| Target-only median | 19 |
| Registered fixture headroom | pass |

## Arm totals

| Arm | Distinct semantic verifier checks |
| --- | ---: |
| Target only | 583 |
| Adapter only | 583 |
| Raw lexical guide | 393 |
| Full semantic transfer | 407 |
| Oracle adapter | 407 |
| Frequency lexical guide | 419 |
| Source-free just-in-time guide | 380 |
| Source ablation | 380 |
| Source only | 42,237 |
| Median of 31 shuffled guides | 468 |

These values guide development choices. A future preregistered run will make
the sealed decision. The stronger source-free development comparator is
`source_free_jit`. The frozen selection uses the paired log cost across all 16
source-to-target environment-family units. Its geometric mean ratio to
`target_only` is 0.6036.

## Registered development analysis

The analysis uses an intersection-union rule. Every component must pass.

| Component | Point estimate | One-sided upper limit | Development result |
| --- | ---: | ---: | --- |
| Full vs adapter-only cost ratio | 0.7034 | 0.9898 | no-go |
| Full vs `source_free_jit` cost ratio | 1.1654 | 1.8793 | no-go |
| Factorial log interaction | 0.1963 | 0.7111 | no-go |

The final development decision is **no-go**. The simple effect won 13 of 16
environment-family units. Its Wilson lower limit is 0.6121. Its
syntax-first target stratum misses the registered stratum gate. The
operational comparison won 5 of 16 units. Its Wilson lower limit is 0.1613.
It also misses the registered point, interval, win, and stratum gates.

The raw-lexical-to-full mechanism ratio is 0.8218. Its lower limit is 0.5932.
The full arm beats the frozen shuffled-guide median. Its randomization p-value
is 0.34375, so the randomization gate stays closed. These results are
development evidence. The sealed lane stays closed.

Every raw row includes a source artifact digest and a hash-bound replay
preimage. The manifest replay regenerates each family from its seed and the
frozen generator logic. The checker independently reconstructs all candidates,
ranks, fallback steps, and exact-verifier outcomes. It validates all 1,280 rows
with the strict shared Reasoner 5 schema. A one-to-one scientific view then
restores the four source-to-target environments. The view binds the native
trace, the transform function, and one identity digest for every input row.

## Receipts

- Source artifact bytes: 1,823
- Source artifact SHA-256:
  `a7b0caee7dcf4291828551baab8dcff2b63871e1bf075cd6296d4705b794ff32`
- Raw trace SHA-256:
  `60f0886ec2291374c5a46c7ee69d104b2486f9962cc8833718178543c9f30287`
- Shared coverage SHA-256:
  `5aeea10bd3eabc75e9eb03ac10dac43ff2639702e978ffc145359e30f70b5e30`
- Replayed common result SHA-256:
  `cccec48984de604b1e51444a480f54136807920c1e33c4cd5a31803d6c9b62a5`
- Intersection-union analysis SHA-256:
  `2e9b806a60de70f5403419e00e37549ba4cdaa4f22c1565c4e1a21a58a79e3ab`
- Development analysis file SHA-256:
  `42e3ef65e7b5c0ac6a6d15765ff2331df2c7b39f448b3ff4a9b164d30f26d5d5`
- Scientific analysis-view receipt SHA-256:
  `d294335ce06ea744d81ec97ab52a8849dde7e0623700b08d4ef2f43475bffe98`

The machine-readable files are
[`DEVELOPMENT.json`](DEVELOPMENT.json),
[`DEVELOPMENT-ANALYSIS.json`](DEVELOPMENT-ANALYSIS.json),
[`DEVELOPMENT-TRACE.jsonl`](DEVELOPMENT-TRACE.jsonl), and
[`SOURCE_ARTIFACT.hex`](SOURCE_ARTIFACT.hex).

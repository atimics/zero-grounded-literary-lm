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
| Independent environment-family units | 16 |
| Episodes after two nested tie repeats | 32 |
| Raw arm rows | 1,280 |
| Exact adapter reconstructions | 8 / 8 |
| Adapter domain checks | 8,000 |
| Paired generator sequences that differ | 4 / 4 |
| Syntax-to-semantic collisions across target families | 9,176 |
| Invalid-first rejections | 1,280 / 1,280 |
| Exact final answers | 1,280 / 1,280 |
| Source-ablation path matches | 32 / 32 |
| Full-to-oracle path matches | 32 / 32 |
| Target-only cost range | 2 to 31 |
| Target-only median | 16 |

## Arm totals

| Arm | Distinct semantic verifier checks |
| --- | ---: |
| Target only | 444 |
| Adapter only | 444 |
| Raw lexical guide | 347 |
| Full semantic transfer | 64 |
| Oracle adapter | 64 |
| Frequency lexical guide | 347 |
| Source-free just-in-time guide | 508 |
| Source ablation | 508 |
| Source only | 230 |
| Median of 31 shuffled guides | 305 |

These values guide development choices. A future preregistered run will make
the sealed decision. The stronger source-free development comparator is
`target_only`.

## Receipts

- Source artifact bytes: 1,823
- Source artifact SHA-256:
  `7e62f3276023af86d2a8c34bbb32991522f2eaa501fae960f015f6445c05fd8e`
- Raw trace SHA-256:
  `0a85404650cbd854ef6a2f847657c149891ca45fb72275956b2a5521b33ed945`

The machine-readable files are
[`DEVELOPMENT.json`](DEVELOPMENT.json),
[`DEVELOPMENT-TRACE.jsonl`](DEVELOPMENT-TRACE.jsonl), and
[`SOURCE_ARTIFACT.hex`](SOURCE_ARTIFACT.hex).

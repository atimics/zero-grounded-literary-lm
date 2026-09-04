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
| Independent target-family units | 8 |
| Generator-environment views | 16 |
| Episodes after two nested tie repeats | 32 |
| Raw arm rows | 1,280 |
| Exact adapter reconstructions | 8 / 8 |
| Adapter domain checks | 8,000 |
| Paired generator sequences that differ | 4 / 4 |
| Syntax-to-semantic collisions across target families | 8,712 |
| Unique source/development AST fingerprints | 136 / 136 |
| Unique source/development behavior fingerprints | 136 / 136 |
| Invalid-first rejections | 1,280 / 1,280 |
| Exact final answers | 1,280 / 1,280 |
| Source-ablation path matches | 32 / 32 |
| Full-to-oracle path matches | 32 / 32 |
| Target-only cost range | 2 to 29 |
| Target-only median | 18 |
| Registered headroom gate | pass |

## Arm totals

| Arm | Distinct semantic verifier checks |
| --- | ---: |
| Target only | 571 |
| Adapter only | 571 |
| Raw lexical guide | 532 |
| Full semantic transfer | 513 |
| Oracle adapter | 513 |
| Frequency lexical guide | 545 |
| Source-free just-in-time guide | 539 |
| Source ablation | 539 |
| Source only | 45,786 |
| Median of 31 shuffled guides | 468 |

These values guide development choices. A future preregistered run will make
the sealed decision. The stronger source-free development comparator is
`source_free_jit`.

Every raw row includes a source artifact digest and a hash-bound replay
preimage. The checker independently reconstructs all candidates, ranks,
fallback steps, and exact-verifier outcomes. It then validates all 1,280 rows
with the strict shared Reasoner 5 schema and rebuilds the common result.

## Receipts

- Source artifact bytes: 1,823
- Source artifact SHA-256:
  `0f1f7b4f76a57328c717a3cbc552c5aebf76bfbadf0d7e493f03c628e8edfb14`
- Raw trace SHA-256:
  `7f5acbab6f1b76c11962c4084f46e227843b5836154b89ff761644b1e3771c27`
- Shared coverage SHA-256:
  `307bef880949ce04c786c76b9d0b51bd15179f9f842c7dae49be4c086c9110a7`
- Replayed common result SHA-256:
  `36ffc6cfd29e249825211caf78e0ff5ef1471c0d1a939f1506aab1d9b3a645a6`

The machine-readable files are
[`DEVELOPMENT.json`](DEVELOPMENT.json),
[`DEVELOPMENT-TRACE.jsonl`](DEVELOPMENT-TRACE.jsonl), and
[`SOURCE_ARTIFACT.hex`](SOURCE_ARTIFACT.hex).

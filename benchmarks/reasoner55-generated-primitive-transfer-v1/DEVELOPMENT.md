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
| Registered fixture headroom | pass |

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

## Registered development analysis

The analysis uses an intersection-union rule. Every component must pass.

| Component | Point estimate | One-sided upper limit | Development result |
| --- | ---: | ---: | --- |
| Full vs adapter-only cost ratio | 0.8551 | 1.2208 | no-go |
| Full vs `source_free_jit` cost ratio | 0.9901 | 1.9148 | no-go |
| Factorial log interaction | -0.0508 | 0.3952 | no-go |

The final development decision is **no-go**. The simple effect won 4 of 8
target-family units. Its Wilson lower limit is 0.2486. The operational
comparison won 5 of 8 units. Its Wilson lower limit is 0.3480. Both
comparisons improve on the skeleton-first generator. Both miss the registered
gate on the syntax-first generator and the cross-generator stratum.

The raw-lexical-to-full mechanism ratio is 1.0521. Its lower limit is 0.7692.
The full arm also misses the frozen shuffled-guide median. These results are
development evidence. The sealed lane stays closed.

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
  `a221aa499220e85473f3a60272fc9066dc6a859346c5a4745bd341f853f0a78b`
- Replayed common result SHA-256:
  `6a9f1485bd03b0a5e7f3cf05b32b259923fb0ee73a32feb891611b015fd88380`
- Intersection-union analysis SHA-256:
  `99806f32e24766fdb07e2dd4c2b67d48ab7e8a219a40325d45e3ec340a3cd14a`
- Development analysis file SHA-256:
  `dd0795d6be587a81b2fe3e33395f1f93caf355abbb95a594d430aa00810721fb`

The machine-readable files are
[`DEVELOPMENT.json`](DEVELOPMENT.json),
[`DEVELOPMENT-ANALYSIS.json`](DEVELOPMENT-ANALYSIS.json),
[`DEVELOPMENT-TRACE.jsonl`](DEVELOPMENT-TRACE.jsonl), and
[`SOURCE_ARTIFACT.hex`](SOURCE_ARTIFACT.hex).

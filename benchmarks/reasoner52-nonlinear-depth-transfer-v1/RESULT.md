# Reasoner 5.2 result: no-go

The registered run produced exact answers on all 24 nonlinear episodes.
The full scorer used 30 candidate checks. Target-only used 44. The reduction
was 31.8%. The full scorer earned eight individual wins; the contract required
sixteen. The recorded decision is no-go.

| Registered arm | Candidate checks |
| --- | ---: |
| Full | 30 |
| Oracle | 24 |
| Target-only | 44 |
| Affine projection | 44 |
| Degree-blind | 31 |
| Shuffled source | 56 |
| Source-only | 2,347 |
| Source ablation | 44 |

The verifier compared every accepted program on all seventeen field inputs.
Six first suggestions required correction. Every final answer was exact.
The independently evaluated zero-source arm matched target-only. The source
artifact hash stayed fixed throughout the run.

## Scope and next evidence

This is a finite nonlinear depth-transfer pilot. Source programs contain two
operations. Target programs contain three. The source corpus and semantic
classes were chosen during design. The learned state consists of small
integer frequency and transition tables.

The aggregate search gain and eight individual wins provide a useful lead.
The one-check gap against the degree-blind control calls for a larger fresh
task family with more room for ranking gains. The frozen gate stays at its
registered threshold.

## Run record

Run `reasoner52-20260902t134909z` used commit
`21328411eb4fd032ac68a5526be263280b97ed6a`. The local run took 11.341
milliseconds at $0 cloud cost. The execution count is one. `RESULT.json` and
`EXECUTION.json` preserve the original bytes. `ARTIFACT.hex` preserves the
176-byte source artifact. `PROVENANCE.json` records their hashes and the
consumed execution lock.

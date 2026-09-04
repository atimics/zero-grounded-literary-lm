# Reasoner 5.6 passive-noise development

This folder contains the development-only Reasoner 5.6 implementation record.
It builds a learned local and first-order observation model over the exact
GF(17) program universe, then checks it with the shared Reasoner 5 harness.

The checked fixture contains:

- `development/result.json`, the native development summary;
- `development/raw-trace.jsonl`, all 5,760 native episode-arm rows;
- `development/artifact.bin`, the frozen little-endian development artifact;
- `development/family-manifest.json`, all replayable episode envelopes;
- `development/harness-trace.jsonl.gz`, the strict shared-harness rows;
- `development/harness-result.json`, the replayed search-cost analysis;
- `development/proxy-taint-audit.json`, the public-boundary audit;
- `development/assessment.json`, the combined development assessment.

Run the focused check with:

```sh
make reasoner56-check
```

The focused check rebuilds every development file twice, checks byte identity,
compares it with the committed fixture, audits every raw row, checks the public
ranker schema, runs address and undefined-behavior sanitizers, and confirms
that sealed execution stays closed.

The deterministic fixture gives a search-cost `no-go` and a separate
`development-ready` channel result. See [SPEC.md](SPEC.md) for the exact failed
gates and readiness measures. Fresh sealed family selection, power analysis, a
frozen publication rule, and explicit execution approval remain the scientific
boundary.

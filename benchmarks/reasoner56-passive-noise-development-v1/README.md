# Reasoner 5.6 passive-noise development

This folder contains the development-only Reasoner 5.6 implementation record.
It prepares a learned local and first-order observation model over the exact
GF(17) program universe.

The checked fixture contains:

- `development/result.json`, a development health summary;
- `development/raw-trace.jsonl`, one row per episode and arm;
- `development/artifact.bin`, the frozen little-endian development artifact.

Run the focused check with:

```sh
make reasoner56-check
```

The focused check rebuilds every development file twice, checks byte identity,
compares it with the committed fixture, audits every raw row, checks the public
ranker schema, and confirms that sealed execution stays closed.

The scientific contract remains a future step. It needs the shared family
harness, a power result, frozen split manifests, opaque sealed seed
commitments, formal gates, and fresh approval.

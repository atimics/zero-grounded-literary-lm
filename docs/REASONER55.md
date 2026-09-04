# Reasoner 5.5 development implementation

Status: development-only

Reasoner 5.5 tests whether an exact semantic adapter can preserve a source
search guide across generated primitive families. This implementation covers
the complete development lane. A later preregistration can freeze larger
calibration and sealed lanes.

## Domain

Each task uses three-value vectors over GF(5). The eight target primitives are
fresh affine maps with these semantic roles:

- axis and dense translations;
- axis and dense nonzero scales;
- coordinate permutations;
- shears;
- linear coordinate mixes;
- affine mixes.

A program has four primitive calls. The grammar therefore has 8^4, or 4,096,
syntax candidates. Equivalent affine maps share one canonical semantic key.
The primary search cost counts distinct semantic classes sent to the exact
verifier.

The verifier evaluates every submitted class on all 125 vectors in GF(5)^3.
Only verifier acceptance can commit an answer. Every arm starts with an
injected invalid candidate and must reject it.

## Independent generators

The syntax-first generator samples a legal role sequence first. The
skeleton-first generator samples one of eight semantic templates before it
binds roles. Program, surface, and input streams use separate deterministic
random streams.

The development fixture uses 64 source families from each generator and four
target families from each generator. Source and target generators form four
fixed environments. Two tie salts are nested inside each family and
environment, producing 32 episodes.

## Semantic adapter and guide

The adapter queries each target primitive at the zero vector and the three
basis vectors. Those four outputs reconstruct the exact 3 by 3 matrix and
bias. The development evaluator compares the reconstruction with the hidden
coefficients and then checks all 125 inputs.

The source artifact stores integer position counts and adjacent-role counts
from canonical exact source solutions. It has a canonical 1,823-byte encoding.
Its SHA-256 is
`7e62f3276023af86d2a8c34bbb32991522f2eaa501fae960f015f6445c05fd8e`.

## Arms

The main two-by-two design is:

| | Guide off | Guide on |
| --- | --- | --- |
| Adapter off | `target_only` | `raw_lexical` |
| Adapter on | `adapter_only` | `full` |

The controls are an oracle adapter, a frequency-only lexical guide, a
source-free just-in-time guide, its byte-for-byte source ablation path, a
source-only guide, and 31 fixed role derangements.

Every arm receives the same candidate multiset, evidence, allowed actions,
latent task, potential responses, verifier, and caps. Each raw row carries
digests for these values so the shared Reasoner 5 harness can verify parity.

## Development fixture

The checked-in fixture has 1,280 raw arm rows. Its target-only median is 16
checks, inside the selected 16-to-64 development range. The development lane
selects `target_only` as the stronger source-free comparator.

The fixture is a calibration record. The scientific decision begins with a
future frozen contract and its own explicit run approval.

Build and verify it with:

```sh
make reasoner55-check
```

The checker replays every aggregate from raw rows, confirms arm parity,
validates artifact and trace hashes, verifies nested family structure, and
compares a fresh deterministic run with the checked-in files.

See the [development record](../benchmarks/reasoner55-generated-primitive-transfer-v1/DEVELOPMENT.md),
the [development contract](../benchmarks/reasoner55-generated-primitive-transfer-v1/contract.json),
and the [next-set design](REASONER5-NEXT.md).

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
fixed views. Two tie salts are nested inside each target family and view,
producing 32 episodes. The generator keeps a development family only when its
target-only median across the four fixed view and tie combinations is between
16 and 64 checks. This registered ambiguity rule creates measurement headroom
before the family split freezes.

Target AST and complete behavior fingerprints are unique across all 128 source
families and all eight development families. The split receipt records every
fingerprint before episode generation.

## Semantic adapter and guide

The adapter queries each target primitive at the zero vector and the three
basis vectors. Those four outputs reconstruct the exact 3 by 3 matrix and
bias. The development evaluator compares the reconstruction with the hidden
coefficients and then checks all 125 inputs.

The ranker receives a typed public view containing surface labels, the single
demonstration, and the allowed action. Target coefficients, semantic roles,
family state, and exact-test values stay in the evaluator view.

The source artifact stores integer position counts and adjacent-role counts
from canonical exact source solutions. It has a canonical 1,823-byte encoding.
Its SHA-256 is
`0f1f7b4f76a57328c717a3cbc552c5aebf76bfbadf0d7e493f03c628e8edfb14`.

## Arms

The main two-by-two design is:

| | Guide off | Guide on |
| --- | --- | --- |
| Adapter off | `target_only` | `raw_lexical` |
| Adapter on | `adapter_only` | `full` |

The controls are an oracle adapter, a frequency-only lexical guide, a
source-free just-in-time guide, its byte-for-byte source ablation path, a
source-only guide, and 31 fixed role derangements.

The registered decision is an intersection-union gate at one-sided alpha
0.01. It requires all three of these results:

1. `full` passes the common gate against `adapter_only`.
2. `full` passes the common gate against the frozen strongest source-free
   comparator, `source_free_jit`.
3. The upper confidence limit for the adapter-by-guide log interaction is
   below zero.

`target_only` remains the registered headroom arm. It is also the off/off cell
of the factorial. The raw lexical guide is the formal mechanism contrast.
The common gates cover both target generators and the fixed cross-generator
stratum.

Every arm receives the same candidate multiset, evidence, allowed actions,
latent task, potential responses, verifier, and caps. Canonical fallback order
comes from the shared Reasoner 5 harness. Each raw row carries a source artifact
digest and a hash-bound 190-byte replay preimage. The checker uses these bytes
to rebuild all 4,096 candidates, every rank, and every 125-point verifier
decision. It then converts every row to the strict shared trace schema.

The 31 role derangements come from a registered uniform Fisher-Yates sampler.
Fixed-point and duplicate draws are rejected. Their shared canonical digest is
`4b29c6f5236276a53adc0fbabacb758b44078146a70fbc3213cac29d55d0e588`.

## Development fixture

The checked-in fixture has 1,280 raw arm rows. Its target-only median is 18
checks, inside the registered 16-to-64 development range. This qualifies the
fixture for analysis. The development lane selects `source_free_jit` as the
stronger source-free comparator.

The registered development analysis is a no-go. The full-to-adapter-only
family-weighted cost ratio is 0.8551 with an upper limit of 1.2208. The
full-to-`source_free_jit` ratio is 0.9901 with an upper limit of 1.9148. The
factorial interaction is -0.0508 with an upper limit of 0.3952. The raw lexical
mechanism ratio is 1.0521 with a lower limit of 0.7692. The result keeps the
scientific gate closed while preserving the valid development measurements.

Observation queries and candidate expansions are logical work counters.
Source artifact access counts the canonical guide bytes made available to an
arm. Wall time and peak memory are explicitly unmeasured in this deterministic
development fixture.

The fixture is a calibration record. The scientific decision begins with a
future frozen contract and its own explicit run approval.

Build and verify it with:

```sh
make reasoner55-check
```

The checker replays every aggregate from raw rows, confirms arm parity,
validates artifact and trace hashes, verifies nested family structure, and
compares a fresh deterministic run with the checked-in files. It also rebuilds
both common gates from strict shared rows. It then rebuilds the complete
intersection-union result from the raw traces.

See the [development record](../benchmarks/reasoner55-generated-primitive-transfer-v1/DEVELOPMENT.md),
the [development analysis](../benchmarks/reasoner55-generated-primitive-transfer-v1/DEVELOPMENT-ANALYSIS.json),
the [development contract](../benchmarks/reasoner55-generated-primitive-transfer-v1/contract.json),
and the [next-set design](REASONER5-NEXT.md).

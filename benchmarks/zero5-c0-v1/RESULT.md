# ZERO.5-C0 Corpus 1 result

## Decision

Select the lossless 512-token byte-BPE contract for the next ZERO.5 C
experiment. This completes C0. It does not authorize model training by itself.

Corpus 1 is a useful factual-grounding and pipeline corpus, but it is too small
for broad language-model pretraining.

## Bound input

- Braid commit: `90c78b9`
- Collection: `braid-corpus-one-v0.1.0-296620cd725547ec5a49a22f28d2816892d5d6c4893518cd48fd83df04804516`
- Core release: `braid-corpus-one-core-v0.1.0-9f5bfbc244855733f7b894a616bbf9ab48005ae15b6c947d8f80c4e748304dd7`
- Train: 797 documents and 183,186 decoded UTF-8 bytes
- Validation: 101 documents and 22,807 decoded UTF-8 bytes
- Test: 101 documents, integrity checked but unopened for tokenizer metrics

The C importer independently verified every JSONL artifact hash, byte count,
record count, declared split, and per-record content hash.
An independent second execution reproduced the result, learned vocabulary,
training token stream, and validation token stream byte for byte.

## Tokenizer result

| Arm | Lossless | Parameters | Validation content tokens | Tokens/raw byte |
| --- | --- | ---: | ---: | ---: |
| ASCII128 historical control | No | 4,852,992 | not comparable | 0.986846 |
| byte264 | Yes | 4,854,016 | 22,807 | 1.000000 |
| byte-BPE512 | Yes | 4,852,992 | 9,790 | 0.429254 |

Byte-BPE512 reduced validation content tokens by 57.07% versus byte264, or
2.330 raw UTF-8 bytes per content token. It learned all 248 requested merges
from training only. Its larger embedding is exactly offset by reducing the
feed-forward width from 1,056 to 1,024.

The ASCII control is lossy, has no document token, and applies historical text
normalization. Its token count is recorded only as a historical reference and
cannot win the selection.

## Artifact boundary

`result.json` binds the tokenizer and derived token streams by SHA-256. The
tokenizer binary, token streams, and corpus are not committed or published.
Public dataset publication remains a separate Braid licensing decision.

## Next

ZERO.5-C1 completed the separate small C training test and passed its frozen
three-seed learning and determinism gates. Corpus 1 still must not be treated
as broad pretraining data.

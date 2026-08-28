# ZERO.5 C4.2 setup

This prepares the next fixed-model corpus experiment. It does not start
training and does not authorize paid compute.

C4.2 keeps the 4.85M-parameter ZERO.5 model, tokenizer, C2 initialization,
and primary compute exposure fixed. It changes the corpus to Braid's
marker-free frontier release.

The Braid schedule has 27,962 optimizer groups over 37,768 packs. A group has
one or two packs. The new `Z5PKV3` format records those boundaries directly,
so paired views share one update without inventing padding packs. Existing
`Z5PKV2` files still use the old fixed-batch path.

The verified local import produced:

- 37,768 primary packs and exactly 19,337,216 token exposures
- 27,962 primary optimizer updates: 18,156 one-pack and 9,806 two-pack
- 50,585 primary records
- 12,159 validation records in 8,715 record-safe packs
- no test content access; only the inherited hash, byte count, and row count

Two independent imports produced identical manifest, primary-pack, full-pack,
and validation-pack hashes.

Braid PR #11 is merged at the exact pinned source commit. Training remains
blocked until the vector validation chooses the math backend and the complete
frozen C4.2 validation evaluator is implemented. A paid run also needs its own
explicit budget approval.

Run the local checks:

```bash
make zero5-c42-check
```

Import a private C4.2 release from its exact Braid checkout:

```bash
node scripts/prepare_zero5_c42.mjs \
  --braid-root /absolute/path/to/braid \
  --braid-head 5dbfec78c53676c6aaa32137f7d30e6f81a53593 \
  --release /absolute/path/to/the/f98728ce-release \
  --release-id braid-corpus-four-two-zero5-512-v0.1.0-f98728ce8a110e3b949fb0fdb3916b0c9c58d7357172b63003e9c1f3e12c3336 \
  --manifest-sha256 931544a5e4988b994562dc07831ff39be9da9de734639e6891a3f17b3368be69 \
  --out build/zero5-c42-v1/import-final
```

The generated corpus packs stay private and ignored under `build/`.

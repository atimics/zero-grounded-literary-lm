# ZERO.5-C0

ZERO.5-C0 is the return to the dependency-free C model line. The real Corpus 1
run is complete and selects byte-BPE512; see `RESULT.md` and `result.json`.

The new trainer is `zero5_lm.c`. The hash-pinned historical
`literary_lm.c` trainer remains unchanged.

It does not train a large model. It establishes the input contract first:

- verify an immutable Braid release/v2 in C;
- decode its canonical JSONL text without changing UTF-8 bytes;
- preserve Braid's governed train, validation, and sealed test splits;
- add an explicit end-of-document token;
- compare the historical 128-character stream with lossless byte and
  lossless byte-BPE streams; and
- prove that the C trainer consumes both lossless formats.

The ZERO.5 trainer accepts the frozen holdout with `--validation-text`. It
uses that whole file for validation and never samples it for training.

The 512-token byte-BPE arm keeps the historical ZERO parameter count exactly:
its larger embedding is paid for by reducing the feed-forward width from 1056
to 1024. The 264-token byte arm is 1,024 parameters larger because no integer
feed-forward width gives an exact match.

Run the mechanics gate with:

    make zero5-c0-check

Run the experiment on a real released Braid directory with:

    make zero5-c0-run BRAID_RELEASE=/path/to/release \
      ZERO5_BRAID_COLLECTION_ID=collection-id ZERO5_BRAID_COMMIT=commit

The result records the exact Braid collection, commit, release, artifact, and
derived-output hashes. Full model training remains closed until a separate
training experiment is preregistered.

The frozen status in `status.json` records the passing adversarial fixture,
sanitizer run, historical Sero hash check, full repository check, and the real
Corpus 1 result.

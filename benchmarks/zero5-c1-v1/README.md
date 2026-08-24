# ZERO.5-C1

ZERO.5-C1 is the first real training experiment in the new dependency-free C
model line. It trains the exact 4,852,992-parameter byte-BPE512 model selected
by C0 from scratch on Braid Corpus 1.

The run is complete and passes every frozen gate. See `RESULT.md`,
`result.json`, and the post-decision `GENERATION.md` diagnostic.

This is a learning and reproducibility test, not broad pretraining. Corpus 1
contains only 797 training records and 80,352 training tokens after BPE. Its
101 validation records may select checkpoints. Its 101 test records remain
sealed.

The frozen run uses seeds 0, 1, and 2, then repeats seed 0. Each seed receives
300 updates of four 512-token sequences. The result passes only if every seed
beats the declared validation ceiling, the mean and spread gates pass, and the
seed-0 repeat produces the exact same checkpoint bytes.

Run the contract check with:

    make zero5-c1-check

Run the authorized experiment after producing the bound C0 artifacts with:

    make zero5-c1-run ZERO5_C1_C0_DIR=build/zero5-c0-v1/corpus-one

No test path is accepted by the runner. A later test opening requires a new
explicit evaluation contract.

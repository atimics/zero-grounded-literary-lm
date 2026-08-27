# ZERO.5-C3

ZERO.5-C3 keeps the C2 4,852,992-parameter model and byte-BPE512
tokenizer fixed, then continues seed 0 through one ordered pass over Braid
Corpus 3: claims, cloze, and retrieval.

The importer found that 96.55% of official retrieval training records exceed
the model's 512-token context. The frozen model view therefore keeps the full
query and answer plus equal 210-code-point exact prefixes from both passages.
All train and validation records then fit; no test view was created.

The experiment measures both ordinary validation loss and answer-only loss on
every validation record. It also requires at least 55% held-out A/B retrieval
choice accuracy and preserves separate Atlas and C1 anchor retention gates.

This is a single-seed pilot. It can show that C3 adds task learning, but it
cannot show that task structure is better than the same number of extra prose
tokens. That causal claim requires a later token-matched Atlas control.

Run the contract and mechanics gate with:

    make zero5-c3-check

Run the local pilot after preparing the bound C0, C2, and C3 artifacts:

    make zero5-c3-run

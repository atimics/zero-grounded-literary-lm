# ZERO.5-C2

ZERO.5-C2 is the first training-scale corpus expansion in the dependency-free
C model line. It keeps the C1 4,852,992-parameter rotary model and frozen
byte-BPE512 tokenizer, then continues seed 0 through one complete ordered pass
over the Corpus 2 Atlas training stream.

The C1 seed-0 checkpoint is the completed anchor stage. Atlas is the second
stage. The C2 trainer consumes its 21,348,611 tokens in Braid's declared order
instead of randomly sampling windows.

This is a single-seed pilot. Seeds 1 and 2 are not authorized by this contract.
The pilot must improve held-out Atlas loss by at least 10%, keep C1 anchor loss
within 10%, complete the ordered pass, and leave both test splits sealed.

Corpus 2 is mixed-rights. The Atlas text is CC BY-SA 4.0. Dataset and
checkpoint publication remain disabled; see `RIGHTS.md`.

Run the contract and mechanics gate with:

    make zero5-c2-check

Run the local pilot after preparing the bound C0, C1, and C2 build artifacts:

    make zero5-c2-run

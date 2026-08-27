# ZERO.5-C3.1

C3.1 starts every arm from the frozen C2 checkpoint and uses the released
Braid ZERO.5-512 view at commit `608688d`. It tests the C3 failure directly:
whether solid task blocks caused interference and whether short answers were
drowned out by easy prompt tokens.

The importer preserves complete records. It first packs each task separately,
then either keeps the three task blocks (V) or smoothly interleaves the exact
same packs (A and B). B changes only the answer-token loss weight from one to
four. All arms consume the same 37,768 packs and 19,337,216 compute-token
exposures.

The test artifact is hash-verified but never parsed, tokenized, packed, or
evaluated.

Run the frozen mechanics gate with:

    make zero5-c31-check

Run the authorized local pilot after preparing the bound artifacts with:

    make zero5-c31-run

The pilot is complete with a frozen no-go. Interleaving improved combined
validation NLL by 41.75% and fixed the cloze regression. Four-times answer
weight improved cloze answer NLL by 26.80% and retrieval answer NLL by 95.97%,
but claim answer improvement stopped at 7.28% and retrieval choice accuracy at
54.77%, below the frozen 10% and 55% gates. See `RESULT.md`, `GENERATION.md`,
and the exact `result.json`.

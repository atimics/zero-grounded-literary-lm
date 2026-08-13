# Literary training corpus

The top-level `.txt` files are normalized UTF-8/LF training inputs for
`literary_lm`:

- `shakespeare.txt` — *The Complete Works of William Shakespeare*.
- `blake.txt` — *Poems of William Blake* plus *The Marriage of Heaven and
  Hell*.
- `crowley.txt` — *Tannhäuser*, *Household Gods*, *Clouds without Water*, and
  *Liber AL vel Legis* (*The Book of the Law*).
- `bible-kjv.txt` — the 66-book King James Bible, used as an optional,
  deliberately low-weight ZERO.3 source.
- `zero-foundation.txt` — the inspectable statements learned by ZERO.1 plus
  the bridge statements used for ZERO.3 foundation distillation.

The Project Gutenberg license wrappers were removed from the training copies;
the source works, titles, headings, poetry, dramatic text, punctuation, and
lineation were retained. CRLF line endings were normalized to LF. Raw downloads
and mechanical conversion products are deliberately gitignored. Their hashes
remain in `SHA256SUMS`, allowing exact local reconstructions to be checked
without redistributing those files in the model release.

For the King James Bible, the preface, table of contents, Project Gutenberg
wrapper, and mechanical chapter-and-verse identifiers were removed. Book
headings, verse text, paragraph wrapping, punctuation, and order were retained.
The deterministic conversion is in `scripts/prepare_kjv.sh`.

The improved fixed-budget training pipeline creates `literary.bpe` and the
binary 16-bit token streams under `bpe/`. `bpe_tokenizer` converts typographic
Unicode punctuation and Latin diacritics to compact ASCII. The final preset
uses these 128 character values directly; larger learned BPE vocabularies were
tested but generalized worse on this corpus. Newlines remain literal,
preserving verse and dramatic line structure.

For model-quality purposes the tokenizer also removes mechanical editorial
noise: transcriber instructions, publisher press notices, Wikisource's very
wide notes table, horizontal rules, source-production credits, italics
underscores, and escaped punctuation. It retains the works themselves,
headings, speaker names, stage directions, poem numbering, and lineation. The
original Shakespeare, Blake, and Crowley top-level texts and all raw downloads
remain unchanged. Leading indentation is normalized to four spaces and
internal whitespace runs to one space, preventing source-layout columns from
becoming a generation mode.

## Sources

Project Gutenberg identifies each of these editions as public domain in the
United States:

- Shakespeare, eBook 100:
  <https://www.gutenberg.org/ebooks/100>
- Blake, eBook 574:
  <https://www.gutenberg.org/ebooks/574>
- Blake, eBook 45315:
  <https://www.gutenberg.org/ebooks/45315>
- Crowley, eBook 70261:
  <https://www.gutenberg.org/ebooks/70261>
- Crowley, eBook 14040:
  <https://www.gutenberg.org/ebooks/14040>
- King James Bible, eBook 30:
  <https://www.gutenberg.org/ebooks/30>

The additional Crowley transcriptions came from these permanent Wikisource
revisions:

- *Clouds without Water*:
  <https://en.wikisource.org/w/index.php?title=Clouds_without_Water&oldid=13649032>
- *Liber AL vel Legis*:
  <https://en.wikisource.org/w/index.php?title=Liber_AL_vel_Legis&oldid=15225259>

Wikisource marks the underlying works public domain and provides its digital
transcription contributions under CC BY-SA. Contributor histories are linked
from [CORPUS_RIGHTS.md](../CORPUS_RIGHTS.md). The raw export and rendered source
are not published in the model repository; their hashes are preserved here.
Wikisource reports that the source document for its *Liber AL* transcription
is not known, so its provenance is weaker than the other listed editions.

Project Gutenberg identifies its KJV edition as public domain in the USA, but
the right to print and publish the Authorized Version remains subject to Crown
letters patent in the United Kingdom. The KJV text is therefore a recorded
training source but is excluded from the Hugging Face release and is not
approved here for dataset redistribution.

Check the copyright rules that apply in your location and intended use. Source
and transcription status can differ. The complete release assessment and
machine-readable source records are in `../CORPUS_RIGHTS.md` and `RIGHTS.json`.

## Train

```sh
./literary_lm \
  --preset literary \
  --tokenizer corpus/literary.bpe \
  --text corpus/bpe/shakespeare.tok \
  --text corpus/bpe/blake.tok \
  --text corpus/bpe/crowley.tok \
  --steps 30000 \
  --dropout 0.1 --cosine \
  --best literary-v6.ckpt \
  --save literary-v6-last.ckpt \
  --save-every 1000 \
  --tokens 0
```

The original three-author corpus contains about 5.82 MB; normalization produces
about 5.67 million character tokens. Shakespeare is much larger than the other
two author files, but `literary_lm` samples each `--text` file uniformly and
holds out 5% of each file. Each author therefore receives equal sequence-level
sampling weight despite the different file sizes.

`SHA256SUMS` records the exact training files and original downloads used to
produce them.

## ZERO.3 mixture

`make zero3-data` creates the fixed 128-character token streams for the
foundation, Shakespeare, Blake, Crowley, and the King James Bible, then builds
the structured channel records. Training samples files by explicit file
weight rather than byte count:

| Source | Sampling weight | Approximate share |
| --- | ---: | ---: |
| ZERO.1 foundation | 2 | 16.7% |
| Shakespeare | 1 | 8.3% |
| Blake | 1 | 8.3% |
| Crowley | 1 | 8.3% |
| King James Bible | 1 | 8.3% |
| Channel records | 6 | 50.0% |

These are starting weights, not a claim that the mixture is universally
optimal. Validation is balanced with the same weights. The Bible is valuable
for Early Modern English cadence and allusion, but increasing its share can
quickly bias vocabulary, dialogue, and generated subject matter.

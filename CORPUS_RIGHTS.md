# ZERO.4 corpus rights and provenance

**Review date:** 2026-08-12

**Artifact:** `docs/model.litq8`

**SHA-256:** `44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50`

## Release decision

ZERO.4 may be published as model weights under **CC BY-SA 4.0**. The checked
memorization gate passed for every protected third-party stream. The Hugging
Face model repository must use `huggingface/release-manifest.json` as an
allowlist. It must not contain training text, token streams, raw downloads, or
evaluation datasets.

This is a conservative rights and provenance record, not legal advice or a
guarantee that the same copyright rules apply in every country. Creative
Commons notes both that AI-training law varies and that using the same CC
license for a publicly shared model is the conservative way to follow a
ShareAlike source condition.

## Bound training lineage

ZERO.4 was initialized from immutable ZERO.3 and trained with immutable
ZERO.1, ZERO.2, and ZERO.3 teachers. The teacher hashes are bound in
`teachers/registry.json` and `corpus/RIGHTS.json`. Its replay mixture consisted
of the foundation, Shakespeare, Blake, Crowley, KJV, and literary-channel
streams. Its added faculty data was produced by the checked quantity-request
generator. The promoted checkpoint is Q2.6 seed 2, update 500.

The recorded lineage contains **no human chat export**. The channel stream was
generated only from the named literary inputs. Later Q2.7/Q2.8 research and
post-training external evaluations are not training sources for ZERO.4.

## Source-level assessment

| Training slice | Source status | Release treatment |
| --- | --- | --- |
| ZERO foundation | Project-authored statements | CC0 1.0 |
| Shakespeare | [Project Gutenberg eBook 100](https://www.gutenberg.org/ebooks/100), identified there as public domain in the USA | Attribute source; do not include text in the model repo |
| Blake | [eBook 574](https://www.gutenberg.org/ebooks/574) and [eBook 45315](https://www.gutenberg.org/ebooks/45315), identified there as public domain in the USA | Attribute sources; do not include text in the model repo |
| Crowley: *Tannhäuser* and *Household Gods* | [eBook 70261](https://www.gutenberg.org/ebooks/70261) and [eBook 14040](https://www.gutenberg.org/ebooks/14040), identified there as public domain in the USA | Attribute sources; jurisdiction review required for dataset redistribution |
| Crowley: *Clouds without Water* | [Wikisource revision 13649032](https://en.wikisource.org/w/index.php?title=Clouds_without_Water&oldid=13649032); underlying work marked public domain in the USA, transcription contributions under CC BY-SA | Preserve revision, [history](https://en.wikisource.org/w/index.php?title=Clouds_without_Water&action=history), license, and change notice |
| Crowley: *Liber AL vel Legis* | [Wikisource revision 15225259](https://en.wikisource.org/w/index.php?title=Liber_AL_vel_Legis&oldid=15225259); same license layers | Preserve revision, [history](https://en.wikisource.org/w/index.php?title=Liber_AL_vel_Legis&action=history), license, and change notice; source document is reported as unknown |
| King James Bible | [Project Gutenberg eBook 30](https://www.gutenberg.org/ebooks/30), identified there as public domain in the USA; special Crown publication rights apply in the UK | Never include the KJV text in the Hugging Face package |
| Literary channel | Mechanically derived from the Shakespeare, Blake, and Crowley streams | Follows those inputs; no human chat data |
| Quantity requests | Project-generated typed records | CC0 1.0 to the extent rights exist |

Project Gutenberg's [license policy](https://www.gutenberg.org/policy/license)
explains that its US-public-domain text is unrestricted by US copyright when
the Gutenberg license/trademark wrapper is removed, while users outside the
USA must check local law. Those wrappers were removed here. This project does
not claim Project Gutenberg endorsement.

The UK government's [copyright-term notice](https://www.gov.uk/government/publications/copyright-notice-duration-of-copyright-term/copyright-notice-duration-of-copyright-term)
records the KJV's special letters-patent regime. Excluding the KJV text from
the model package avoids representing it as a globally unrestricted dataset.

## Transformations and attribution

The literary inputs underwent wrapper removal, UTF-8/LF normalization,
character-level ASCII normalization, removal of specified editorial noise,
and whitespace normalization. Wikisource material was therefore modified.
The permanent revision and contributor-history links above provide reasonable
attribution for the collaborative transcription layer; downstream dataset
publication would require a separate, attribution-preserving review.

Original download and transformation hashes are in `corpus/SHA256SUMS` and
`corpus/RIGHTS.json`. Raw downloads and generated token streams are deliberately
gitignored; their hashes remain so the exact inputs can be reconstructed and
checked without placing them in the model release.

## Model and code licensing

- Trained model artifacts: [CC BY-SA 4.0](LICENSE-MODEL.md), to the extent
  controlled rights apply.
- Project code and runtime: [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- Eligible first-party generated data: [CC0 1.0](LICENSE-DATA.md).
- Literary text and derived records: source-specific status above; neither the
  Apache nor model license relicenses them.

This split avoids implying that an Apache software license clears the corpus.
The CC BY-SA model license is conservative overcompliance; it is not a legal
conclusion that trained weights are necessarily an adaptation in every
jurisdiction.

## Memorization release gate

The 2026-08-12 evaluation used sixteen evenly stratified windows per bound
stream, a 128-token source prompt, and a 64-token greedy continuation. No
protected third-party stream reached the 32-token warning threshold: the
maxima were 2 for Shakespeare, 16 for Blake, 4 for Crowley, 6 for the KJV, and
9 for the derived literary channel.

Eight of sixteen project-authored foundation probes reproduced all 64
continuation tokens. That stream is intentionally inspectable, dedicated under
CC0, and is therefore recorded as an informational rather than
third-party-rights blocker. The complete hash-bound, text-free result is in
`release/zero4-memorization-v1.json`.

## Safety and limitations

The corpus contains archaic language plus sexual, violent, coercive,
discriminatory, religious, and drug-related material, especially in the
Crowley sources. ZERO.4 may reproduce themes or short phrases from its small
corpus. It is not suitable as an authority on religion, history, medicine,
law, identity, or factual questions. The memorization evaluation is a useful
release gate, not proof that no source expression can ever be reproduced.

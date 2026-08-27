# Sero curriculum corpus rights and provenance

The `sero-pretrain-curriculum/2026-08-22.v1` dataset contains 161,955,325
unique UTF-8 bytes. Its immutable dataset digest is
`dcad26c0cc44f449d87eb8af0d62d0518dc120a62aad049ff541c2fc149a35d8`.

The existing Simple English Wikipedia, English Wikibooks, and English Wikinews
material keeps its documented Wikimedia license and attribution trail. The new
sources are:

| Source | Pinned revision | License | Use |
| --- | --- | --- | --- |
| MDN Web Docs | `b2c48c8b7c097aeab4bc15a388c913f466f40e25` | CC BY-SA 2.5 for prose; code samples follow MDN's stated terms | Technical explanations |
| OpenAssistant OASST1 | `fdf72ae0827c1cda404aff25b6603abec9e3399b` | Apache 2.0 | Reviewed English dialogue |
| GSM8K | `3101c7d5072418e28b9008a6636bde82a006892c` | MIT | Worked grade-school math |

The built dataset carries the exact MDN, OASST1, and GSM8K license files and a
source registry with source URLs, revisions, archive hashes, and per-document
attribution. OpenStax and current Stack Exchange data dumps were intentionally
excluded because their current access or license terms include noncommercial
restrictions.

The builder removes repeated long paragraphs, exact and near-duplicate
documents, and any training document sharing an exact 12-word sequence with
the full validation/test set or the frozen semantic panel. The final report has
zero remaining matches. The official GSM8K test split remains evaluation-only.

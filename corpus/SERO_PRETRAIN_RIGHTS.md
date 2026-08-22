# Sero pretraining corpus rights and provenance

**Review date:** 2026-08-22

**Acquisition plan:** `corpus/registry/sero-pretrain-v1-acquisition.json`

## Scope

The `sero-pretrain/2026-08-22.v1` dataset uses text from three fixed Wikimedia
snapshots: Simple English Wikipedia, English Wikibooks, and English Wikinews.
Each source is capped at the same cleaned UTF-8 byte target before dataset-level
deduplication. Images and other media are not included.

Every raw dump URL and SHA-1 is fixed in the acquisition plan. The prepared
registry binds each normalized source by SHA-256. It also binds a JSONL
attribution index with the article title, revision ID, article URL, source
license, content hash, and recorded transformations. The immutable dataset
manifest seals those files before promotion.

## Licenses and attribution

Wikimedia states that original project text is generally available under
CC BY-SA 4.0 and GFDL. Its special rule for Wikinews states that text published
on or after 2005-09-25 is CC BY 2.5, while earlier Wikinews material is public
domain. The controlling terms permit attribution through a link or URL to the
article, where its history lists contributors. The corpus keeps such a URL for
each selected page and marks every page as modified.

The dataset and any material redistribution must keep the attribution indexes,
license links, source notice, and change notice together. This repository's
Apache software license does not relicense the source text.

## Limits

This record is a careful provenance and license gate, not legal advice or a
promise of zero copyright risk. Wikimedia warns that dumps can contain fair-use
material, imported text with extra attribution terms, or infringements that
have not yet been found. A takedown and source-removal process is still needed
before a public corpus release. The corpus is private in the Sero AWS data
plane; model release needs a separate memorization and rights review.

Sources:

- <https://dumps.wikimedia.org/legal.html>
- <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use>
- <https://dumps.wikimedia.org/simplewiki/20260801/>
- <https://dumps.wikimedia.org/enwikibooks/20260801/>
- <https://dumps.wikimedia.org/enwikinews/20260801/>
- <https://github.com/WikiExtractor/wikiextractor>

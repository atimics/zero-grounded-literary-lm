#!/usr/bin/env python3
"""Rebuild the Sero corpus with original articles as the split unit."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "build" / "sero-pretrain-v1"
DEFAULT_OUTPUT = ROOT / "build" / "sero-pretrain-v2"
SPLITS = ("train", "validation", "test")


def stable_value(value: object) -> object:
    if isinstance(value, list):
        return [stable_value(item) for item in value]
    if isinstance(value, dict):
        return {key: stable_value(value[key]) for key in sorted(value)}
    return value


def canonical_json(value: object) -> bytes:
    return (json.dumps(stable_value(value), ensure_ascii=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def pretty_json(value: object) -> str:
    return json.dumps(stable_value(value), ensure_ascii=False, indent=2) + "\n"


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = "\n".join(line.rstrip(" \t") for line in text.split("\n"))
    return re.sub(r"\n{4,}", "\n\n\n", text).strip()


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text.casefold())


def simhash(text: str, shingle_size: int = 5) -> int:
    tokens = words(text)
    shingles = {
        " ".join(tokens[index:index + shingle_size])
        for index in range(max(len(tokens) - shingle_size + 1, 0))
    }
    vector = [0] * 64
    for shingle in shingles:
        value = int.from_bytes(hashlib.sha256(shingle.encode("utf-8")).digest()[:8], "big")
        for bit in range(64):
            vector[bit] += 1 if value & (1 << bit) else -1
    result = 0
    for bit, score in enumerate(vector):
        if score >= 0:
            result |= 1 << bit
    return result


def hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


class SimHashIndex:
    def __init__(self, maximum_distance: int) -> None:
        self.maximum_distance = maximum_distance
        self.band_count = maximum_distance + 1
        self.buckets: defaultdict[tuple[int, int], list[int]] = defaultdict(list)
        self.fingerprints: list[int] = []

    def keys(self, fingerprint: int) -> Iterable[tuple[int, int]]:
        for band in range(self.band_count):
            start = 64 * band // self.band_count
            end = 64 * (band + 1) // self.band_count
            mask = (1 << (end - start)) - 1
            yield band, (fingerprint >> start) & mask

    def find(self, fingerprint: int) -> int:
        candidates: set[int] = set()
        for key in self.keys(fingerprint):
            candidates.update(self.buckets.get(key, []))
        for index in sorted(candidates):
            if hamming(self.fingerprints[index], fingerprint) <= self.maximum_distance:
                return index
        return -1

    def add(self, fingerprint: int) -> int:
        index = len(self.fingerprints)
        self.fingerprints.append(fingerprint)
        for key in self.keys(fingerprint):
            self.buckets[key].append(index)
        return index


def reconstruct_articles(source_root: Path, source_id: str) -> list[dict[str, Any]]:
    source_path = source_root / "sources" / f"{source_id}.txt"
    attribution_path = source_root / "attribution" / f"{source_id}.jsonl"
    text = source_path.read_text(encoding="utf-8")
    attribution = [
        json.loads(line) for line in attribution_path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    if not attribution:
        raise ValueError(f"empty attribution for {source_id}")
    starts = [0]
    current = 0
    for index in range(1, len(attribution)):
        marker = normalize(str(attribution[index]["title"])) + "\n\n"
        candidate = text.find(marker, current + 1)
        matched = -1
        while candidate >= 0:
            data = text[current:candidate].encode("utf-8")
            if (
                (candidate == 0 or text[candidate - 1] == "\n")
                and hashlib.sha256(data).hexdigest()
                == attribution[index - 1]["article_sha256"]
            ):
                matched = candidate
                break
            candidate = text.find(marker, candidate + 1)
        if matched < 0:
            raise ValueError(
                f"could not reconstruct {source_id} article {index}: "
                f"{attribution[index]['title']}"
            )
        starts.append(matched)
        current = matched
    ends = starts[1:] + [len(text)]
    articles: list[dict[str, Any]] = []
    for index, (start, end, metadata) in enumerate(zip(starts, ends, attribution)):
        value = text[start:end]
        data = value.encode("utf-8")
        observed = hashlib.sha256(data).hexdigest()
        if observed != metadata["article_sha256"]:
            raise ValueError(f"article hash mismatch for {source_id} attribution row {index}")
        identity = (
            f"{source_id}/{metadata.get('id', '')}/{metadata.get('revid', '')}/"
            f"{observed[:16]}"
        )
        articles.append({
            "id": identity,
            "source_id": source_id,
            "source_article_id": str(metadata.get("id", "")),
            "source_revision_id": str(metadata.get("revid", "")),
            "title": str(metadata["title"]),
            "url": str(metadata["article_url"]),
            "license": str(metadata["license"]),
            "license_url": str(metadata["license_url"]),
            "sha256": observed,
            "bytes": len(data),
            "words": len(words(value)),
            "text": value,
        })
    return articles


def deduplicate(articles: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    ranked = sorted(
        articles,
        key=lambda row: hashlib.sha256(
            f"sero-pretrain-v2-dedup\0{row['id']}".encode("utf-8")
        ).hexdigest(),
    )
    exact: dict[str, str] = {}
    near = SimHashIndex(3)
    retained: list[dict[str, Any]] = []
    exact_duplicates: list[dict[str, Any]] = []
    near_duplicates: list[dict[str, Any]] = []
    for article in ranked:
        digest = str(article["sha256"])
        if digest in exact:
            exact_duplicates.append({
                "discarded_id": article["id"], "retained_id": exact[digest],
            })
            continue
        fingerprint = simhash(str(article["text"]))
        near_index = near.find(fingerprint)
        if near_index >= 0:
            retained_article = retained[near_index]
            near_duplicates.append({
                "discarded_id": article["id"],
                "retained_id": retained_article["id"],
                "hamming_distance": hamming(fingerprint, int(retained_article["fingerprint"])),
            })
            continue
        exact[digest] = str(article["id"])
        article["fingerprint"] = fingerprint
        near.add(fingerprint)
        retained.append(article)
    for article in retained:
        article.pop("fingerprint")
    return retained, {
        "schema": "sero.article_deduplication.v1",
        "candidates": len(articles),
        "retained": len(retained),
        "exact_duplicates": exact_duplicates,
        "near_duplicates": near_duplicates,
        "word_shingle_size": 5,
        "simhash_max_hamming_distance": 3,
    }


def assign_splits(articles: list[dict[str, Any]], split_seed: str) -> None:
    grouped: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for article in articles:
        grouped[str(article["source_id"])].append(article)
    for source_id, rows in grouped.items():
        ordered = sorted(
            rows,
            key=lambda row: hashlib.sha256(
                f"{split_seed}\0{row['id']}".encode("utf-8")
            ).hexdigest(),
        )
        test_count = max(1, round(len(ordered) * 0.01))
        validation_count = max(1, round(len(ordered) * 0.01))
        for index, article in enumerate(ordered):
            article["split"] = (
                "test" if index < test_count else
                "validation" if index < test_count + validation_count else "train"
            )


def artifact(root: Path, path: Path) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(root)),
        "bytes": path.stat().st_size,
        "sha256": file_hash(path),
    }


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(pretty_json(value), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--split-seed", default="sero-pretrain-article-split-v2")
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    output = args.output.resolve()
    if output.exists():
        raise ValueError(f"refusing to overwrite existing output: {output}")
    parent_manifest = json.loads((source_root / "manifest.json").read_text(encoding="utf-8"))
    source_ids = sorted(
        path.stem for path in (source_root / "attribution").glob("*.jsonl")
    )
    if not source_ids:
        raise ValueError("source corpus has no attribution indexes")
    candidates: list[dict[str, Any]] = []
    for source_id in source_ids:
        reconstructed = reconstruct_articles(source_root, source_id)
        print(f"reconstructed {source_id}: {len(reconstructed)} articles", flush=True)
        candidates.extend(reconstructed)
    retained, deduplication = deduplicate(candidates)
    assign_splits(retained, args.split_seed)
    output.mkdir(parents=True)
    document_artifacts: list[dict[str, Any]] = []
    split_metadata: dict[str, Any] = {}
    for split in SPLITS:
        rows = sorted(
            (row for row in retained if row["split"] == split),
            key=lambda row: str(row["id"]),
        )
        document_path = output / "documents" / f"{split}.jsonl"
        document_path.parent.mkdir(parents=True, exist_ok=True)
        with document_path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in rows:
                public = {key: value for key, value in row.items() if key != "split"}
                handle.write(json.dumps(public, ensure_ascii=False, sort_keys=True) + "\n")
        document_artifacts.append(artifact(output, document_path))
        sources = []
        for source_id in source_ids:
            selected = [row for row in rows if row["source_id"] == source_id]
            sources.append({
                "source_id": source_id,
                "sampling_weight": 1,
                "documents": len(selected),
                "utf8_bytes": sum(int(row["bytes"]) for row in selected),
            })
        split_metadata[split] = {
            "documents": len(rows),
            "utf8_bytes": sum(int(row["bytes"]) for row in rows),
            "words": sum(int(row["words"]) for row in rows),
            "sources": sources,
        }
    deduplication_path = output / "reports" / "deduplication.json"
    write_json(deduplication_path, deduplication)
    source_counts = Counter(str(row["source_id"]) for row in retained)
    quality = {
        "schema": "sero.article_corpus_quality.v1",
        "parent_dataset_digest": parent_manifest["dataset_digest"],
        "split_unit": "original-source-article",
        "unmarked_article_boundaries": 0,
        "articles_present_in_multiple_splits": 0,
        "end_of_document_training_byte": "00",
        "end_of_document_byte_occurs_in_source_text": any(
            "\x00" in str(row["text"]) for row in retained
        ),
        "sources": [
            {
                "source_id": source_id,
                "candidate_articles": sum(
                    row["source_id"] == source_id for row in candidates
                ),
                "retained_articles": source_counts[source_id],
                "retained_utf8_bytes": sum(
                    int(row["bytes"]) for row in retained if row["source_id"] == source_id
                ),
            }
            for source_id in source_ids
        ],
        "totals": {
            "candidate_articles": len(candidates),
            "retained_articles": len(retained),
            "retained_utf8_bytes": sum(int(row["bytes"]) for row in retained),
        },
    }
    if quality["end_of_document_byte_occurs_in_source_text"]:
        raise ValueError("reserved NUL end-of-document byte occurs in source text")
    quality_path = output / "reports" / "quality.json"
    write_json(quality_path, quality)
    source_registry = {
        "schema": "sero.article_corpus_registry.v1",
        "dataset_id": "sero-pretrain-article",
        "version": "2026-08-22.v2",
        "parent_dataset_id": parent_manifest["dataset_id"],
        "parent_dataset_version": parent_manifest["version"],
        "parent_dataset_digest": parent_manifest["dataset_digest"],
        "split_seed": args.split_seed,
        "split_allocation": {"train": 0.98, "validation": 0.01, "test": 0.01},
        "split_unit": "original-source-article",
        "deduplication": {
            "word_shingle_size": 5, "simhash_max_hamming_distance": 3,
        },
        "end_of_document": {
            "kind": "reserved-source-absent-byte",
            "hex": "00",
            "included_in_training_loss": True,
            "excluded_from_content_bits_per_byte": True,
        },
        "rights_and_attribution": {
            "inherited_from_parent": True,
            "parent_source_registry_sha256": file_hash(source_root / "source-registry.json"),
            "attribution_indexes": [
                {
                    "source_id": source_id,
                    "sha256": file_hash(source_root / "attribution" / f"{source_id}.jsonl"),
                }
                for source_id in source_ids
            ],
        },
    }
    source_registry_path = output / "source-registry.json"
    write_json(source_registry_path, source_registry)
    inherited_contamination = json.loads(
        (source_root / "reports" / "contamination.json").read_text(encoding="utf-8")
    )
    if inherited_contamination.get("matches"):
        raise ValueError("parent contamination report is not clean")
    contamination = {
        "schema": "sero.article_contamination_inheritance.v1",
        "parent_dataset_digest": parent_manifest["dataset_digest"],
        "parent_report_sha256": file_hash(source_root / "reports" / "contamination.json"),
        "matches": [],
        "reason": "The article corpus only removes boundaries and documents from the audited parent text; it adds no source text.",
    }
    contamination_path = output / "reports" / "contamination.json"
    write_json(contamination_path, contamination)
    artifacts = sorted(
        document_artifacts + [
            artifact(output, contamination_path), artifact(output, deduplication_path),
            artifact(output, quality_path), artifact(output, source_registry_path),
        ],
        key=lambda row: row["path"],
    )
    manifest_without_digest = {
        "schema": "zero.dataset_manifest.v1",
        "dataset_id": "sero-pretrain-article",
        "version": "2026-08-22.v2",
        "created_at": "2026-08-22T00:00:00Z",
        "source_registry": "source-registry.json",
        "source_registry_sha256": file_hash(source_registry_path),
        "artifacts": artifacts,
        "splits": split_metadata,
    }
    dataset_digest = hashlib.sha256(canonical_json(manifest_without_digest)).hexdigest()
    manifest = {**manifest_without_digest, "dataset_digest": dataset_digest}
    manifest_path = output / "manifest.json"
    write_json(manifest_path, manifest)
    ready = {
        "schema": "zero.dataset_ready.v1",
        "dataset_id": manifest["dataset_id"],
        "version": manifest["version"],
        "dataset_digest": dataset_digest,
        "manifest_sha256": file_hash(manifest_path),
    }
    write_json(output / "READY", ready)
    print(
        f"wrote {output}: {len(retained)} articles, "
        f"{quality['totals']['retained_utf8_bytes']} bytes, digest {dataset_digest}",
        flush=True,
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build a rights-tracked, staged-skills corpus for the Sero curriculum pilot."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_sero_article_corpus import (  # noqa: E402
    SimHashIndex, artifact, canonical_json, file_hash, hamming, normalize,
    pretty_json, simhash, words, write_json,
)


BASE_DIGEST = "0cefd7a464177abec1ce32349aca957ac2a82d4d53cb0c9a7775defb13ace82d"
MDN_COMMIT = "b2c48c8b7c097aeab4bc15a388c913f466f40e25"
MDN_ARCHIVE_SHA256 = "163a6f3199f4db0294cac2ad277b357abbb98ba54188323eeebd2e8df4b33ecb"
OASST_COMMIT = "fdf72ae0827c1cda404aff25b6603abec9e3399b"
OASST_ARCHIVE_SHA256 = "286a6e9a5a413b3272ae9c0b5a20d327983dea1c24342ae28cb244a6da65185c"
OASST_LICENSE_SHA256 = "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
GSM_COMMIT = "3101c7d5072418e28b9008a6636bde82a006892c"
GSM_ARCHIVE_SHA256 = "19ab616f7ad67a18250e57eba3b57b8ff9b1d365055fd59839613424c24afb6a"
SPLITS = ("train", "validation", "test")
SOURCE_DOMAINS = {
    "simple-wikipedia": "foundation",
    "english-wikibooks": "foundation",
    "english-wikinews": "general",
    "mdn-web-docs": "technical",
    "openassistant-english": "dialogue",
    "gsm8k": "reasoning",
}


def source_hash(path: Path, expected: str, label: str) -> None:
    observed = file_hash(path)
    if observed != expected:
        raise ValueError(f"{label} source hash mismatch: {observed}")


def split_for(identity: str, source: str, validation: int = 100, test: int = 100) -> str:
    value = int.from_bytes(hashlib.sha256(
        f"sero-curriculum-split-v1\0{source}\0{identity}".encode("utf-8")
    ).digest()[:8], "big") % 10000
    if value < test:
        return "test"
    if value < test + validation:
        return "validation"
    return "train"


def document(
    identity: str, source_id: str, split: str, title: str, url: str,
    license_name: str, license_url: str, text: str, transformations: list[str],
) -> dict[str, Any] | None:
    text = normalize(text)
    data = text.encode("utf-8")
    if len(data) < 192 or len(words(text)) < 24 or b"\0" in data:
        return None
    return {
        "id": identity,
        "source_id": source_id,
        "domain": SOURCE_DOMAINS[source_id],
        "split": split,
        "title": title,
        "url": url,
        "license": license_name,
        "license_url": license_url,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "words": len(words(text)),
        "transformations": transformations,
        "text": text,
    }


def load_base(path: Path) -> list[dict[str, Any]]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("dataset_digest") != BASE_DIGEST:
        raise ValueError("curriculum parent dataset digest mismatch")
    rows: list[dict[str, Any]] = []
    for split in SPLITS:
        source = path.parent / "documents" / f"{split}.jsonl"
        for line in source.read_text(encoding="utf-8").split("\n"):
            if not line:
                continue
            row = json.loads(line)
            row["split"] = split
            row["domain"] = SOURCE_DOMAINS[str(row["source_id"])]
            row["transformations"] = [
                "inherited article reconstruction and normalization",
                "global repeated-paragraph removal",
                "held-out 12-word overlap gate",
            ]
            rows.append(row)
    return rows


def parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---\n"):
        return {}, raw
    end = raw.find("\n---\n", 4)
    if end < 0:
        return {}, raw
    metadata: dict[str, str] = {}
    for line in raw[4:end].splitlines():
        key, separator, value = line.partition(":")
        if separator and re.fullmatch(r"[a-zA-Z0-9_-]+", key):
            metadata[key] = value.strip().strip("\"'")
    return metadata, raw[end + 5:]


def clean_markdown(raw: str) -> tuple[str, str]:
    metadata, body = parse_frontmatter(raw.replace("\r\n", "\n"))
    body = re.sub(r"<!--[\s\S]*?-->", "", body)
    body = re.sub(r"\{\{[\s\S]*?\}\}", "", body)
    body = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", body)
    body = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", body)
    body = re.sub(r"</?[a-zA-Z][^>]{0,500}>", "", body)
    body = re.sub(r"^\s*(?:sidebar|page-type|browser-compat):.*$", "", body,
                  flags=re.MULTILINE)
    body = normalize(body)
    title = metadata.get("title", "").strip() or next(
        (line.lstrip("# ").strip() for line in body.splitlines() if line.startswith("#")),
        "MDN Web Docs article",
    )
    return title, body


def load_mdn(root: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    files = sorted((root / "files" / "en-us").glob("**/index.md"))
    rows: list[dict[str, Any]] = []
    excluded = Counter()
    for path in files:
        relative = path.relative_to(root / "files" / "en-us")
        title, body = clean_markdown(path.read_text(encoding="utf-8"))
        slug = str(relative.parent).replace("\\", "/")
        result = document(
            f"mdn/{slug}", "mdn-web-docs", split_for(slug, "mdn"), title,
            "https://developer.mozilla.org/en-US/docs/" + slug,
            "CC-BY-SA-2.5", "https://creativecommons.org/licenses/by-sa/2.5/",
            f"{title}\n\n{body}", [
                "YAML frontmatter removal", "MDN macro and HTML wrapper removal",
                "Markdown link target removal", "Unicode NFC and LF normalization",
            ],
        )
        if result is None:
            excluded["too_short"] += 1
        else:
            rows.append(result)
    return rows, dict(excluded)


def label_value(row: dict[str, Any], name: str, default: float = 0.0) -> float:
    value = row.get("labels", {}).get(name, {})
    return float(value.get("value", default)) if isinstance(value, dict) else default


def eligible_oasst(row: dict[str, Any]) -> bool:
    if not (
        row.get("lang") == "en" and row.get("review_result") is True
        and row.get("deleted") is False and row.get("synthetic") is False
        and row.get("tree_state") == "ready_for_export"
    ):
        return False
    if any(label_value(row, name) > 0.0 for name in (
        "pii", "spam", "lang_mismatch", "not_appropriate", "hate_speech",
        "sexual_content",
    )):
        return False
    detoxify = row.get("detoxify") or {}
    if any(float(detoxify.get(name, 0.0)) > threshold for name, threshold in {
        "toxicity": 0.35, "severe_toxicity": 0.05, "obscene": 0.25,
        "identity_attack": 0.25, "insult": 0.35, "threat": 0.20,
        "sexual_explicit": 0.20,
    }.items()):
        return False
    if row.get("role") == "assistant":
        if label_value(row, "quality", 1.0) < 0.5:
            return False
        if label_value(row, "helpfulness", 1.0) < 0.5:
            return False
        if label_value(row, "fails_task", 0.0) > 0.0:
            return False
    text = str(row.get("text", ""))
    if len(text.encode("utf-8")) > 10000:
        return False
    if re.search(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", text):
        return False
    return True


def oasst_rank(row: dict[str, Any]) -> tuple[int, float, str]:
    rank = row.get("rank")
    return (
        int(rank) if isinstance(rank, int) and rank >= 0 else 1000000,
        -label_value(row, "quality", 0.0),
        str(row["message_id"]),
    )


def load_oasst(path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    all_rows: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            all_rows.append(json.loads(line))
    allowed = {str(row["message_id"]): row for row in all_rows if eligible_oasst(row)}
    children: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    roots: list[dict[str, Any]] = []
    for row in allowed.values():
        parent = str(row.get("parent_id", ""))
        if parent and parent in allowed:
            children[parent].append(row)
        elif not parent:
            roots.append(row)
    documents: list[dict[str, Any]] = []
    for root in sorted(roots, key=lambda row: str(row["message_tree_id"])):
        path_rows = [root]
        current = root
        while children.get(str(current["message_id"])):
            current = min(children[str(current["message_id"])], key=oasst_rank)
            path_rows.append(current)
        if path_rows[-1].get("role") != "assistant":
            path_rows.pop()
        if len(path_rows) < 2:
            continue
        text = "\n\n".join(
            ("User:" if row["role"] == "prompter" else "Assistant:")
            + "\n" + normalize(str(row["text"]))
            for row in path_rows
        )
        tree = str(root["message_tree_id"])
        result = document(
            f"oasst1/{tree}", "openassistant-english", split_for(tree, "oasst1"),
            "OpenAssistant conversation", "https://huggingface.co/datasets/OpenAssistant/oasst1",
            "Apache-2.0", "https://www.apache.org/licenses/LICENSE-2.0", text,
            [
                "English reviewed non-synthetic messages only",
                "PII and safety label threshold filtering", "highest-ranked eligible path per tree",
                "explicit User and Assistant role labels", "Unicode NFC and LF normalization",
            ],
        )
        if result is not None:
            documents.append(result)
    return documents, {
        "messages_total": len(all_rows), "messages_eligible": len(allowed),
        "trees_with_retained_path": len(documents),
    }


def clean_gsm_answer(answer: str) -> str:
    answer = re.sub(r"<<[^<>\n]*>>", "", answer)
    reasoning, separator, final = answer.rpartition("####")
    if not separator:
        return normalize(answer)
    return normalize(reasoning) + "\n\nFinal answer: " + final.strip()


def load_gsm(root: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    data = root / "grade_school_math" / "data"
    rows: list[dict[str, Any]] = []
    counts = Counter()
    for official_split in ("train", "test"):
        for line_number, line in enumerate(
            (data / f"{official_split}.jsonl").read_text(encoding="utf-8").split("\n")
        ):
            if not line:
                continue
            value = json.loads(line)
            identity = hashlib.sha256(
                (str(value["question"]) + "\0" + str(line_number)).encode("utf-8")
            ).hexdigest()
            split = "test" if official_split == "test" else split_for(
                identity, "gsm8k-train", validation=200, test=0,
            )
            text = "Question:\n" + normalize(str(value["question"])) + \
                "\n\nReasoning:\n" + clean_gsm_answer(str(value["answer"]))
            result = document(
                f"gsm8k/{official_split}/{identity[:24]}", "gsm8k", split,
                "Grade-school math worked problem",
                "https://github.com/openai/grade-school-math",
                "MIT", "https://opensource.org/license/mit", text,
                [
                    "official test split reserved for evaluation",
                    "calculator annotation removal", "explicit question and reasoning labels",
                    "Unicode NFC and LF normalization",
                ],
            )
            if result is not None:
                rows.append(result)
                counts[split] += 1
    return rows, dict(counts)


def paragraphs(text: str) -> list[str]:
    return [value.strip() for value in re.split(r"\n\s*\n", text) if value.strip()]


def paragraph_key(value: str) -> str | None:
    normalized = " ".join(words(value))
    if len(value.encode("utf-8")) < 120 or len(normalized.split()) < 20:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def remove_repeated_paragraphs(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    owners: dict[str, str] = {}
    priority = {"test": 0, "validation": 1, "train": 2}
    ordered = sorted(rows, key=lambda row: (
        priority[str(row["split"])],
        hashlib.sha256(str(row["id"]).encode("utf-8")).hexdigest(),
    ))
    retained: list[dict[str, Any]] = []
    removed_paragraphs = 0
    removed_bytes = 0
    removed_documents = 0
    for row in ordered:
        kept: list[str] = []
        newly_owned: list[str] = []
        for value in paragraphs(str(row["text"])):
            key = paragraph_key(value)
            if key is not None and key in owners:
                removed_paragraphs += 1
                removed_bytes += len(value.encode("utf-8"))
                continue
            if key is not None:
                owners[key] = str(row["id"])
                newly_owned.append(key)
            kept.append(value)
        text = normalize("\n\n".join(kept))
        data = text.encode("utf-8")
        if len(data) < 192 or len(words(text)) < 24:
            for key in newly_owned:
                if owners.get(key) == str(row["id"]):
                    del owners[key]
            removed_documents += 1
            continue
        updated = dict(row)
        updated.update({
            "text": text, "bytes": len(data), "words": len(words(text)),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
        retained.append(updated)
    return retained, {
        "paragraphs_removed": removed_paragraphs,
        "utf8_bytes_removed": removed_bytes,
        "documents_emptied": removed_documents,
    }


def deduplicate(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    priority = {"test": 0, "validation": 1, "train": 2}
    ordered = sorted(rows, key=lambda row: (
        priority[str(row["split"])],
        hashlib.sha256(str(row["id"]).encode("utf-8")).hexdigest(),
    ))
    exact: dict[str, str] = {}
    index = SimHashIndex(3)
    indexed_rows: list[dict[str, Any]] = []
    retained: list[dict[str, Any]] = []
    discarded: list[dict[str, Any]] = []
    for row in ordered:
        digest = str(row["sha256"])
        if digest in exact:
            discarded.append({
                "kind": "exact", "discarded_id": row["id"], "retained_id": exact[digest],
            })
            continue
        fingerprint = simhash(str(row["text"]))
        match = index.find(fingerprint)
        if match >= 0:
            owner = indexed_rows[match]
            discarded.append({
                "kind": "near", "discarded_id": row["id"], "retained_id": owner["id"],
                "hamming_distance": hamming(fingerprint, int(owner["fingerprint"])),
            })
            continue
        exact[digest] = str(row["id"])
        indexed = dict(row)
        indexed["fingerprint"] = fingerprint
        index.add(fingerprint)
        indexed_rows.append(indexed)
        retained.append(row)
    return retained, {
        "schema": "sero.curriculum_deduplication.v1",
        "candidates": len(rows), "retained": len(retained),
        "discarded": discarded, "word_shingle_size": 5,
        "simhash_max_hamming_distance": 3,
    }


def shingles(text: str, size: int = 12) -> set[str]:
    tokens = words(text)
    return {" ".join(tokens[index:index + size]) for index in range(len(tokens) - size + 1)}


def semantic_panel(path: Path) -> Iterable[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = lines[0].split("\t")
    column = header.index("model_input")
    return [line.split("\t")[column] for line in lines[1:] if line]


def remove_contamination(
    rows: list[dict[str, Any]], panel_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    panel: set[str] = set()
    for row in rows:
        if row["split"] in {"validation", "test"}:
            panel.update(shingles(str(row["text"])))
    for value in semantic_panel(panel_path):
        panel.update(shingles(value))
    retained: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for row in rows:
        matches = shingles(str(row["text"])) & panel if row["split"] == "train" else set()
        if matches:
            blocked.append({
                "document_id": row["id"], "source_id": row["source_id"],
                "matching_shingles": sorted(matches)[:3],
            })
        else:
            retained.append(row)
    return retained, {
        "schema": "sero.curriculum_contamination.v1",
        "shingle_words": 12, "panel_shingles": len(panel),
        "blocked_training_documents": blocked, "matches_after_filter": [],
        "panels": [
            "all curriculum validation and test documents",
            str(panel_path.relative_to(ROOT)),
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-manifest", type=Path, required=True)
    parser.add_argument("--mdn-root", type=Path, required=True)
    parser.add_argument("--mdn-archive", type=Path, required=True)
    parser.add_argument("--oasst", type=Path, required=True)
    parser.add_argument("--oasst-license", type=Path, required=True)
    parser.add_argument("--gsm-root", type=Path, required=True)
    parser.add_argument("--gsm-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--semantic-panel", type=Path,
        default=ROOT / "benchmarks" / "zero4-q34-semantic-head-v1" / "semantic-confirmation.tsv",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise ValueError(f"refusing to overwrite existing output: {output}")
    source_hash(args.mdn_archive, MDN_ARCHIVE_SHA256, "MDN")
    source_hash(args.oasst, OASST_ARCHIVE_SHA256, "OpenAssistant")
    source_hash(args.oasst_license, OASST_LICENSE_SHA256, "OpenAssistant license")
    source_hash(args.gsm_archive, GSM_ARCHIVE_SHA256, "GSM8K")

    base = load_base(args.base_manifest.resolve())
    mdn, mdn_filters = load_mdn(args.mdn_root.resolve())
    oasst, oasst_filters = load_oasst(args.oasst.resolve())
    gsm, gsm_counts = load_gsm(args.gsm_root.resolve())
    candidates = base + mdn + oasst + gsm
    paragraph_clean, paragraph_report = remove_repeated_paragraphs(candidates)
    deduplicated, deduplication = deduplicate(paragraph_clean)
    retained, contamination = remove_contamination(deduplicated, args.semantic_panel.resolve())
    retained.sort(key=lambda row: (str(row["split"]), str(row["id"])))
    if any("\0" in str(row["text"]) for row in retained):
        raise ValueError("reserved NUL end-of-document marker occurs in curriculum text")

    output.mkdir(parents=True)
    licenses = output / "licenses"
    licenses.mkdir(parents=True, exist_ok=True)
    license_sources = {
        "mdn-LICENSE.md": args.mdn_root.resolve() / "LICENSE.md",
        "oasst1-LICENSE": args.oasst_license.resolve(),
        "gsm8k-LICENSE": args.gsm_root.resolve() / "LICENSE",
    }
    for name, source in license_sources.items():
        (licenses / name).write_bytes(source.read_bytes())
    document_artifacts: list[dict[str, Any]] = []
    split_metadata: dict[str, Any] = {}
    source_ids = sorted(SOURCE_DOMAINS)
    for split in SPLITS:
        selected = [row for row in retained if row["split"] == split]
        path = output / "documents" / f"{split}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in selected:
                public = {key: value for key, value in row.items() if key != "split"}
                handle.write(json.dumps(public, ensure_ascii=False, sort_keys=True) + "\n")
        document_artifacts.append(artifact(output, path))
        source_rows = []
        for source_id in source_ids:
            subset = [row for row in selected if row["source_id"] == source_id]
            if subset:
                source_rows.append({
                    "source_id": source_id, "domain": SOURCE_DOMAINS[source_id],
                    "sampling_weight": 1, "documents": len(subset),
                    "utf8_bytes": sum(int(row["bytes"]) for row in subset),
                })
        split_metadata[split] = {
            "documents": len(selected),
            "utf8_bytes": sum(int(row["bytes"]) for row in selected),
            "words": sum(int(row["words"]) for row in selected),
            "sources": source_rows,
        }

    source_registry = {
        "schema": "sero.curriculum_corpus_registry.v1",
        "dataset_id": "sero-pretrain-curriculum",
        "version": "2026-08-22.v1",
        "parent_dataset_digest": BASE_DIGEST,
        "split_seed": "sero-curriculum-split-v1",
        "split_unit": "source article, conversation tree, or worked problem",
        "end_of_document": {"hex": "00", "included_in_training_loss": True},
        "domains": SOURCE_DOMAINS,
        "sources": [
            {
                "id": "mdn-web-docs", "revision": MDN_COMMIT,
                "archive_sha256": MDN_ARCHIVE_SHA256, "license": "CC-BY-SA-2.5",
                "license_path": "licenses/mdn-LICENSE.md",
                "license_sha256": file_hash(licenses / "mdn-LICENSE.md"),
                "origin_url": "https://github.com/mdn/content",
                "attribution": "Per-page MDN URL and Mozilla Contributors",
            },
            {
                "id": "openassistant-english", "revision": OASST_COMMIT,
                "archive_sha256": OASST_ARCHIVE_SHA256, "license": "Apache-2.0",
                "license_path": "licenses/oasst1-LICENSE",
                "license_sha256": file_hash(licenses / "oasst1-LICENSE"),
                "origin_url": "https://huggingface.co/datasets/OpenAssistant/oasst1",
                "attribution": "OpenAssistant contributors and bundled Apache-2.0 license",
            },
            {
                "id": "gsm8k", "revision": GSM_COMMIT,
                "archive_sha256": GSM_ARCHIVE_SHA256, "license": "MIT",
                "license_path": "licenses/gsm8k-LICENSE",
                "license_sha256": file_hash(licenses / "gsm8k-LICENSE"),
                "origin_url": "https://github.com/openai/grade-school-math",
                "attribution": "OpenAI GSM8K authors and bundled MIT license",
            },
        ],
        "inherited_sources": ["simple-wikipedia", "english-wikibooks", "english-wikinews"],
    }
    registry_path = output / "source-registry.json"
    write_json(registry_path, source_registry)
    reports = output / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    write_json(reports / "deduplication.json", {
        **deduplication, "paragraph_deduplication": paragraph_report,
    })
    write_json(reports / "contamination.json", contamination)
    quality = {
        "schema": "sero.curriculum_corpus_quality.v1",
        "candidate_documents": len(candidates), "retained_documents": len(retained),
        "candidate_utf8_bytes": sum(int(row["bytes"]) for row in candidates),
        "retained_utf8_bytes": sum(int(row["bytes"]) for row in retained),
        "mdn_filters": mdn_filters, "openassistant_filters": oasst_filters,
        "gsm8k_split_counts": gsm_counts,
        "source_counts": {
            source: {
                "documents": sum(row["source_id"] == source for row in retained),
                "utf8_bytes": sum(int(row["bytes"]) for row in retained if row["source_id"] == source),
            }
            for source in source_ids
        },
        "unmarked_document_boundaries": 0,
        "documents_present_in_multiple_splits": 0,
        "source_text_contains_reserved_nul": False,
    }
    write_json(reports / "quality.json", quality)
    curriculum = {
        "schema": "sero.curriculum_schedule.v1",
        "total_target_raw_bytes": 600000000,
        "sampling_unit": "token window with deterministic per-domain reshuffle and replay",
        "stages": [
            {"id": "foundations", "target_raw_bytes": 200000000,
             "domain_weights": {"foundation": 0.55, "general": 0.20, "technical": 0.20,
                                "dialogue": 0.03, "reasoning": 0.02}},
            {"id": "breadth", "target_raw_bytes": 200000000,
             "domain_weights": {"foundation": 0.35, "general": 0.20, "technical": 0.30,
                                "dialogue": 0.10, "reasoning": 0.05}},
            {"id": "application", "target_raw_bytes": 200000000,
             "domain_weights": {"foundation": 0.25, "general": 0.15, "technical": 0.25,
                                "dialogue": 0.25, "reasoning": 0.10}},
        ],
        "notes": [
            "Every later stage retains foundation and general replay.",
            "The schedule is a seed-0 diagnostic, not evidence that ordering alone caused a gain.",
            "The official GSM8K test split is evaluation-only.",
        ],
    }
    curriculum_path = output / "curriculum.json"
    write_json(curriculum_path, curriculum)
    artifacts = sorted(document_artifacts + [
        artifact(output, registry_path), artifact(output, curriculum_path),
        artifact(output, reports / "deduplication.json"),
        artifact(output, reports / "contamination.json"),
        artifact(output, reports / "quality.json"),
        *(artifact(output, licenses / name) for name in sorted(license_sources)),
    ], key=lambda row: row["path"])
    without_digest = {
        "schema": "zero.dataset_manifest.v1",
        "dataset_id": "sero-pretrain-curriculum", "version": "2026-08-22.v1",
        "created_at": "2026-08-22T00:00:00Z",
        "source_registry": "source-registry.json",
        "source_registry_sha256": file_hash(registry_path),
        "curriculum": "curriculum.json", "curriculum_sha256": file_hash(curriculum_path),
        "artifacts": artifacts, "splits": split_metadata,
    }
    digest = hashlib.sha256(canonical_json(without_digest)).hexdigest()
    manifest = {**without_digest, "dataset_digest": digest}
    manifest_path = output / "manifest.json"
    write_json(manifest_path, manifest)
    write_json(output / "READY", {
        "schema": "zero.dataset_ready.v1", "dataset_id": manifest["dataset_id"],
        "version": manifest["version"], "dataset_digest": digest,
        "manifest_sha256": file_hash(manifest_path),
    })
    print(
        f"wrote {output}: {len(retained)} documents, "
        f"{quality['retained_utf8_bytes']} bytes, digest {digest}", flush=True,
    )


if __name__ == "__main__":
    main()

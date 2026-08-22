#!/usr/bin/env python3
"""Download, verify, extract, and deterministically balance Sero corpus sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "corpus" / "registry" / "sero-pretrain-v1-acquisition.json"


def stable_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def file_hash(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, expected_sha1: str) -> None:
    if destination.is_file():
        if file_hash(destination, "sha1") != expected_sha1:
            raise ValueError(f"existing download failed SHA-1 verification: {destination}")
        print(f"verified cached {destination.name}", flush=True)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    offset = partial.stat().st_size if partial.exists() else 0
    request = Request(url, headers={"User-Agent": "SeroCorpusBuilder/1.0"})
    if offset:
        request.add_header("Range", f"bytes={offset}-")
    print(f"downloading {url}", flush=True)
    with urlopen(request, timeout=120) as response:
        append = offset > 0 and getattr(response, "status", 200) == 206
        mode = "ab" if append else "wb"
        with partial.open(mode) as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
    if file_hash(partial, "sha1") != expected_sha1:
        raise ValueError(f"download failed SHA-1 verification: {url}")
    partial.replace(destination)


def run(command: list[str], cwd: Path | None = None) -> None:
    print("running " + " ".join(command[:4]) + (" ..." if len(command) > 4 else ""), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def ensure_extractor(plan: dict[str, object], tools: Path) -> Path:
    settings = plan["extractor"]
    assert isinstance(settings, dict)
    repository = str(settings["repository"])
    commit = str(settings["commit"])
    checkout = tools / "wikiextractor"
    if not (checkout / ".git").exists():
        checkout.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--filter=blob:none", "--no-checkout", repository, str(checkout)])
    run(["git", "fetch", "--depth", "1", "origin", commit], cwd=checkout)
    run(["git", "checkout", "--detach", commit], cwd=checkout)
    observed = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
    if observed != commit:
        raise ValueError("WikiExtractor checkout did not match the pinned commit")
    return checkout


def extraction_marker(source: dict[str, object], extractor_commit: str) -> dict[str, object]:
    return {
        "schema": "sero.wikiextraction.v1",
        "source_id": source["id"],
        "dump_sha1": source["dump_sha1"],
        "extractor_commit": extractor_commit,
        "arguments": ["--json", "--no-templates", "-ns", "0", "-b", "100M"],
    }


def extract_dump(
    checkout: Path,
    dump: Path,
    output: Path,
    source: dict[str, object],
    extractor_commit: str,
    processes: int,
) -> None:
    marker_value = extraction_marker(source, extractor_commit)
    marker = output / "EXTRACTED.json"
    if marker.is_file() and json.loads(marker.read_text(encoding="utf-8")) == marker_value:
        if any(path.is_file() for path in output.glob("**/wiki_*")):
            print(f"verified cached extraction for {source['id']}", flush=True)
            return
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"refusing to overwrite incomplete extraction: {output}")
    output.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = str(checkout) + (os.pathsep + existing_pythonpath if existing_pythonpath else "")
    command = [
        sys.executable,
        "-m",
        "wikiextractor.WikiExtractor",
        str(dump),
        "-o",
        str(output),
        "--json",
        "--no-templates",
        "-ns",
        "0",
        "-b",
        "100M",
        "--processes",
        str(processes),
    ]
    print(f"extracting {source['id']}", flush=True)
    subprocess.run(command, cwd=checkout, env=environment, check=True)
    marker.write_text(stable_json(marker_value), encoding="utf-8")


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = "\n".join(line.rstrip(" \t") for line in text.split("\n"))
    text = re.sub(r"\n{4,}", "\n\n\n", text).strip()
    return text


def article_block(row: dict[str, object]) -> str:
    title = normalize(str(row.get("title", "")))
    text = normalize(str(row.get("text", "")))
    if not title or not text:
        return ""
    if text.casefold().startswith("#redirect"):
        return ""
    return f"{title}\n\n{text}\n"


def has_residual_markup(text: str) -> bool:
    return re.search(
        r"\{\{|\}\}|\[\[(?:File|Image|Category):|<\/?(?:ref|math)\b|\{\|",
        text,
        flags=re.IGNORECASE,
    ) is not None or "\ufffd" in text


def extracted_files(output: Path) -> list[Path]:
    return sorted(path for path in output.glob("**/wiki_*") if path.is_file())


def prepare_source(
    source: dict[str, object],
    extracted: Path,
    prepared: Path,
    target_bytes: int,
    minimum_article_bytes: int,
) -> dict[str, object]:
    candidates: list[tuple[str, Path, int, int, int]] = []
    total_clean_bytes = 0
    total_articles = 0
    residual_markup_exclusions = 0
    for filename in extracted_files(extracted):
        with filename.open("rb") as handle:
            while True:
                offset = handle.tell()
                line = handle.readline()
                if not line:
                    break
                try:
                    row = json.loads(line)
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise ValueError(f"bad WikiExtractor JSON in {filename} at {offset}") from error
                block = article_block(row)
                size = len(block.encode("utf-8"))
                if size < minimum_article_bytes:
                    continue
                if has_residual_markup(block):
                    residual_markup_exclusions += 1
                    continue
                identity = f"{source['id']}\0{row.get('id', '')}\0{row.get('revid', '')}"
                rank = hashlib.sha256(identity.encode("utf-8")).hexdigest()
                candidates.append((rank, filename, offset, len(line), size))
                total_clean_bytes += size
                total_articles += 1
    if total_clean_bytes < target_bytes:
        raise ValueError(
            f"{source['id']} has only {total_clean_bytes} eligible bytes; target is {target_bytes}"
        )
    candidates.sort(key=lambda item: item[0])
    selected: list[tuple[str, Path, int, int, int]] = []
    selected_bytes = 0
    for candidate in candidates:
        selected.append(candidate)
        selected_bytes += candidate[4]
        if selected_bytes >= target_bytes:
            break

    prepared.mkdir(parents=True, exist_ok=True)
    text_path = prepared / f"{source['id']}.txt"
    attribution_path = prepared / f"{source['id']}.attribution.jsonl"
    article_count = 0
    actual_bytes = 0
    with text_path.open("w", encoding="utf-8", newline="\n") as text_output, attribution_path.open(
        "w", encoding="utf-8", newline="\n"
    ) as attribution_output:
        for rank, filename, offset, line_bytes, expected_bytes in selected:
            with filename.open("rb") as handle:
                handle.seek(offset)
                row = json.loads(handle.read(line_bytes))
            block = article_block(row)
            encoded = block.encode("utf-8")
            if len(encoded) != expected_bytes:
                raise ValueError("article normalization changed between selection passes")
            text_output.write(block)
            article_url = str(row.get("url", "")).strip()
            if not article_url:
                title_path = quote(str(row.get("title", "")).replace(" ", "_"), safe="()/:,_-")
                article_url = str(source["project_url"]).rstrip("/") + "/wiki/" + title_path
            attribution = {
                "article_sha256": hashlib.sha256(encoded).hexdigest(),
                "article_url": article_url,
                "dump_url": source["dump_url"],
                "id": str(row.get("id", "")),
                "license": source["license"],
                "license_url": source["license_url"],
                "modified": True,
                "rank_sha256": rank,
                "revid": str(row.get("revid", "")),
                "title": str(row.get("title", "")),
                "transformations": [
                    "WikiExtractor plain-text extraction without template expansion",
                    "Unicode NFC and LF normalization",
                    "control-character and trailing-whitespace removal",
                    "deterministic minimum-hash source sampling",
                ],
            }
            attribution_output.write(json.dumps(attribution, ensure_ascii=False, sort_keys=True) + "\n")
            actual_bytes += len(encoded)
            article_count += 1
    if actual_bytes != text_path.stat().st_size or actual_bytes < target_bytes:
        raise ValueError("prepared source byte accounting failed")
    return {
        "id": source["id"],
        "path": str(text_path.relative_to(ROOT)),
        "sha256": file_hash(text_path),
        "title": source["project"] + " fixed-snapshot sample",
        "author": "Wikimedia contributors",
        "origin_url": source["dump_url"],
        "origin_sha1": source["dump_sha1"],
        "project_url": source["project_url"],
        "license": source["license"],
        "license_url": source["license_url"],
        "attribution_method": source["attribution_method"],
        "attribution_path": str(attribution_path.relative_to(ROOT)),
        "attribution_sha256": file_hash(attribution_path),
        "sampling_weight": source["sampling_weight"],
        "tags": source["tags"],
        "prepared_articles": article_count,
        "prepared_utf8_bytes": actual_bytes,
        "eligible_articles": total_articles,
        "eligible_utf8_bytes": total_clean_bytes,
        "residual_markup_exclusions": residual_markup_exclusions,
    }


def make_registry(
    plan: dict[str, object], plan_path: Path, sources: list[dict[str, object]]
) -> dict[str, object]:
    registry = plan["registry"]
    assert isinstance(registry, dict)
    return {
        "schema": "zero.corpus_sources.v1",
        "dataset_id": plan["dataset_id"],
        "version": plan["version"],
        "release_date": plan["release_date"],
        "description": plan["description"],
        "split_seed": registry["split_seed"],
        "splits": registry["splits"],
        "documents": registry["documents"],
        "deduplication": registry["deduplication"],
        "tokenizer": registry["tokenizer"],
        "contamination_panels": registry["contamination_panels"],
        "acquisition_plan": str(plan_path.relative_to(ROOT)),
        "acquisition_plan_sha256": file_hash(plan_path),
        "extractor": plan["extractor"],
        "legal_notice_url": plan["legal_notice_url"],
        "terms_url": plan["terms_url"],
        "sources": sources,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--work", type=Path, default=ROOT / "build" / "sero-corpus-v1")
    parser.add_argument("--processes", type=int, default=max(1, min(8, os.cpu_count() or 1)))
    args = parser.parse_args()
    plan_path = args.plan.resolve()
    work = args.work.resolve()
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("schema") != "sero.corpus_acquisition.v1":
        raise ValueError("unsupported acquisition plan schema")
    if args.processes < 1:
        raise ValueError("process count must be positive")
    checkout = ensure_extractor(plan, work / "tools")
    extractor = plan["extractor"]
    assert isinstance(extractor, dict)
    target = int(plan["target_clean_utf8_bytes_per_source"])
    minimum = int(plan["minimum_article_utf8_bytes"])
    prepared_sources: list[dict[str, object]] = []
    sources = plan["sources"]
    assert isinstance(sources, list)
    for source_value in sources:
        assert isinstance(source_value, dict)
        source = source_value
        filename = str(source["dump_url"]).rsplit("/", 1)[-1]
        dump_path = work / "raw" / filename
        download(str(source["dump_url"]), dump_path, str(source["dump_sha1"]))
        extraction_path = work / "extracted" / str(source["id"])
        extract_dump(
            checkout,
            dump_path,
            extraction_path,
            source,
            str(extractor["commit"]),
            args.processes,
        )
        prepared_sources.append(
            prepare_source(source, extraction_path, work / "prepared", target, minimum)
        )
        print(
            f"prepared {source['id']}: {prepared_sources[-1]['prepared_articles']} articles, "
            f"{prepared_sources[-1]['prepared_utf8_bytes']} bytes",
            flush=True,
        )
    registry = make_registry(plan, plan_path, prepared_sources)
    registry_path = work / "source-registry.json"
    registry_path.write_text(stable_json(registry), encoding="utf-8")
    print(f"wrote {registry_path}", flush=True)


if __name__ == "__main__":
    main()

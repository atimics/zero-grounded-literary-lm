"""Verified, document-safe token windows for Sero 1 pretraining."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import struct
from typing import Iterator, Sequence

import numpy as np

from tokenizer import Sero1Tokenizer


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@dataclass(frozen=True)
class RawDocument:
    document_id: str
    source_id: str
    data: bytes


@dataclass(frozen=True)
class TokenizedDocument:
    document_id: str
    source_id: str
    token_ids: np.ndarray
    token_byte_lengths: np.ndarray
    raw_bytes: int


@dataclass(frozen=True)
class TokenWindow:
    document_index: int
    document_id: str
    source_id: str
    token_start: int
    token_stop: int
    raw_bytes: int

    def schedule_record(self, epoch: int) -> bytes:
        return (
            f"{epoch}\0{self.document_id}\0{self.token_start}\0{self.token_stop}\n"
        ).encode("utf-8")


class ManifestDocuments:
    def __init__(self, path: Path, manifest: dict, splits: dict[str, list[RawDocument]]) -> None:
        self.path = path
        self.manifest = manifest
        self.splits = splits
        self.dataset_digest = str(manifest["dataset_digest"])

    @classmethod
    def load(cls, specification: Path) -> "ManifestDocuments":
        path = specification.resolve()
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("schema") != "zero.dataset_manifest.v1":
            raise ValueError("Sero 1 requires a zero.dataset_manifest.v1 manifest")
        artifacts = {
            str(row["path"]): row for row in manifest.get("artifacts", [])
            if isinstance(row, dict) and "path" in row
        }
        split_metadata = manifest.get("splits")
        if not isinstance(split_metadata, dict):
            raise ValueError("dataset manifest has no split metadata")
        splits: dict[str, list[RawDocument]] = {}
        for split in ("train", "validation", "test"):
            relative = f"documents/{split}.jsonl"
            artifact = artifacts.get(relative)
            if not isinstance(artifact, dict):
                raise ValueError(f"manifest does not inventory {relative}")
            raw = (path.parent / relative).read_bytes()
            if len(raw) != int(artifact["bytes"]) or digest_bytes(raw) != artifact["sha256"]:
                raise ValueError(f"artifact drift for {relative}")
            documents: list[RawDocument] = []
            for line_number, line in enumerate(raw.decode("utf-8").split("\n"), start=1):
                if not line:
                    continue
                row = json.loads(line)
                data = str(row["text"]).encode("utf-8")
                if len(data) != int(row["bytes"]) or digest_bytes(data) != row["sha256"]:
                    raise ValueError(f"document drift at {relative}:{line_number}")
                documents.append(RawDocument(str(row["id"]), str(row["source_id"]), data))
            expected = split_metadata[split]
            if len(documents) != int(expected["documents"]):
                raise ValueError(f"{split} document count drifted")
            if sum(len(document.data) for document in documents) != int(expected["utf8_bytes"]):
                raise ValueError(f"{split} raw byte count drifted")
            if len({document.document_id for document in documents}) != len(documents):
                raise ValueError(f"{split} document ids are not unique")
            expected_sources = {
                str(row["source_id"]): (int(row["documents"]), int(row["utf8_bytes"]))
                for row in expected["sources"]
            }
            actual_sources = {
                source: (
                    sum(document.source_id == source for document in documents),
                    sum(len(document.data) for document in documents if document.source_id == source),
                )
                for source in {document.source_id for document in documents}
            }
            if actual_sources != expected_sources:
                raise ValueError(f"{split} source accounting drifted")
            splits[split] = documents
        return cls(path, manifest, splits)

    def raw_bytes(self, split: str) -> int:
        return sum(len(document.data) for document in self.splits[split])

    def source_bytes(self, split: str) -> dict[str, int]:
        counts: Counter[str] = Counter()
        for document in self.splits[split]:
            counts[document.source_id] += len(document.data)
        return dict(sorted(counts.items()))


class TokenizedCorpus:
    def __init__(self, source: ManifestDocuments, tokenizer: Sero1Tokenizer, context: int) -> None:
        if context < 2:
            raise ValueError("token context must be at least two")
        self.source = source
        self.tokenizer = tokenizer
        self.context = context
        self.documents: dict[str, list[TokenizedDocument]] = {}
        self.windows: dict[str, list[TokenWindow]] = {}
        for split, raw_documents in source.splits.items():
            tokenized: list[TokenizedDocument] = []
            windows: list[TokenWindow] = []
            for document_index, document in enumerate(raw_documents):
                ids, lengths = tokenizer.encode(document.data)
                if not ids or sum(lengths) != len(document.data):
                    raise ValueError(f"tokenization accounting failed for {document.document_id}")
                token_ids = np.asarray(ids, dtype=np.int64)
                byte_lengths = np.asarray(lengths, dtype=np.int64)
                tokenized.append(TokenizedDocument(
                    document.document_id, document.source_id, token_ids, byte_lengths,
                    len(document.data),
                ))
                for start in range(0, len(ids), context):
                    stop = min(start + context, len(ids))
                    windows.append(TokenWindow(
                        document_index, document.document_id, document.source_id,
                        start, stop, int(byte_lengths[start:stop].sum()),
                    ))
            self.documents[split] = tokenized
            self.windows[split] = windows
            if self.window_raw_bytes(split) != source.raw_bytes(split):
                raise ValueError(f"{split} windows do not cover every raw byte exactly once")

    def token_count(self, split: str) -> int:
        return sum(len(document.token_ids) for document in self.documents[split])

    def window_raw_bytes(self, split: str) -> int:
        return sum(window.raw_bytes for window in self.windows[split])

    def split_digest(self, split: str) -> str:
        digest = hashlib.sha256()
        for document in self.documents[split]:
            digest.update(document.document_id.encode("utf-8"))
            digest.update(b"\0")
            for token_id, length in zip(document.token_ids, document.token_byte_lengths):
                digest.update(struct.pack("<IB", int(token_id), int(length)))
            digest.update(b"\0")
        return digest.hexdigest()

    def ordered_windows(
        self, split: str, order: Sequence[int] | None = None, raw_byte_limit: int = 0,
    ) -> list[TokenWindow]:
        windows = self.windows[split]
        selected = [windows[index] for index in order] if order is not None else list(windows)
        if raw_byte_limit <= 0:
            return selected
        bounded: list[TokenWindow] = []
        exposed = 0
        for window in selected:
            bounded.append(window)
            exposed += window.raw_bytes
            if exposed >= raw_byte_limit:
                break
        return bounded

    def batch_arrays(
        self, split: str, windows: Sequence[TokenWindow],
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        token_ids = np.zeros((len(windows), self.context), dtype=np.int64)
        valid = np.zeros((len(windows), self.context), dtype=np.bool_)
        byte_lengths = np.zeros((len(windows), self.context), dtype=np.int64)
        documents = self.documents[split]
        for row, window in enumerate(windows):
            document = documents[window.document_index]
            count = window.token_stop - window.token_start
            token_ids[row, :count] = document.token_ids[window.token_start:window.token_stop]
            byte_lengths[row, :count] = document.token_byte_lengths[
                window.token_start:window.token_stop
            ]
            valid[row, :count] = True
        return token_ids, valid, byte_lengths


class EodTokenizedCorpus(TokenizedCorpus):
    """Document-safe corpus with a source-absent NUL token after every article."""

    def __init__(
        self, source: ManifestDocuments, tokenizer: Sero1Tokenizer, context: int,
    ) -> None:
        if context < 2:
            raise ValueError("token context must be at least two")
        eod_ids, eod_lengths = tokenizer.encode(b"\0")
        if len(eod_ids) != 1 or eod_lengths != [1]:
            raise ValueError("reserved NUL end-of-document marker must be exactly one token")
        if any(b"\0" in document.data for rows in source.splits.values() for document in rows):
            raise ValueError("reserved NUL end-of-document marker occurs in source text")
        self.source = source
        self.tokenizer = tokenizer
        self.context = context
        self.eod_token_id = eod_ids[0]
        self.documents: dict[str, list[TokenizedDocument]] = {}
        self.windows: dict[str, list[TokenWindow]] = {}
        for split, raw_documents in source.splits.items():
            tokenized: list[TokenizedDocument] = []
            windows: list[TokenWindow] = []
            for document_index, document in enumerate(raw_documents):
                ids, lengths = tokenizer.encode(document.data)
                if not ids or sum(lengths) != len(document.data):
                    raise ValueError(f"tokenization accounting failed for {document.document_id}")
                ids.append(self.eod_token_id)
                lengths.append(0)
                token_ids = np.asarray(ids, dtype=np.int64)
                token_byte_lengths = np.asarray(lengths, dtype=np.int64)
                tokenized.append(TokenizedDocument(
                    document.document_id, document.source_id, token_ids, token_byte_lengths,
                    len(document.data),
                ))
                for start in range(0, len(ids), context):
                    stop = min(start + context, len(ids))
                    windows.append(TokenWindow(
                        document_index, document.document_id, document.source_id,
                        start, stop, int(token_byte_lengths[start:stop].sum()),
                    ))
            self.documents[split] = tokenized
            self.windows[split] = windows
            if self.window_raw_bytes(split) != source.raw_bytes(split):
                raise ValueError(f"{split} windows do not cover every source byte exactly once")

    def eod_count(self, split: str) -> int:
        return len(self.documents[split])

    def content_token_count(self, split: str) -> int:
        return self.token_count(split) - self.eod_count(split)

    def batch_negative_token_ids(
        self, split: str, windows: Sequence[TokenWindow], ngram: int = 4,
    ) -> np.ndarray:
        if ngram < 2:
            raise ValueError("unlikelihood n-gram must be at least two")
        negative = np.full((len(windows), self.context), -1, dtype=np.int64)
        documents = self.documents[split]
        prefix = ngram - 1
        for row, window in enumerate(windows):
            values = documents[window.document_index].token_ids[
                window.token_start:window.token_stop
            ]
            previous: dict[tuple[int, ...], list[int]] = {}
            for index in range(prefix, len(values)):
                key = tuple(int(value) for value in values[index - prefix:index])
                target = int(values[index])
                for candidate in reversed(previous.get(key, [])):
                    if candidate != target:
                        negative[row, index] = candidate
                        break
                previous.setdefault(key, []).append(target)
        return negative


def batches(values: Sequence[TokenWindow], batch_size: int) -> Iterator[list[TokenWindow]]:
    for start in range(0, len(values), batch_size):
        yield list(values[start:start + batch_size])

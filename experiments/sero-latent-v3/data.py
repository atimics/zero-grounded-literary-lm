"""Manifest-bound raw-byte sampling for Sero Latent v3."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Iterator, Sequence

import numpy as np


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Document:
    document_id: str
    source_id: str
    data: bytes
    digest: str


@dataclass(frozen=True)
class SampledWindow:
    data: bytes
    document_id: str
    source_id: str
    start: int

    def schedule_record(self) -> bytes:
        return (
            f"{self.document_id}\0{self.start}\0{len(self.data)}\n".encode("utf-8")
        )


class ManifestCorpus:
    """Verified document splits with weighted raw-byte window sampling."""

    def __init__(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
        splits: dict[str, list[Document]],
        source_weights: dict[str, float],
    ):
        self.manifest_path = manifest_path
        self.manifest = manifest
        self.splits = splits
        self.source_weights = source_weights
        self.dataset_digest = str(manifest["dataset_digest"])
        self._training_cache: dict[int, tuple[list[Document], np.ndarray]] = {}

    @classmethod
    def load(cls, specification: str | Path) -> "ManifestCorpus":
        manifest_path = Path(specification).resolve()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("schema") != "zero.dataset_manifest.v1":
            raise ValueError("V3 requires a zero.dataset_manifest.v1 manifest")
        if not isinstance(manifest.get("dataset_digest"), str):
            raise ValueError("dataset manifest has no digest")
        artifact_rows = manifest.get("artifacts")
        if not isinstance(artifact_rows, list):
            raise ValueError("dataset manifest has no artifact inventory")
        artifacts = {
            str(row["path"]): row
            for row in artifact_rows
            if isinstance(row, dict) and "path" in row
        }

        split_manifest = manifest.get("splits")
        if not isinstance(split_manifest, dict):
            raise ValueError("dataset manifest has no split metadata")
        train_manifest = split_manifest.get("train")
        if not isinstance(train_manifest, dict):
            raise ValueError("dataset manifest has no training split")
        source_rows = train_manifest.get("sources")
        if not isinstance(source_rows, list):
            raise ValueError("training split has no source rows")
        source_weights = {
            str(row["source_id"]): float(row["sampling_weight"])
            for row in source_rows
        }
        if any(weight <= 0 or not np.isfinite(weight) for weight in source_weights.values()):
            raise ValueError("all training source weights must be finite and positive")

        splits: dict[str, list[Document]] = {}
        for split in ("train", "validation"):
            relative_document_path = f"documents/{split}.jsonl"
            document_path = manifest_path.parent / relative_document_path
            if not document_path.is_file():
                raise FileNotFoundError(f"missing manifest document split: {document_path}")
            artifact = artifacts.get(relative_document_path)
            if not isinstance(artifact, dict):
                raise ValueError(f"manifest does not inventory {relative_document_path}")
            document_bytes = document_path.read_bytes()
            if len(document_bytes) != int(artifact["bytes"]):
                raise ValueError(f"artifact byte count drift for {relative_document_path}")
            if sha256(document_bytes) != artifact["sha256"]:
                raise ValueError(f"artifact digest drift for {relative_document_path}")
            documents: list[Document] = []
            for line_number, line in enumerate(
                document_bytes.decode("utf-8").split("\n"), start=1
            ):
                if not line:
                    continue
                row = json.loads(line)
                data = str(row["text"]).encode("utf-8")
                digest = sha256(data)
                if digest != row["sha256"]:
                    raise ValueError(
                        f"document digest drift at {document_path}:{line_number}"
                    )
                if len(data) != int(row["bytes"]):
                    raise ValueError(
                        f"document byte count drift at {document_path}:{line_number}"
                    )
                source_id = str(row["source_id"])
                if split == "train" and source_id not in source_weights:
                    raise ValueError(f"training source {source_id} has no sampling weight")
                documents.append(
                    Document(str(row["id"]), source_id, data, digest)
                )
            if not documents:
                raise ValueError(f"{split} document split is empty")
            if len({document.document_id for document in documents}) != len(documents):
                raise ValueError(f"{split} document ids are not unique")
            expected_split = split_manifest.get(split)
            if not isinstance(expected_split, dict):
                raise ValueError(f"manifest has no {split} split metadata")
            if len(documents) != int(expected_split["documents"]):
                raise ValueError(f"{split} document count drifted")
            if sum(len(document.data) for document in documents) != int(expected_split["utf8_bytes"]):
                raise ValueError(f"{split} byte count drifted")
            expected_sources = {
                str(row["source_id"]): (int(row["documents"]), int(row["utf8_bytes"]))
                for row in expected_split["sources"]
            }
            actual_sources: dict[str, tuple[int, int]] = {}
            for source_id in {document.source_id for document in documents}:
                selected = [document for document in documents if document.source_id == source_id]
                actual_sources[source_id] = (len(selected), sum(len(document.data) for document in selected))
            if actual_sources != expected_sources:
                raise ValueError(f"{split} source accounting drifted")
            splits[split] = documents
        return cls(manifest_path, manifest, splits, source_weights)

    def unique_bytes(self, split: str) -> int:
        return sum(len(document.data) for document in self.splits[split])

    def split_digest(self, split: str) -> str:
        digest = hashlib.sha256()
        for document in self.splits[split]:
            digest.update(document.document_id.encode("utf-8"))
            digest.update(b"\0")
            digest.update(document.data)
            digest.update(b"\0")
        return digest.hexdigest()

    def source_byte_counts(self, split: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for document in self.splits[split]:
            counts[document.source_id] = counts.get(document.source_id, 0) + len(
                document.data
            )
        return dict(sorted(counts.items()))

    def _eligible_training_documents(
        self, context: int
    ) -> tuple[list[Document], np.ndarray]:
        if context < 1:
            raise ValueError("raw-byte context must be positive")
        cached = self._training_cache.get(context)
        if cached is not None:
            return cached
        documents: list[Document] = []
        weights: list[float] = []
        for document in self.splits["train"]:
            starts = len(document.data) - context + 1
            if starts <= 0:
                continue
            documents.append(document)
            weights.append(starts * self.source_weights[document.source_id])
        if not documents:
            raise ValueError("no training document is long enough for the context")
        probabilities = np.asarray(weights, dtype=np.float64)
        probabilities /= probabilities.sum()
        result = (documents, probabilities)
        self._training_cache[context] = result
        return result

    def sample_batch(
        self, rng: np.random.Generator, batch_size: int, context: int
    ) -> list[SampledWindow]:
        if batch_size < 1:
            raise ValueError("batch size must be positive")
        documents, probabilities = self._eligible_training_documents(context)
        choices = rng.choice(len(documents), size=batch_size, p=probabilities)
        windows: list[SampledWindow] = []
        for choice in choices.tolist():
            document = documents[choice]
            maximum_start = len(document.data) - context
            start = int(rng.integers(0, maximum_start + 1))
            data = document.data[start : start + context]
            if len(data) != context:
                raise AssertionError("training sampler returned a short window")
            windows.append(
                SampledWindow(
                    data=data,
                    document_id=document.document_id,
                    source_id=document.source_id,
                    start=start,
                )
            )
        return windows

    def representative_windows(
        self, byte_budget: int, context: int, seed: int
    ) -> Iterator[SampledWindow]:
        if byte_budget < 1:
            raise ValueError("representative sample budget must be positive")
        rng = np.random.default_rng(seed)
        remaining = byte_budget
        while remaining:
            width = min(context, remaining)
            yield self.sample_batch(rng, 1, width)[0]
            remaining -= width

    def validation_windows(self, context: int) -> Iterator[SampledWindow]:
        if context < 1:
            raise ValueError("raw-byte context must be positive")
        for document in self.splits["validation"]:
            for start in range(0, len(document.data), context):
                data = document.data[start : start + context]
                if data:
                    yield SampledWindow(
                        data=data,
                        document_id=document.document_id,
                        source_id=document.source_id,
                        start=start,
                    )


def batch_windows(
    windows: Sequence[SampledWindow], batch_size: int
) -> Iterator[list[SampledWindow]]:
    for start in range(0, len(windows), batch_size):
        yield list(windows[start : start + batch_size])

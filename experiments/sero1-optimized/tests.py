#!/usr/bin/env python3
"""Mechanics checks for the article-safe optimized Sero pilot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
import torch


ROOT = Path(__file__).resolve().parents[2]
PRETRAIN = ROOT / "experiments" / "sero1-pretrain"
sys.path.insert(0, str(PRETRAIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from data import EodTokenizedCorpus, ManifestDocuments  # noqa: E402
from model import Sero1Config, Sero1Model  # noqa: E402
from tokenizer import Sero1Tokenizer  # noqa: E402
from train import loss_for_batch  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--tokenizer", type=Path,
        default=ROOT / "tokenizers" / "sero1-byte-bpe-4096.json",
    )
    return parser.parse_args()


def check_split_units(manifest: Path) -> None:
    seen: set[tuple[str, str, str]] = set()
    for split in ("train", "validation", "test"):
        path = manifest.parent / "documents" / f"{split}.jsonl"
        for line in path.read_text(encoding="utf-8").split("\n"):
            if not line:
                continue
            row = json.loads(line)
            identity = (
                str(row["source_id"]), str(row["source_article_id"]),
                str(row["source_revision_id"]),
            )
            assert identity not in seen
            seen.add(identity)


def check_corpus(manifest: Path, tokenizer: Sero1Tokenizer) -> None:
    documents = ManifestDocuments.load(manifest)
    corpus = EodTokenizedCorpus(documents, tokenizer, 512)
    assert corpus.eod_token_id == 188
    for split in ("train", "validation", "test"):
        assert corpus.eod_count(split) == len(corpus.documents[split])
        assert corpus.content_token_count(split) + corpus.eod_count(split) == \
            corpus.token_count(split)
        assert corpus.window_raw_bytes(split) == documents.raw_bytes(split)
        for document in corpus.documents[split]:
            assert int(document.token_ids[-1]) == corpus.eod_token_id
            assert int(document.token_byte_lengths[-1]) == 0
        sample = corpus.windows[split][:4]
        ids, valid, byte_lengths = corpus.batch_arrays(split, sample)
        assert ids.shape == valid.shape == byte_lengths.shape == (len(sample), 512)
        assert int(byte_lengths.sum()) == sum(window.raw_bytes for window in sample)
    first = corpus.windows["train"][:1]
    negatives = corpus.batch_negative_token_ids("train", first, 4)
    assert negatives.shape == (1, 512)
    assert np.all((negatives == -1) | ((negatives >= 0) & (negatives < tokenizer.vocab_size)))


def check_unlikelihood_loss() -> None:
    torch.manual_seed(7)
    model = Sero1Model(Sero1Config(
        vocabulary_size=32, token_context=8, dimension=16, heads=4, layers=1,
        feed_forward=32,
    ))
    target = torch.tensor([[1, 2, 3, 4, 1, 2, 3, 5]], dtype=torch.long)
    valid = torch.ones_like(target, dtype=torch.bool)
    negative = torch.full_like(target, -1)
    negative[0, 7] = 4
    base, base_totals = loss_for_batch(model, target, valid, None, 0.0)
    combined, totals = loss_for_batch(model, target, valid, negative, 0.1)
    assert torch.isfinite(base) and torch.isfinite(combined)
    assert combined > base
    assert int(base_totals["tokens"]) == target.numel()
    assert int(totals["unlikelihood_tokens"]) == 1
    combined.backward()
    assert all(parameter.grad is None or torch.isfinite(parameter.grad).all()
               for parameter in model.parameters())


def main() -> None:
    args = parse_args()
    tokenizer = Sero1Tokenizer(args.tokenizer)
    check_split_units(args.manifest)
    check_corpus(args.manifest, tokenizer)
    check_unlikelihood_loss()
    print("Sero 1 optimized mechanics passed")


if __name__ == "__main__":
    main()

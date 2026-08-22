#!/usr/bin/env python3
"""Mechanics checks for the Sero 1 pretraining path."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch

from data import ManifestDocuments, TokenizedCorpus
from model import Sero1Config, Sero1Model, parameter_count
from tokenizer import Sero1Tokenizer
from train import epoch_order, tensor_digest


ROOT = Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "build" / "sero-pretrain-v1" / "manifest.json",
    )
    parser.add_argument(
        "--tokenizer", type=Path, default=ROOT / "tokenizers" / "sero1-byte-bpe-4096.json",
    )
    return parser.parse_args()


def check_tokenizer(tokenizer: Sero1Tokenizer) -> None:
    cases = [
        b"", bytes(range(256)), bytes(reversed(range(256))), b"The quick brown fox.\n",
        b"\x00\xff\x80broken-utf8\xc0\xaf", bytes(range(256)) * 5,
    ]
    generator = np.random.default_rng(89)
    cases.extend(generator.integers(0, 256, size=size, dtype=np.uint8).tobytes()
                 for size in (1, 7, 63, 1024))
    for case in cases:
        ids, lengths = tokenizer.encode(case)
        assert tokenizer.decode(ids) == case
        assert sum(lengths) == len(case)
        assert all(1 <= length <= 8 for length in lengths)


def check_model() -> None:
    torch.manual_seed(89)
    config = Sero1Config(
        vocabulary_size=256, token_context=16, dimension=32, heads=4, layers=2,
        feed_forward=64,
    )
    model = Sero1Model(config)
    target = torch.randint(0, 256, (2, 12), dtype=torch.long)
    valid = torch.ones_like(target, dtype=torch.bool)
    changed = target.clone()
    changed[:, 8:] = torch.randint(0, 256, changed[:, 8:].shape)
    model.eval()
    with torch.no_grad():
        before = model(target, valid)
        after = model(changed, valid)
    torch.testing.assert_close(before[:, :9], after[:, :9], rtol=0, atol=0)
    model.train()
    loss, totals = model.loss(target, valid)
    loss.backward()
    assert torch.isfinite(loss)
    assert int(totals["tokens"]) == target.numel()
    assert all(parameter.grad is None or torch.isfinite(parameter.grad).all()
               for parameter in model.parameters())
    assert len(tensor_digest(model)) == 64
    assert parameter_count(Sero1Model(Sero1Config())) == 6021312


def check_data(manifest: Path, tokenizer: Sero1Tokenizer) -> None:
    documents = ManifestDocuments.load(manifest)
    corpus = TokenizedCorpus(documents, tokenizer, 512)
    for split in ("train", "validation", "test"):
        assert corpus.window_raw_bytes(split) == documents.raw_bytes(split)
        assert corpus.token_count(split) > 0
        assert len(corpus.split_digest(split)) == 64
        for window in corpus.windows[split]:
            document = corpus.documents[split][window.document_index]
            assert window.document_id == document.document_id
            assert window.source_id == document.source_id
            assert 0 <= window.token_start < window.token_stop <= len(document.token_ids)
    first = epoch_order(len(corpus.windows["train"]), 0, 0)
    assert np.array_equal(first, epoch_order(len(first), 0, 0))
    assert not np.array_equal(first, epoch_order(len(first), 1, 0))
    assert not np.array_equal(first, epoch_order(len(first), 0, 1))
    sample = corpus.ordered_windows("validation")[:3]
    ids, valid, byte_lengths = corpus.batch_arrays("validation", sample)
    assert ids.shape == valid.shape == byte_lengths.shape == (3, 512)
    assert int(byte_lengths.sum()) == sum(window.raw_bytes for window in sample)


def main() -> None:
    args = parse_args()
    tokenizer = Sero1Tokenizer(args.tokenizer)
    check_tokenizer(tokenizer)
    check_model()
    check_data(args.manifest, tokenizer)
    print("Sero 1 pretraining mechanics passed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Mechanics checks for the frozen Sero curriculum pilot."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
PRETRAIN = ROOT / "experiments" / "sero1-pretrain"
sys.path.insert(0, str(PRETRAIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from data import EodTokenizedCorpus, ManifestDocuments  # noqa: E402
from tokenizer import Sero1Tokenizer  # noqa: E402
from train import build_schedule, load_contract  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--contract", type=Path,
        default=ROOT / "benchmarks" / "sero2-curriculum-v1" / "contract.json",
    )
    parser.add_argument(
        "--tokenizer", type=Path,
        default=ROOT / "tokenizers" / "sero1-byte-bpe-4096.json",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    contract, _ = load_contract(args.contract)
    documents = ManifestDocuments.load(args.manifest)
    tokenizer = Sero1Tokenizer(args.tokenizer)
    corpus = EodTokenizedCorpus(documents, tokenizer, 512)
    seeds = [int(seed) for seed in contract.get(
        "open_seeds", [contract["pilot_seed"]],
    )]
    seed = seeds[0]
    stages, digest = build_schedule(corpus, contract, seed)
    repeated, repeated_digest = build_schedule(corpus, contract, seed)
    assert digest == repeated_digest
    assert len(digest) == 64
    seed_digests = {
        candidate: build_schedule(corpus, contract, candidate)[1]
        for candidate in seeds
    }
    assert len(set(seed_digests.values())) == len(seeds)
    expected_digests = contract.get("expected_schedule_sha256_by_seed")
    if expected_digests is not None:
        assert seed_digests == {
            int(candidate): digest for candidate, digest in expected_digests.items()
        }
    assert [stage["id"] for stage in stages] == [
        rule["id"] for rule in contract["training"]["stages"]
    ]
    assert [stage["scheduled_raw_bytes"] for stage in stages] == [
        stage["scheduled_raw_bytes"] for stage in repeated
    ]
    maximum_window = max(window.raw_bytes for window in corpus.windows["train"])
    for stage, rule in zip(stages, contract["training"]["stages"]):
        assert stage["scheduled_raw_bytes"] >= int(rule["target_raw_bytes"])
        assert stage["scheduled_raw_bytes"] <= (
            int(rule["target_raw_bytes"]) + maximum_window * len(rule["domain_weights"])
        )
        assert sum(value["scheduled_raw_bytes"] for value in stage["domains"].values()) == \
            stage["scheduled_raw_bytes"]
        assert sum(stage["source_raw_bytes"].values()) == stage["scheduled_raw_bytes"]
        for domain, value in stage["domains"].items():
            target = round(int(rule["target_raw_bytes"]) * rule["domain_weights"][domain])
            assert value["target_raw_bytes"] == target
            assert value["scheduled_raw_bytes"] >= target
            assert value["scheduled_raw_bytes"] <= target + maximum_window
    assert sum(stage["target_raw_bytes"] for stage in stages) == \
        contract["training"]["total_target_raw_bytes"]
    assert all(document.token_ids[-1] == corpus.eod_token_id
               for document in corpus.documents["train"])
    print(
        "Sero curriculum mechanics passed: "
        f"{sum(len(stage['windows']) for stage in stages)} scheduled windows, "
        f"seed digests {seed_digests}"
    )


if __name__ == "__main__":
    main()

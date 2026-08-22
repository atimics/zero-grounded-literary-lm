#!/usr/bin/env python3
"""Bind the frozen V3 compute estimate to a training-only corpus sample."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time

from control import BPEConfig, BPETransformer, StaticByteBPE
from data import ManifestCorpus
from model import LatentConfig, SeroLatentModel


ROOT = Path(__file__).resolve().parents[2]


def stable_json(value: object) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path,
                        default=ROOT / "benchmarks" / "sero-latent-v3" / "contract.json")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tokenizer-output", type=Path, required=True)
    args = parser.parse_args()
    contract = json.loads(args.contract.read_text(encoding="utf-8"))
    corpus = ManifestCorpus.load(args.manifest)
    data = contract["data"]
    bpe = contract["bpe_control"]
    latent = contract["latent_model"]
    context = int(data["raw_byte_context"])
    training_bytes = int(bpe["tokenizer_training_bytes"])
    sample = list(corpus.representative_windows(
        training_bytes, context, int(bpe["tokenizer_seed"])
    ))
    schedule = hashlib.sha256()
    for window in sample:
        schedule.update(window.schedule_record())
        schedule.update(window.data)
    started = time.perf_counter()
    tokenizer = StaticByteBPE.train(
        (window.data for window in sample),
        int(bpe["vocabulary_size"]),
        int(bpe["maximum_token_bytes"]),
    )
    tokenizer_seconds = time.perf_counter() - started
    args.tokenizer_output.parent.mkdir(parents=True, exist_ok=True)
    tokenizer.save(args.tokenizer_output)
    token_count = sum(len(tokenizer.encode(window.data)) for window in sample)
    bytes_per_token = training_bytes / token_count
    latent_model = SeroLatentModel(LatentConfig(
        byte_context=context,
        local_dim=int(latent["local_dimension"]),
        local_heads=int(latent["local_heads"]),
        local_encoder_layers=int(latent["local_encoder_layers"]),
        local_decoder_layers=int(latent["local_decoder_layers"]),
        local_ffn_dim=int(latent["local_feed_forward"]),
        local_window=int(latent["local_attention_window"]),
        global_dim=int(latent["global_dimension"]),
        global_heads=int(latent["global_heads"]),
        global_layers=int(latent["global_layers"]),
        global_ffn_dim=int(latent["global_feed_forward"]),
        compression_ratio_target=bytes_per_token,
    ))
    bpe_model = BPETransformer(tokenizer.vocab_size, BPEConfig(
        byte_context=context,
        dim=int(bpe["dimension"]),
        heads=int(bpe["heads"]),
        layers=int(bpe["layers"]),
        ffn_dim=int(bpe["feed_forward"]),
    ))
    expected_positions = context / bytes_per_token
    latent_madds = latent_model.estimated_madds_per_sample(expected_positions)
    bpe_madds = bpe_model.estimated_madds_per_sample(expected_positions)
    result = {
        "schema": "sero.latent_v3_compute_calibration.v1",
        "scope": "training-only",
        "dataset_id": corpus.manifest["dataset_id"],
        "dataset_version": corpus.manifest["version"],
        "dataset_digest": corpus.dataset_digest,
        "unique_training_bytes": corpus.unique_bytes("train"),
        "tokenizer_training_bytes": training_bytes,
        "tokenizer_seed": int(bpe["tokenizer_seed"]),
        "tokenizer_sample_schedule_sha256": schedule.hexdigest(),
        "tokenizer_sha256": tokenizer.digest,
        "tokenizer_vocabulary_size": tokenizer.vocab_size,
        "tokenizer_token_count": token_count,
        "measured_bytes_per_token": bytes_per_token,
        "tokenizer_training_seconds": tokenizer_seconds,
        "estimator": "inference-multiply-adds-v1",
        "latent_madds_per_sample_at_target": latent_madds,
        "bpe_madds_per_sample_at_target": bpe_madds,
        "latent_to_bpe_ratio_at_target": latent_madds / bpe_madds,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(stable_json(result), encoding="utf-8")
    print(stable_json(result), end="")


if __name__ == "__main__":
    main()

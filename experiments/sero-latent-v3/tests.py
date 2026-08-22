#!/usr/bin/env python3
"""Fast invariants for Sero Latent V3."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile

import numpy as np
import torch

from control import BPEConfig, BPETransformer, StaticByteBPE, encode_batch
from data import ManifestCorpus
from model import LatentConfig, SeroLatentModel, hnet_ratio_loss


def tiny_latent_config() -> LatentConfig:
    return LatentConfig(
        byte_context=24,
        local_dim=16,
        local_heads=2,
        local_encoder_layers=1,
        local_decoder_layers=1,
        local_ffn_dim=32,
        local_window=8,
        global_dim=24,
        global_heads=2,
        global_layers=1,
        global_ffn_dim=48,
        router_dim=8,
        compression_ratio_target=2.0,
    )


def check_latent_model() -> None:
    torch.manual_seed(7)
    model = SeroLatentModel(tiny_latent_config())
    target = torch.randint(0, 256, (2, 16), dtype=torch.long)
    output = model(target)
    assert output.logits.shape == (2, 16, 256)
    assert torch.isfinite(output.logits).all()
    assert torch.isfinite(output.ratio_loss)
    assert output.hard_boundary[:, 0].all()
    assert torch.all((output.boundary_probability >= 0.0) & (output.boundary_probability <= 1.0))

    objective, metrics = model.loss(target)
    assert torch.isfinite(objective)
    objective.backward()
    router_gradient = sum(
        float(parameter.grad.abs().sum().item())
        for parameter in model.router.parameters()
        if parameter.grad is not None
    )
    assert router_gradient > 0.0
    assert int(metrics["byte_count"].item()) == target.numel()


def check_causality() -> None:
    torch.manual_seed(11)
    model = SeroLatentModel(tiny_latent_config()).eval()
    original = torch.randint(0, 256, (1, 16), dtype=torch.long)
    changed = original.clone()
    changed[:, 8:] = torch.randint(0, 256, (1, 8), dtype=torch.long)
    with torch.no_grad():
        first = model(original)
        second = model(changed)
    # Position 8 predicts byte 8 from bytes 0..7, so changing byte 8 and later
    # must not change logits or routing through that position.
    assert torch.allclose(first.logits[:, :9], second.logits[:, :9], atol=1e-6, rtol=1e-5)
    assert torch.equal(first.hard_boundary[:, :9], second.hard_boundary[:, :9])
    assert torch.allclose(
        first.boundary_probability[:, :9], second.boundary_probability[:, :9], atol=1e-6, rtol=1e-5
    )


def check_padding_invariance() -> None:
    torch.manual_seed(13)
    model = SeroLatentModel(tiny_latent_config()).eval()
    short = torch.randint(0, 256, (1, 7), dtype=torch.long)
    padded = torch.zeros(2, 11, dtype=torch.long)
    valid = torch.zeros(2, 11, dtype=torch.bool)
    padded[0, :7] = short[0]
    valid[0, :7] = True
    padded[1] = torch.randint(0, 256, (11,), dtype=torch.long)
    valid[1] = True
    with torch.no_grad():
        alone = model(short).logits
        together = model(padded, valid).logits[0, :7]
    assert torch.allclose(alone[0], together, atol=1e-6, rtol=1e-5)


def check_ratio_loss_direction() -> None:
    probability = torch.full((1, 8), 0.5, requires_grad=True)
    hard = torch.tensor([[True, False, True, False, True, False, True, False]])
    valid = torch.ones_like(hard)
    loss = hnet_ratio_loss(probability, hard, valid, compression_ratio_target=4.0)
    loss.backward()
    # With too many selected chunks (1/2 instead of 1/4), gradient descent must
    # reduce the soft boundary probabilities.
    assert probability.grad is not None
    assert torch.all(probability.grad > 0)


def check_bpe() -> None:
    training = [
        b"the quick brown fox jumps over the lazy dog\n" * 8,
        bytes(range(256)) * 2,
        b"embedding boundaries should be reversible\n" * 8,
    ]
    tokenizer = StaticByteBPE.train(training, vocab_size=384, max_token_length=8)
    repeated = StaticByteBPE.train(training, vocab_size=384, max_token_length=8)
    assert repeated.digest == tokenizer.digest
    probes = [b"", bytes(range(256)), b"\x00\xff\x80text\n", training[0]]
    for probe in probes:
        assert tokenizer.decode(tokenizer.encode(probe)) == probe
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "tokenizer.json"
        tokenizer.save(path)
        loaded = StaticByteBPE.load(path)
        assert loaded.digest == tokenizer.digest
        assert loaded.decode(loaded.encode(bytes(range(255, -1, -1)))) == bytes(range(255, -1, -1))

    model = BPETransformer(
        tokenizer.vocab_size, BPEConfig(byte_context=24, dim=16, heads=2, layers=1, ffn_dim=32)
    )
    raw = [b"the quick brown fox", b"\x00\xffshort"]
    ids, valid, raw_bytes, _ = encode_batch(tokenizer, raw, torch.device("cpu"))
    logits = model(ids, valid)
    assert logits.shape[-1] == tokenizer.vocab_size
    loss, metrics = model.loss(ids, valid, raw_bytes)
    loss.backward()
    assert int(metrics["byte_count"].item()) == sum(map(len, raw))


def check_manifest(path: Path) -> None:
    corpus = ManifestCorpus.load(path)
    assert corpus.unique_bytes("train") > 0
    assert corpus.unique_bytes("validation") > 0
    first = corpus.sample_batch(np.random.default_rng(5), batch_size=16, context=32)
    second = corpus.sample_batch(np.random.default_rng(5), batch_size=16, context=32)
    assert [window.schedule_record() for window in first] == [
        window.schedule_record() for window in second
    ]
    for window in first:
        document = next(
            document
            for document in corpus.splits["train"]
            if document.document_id == window.document_id
        )
        assert document.data[window.start:window.start + len(window.data)] == window.data


def check_jsonl_record_boundary() -> None:
    implementation = (
        Path(__file__).resolve().parent / "data.py"
    ).read_text(encoding="utf-8")
    assert '.split("\\n")' in implementation
    assert ".splitlines()" not in implementation


def check_compute_contract(path: Path) -> None:
    contract = json.loads(path.read_text(encoding="utf-8"))
    latent = contract["latent_model"]
    bpe = contract["bpe_control"]
    data = contract["data"]
    calibration = contract["compute_calibration"]
    context = int(data["raw_byte_context"])
    bytes_per_token = float(calibration["measured_bytes_per_token"])
    latent_model = SeroLatentModel(
        LatentConfig(
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
        )
    )
    bpe_model = BPETransformer(
        int(bpe["vocabulary_size"]),
        BPEConfig(
            byte_context=context,
            dim=int(bpe["dimension"]),
            heads=int(bpe["heads"]),
            layers=int(bpe["layers"]),
            ffn_dim=int(bpe["feed_forward"]),
        ),
    )
    expected_positions = context / bytes_per_token
    ratio = latent_model.estimated_madds_per_sample(expected_positions)
    ratio /= bpe_model.estimated_madds_per_sample(expected_positions)
    assert abs(ratio - float(calibration["latent_to_bpe_ratio_at_target"])) < 1e-12
    assert float(contract["gates"]["estimated_compute_ratio_minimum"]) <= ratio
    assert ratio <= float(contract["gates"]["estimated_compute_ratio_maximum"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--contract",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "benchmarks/sero-latent-v3/contract.json",
    )
    args = parser.parse_args()
    check_latent_model()
    check_causality()
    check_padding_invariance()
    check_ratio_loss_direction()
    check_bpe()
    check_jsonl_record_boundary()
    check_manifest(args.manifest)
    check_compute_contract(args.contract)
    print("sero-latent-v3 invariants: ok")


if __name__ == "__main__":
    main()

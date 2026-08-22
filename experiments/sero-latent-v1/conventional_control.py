#!/usr/bin/env python3
"""Compute-matched conventional byte-BPE Transformer control for Sero Latent v1."""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from tokenizers import Tokenizer

import train as latent


LOG2 = math.log(2.0)


class TokenCorpus:
    def __init__(self, token_ids: list[int], patches: list[bytes]):
        if len(token_ids) != len(patches) or len(token_ids) < 2:
            raise ValueError("token ids and byte patches must be aligned")
        self.ids = np.asarray(token_ids, dtype=np.int64)
        self.byte_lengths = np.asarray([len(patch) for patch in patches], dtype=np.int64)

    @property
    def token_count(self) -> int:
        return len(self.ids)

    def batch(
        self, starts: np.ndarray, context: int, device: torch.device
    ) -> tuple[torch.Tensor, torch.Tensor]:
        indices = starts[:, None] + np.arange(context)[None, :]
        return (
            torch.from_numpy(self.ids[indices]).to(device),
            torch.from_numpy(self.byte_lengths[indices]).to(device),
        )


class ConventionalTokenTransformer(nn.Module):
    def __init__(
        self,
        vocabulary_size: int,
        dimension: int,
        heads: int,
        layers: int,
        feed_forward: int,
        token_context: int,
    ):
        super().__init__()
        self.vocabulary_size = vocabulary_size
        self.dimension = dimension
        self.token_context = token_context
        self.token_embedding = nn.Embedding(vocabulary_size, dimension)
        self.token_bos = nn.Parameter(torch.empty(dimension))
        self.position = nn.Parameter(torch.empty(token_context, dimension))
        layer = nn.TransformerEncoderLayer(
            d_model=dimension,
            nhead=heads,
            dim_feedforward=feed_forward,
            dropout=0.0,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(dimension)
        self.token_bias = nn.Parameter(torch.zeros(vocabulary_size))
        nn.init.normal_(self.token_bos, mean=0.0, std=dimension ** -0.5)
        nn.init.normal_(self.position, mean=0.0, std=dimension ** -0.5)

    def forward(self, targets: torch.Tensor) -> torch.Tensor:
        batch, tokens = targets.shape
        if tokens != self.token_context:
            raise ValueError("token batch does not match frozen context")
        previous = torch.cat(
            [
                self.token_bos.reshape(1, 1, -1).expand(batch, 1, -1),
                self.token_embedding(targets[:, :-1]),
            ],
            dim=1,
        )
        previous = previous + self.position[None, :, :]
        causal_mask = torch.triu(
            torch.ones(tokens, tokens, dtype=torch.bool, device=targets.device), diagonal=1
        )
        hidden = self.norm(self.transformer(previous, mask=causal_mask))
        return hidden @ self.token_embedding.weight.T + self.token_bias


def token_loss(
    logits: torch.Tensor, targets: torch.Tensor, byte_lengths: torch.Tensor
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    nats = F.cross_entropy(
        logits.reshape(-1, logits.shape[-1]), targets.reshape(-1), reduction="sum"
    )
    raw_bytes = byte_lengths.sum()
    return nats / raw_bytes, nats, raw_bytes


@dataclass
class Totals:
    nats: float = 0.0
    raw_bytes: int = 0
    tokens: int = 0

    def metrics(self) -> dict[str, float | int]:
        return {
            "total_bits_per_raw_byte": self.nats / (self.raw_bytes * LOG2),
            "raw_bytes": self.raw_bytes,
            "tokens": self.tokens,
        }


@torch.no_grad()
def evaluate(
    model: ConventionalTokenTransformer,
    corpus: TokenCorpus,
    batch_size: int,
    device: torch.device,
) -> dict[str, float | int]:
    context = model.token_context
    starts = np.arange(0, corpus.token_count - context + 1, context, dtype=np.int64)
    if len(starts) == 0:
        raise ValueError("validation corpus is shorter than one token context")
    total = Totals()
    model.eval()
    started = time.perf_counter()
    for offset in range(0, len(starts), batch_size):
        token_ids, byte_lengths = corpus.batch(starts[offset : offset + batch_size], context, device)
        logits = model(token_ids)
        _, nats, raw_bytes = token_loss(logits, token_ids, byte_lengths)
        total.nats += float(nats)
        total.raw_bytes += int(raw_bytes)
        total.tokens += token_ids.numel()
    metrics = total.metrics()
    wall = time.perf_counter() - started
    metrics["wall_seconds"] = wall
    metrics["model_bytes_per_second"] = total.raw_bytes / max(wall, 1e-9)
    return metrics


def estimated_madds_per_position(
    dimension: int, layers: int, feed_forward: int, context: int, vocabulary_size: int
) -> float:
    transformer = layers * (
        4 * dimension * dimension
        + 2 * context * dimension
        + 2 * dimension * feed_forward
    )
    return float(transformer + dimension * vocabulary_size)


def estimated_latent_madds_per_position(
    dimension: int,
    layers: int,
    feed_forward: int,
    context: int,
    max_patch: int,
    average_patch_bytes: float,
) -> float:
    encoder = average_patch_bytes * 6 * dimension * dimension
    transformer = layers * (
        4 * dimension * dimension
        + 2 * context * dimension
        + 2 * dimension * feed_forward
    )
    decoder = (max_patch + 1) * (6 * dimension * dimension + dimension * 257)
    return float(encoder + transformer + decoder + dimension * dimension)


def run(arguments: argparse.Namespace) -> dict[str, object]:
    latent.configure_determinism(arguments.seed, arguments.threads)
    device = torch.device(arguments.device)
    train_bytes, train_paths = latent.read_bound_input(arguments.train, arguments.train_limit)
    validation_bytes, validation_paths = latent.read_bound_input(
        arguments.validation, arguments.validation_limit
    )
    tokenizer_path = Path(arguments.tokenizer)
    tokenizer_digest = latent.sha256(tokenizer_path.read_bytes())
    if tokenizer_digest != arguments.tokenizer_sha256:
        raise ValueError("frozen static tokenizer digest drifted")
    tokenizer = latent.StaticByteBPE(
        Tokenizer.from_file(str(tokenizer_path)), arguments.vocab_size, arguments.max_patch
    )
    train_patches, train_ids = tokenizer.encode_with_ids(train_bytes)
    validation_patches, validation_ids = tokenizer.encode_with_ids(validation_bytes)
    train_corpus = TokenCorpus(train_ids, train_patches)
    validation_corpus = TokenCorpus(validation_ids, validation_patches)

    torch.manual_seed(arguments.seed + 1)
    model = ConventionalTokenTransformer(
        arguments.vocab_size,
        arguments.dimension,
        arguments.heads,
        arguments.layers,
        arguments.feed_forward,
        arguments.context,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=arguments.learning_rate, weight_decay=0.01)
    rng = np.random.default_rng(arguments.seed + 2)
    trace: list[dict[str, float | int]] = []
    record_at = {
        1,
        arguments.steps,
        max(1, arguments.steps // 4),
        max(1, arguments.steps // 2),
        max(1, 3 * arguments.steps // 4),
    }
    exposed_bytes = 0
    model.train()
    started = time.perf_counter()
    for update in range(1, arguments.steps + 1):
        starts = rng.integers(
            0,
            train_corpus.token_count - arguments.context,
            size=arguments.batch_size,
            dtype=np.int64,
        )
        token_ids, byte_lengths = train_corpus.batch(starts, arguments.context, device)
        logits = model(token_ids)
        loss, _, raw_bytes = token_loss(logits, token_ids, byte_lengths)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        exposed_bytes += int(raw_bytes.detach())
        if update in record_at:
            trace.append(
                {
                    "update": update,
                    "training_bits_per_raw_byte": float(loss.detach()) / LOG2,
                    "gradient_norm": float(gradient_norm),
                }
            )
    training_wall = time.perf_counter() - started
    validation = evaluate(model, validation_corpus, arguments.batch_size, device)
    model_path = Path(arguments.artifact)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "configuration": {
                "vocabulary_size": arguments.vocab_size,
                "dimension": arguments.dimension,
                "heads": arguments.heads,
                "layers": arguments.layers,
                "feed_forward": arguments.feed_forward,
                "context": arguments.context,
            },
        },
        model_path,
    )

    latent_result = json.loads(Path(arguments.latent_result).read_text())
    if latent_result["inputs"]["train_sha256"] != latent.sha256(train_bytes):
        raise ValueError("latent result is bound to different training bytes")
    if latent_result["inputs"]["validation_sha256"] != latent.sha256(validation_bytes):
        raise ValueError("latent result is bound to different validation bytes")
    latent_arm = latent_result["arms"]["latent"]
    latent_bpb = latent_arm["validation"]["total_bits_per_raw_byte"]
    conventional_bpb = validation["total_bits_per_raw_byte"]
    conventional_madds = estimated_madds_per_position(
        arguments.dimension,
        arguments.layers,
        arguments.feed_forward,
        arguments.context,
        arguments.vocab_size,
    )
    latent_configuration = latent_result["configuration"]["language_model"]
    latent_average_patch = latent_result["latent_tokenizer"]["training_distribution"][
        "bytes_per_patch"
    ]
    latent_madds = estimated_latent_madds_per_position(
        latent_configuration["dimension"],
        latent_configuration["layers"],
        latent_configuration["feed_forward"],
        latent_configuration["patch_context"],
        latent_configuration["max_patch"],
        latent_average_patch,
    )
    compute_ratio = conventional_madds / latent_madds
    raw_byte_ratio = exposed_bytes / latent_arm["raw_bytes_seen"]
    exact = b"".join(train_patches) == train_bytes and b"".join(validation_patches) == validation_bytes
    compute_matched = 0.90 <= compute_ratio <= 1.10
    exposure_matched = 0.95 <= raw_byte_ratio <= 1.05
    conventional_wins = conventional_bpb <= latent_bpb
    decision = "retain-static-control" if conventional_wins else "advance-latent-over-conventional"
    return {
        "schema": "sero.latent_v1_conventional_result.v1",
        "experiment": "sero-latent-v1-conventional-control",
        "decision": decision,
        "seed": arguments.seed,
        "inputs": {
            "train_paths": train_paths,
            "validation_paths": validation_paths,
            "train_sha256": latent.sha256(train_bytes),
            "validation_sha256": latent.sha256(validation_bytes),
            "train_bytes": len(train_bytes),
            "validation_bytes": len(validation_bytes),
        },
        "tokenizer": {
            "artifact": str(tokenizer_path),
            "sha256": tokenizer_digest,
            "vocabulary_size": arguments.vocab_size,
            "exact_roundtrip": exact,
        },
        "model": {
            "dimension": arguments.dimension,
            "heads": arguments.heads,
            "layers": arguments.layers,
            "feed_forward": arguments.feed_forward,
            "context": arguments.context,
            "parameters": sum(parameter.numel() for parameter in model.parameters()),
            "updates": arguments.steps,
            "patch_positions_seen": arguments.steps * arguments.batch_size * arguments.context,
            "raw_bytes_seen": exposed_bytes,
            "training_wall_seconds": training_wall,
            "trace": trace,
            "validation": validation,
            "artifact": str(model_path),
        },
        "comparison": {
            "latent_parameters": latent_arm["parameters"],
            "latent_total_bits_per_raw_byte": latent_bpb,
            "conventional_total_bits_per_raw_byte": conventional_bpb,
            "conventional_to_latent_bits_per_byte": conventional_bpb / latent_bpb,
            "conventional_to_latent_training_raw_bytes": raw_byte_ratio,
            "estimated_conventional_madds_per_patch_position": conventional_madds,
            "estimated_latent_madds_per_patch_position": latent_madds,
            "conventional_to_latent_estimated_madds": compute_ratio,
        },
        "gates": {
            "exact_roundtrip": exact,
            "training_exposure_within_five_percent": exposure_matched,
            "estimated_compute_within_ten_percent": compute_matched,
            "conventional_matches_or_beats_latent": conventional_wins,
        },
    }


def self_test() -> None:
    latent.configure_determinism(3, 1)
    model = ConventionalTokenTransformer(300, 16, 2, 1, 32, 4)
    targets = torch.tensor([[1, 2, 3, 4], [4, 3, 2, 1]])
    lengths = torch.tensor([[1, 2, 1, 3], [2, 1, 2, 1]])
    logits = model(targets)
    loss, _, _ = token_loss(logits, targets, lengths)
    assert torch.isfinite(loss)
    loss.backward()
    assert all(parameter.grad is not None for parameter in model.parameters())
    changed = targets.clone()
    changed[:, -1] ^= 1
    with torch.no_grad():
        left = model(targets)
        right = model(changed)
    assert torch.equal(left[:, :-1], right[:, :-1]), "conventional control used future tokens"
    print("Sero conventional control self-test passed")


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--train", action="append", default=[])
    command.add_argument("--validation", action="append", default=[])
    command.add_argument("--train-limit", type=int, default=1048576)
    command.add_argument("--validation-limit", type=int, default=131072)
    command.add_argument("--tokenizer", default="build/sero-latent-v1/static-byte-bpe.json")
    command.add_argument(
        "--tokenizer-sha256",
        default="59d13ac8133835e85b3414df5ec06c9145c860ceb1e7cc65efc90f50acc7caf1",
    )
    command.add_argument("--vocab-size", type=int, default=4096)
    command.add_argument("--max-patch", type=int, default=8)
    command.add_argument("--dimension", type=int, default=48)
    command.add_argument("--heads", type=int, default=4)
    command.add_argument("--layers", type=int, default=4)
    command.add_argument("--feed-forward", type=int, default=192)
    command.add_argument("--context", type=int, default=16)
    command.add_argument("--steps", type=int, default=300)
    command.add_argument("--batch-size", type=int, default=8)
    command.add_argument("--learning-rate", type=float, default=0.001)
    command.add_argument("--seed", type=int, default=0)
    command.add_argument("--threads", type=int, default=4)
    command.add_argument("--device", default="cpu")
    command.add_argument("--latent-result", default="benchmarks/sero-latent-v1/result.json")
    command.add_argument("--artifact", default="build/sero-latent-v1/conventional-token-lm.pt")
    command.add_argument(
        "--result", default="benchmarks/sero-latent-v1/conventional-result.json"
    )
    command.add_argument("--self-test", action="store_true")
    return command


def main() -> None:
    arguments = parser().parse_args()
    if arguments.self_test:
        self_test()
        return
    if not arguments.train or not arguments.validation:
        raise SystemExit("--train and --validation are required outside --self-test")
    result = run(arguments)
    output = Path(arguments.result)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(latent.stable_json(result), encoding="utf-8")
    print(
        latent.stable_json(
            {
                "decision": result["decision"],
                "conventional_total_bits_per_raw_byte": result["model"]["validation"][
                    "total_bits_per_raw_byte"
                ],
                "latent_total_bits_per_raw_byte": result["comparison"][
                    "latent_total_bits_per_raw_byte"
                ],
                "result": str(output),
            }
        ),
        end="",
    )


if __name__ == "__main__":
    main()

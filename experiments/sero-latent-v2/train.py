#!/usr/bin/env python3
"""Sero Latent v2: direct discrete patch codes with an exact escape path."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

V1_DIRECTORY = Path(__file__).resolve().parents[1] / "sero-latent-v1"
sys.path.insert(0, str(V1_DIRECTORY))
import train as v1  # noqa: E402


LOG2 = math.log(2.0)
EOP = 256


class PatchCodebook:
    """Training-only exact dictionary plus one lossless residual escape code."""

    def __init__(self, entries: list[bytes], vocabulary_size: int):
        if vocabulary_size < 2 or len(entries) != vocabulary_size - 1:
            raise ValueError("codebook requires exactly vocabulary_size - 1 entries")
        if len(set(entries)) != len(entries) or any(not entry for entry in entries):
            raise ValueError("codebook entries must be unique and non-empty")
        self.entries = entries
        self.vocabulary_size = vocabulary_size
        self.escape_id = vocabulary_size - 1
        self.lookup = {patch: index for index, patch in enumerate(entries)}

    @classmethod
    def train(cls, patches: list[bytes], vocabulary_size: int) -> "PatchCodebook":
        counts = Counter(patches)
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        if len(ranked) < vocabulary_size - 1:
            raise ValueError("training split has too few unique patches for the frozen codebook")
        return cls([patch for patch, _ in ranked[: vocabulary_size - 1]], vocabulary_size)

    def encode(self, patches: list[bytes]) -> np.ndarray:
        return np.asarray(
            [self.lookup.get(patch, self.escape_id) for patch in patches], dtype=np.int64
        )

    def reconstruct(self, codes: np.ndarray, patches: list[bytes]) -> bytes:
        if len(codes) != len(patches):
            raise ValueError("codes and residual sources are not aligned")
        output: list[bytes] = []
        for code, patch in zip(codes.tolist(), patches):
            if code == self.escape_id:
                output.append(patch)
            elif 0 <= code < len(self.entries):
                output.append(self.entries[code])
            else:
                raise ValueError("code outside vocabulary")
        return b"".join(output)

    def metrics(self, patches: list[bytes], codes: np.ndarray) -> dict[str, float | int]:
        escaped = codes == self.escape_id
        lengths = np.asarray([len(patch) for patch in patches], dtype=np.int64)
        escaped_patches = int(escaped.sum())
        escaped_bytes = int(lengths[escaped].sum())
        return {
            "patches": len(patches),
            "raw_bytes": int(lengths.sum()),
            "exact_code_patches": len(patches) - escaped_patches,
            "escape_patches": escaped_patches,
            "exact_code_patch_fraction": 1.0 - escaped_patches / len(patches),
            "exact_code_raw_byte_fraction": 1.0 - escaped_bytes / int(lengths.sum()),
            "bytes_per_patch": float(lengths.mean()),
            "escape_bytes_per_patch": (
                escaped_bytes / escaped_patches if escaped_patches else 0.0
            ),
            "maximum_patch_bytes": int(lengths.max()),
        }

    def save(self, path: Path, training_counts: Counter[bytes]) -> None:
        document = {
            "schema": "sero.discrete_patch_codebook.v1",
            "vocabulary_size": self.vocabulary_size,
            "escape_id": self.escape_id,
            "entries": [
                {"id": index, "bytes_hex": patch.hex(), "training_count": training_counts[patch]}
                for index, patch in enumerate(self.entries)
            ],
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(v1.stable_json(document), encoding="utf-8")


class CodeCorpus:
    def __init__(self, patches: list[bytes], codes: np.ndarray, max_patch: int):
        if len(patches) != len(codes) or len(patches) < 2:
            raise ValueError("patches and codes must be aligned")
        self.codes = codes
        self.lengths = np.asarray([len(patch) for patch in patches], dtype=np.int64)
        self.values = np.zeros((len(patches), max_patch), dtype=np.uint8)
        for index, patch in enumerate(patches):
            if not patch or len(patch) > max_patch:
                raise ValueError("invalid patch size")
            self.values[index, : len(patch)] = np.frombuffer(patch, dtype=np.uint8)

    @property
    def patch_count(self) -> int:
        return len(self.codes)

    def batch(
        self, starts: np.ndarray, context: int, device: torch.device
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        indices = starts[:, None] + np.arange(context)[None, :]
        return (
            torch.from_numpy(self.codes[indices]).to(device),
            torch.from_numpy(self.values[indices].astype(np.int64)).to(device),
            torch.from_numpy(self.lengths[indices]).to(device),
        )


class DiscretePatchLanguageModel(nn.Module):
    """Predict one code per patch; decode bytes only for the escape code."""

    def __init__(
        self,
        vocabulary_size: int,
        dimension: int,
        heads: int,
        layers: int,
        feed_forward: int,
        patch_context: int,
        max_patch: int,
    ):
        super().__init__()
        self.vocabulary_size = vocabulary_size
        self.escape_id = vocabulary_size - 1
        self.dimension = dimension
        self.patch_context = patch_context
        self.max_patch = max_patch
        self.code_embedding = nn.Embedding(vocabulary_size, dimension)
        self.patch_bos = nn.Parameter(torch.empty(dimension))
        self.patch_position = nn.Parameter(torch.empty(patch_context, dimension))
        layer = nn.TransformerEncoderLayer(
            d_model=dimension,
            nhead=heads,
            dim_feedforward=feed_forward,
            dropout=0.0,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.global_transformer = nn.TransformerEncoder(
            layer, num_layers=layers, enable_nested_tensor=False
        )
        self.global_norm = nn.LayerNorm(dimension)
        self.code_bias = nn.Parameter(torch.zeros(vocabulary_size))

        self.byte_embedding = nn.Embedding(256, dimension)
        self.byte_bos = nn.Parameter(torch.empty(dimension))
        self.residual_initial = nn.Linear(dimension, dimension)
        self.residual_decoder = nn.GRU(dimension, dimension, batch_first=True)
        self.byte_bias = nn.Parameter(torch.zeros(256))
        self.eop_output = nn.Linear(dimension, 1)
        nn.init.normal_(self.patch_bos, mean=0.0, std=dimension ** -0.5)
        nn.init.normal_(self.patch_position, mean=0.0, std=dimension ** -0.5)
        nn.init.normal_(self.byte_bos, mean=0.0, std=dimension ** -0.5)

    def forward(
        self, codes: torch.Tensor, values: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor | None, torch.Tensor]:
        batch, patches = codes.shape
        if patches != self.patch_context or values.shape != (batch, patches, self.max_patch):
            raise ValueError("batch does not match the frozen V2 model contract")
        previous = torch.cat(
            [
                self.patch_bos.reshape(1, 1, -1).expand(batch, 1, -1),
                self.code_embedding(codes[:, :-1]),
            ],
            dim=1,
        )
        previous = previous + self.patch_position[None, :, :]
        causal_mask = torch.triu(
            torch.ones(patches, patches, dtype=torch.bool, device=codes.device), diagonal=1
        )
        context = self.global_norm(self.global_transformer(previous, mask=causal_mask))
        code_logits = context @ self.code_embedding.weight.T + self.code_bias

        flat_codes = codes.reshape(-1)
        escape_indices = torch.nonzero(flat_codes == self.escape_id, as_tuple=False).squeeze(-1)
        if escape_indices.numel() == 0:
            return code_logits, None, escape_indices
        flat_values = values.reshape(batch * patches, self.max_patch)[escape_indices]
        flat_context = context.reshape(batch * patches, self.dimension)[escape_indices]
        embedded = self.byte_embedding(flat_values)
        decoder_inputs = torch.cat(
            [
                self.byte_bos.reshape(1, 1, -1).expand(len(escape_indices), 1, -1),
                embedded,
            ],
            dim=1,
        )
        initial = torch.tanh(self.residual_initial(flat_context)).unsqueeze(0)
        decoded, _ = self.residual_decoder(decoder_inputs, initial)
        byte_logits = decoded @ self.byte_embedding.weight.T + self.byte_bias
        residual_logits = torch.cat([byte_logits, self.eop_output(decoded)], dim=-1)
        return code_logits, residual_logits, escape_indices


@dataclass
class LossTotals:
    code_nats: float = 0.0
    residual_nats: float = 0.0
    residual_byte_nats: float = 0.0
    residual_eop_nats: float = 0.0
    raw_bytes: int = 0
    patches: int = 0
    escapes: int = 0

    def metrics(self) -> dict[str, float | int]:
        total = self.code_nats + self.residual_nats
        return {
            "total_bits_per_raw_byte": total / (self.raw_bytes * LOG2),
            "code_bits_per_raw_byte": self.code_nats / (self.raw_bytes * LOG2),
            "residual_byte_bits_per_raw_byte": self.residual_byte_nats / (self.raw_bytes * LOG2),
            "residual_boundary_bits_per_raw_byte": self.residual_eop_nats / (self.raw_bytes * LOG2),
            "raw_bytes": self.raw_bytes,
            "patches": self.patches,
            "escape_patches": self.escapes,
        }


def loss_components(
    model: DiscretePatchLanguageModel,
    code_logits: torch.Tensor,
    residual_logits: torch.Tensor | None,
    escape_indices: torch.Tensor,
    codes: torch.Tensor,
    values: torch.Tensor,
    lengths: torch.Tensor,
) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
    batch, patches = codes.shape
    code_nats = F.cross_entropy(
        code_logits.reshape(-1, model.vocabulary_size), codes.reshape(-1), reduction="sum"
    )
    raw_bytes = lengths.sum()
    zero = code_nats.new_zeros(())
    residual_nats = zero
    residual_byte_nats = zero
    residual_eop_nats = zero
    if residual_logits is not None:
        escaped_values = values.reshape(batch * patches, model.max_patch)[escape_indices]
        escaped_lengths = lengths.reshape(batch * patches)[escape_indices]
        targets = torch.full(
            (len(escape_indices), model.max_patch + 1),
            EOP,
            dtype=torch.long,
            device=codes.device,
        )
        targets[:, : model.max_patch] = escaped_values
        positions = torch.arange(model.max_patch + 1, device=codes.device)[None, :]
        mask = positions <= escaped_lengths[:, None]
        byte_mask = positions < escaped_lengths[:, None]
        eop_mask = positions == escaped_lengths[:, None]
        per_target = F.cross_entropy(
            residual_logits.reshape(-1, EOP + 1), targets.reshape(-1), reduction="none"
        ).reshape(len(escape_indices), model.max_patch + 1)
        residual_nats = (per_target * mask).sum()
        residual_byte_nats = (per_target * byte_mask).sum()
        residual_eop_nats = (per_target * eop_mask).sum()
    total_loss = (code_nats + residual_nats) / raw_bytes
    return total_loss, {
        "code_nats": code_nats,
        "residual_nats": residual_nats,
        "residual_byte_nats": residual_byte_nats,
        "residual_eop_nats": residual_eop_nats,
        "raw_bytes": raw_bytes,
        "patches": torch.tensor(batch * patches, device=codes.device),
        "escapes": torch.tensor(len(escape_indices), device=codes.device),
    }


def add_totals(total: LossTotals, parts: dict[str, torch.Tensor]) -> None:
    total.code_nats += float(parts["code_nats"].detach())
    total.residual_nats += float(parts["residual_nats"].detach())
    total.residual_byte_nats += float(parts["residual_byte_nats"].detach())
    total.residual_eop_nats += float(parts["residual_eop_nats"].detach())
    total.raw_bytes += int(parts["raw_bytes"].detach())
    total.patches += int(parts["patches"].detach())
    total.escapes += int(parts["escapes"].detach())


@torch.no_grad()
def evaluate(
    model: DiscretePatchLanguageModel,
    corpus: CodeCorpus,
    batch_size: int,
    device: torch.device,
) -> dict[str, float | int]:
    starts = np.arange(
        0, corpus.patch_count - model.patch_context + 1, model.patch_context, dtype=np.int64
    )
    if len(starts) == 0:
        raise ValueError("validation split is shorter than one patch context")
    total = LossTotals()
    model.eval()
    started = time.perf_counter()
    for offset in range(0, len(starts), batch_size):
        codes, values, lengths = corpus.batch(
            starts[offset : offset + batch_size], model.patch_context, device
        )
        outputs = model(codes, values)
        _, parts = loss_components(model, *outputs, codes, values, lengths)
        add_totals(total, parts)
    metrics = total.metrics()
    wall = time.perf_counter() - started
    metrics["wall_seconds"] = wall
    metrics["model_bytes_per_second"] = total.raw_bytes / max(wall, 1e-9)
    return metrics


def estimated_madds_per_patch(
    dimension: int,
    layers: int,
    feed_forward: int,
    context: int,
    max_patch: int,
    vocabulary_size: int,
    escape_fraction: float,
) -> float:
    global_madds = layers * (
        4 * dimension * dimension
        + 2 * context * dimension
        + 2 * dimension * feed_forward
    ) + dimension * vocabulary_size
    residual_madds = escape_fraction * (
        dimension * dimension
        + (max_patch + 1) * (6 * dimension * dimension + dimension * 257)
    )
    return float(global_madds + residual_madds)


BASELINES = {
    0: {"bits_per_byte": 4.003875795506535, "training_raw_bytes": 139437},
    1: {"bits_per_byte": 3.963665927434818, "training_raw_bytes": 138966},
    2: {"bits_per_byte": 4.012653191758525, "training_raw_bytes": 138755},
}


def run(arguments: argparse.Namespace) -> dict[str, object]:
    if arguments.seed not in BASELINES:
        raise ValueError("the frozen V2 experiment permits only seeds 0, 1, and 2")
    v1.configure_determinism(arguments.seed, arguments.threads)
    device = torch.device(arguments.device)
    train, train_paths = v1.read_bound_input(arguments.train, arguments.train_limit)
    validation, validation_paths = v1.read_bound_input(
        arguments.validation, arguments.validation_limit
    )

    boundary_model, boundary_training = v1.train_boundary_predictor(
        train,
        arguments.boundary_dimension,
        arguments.boundary_steps,
        arguments.boundary_batch_size,
        arguments.boundary_sequence,
        arguments.boundary_learning_rate,
        arguments.seed,
        device,
    )
    scoring_started = time.perf_counter()
    train_scores = v1.causal_entropy_scores(boundary_model, train, device)
    calibration_bytes = min(arguments.calibration_bytes, len(train))
    threshold, _ = v1.calibrate_threshold(
        train[:calibration_bytes],
        train_scores[:calibration_bytes],
        arguments.target_bytes_per_patch,
        arguments.max_patch,
    )
    train_patches = v1.patches_from_scores(train, train_scores, threshold, arguments.max_patch)
    validation_scores = v1.causal_entropy_scores(boundary_model, validation, device)
    validation_patches = v1.patches_from_scores(
        validation, validation_scores, threshold, arguments.max_patch
    )
    segmentation_wall = time.perf_counter() - scoring_started

    codebook = PatchCodebook.train(train_patches, arguments.vocabulary_size)
    train_codes = codebook.encode(train_patches)
    validation_codes = codebook.encode(validation_patches)
    exact = (
        codebook.reconstruct(train_codes, train_patches) == train
        and codebook.reconstruct(validation_codes, validation_patches) == validation
    )
    artifact_directory = Path(arguments.artifact_dir or f"build/sero-latent-v2/seed{arguments.seed}")
    artifact_directory.mkdir(parents=True, exist_ok=True)
    codebook_path = artifact_directory / "codebook.json"
    codebook.save(codebook_path, Counter(train_patches))

    train_corpus = CodeCorpus(train_patches, train_codes, arguments.max_patch)
    validation_corpus = CodeCorpus(validation_patches, validation_codes, arguments.max_patch)
    model_arguments = {
        "vocabulary_size": arguments.vocabulary_size,
        "dimension": arguments.dimension,
        "heads": arguments.heads,
        "layers": arguments.layers,
        "feed_forward": arguments.feed_forward,
        "patch_context": arguments.patch_context,
        "max_patch": arguments.max_patch,
    }
    torch.manual_seed(arguments.seed + 1)
    model = DiscretePatchLanguageModel(**model_arguments).to(device)
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
    raw_bytes_seen = 0
    model.train()
    training_started = time.perf_counter()
    for update in range(1, arguments.steps + 1):
        starts = rng.integers(
            0,
            train_corpus.patch_count - arguments.patch_context,
            size=arguments.batch_size,
            dtype=np.int64,
        )
        codes, values, lengths = train_corpus.batch(
            starts, arguments.patch_context, device
        )
        outputs = model(codes, values)
        loss, parts = loss_components(model, *outputs, codes, values, lengths)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        raw_bytes_seen += int(parts["raw_bytes"].detach())
        if update in record_at:
            trace.append(
                {
                    "update": update,
                    "training_total_bits_per_raw_byte": float(loss.detach()) / LOG2,
                    "gradient_norm": float(gradient_norm),
                }
            )
    training_wall = time.perf_counter() - training_started
    validation_metrics = evaluate(model, validation_corpus, arguments.batch_size, device)
    model_path = artifact_directory / "model.pt"
    torch.save(
        {"state_dict": model.state_dict(), "model_arguments": model_arguments}, model_path
    )

    baseline = BASELINES[arguments.seed]
    training_distribution = codebook.metrics(train_patches, train_codes)
    validation_distribution = codebook.metrics(validation_patches, validation_codes)
    madds = estimated_madds_per_patch(
        arguments.dimension,
        arguments.layers,
        arguments.feed_forward,
        arguments.patch_context,
        arguments.max_patch,
        arguments.vocabulary_size,
        float(training_distribution["escape_patches"]) / len(train_patches),
    )
    compute_ratio = madds / arguments.conventional_madds_per_patch
    exposure_ratio = raw_bytes_seen / baseline["training_raw_bytes"]
    quality_ratio = validation_metrics["total_bits_per_raw_byte"] / baseline["bits_per_byte"]
    gates = {
        "exact_roundtrip": exact,
        "vocabulary_size_is_4096": arguments.vocabulary_size == 4096,
        "training_exposure_within_five_percent": 0.95 <= exposure_ratio <= 1.05,
        "estimated_compute_within_ten_percent": 0.90 <= compute_ratio <= 1.10,
        "at_least_one_percent_better_than_conventional": quality_ratio <= 0.99,
    }
    return {
        "schema": "sero.latent_v2_seed_result.v1",
        "experiment": "sero-latent-v2",
        "seed": arguments.seed,
        "decision": "seed-go" if all(gates.values()) else "seed-no-go",
        "inputs": {
            "dataset_digest": arguments.dataset_digest,
            "train_paths": train_paths,
            "validation_paths": validation_paths,
            "train_bytes": len(train),
            "validation_bytes": len(validation),
            "train_sha256": v1.sha256(train),
            "validation_sha256": v1.sha256(validation),
            "training_only_boundary_fit": True,
            "training_only_threshold_calibration": True,
            "training_only_codebook_fit": True,
        },
        "configuration": {
            "boundary_dimension": arguments.boundary_dimension,
            "boundary_steps": arguments.boundary_steps,
            "calibration_bytes": calibration_bytes,
            "target_bytes_per_patch": arguments.target_bytes_per_patch,
            "maximum_patch_bytes": arguments.max_patch,
            "codebook_size": arguments.vocabulary_size,
            "model": model_arguments,
            "steps": arguments.steps,
            "batch_size": arguments.batch_size,
            "learning_rate": arguments.learning_rate,
            "device": str(device),
            "threads": arguments.threads,
        },
        "boundary_model": {
            **boundary_training,
            "threshold_bits": threshold,
            "scoring_and_segmentation_wall_seconds": segmentation_wall,
        },
        "codebook": {
            "artifact": str(codebook_path),
            "artifact_sha256": v1.sha256(codebook_path.read_bytes()),
            "escape_id": codebook.escape_id,
            "training_distribution": training_distribution,
            "validation_distribution": validation_distribution,
        },
        "model": {
            "parameters": sum(parameter.numel() for parameter in model.parameters()),
            "updates": arguments.steps,
            "patch_positions_seen": arguments.steps * arguments.batch_size * arguments.patch_context,
            "raw_bytes_seen": raw_bytes_seen,
            "training_wall_seconds": training_wall,
            "trace": trace,
            "validation": validation_metrics,
            "artifact": str(model_path),
        },
        "comparison": {
            "conventional_bits_per_raw_byte": baseline["bits_per_byte"],
            "v2_to_conventional_bits_per_byte": quality_ratio,
            "conventional_training_raw_bytes": baseline["training_raw_bytes"],
            "v2_to_conventional_training_raw_bytes": exposure_ratio,
            "estimated_v2_madds_per_patch_position": madds,
            "estimated_conventional_madds_per_patch_position": arguments.conventional_madds_per_patch,
            "v2_to_conventional_estimated_madds": compute_ratio,
        },
        "gates": gates,
    }


def self_test() -> None:
    v1.configure_determinism(5, 1)
    patches = [b"a", b"b", b"a", b"cc", b"a", b"dd", b"ee", b"b"]
    codebook = PatchCodebook.train(patches, 5)
    codes = codebook.encode(patches)
    assert codebook.reconstruct(codes, patches) == b"".join(patches)
    assert codebook.escape_id in codes
    again = PatchCodebook.train(patches, 5)
    assert again.entries == codebook.entries

    corpus = CodeCorpus(patches * 3, np.tile(codes, 3), 2)
    model = DiscretePatchLanguageModel(5, 16, 2, 1, 32, 4, 2)
    batch_codes, values, lengths = corpus.batch(np.asarray([0, 4]), 4, torch.device("cpu"))
    outputs = model(batch_codes, values)
    loss, _ = loss_components(model, *outputs, batch_codes, values, lengths)
    assert torch.isfinite(loss)
    loss.backward()
    assert all(parameter.grad is not None for parameter in model.parameters())
    changed = batch_codes.clone()
    changed[:, -1] = (changed[:, -1] + 1) % 5
    with torch.no_grad():
        left = model(batch_codes, values)[0]
        right = model(changed, values)[0]
    assert torch.equal(left[:, :-1], right[:, :-1]), "V2 global model used a future code"
    print("Sero Latent v2 self-test passed")


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--train", action="append", default=[])
    command.add_argument("--validation", action="append", default=[])
    command.add_argument("--train-limit", type=int, default=1048576)
    command.add_argument("--validation-limit", type=int, default=131072)
    command.add_argument(
        "--dataset-digest",
        default="9ac3fcfd15e9e4cea44c0b8504799c9de33672fb0561d620bc1959b27b6ec736",
    )
    command.add_argument("--target-bytes-per-patch", type=float, default=3.6210485603188087)
    command.add_argument("--max-patch", type=int, default=8)
    command.add_argument("--calibration-bytes", type=int, default=262144)
    command.add_argument("--boundary-dimension", type=int, default=32)
    command.add_argument("--boundary-steps", type=int, default=200)
    command.add_argument("--boundary-batch-size", type=int, default=64)
    command.add_argument("--boundary-sequence", type=int, default=64)
    command.add_argument("--boundary-learning-rate", type=float, default=0.003)
    command.add_argument("--vocabulary-size", type=int, default=4096)
    command.add_argument("--dimension", type=int, default=48)
    command.add_argument("--heads", type=int, default=4)
    command.add_argument("--layers", type=int, default=4)
    command.add_argument("--feed-forward", type=int, default=192)
    command.add_argument("--patch-context", type=int, default=16)
    command.add_argument("--steps", type=int, default=300)
    command.add_argument("--batch-size", type=int, default=8)
    command.add_argument("--learning-rate", type=float, default=0.001)
    command.add_argument("--conventional-madds-per-patch", type=float, default=313344.0)
    command.add_argument("--seed", type=int, default=0)
    command.add_argument("--threads", type=int, default=4)
    command.add_argument("--device", default="cpu")
    command.add_argument("--artifact-dir")
    command.add_argument("--result")
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
    output = Path(arguments.result or f"benchmarks/sero-latent-v2/seed{arguments.seed}.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(v1.stable_json(result), encoding="utf-8")
    print(
        v1.stable_json(
            {
                "seed": arguments.seed,
                "decision": result["decision"],
                "v2_total_bits_per_raw_byte": result["model"]["validation"][
                    "total_bits_per_raw_byte"
                ],
                "conventional_total_bits_per_raw_byte": result["comparison"][
                    "conventional_bits_per_raw_byte"
                ],
                "result": str(output),
            }
        ),
        end="",
    )


if __name__ == "__main__":
    main()

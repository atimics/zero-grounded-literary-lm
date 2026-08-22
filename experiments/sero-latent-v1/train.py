#!/usr/bin/env python3
"""Sero Latent v1: a causal, lossless patch-LM ablation.

The experiment compares two segmenters while holding the downstream neural
architecture, initialization, patch positions, decoder slots, optimizer, and
update count fixed:

* a 4,096-entry lossless byte-BPE control; and
* boundaries selected from the entropy of a causal learned byte embedding
  model, calibrated on training data to the control's bytes-per-patch.

Both arms use a tied byte embedding, local GRU byte encoder, causal patch
Transformer, and autoregressive local byte decoder with an explicit end-patch
symbol. The reported total bits/byte includes end-patch probability.
"""

from __future__ import annotations

import argparse
import copy
import glob
import hashlib
import json
import math
import os
import random
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

try:
    import numpy as np
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.nn.utils.rnn import pack_padded_sequence
    from tokenizers import Tokenizer
    from tokenizers.models import BPE
    from tokenizers.trainers import BpeTrainer
except ModuleNotFoundError as error:  # pragma: no cover - exercised by CLI users
    raise SystemExit(
        "missing experiment dependency; install experiments/sero-latent-v1/requirements.txt"
    ) from error


LOG2 = math.log(2.0)
EOP = 256


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_json(value: object) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def byte_unicode_tables() -> tuple[dict[int, str], dict[str, int]]:
    """Return the reversible GPT-2 byte alphabet without importing a model."""
    visible = list(range(ord("!"), ord("~") + 1))
    visible += list(range(ord("¡"), ord("¬") + 1))
    visible += list(range(ord("®"), ord("ÿ") + 1))
    codepoints = list(visible)
    extra = 0
    for byte in range(256):
        if byte not in visible:
            visible.append(byte)
            codepoints.append(256 + extra)
            extra += 1
    encode = {byte: chr(codepoint) for byte, codepoint in zip(visible, codepoints)}
    return encode, {character: byte for byte, character in encode.items()}


BYTE_TO_CHAR, CHAR_TO_BYTE = byte_unicode_tables()


def bytes_to_alphabet(data: bytes) -> str:
    return "".join(BYTE_TO_CHAR[value] for value in data)


def alphabet_to_bytes(text: str) -> bytes:
    try:
        return bytes(CHAR_TO_BYTE[character] for character in text)
    except KeyError as error:
        raise ValueError(f"token contains a character outside the byte alphabet: {error}") from error


class StaticByteBPE:
    def __init__(self, tokenizer: Tokenizer, vocabulary_size: int, max_patch: int):
        self.tokenizer = tokenizer
        self.vocabulary_size = vocabulary_size
        self.max_patch = max_patch

    @classmethod
    def train(cls, data: bytes, vocabulary_size: int, max_patch: int) -> "StaticByteBPE":
        if vocabulary_size < 256:
            raise ValueError("byte-BPE vocabulary must contain at least 256 entries")
        tokenizer = Tokenizer(BPE(unk_token=None, fuse_unk=False))
        trainer = BpeTrainer(
            vocab_size=vocabulary_size,
            min_frequency=2,
            show_progress=False,
            initial_alphabet=list(BYTE_TO_CHAR.values()),
            max_token_length=max_patch,
            special_tokens=[],
        )
        chunk = 64 * 1024
        tokenizer.train_from_iterator(
            (bytes_to_alphabet(data[start : start + chunk])
             for start in range(0, len(data), chunk)),
            trainer=trainer,
            length=math.ceil(len(data) / chunk),
        )
        return cls(tokenizer, tokenizer.get_vocab_size(), max_patch)

    def encode(self, data: bytes) -> list[bytes]:
        patches, _ = self.encode_with_ids(data)
        return patches

    def encode_with_ids(self, data: bytes) -> tuple[list[bytes], list[int]]:
        if not data:
            return [], []
        encoding = self.tokenizer.encode(bytes_to_alphabet(data), add_special_tokens=False)
        patches = [alphabet_to_bytes(token) for token in encoding.tokens]
        if any(not patch or len(patch) > self.max_patch for patch in patches):
            raise AssertionError("byte-BPE emitted an empty or overlong patch")
        if b"".join(patches) != data:
            raise AssertionError("byte-BPE failed exact reconstruction")
        return patches, encoding.ids

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.tokenizer.save(str(path), pretty=True)


class BoundaryPredictor(nn.Module):
    """A small causal byte model whose predictive entropy selects boundaries."""

    def __init__(self, dimension: int):
        super().__init__()
        self.embedding = nn.Embedding(256, dimension)
        self.recurrent = nn.GRU(dimension, dimension, batch_first=True)
        self.byte_bias = nn.Parameter(torch.zeros(256))

    def forward(
        self, byte_ids: torch.Tensor, hidden: torch.Tensor | None = None
    ) -> tuple[torch.Tensor, torch.Tensor]:
        encoded, hidden = self.recurrent(self.embedding(byte_ids), hidden)
        logits = encoded @ self.embedding.weight.T + self.byte_bias
        return logits, hidden


def train_boundary_predictor(
    data: bytes,
    dimension: int,
    steps: int,
    batch_size: int,
    sequence_length: int,
    learning_rate: float,
    seed: int,
    device: torch.device,
) -> tuple[BoundaryPredictor, dict[str, object]]:
    if len(data) <= sequence_length:
        raise ValueError("boundary training data is shorter than one sequence")
    torch.manual_seed(seed)
    model = BoundaryPredictor(dimension).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.01)
    source = np.frombuffer(data, dtype=np.uint8)
    rng = np.random.default_rng(seed)
    trace: list[dict[str, float | int]] = []
    started = time.perf_counter()
    record_at = {1, steps, max(1, steps // 4), max(1, steps // 2), max(1, 3 * steps // 4)}
    model.train()
    for update in range(1, steps + 1):
        starts = rng.integers(0, len(source) - sequence_length, size=batch_size)
        batch = np.stack([source[start : start + sequence_length + 1] for start in starts])
        inputs = torch.from_numpy(batch[:, :-1].astype(np.int64)).to(device)
        targets = torch.from_numpy(batch[:, 1:].astype(np.int64)).to(device)
        logits, _ = model(inputs)
        loss = F.cross_entropy(logits.reshape(-1, 256), targets.reshape(-1))
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        if update in record_at:
            trace.append({"update": update, "bits_per_byte": float(loss.detach()) / LOG2})
    return model, {
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "updates": steps,
        "training_bytes_seen": steps * batch_size * sequence_length,
        "wall_seconds": time.perf_counter() - started,
        "trace": trace,
    }


@torch.no_grad()
def causal_entropy_scores(
    model: BoundaryPredictor, data: bytes, device: torch.device, chunk_size: int = 4096
) -> np.ndarray:
    """Score byte i using only bytes strictly before i."""
    scores = np.empty(len(data), dtype=np.float32)
    if not data:
        return scores
    scores[0] = 8.0
    source = np.frombuffer(data, dtype=np.uint8)
    hidden = None
    model.eval()
    written = 1
    for start in range(0, len(source) - 1, chunk_size):
        stop = min(start + chunk_size, len(source) - 1)
        inputs = torch.from_numpy(source[start:stop].astype(np.int64)[None, :]).to(device)
        logits, hidden = model(inputs, hidden)
        hidden = hidden.detach()
        log_probabilities = F.log_softmax(logits.float(), dim=-1)
        probabilities = log_probabilities.exp()
        entropy = -(probabilities * log_probabilities).sum(dim=-1) / LOG2
        values = entropy.squeeze(0).cpu().numpy()
        scores[written : written + len(values)] = values
        written += len(values)
    if written != len(data):
        raise AssertionError("causal entropy scorer produced the wrong number of scores")
    return scores


def patches_from_scores(
    data: bytes, scores: np.ndarray, threshold: float, max_patch: int
) -> list[bytes]:
    if len(scores) != len(data):
        raise ValueError("one causal score is required for every byte")
    if not data:
        return []
    starts = [0]
    current_length = 1
    for position in range(1, len(data)):
        if current_length >= max_patch or float(scores[position]) >= threshold:
            starts.append(position)
            current_length = 1
        else:
            current_length += 1
    starts.append(len(data))
    patches = [data[left:right] for left, right in zip(starts, starts[1:])]
    if b"".join(patches) != data or any(not patch or len(patch) > max_patch for patch in patches):
        raise AssertionError("latent segmenter violated lossless/max-patch contract")
    return patches


def calibrate_threshold(
    data: bytes, scores: np.ndarray, target_bytes_per_patch: float, max_patch: int
) -> tuple[float, list[bytes]]:
    if len(data) < 2:
        return 8.0, [data] if data else []
    low = float(scores[1:].min()) - 1e-6
    high = float(scores[1:].max()) + 1e-6
    best: tuple[float, list[bytes], float] | None = None
    for _ in range(48):
        threshold = (low + high) / 2.0
        patches = patches_from_scores(data, scores, threshold, max_patch)
        bytes_per_patch = len(data) / len(patches)
        error = abs(bytes_per_patch - target_bytes_per_patch)
        if best is None or error < best[2]:
            best = (threshold, patches, error)
        if bytes_per_patch < target_bytes_per_patch:
            low = threshold
        else:
            high = threshold
    assert best is not None
    return best[0], best[1]


class PatchCorpus:
    def __init__(self, patches: Sequence[bytes], max_patch: int):
        if len(patches) < 2:
            raise ValueError("patch corpus must contain at least two patches")
        self.max_patch = max_patch
        self.values = np.zeros((len(patches), max_patch), dtype=np.uint8)
        self.lengths = np.empty(len(patches), dtype=np.int64)
        for index, patch in enumerate(patches):
            if not patch or len(patch) > max_patch:
                raise ValueError("invalid patch length")
            self.values[index, : len(patch)] = np.frombuffer(patch, dtype=np.uint8)
            self.lengths[index] = len(patch)

    @property
    def patch_count(self) -> int:
        return len(self.lengths)

    @property
    def raw_bytes(self) -> int:
        return int(self.lengths.sum())

    def batch(self, starts: np.ndarray, context: int, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
        indices = starts[:, None] + np.arange(context)[None, :]
        values = torch.from_numpy(self.values[indices].astype(np.int64)).to(device)
        lengths = torch.from_numpy(self.lengths[indices]).to(device)
        return values, lengths


class PatchLanguageModel(nn.Module):
    """Local byte encoder -> causal patch Transformer -> local byte decoder."""

    def __init__(
        self,
        dimension: int,
        heads: int,
        layers: int,
        feed_forward: int,
        patch_context: int,
        max_patch: int,
    ):
        super().__init__()
        self.dimension = dimension
        self.patch_context = patch_context
        self.max_patch = max_patch
        self.byte_embedding = nn.Embedding(256, dimension)
        self.local_encoder = nn.GRU(dimension, dimension, batch_first=True)
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
        self.global_transformer = nn.TransformerEncoder(layer, num_layers=layers, enable_nested_tensor=False)
        self.global_norm = nn.LayerNorm(dimension)
        self.decoder_initial = nn.Linear(dimension, dimension)
        self.byte_bos = nn.Parameter(torch.empty(dimension))
        self.local_decoder = nn.GRU(dimension, dimension, batch_first=True)
        self.byte_bias = nn.Parameter(torch.zeros(256))
        self.eop_output = nn.Linear(dimension, 1)
        nn.init.normal_(self.patch_bos, mean=0.0, std=dimension ** -0.5)
        nn.init.normal_(self.patch_position, mean=0.0, std=dimension ** -0.5)
        nn.init.normal_(self.byte_bos, mean=0.0, std=dimension ** -0.5)

    def forward(self, values: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        batch, patches, width = values.shape
        if patches != self.patch_context or width != self.max_patch:
            raise ValueError("batch shape does not match the frozen model contract")
        flat_values = values.reshape(batch * patches, width)
        flat_lengths = lengths.reshape(batch * patches)
        embedded = self.byte_embedding(flat_values)
        packed = pack_padded_sequence(
            embedded, flat_lengths.detach().cpu(), batch_first=True, enforce_sorted=False
        )
        _, hidden = self.local_encoder(packed)
        patch_embeddings = hidden[-1].reshape(batch, patches, self.dimension)
        previous = torch.cat(
            [self.patch_bos.reshape(1, 1, -1).expand(batch, 1, -1), patch_embeddings[:, :-1]],
            dim=1,
        )
        previous = previous + self.patch_position[None, :, :]
        causal_mask = torch.triu(
            torch.ones(patches, patches, dtype=torch.bool, device=values.device), diagonal=1
        )
        global_context = self.global_norm(self.global_transformer(previous, mask=causal_mask))

        flat_context = global_context.reshape(batch * patches, self.dimension)
        byte_inputs = torch.cat(
            [self.byte_bos.reshape(1, 1, -1).expand(batch * patches, 1, -1), embedded], dim=1
        )
        initial = torch.tanh(self.decoder_initial(flat_context)).unsqueeze(0)
        decoded, _ = self.local_decoder(byte_inputs, initial)
        byte_logits = decoded @ self.byte_embedding.weight.T + self.byte_bias
        eop_logits = self.eop_output(decoded)
        return torch.cat([byte_logits, eop_logits], dim=-1)


@dataclass
class LossTotals:
    nats: float = 0.0
    byte_nats: float = 0.0
    eop_nats: float = 0.0
    raw_bytes: int = 0
    patches: int = 0

    def metrics(self) -> dict[str, float | int]:
        return {
            "total_bits_per_raw_byte": self.nats / (self.raw_bytes * LOG2),
            "byte_only_bits_per_raw_byte": self.byte_nats / (self.raw_bytes * LOG2),
            "boundary_bits_per_raw_byte": self.eop_nats / (self.raw_bytes * LOG2),
            "raw_bytes": self.raw_bytes,
            "patches": self.patches,
        }


def loss_components(
    logits: torch.Tensor, values: torch.Tensor, lengths: torch.Tensor
) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
    batch, patches, width = values.shape
    flat_values = values.reshape(batch * patches, width)
    flat_lengths = lengths.reshape(batch * patches)
    targets = torch.full(
        (batch * patches, width + 1), EOP, dtype=torch.long, device=values.device
    )
    targets[:, :width] = flat_values
    positions = torch.arange(width + 1, device=values.device)[None, :]
    mask = positions <= flat_lengths[:, None]
    byte_mask = positions < flat_lengths[:, None]
    eop_mask = positions == flat_lengths[:, None]
    per_target = F.cross_entropy(
        logits.reshape(-1, EOP + 1), targets.reshape(-1), reduction="none"
    ).reshape(batch * patches, width + 1)
    raw_bytes = flat_lengths.sum()
    loss = (per_target * mask).sum() / raw_bytes
    return loss, {
        "nats": (per_target * mask).sum(),
        "byte_nats": (per_target * byte_mask).sum(),
        "eop_nats": (per_target * eop_mask).sum(),
        "raw_bytes": raw_bytes,
        "patches": torch.tensor(batch * patches, device=values.device),
    }


def add_totals(total: LossTotals, parts: dict[str, torch.Tensor]) -> None:
    total.nats += float(parts["nats"].detach())
    total.byte_nats += float(parts["byte_nats"].detach())
    total.eop_nats += float(parts["eop_nats"].detach())
    total.raw_bytes += int(parts["raw_bytes"].detach())
    total.patches += int(parts["patches"].detach())


@torch.no_grad()
def evaluate(
    model: PatchLanguageModel,
    corpus: PatchCorpus,
    patch_context: int,
    batch_size: int,
    device: torch.device,
) -> tuple[dict[str, float | int], float]:
    starts = np.arange(0, corpus.patch_count - patch_context + 1, patch_context, dtype=np.int64)
    if len(starts) == 0:
        raise ValueError("validation corpus is shorter than one patch context")
    model.eval()
    total = LossTotals()
    started = time.perf_counter()
    for offset in range(0, len(starts), batch_size):
        values, lengths = corpus.batch(starts[offset : offset + batch_size], patch_context, device)
        logits = model(values, lengths)
        _, parts = loss_components(logits, values, lengths)
        add_totals(total, parts)
    wall = time.perf_counter() - started
    metrics = total.metrics()
    metrics["model_bytes_per_second"] = total.raw_bytes / max(wall, 1e-9)
    return metrics, wall


def train_patch_arm(
    name: str,
    initial_state: dict[str, torch.Tensor],
    train_corpus: PatchCorpus,
    validation_corpus: PatchCorpus,
    model_arguments: dict[str, int],
    steps: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    device: torch.device,
) -> tuple[PatchLanguageModel, dict[str, object]]:
    model = PatchLanguageModel(**model_arguments).to(device)
    model.load_state_dict(initial_state)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.01)
    rng = np.random.default_rng(seed)
    trace: list[dict[str, float | int]] = []
    record_at = {1, steps, max(1, steps // 4), max(1, steps // 2), max(1, 3 * steps // 4)}
    exposed_bytes = 0
    started = time.perf_counter()
    model.train()
    for update in range(1, steps + 1):
        starts = rng.integers(
            0, train_corpus.patch_count - model.patch_context, size=batch_size, dtype=np.int64
        )
        values, lengths = train_corpus.batch(starts, model.patch_context, device)
        logits = model(values, lengths)
        loss, parts = loss_components(logits, values, lengths)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        exposed_bytes += int(parts["raw_bytes"].detach())
        if update in record_at:
            trace.append({
                "update": update,
                "training_total_bits_per_raw_byte": float(loss.detach()) / LOG2,
                "gradient_norm": float(gradient_norm),
            })
    training_wall = time.perf_counter() - started
    validation, validation_wall = evaluate(
        model, validation_corpus, model.patch_context, batch_size, device
    )
    return model, {
        "name": name,
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "updates": steps,
        "patch_positions_seen": steps * batch_size * model.patch_context,
        "decoder_slots_computed": steps * batch_size * model.patch_context * (model.max_patch + 1),
        "raw_bytes_seen": exposed_bytes,
        "training_wall_seconds": training_wall,
        "validation_wall_seconds": validation_wall,
        "trace": trace,
        "validation": validation,
    }


def expanded_paths(specifications: Sequence[str]) -> list[Path]:
    paths: list[Path] = []
    for specification in specifications:
        matches = sorted(glob.glob(specification))
        if not matches and Path(specification).is_file():
            matches = [specification]
        paths.extend(Path(match) for match in matches if Path(match).is_file())
    unique = list(dict.fromkeys(path.resolve() for path in paths))
    if not unique:
        raise FileNotFoundError(f"no files matched: {', '.join(specifications)}")
    return unique


def read_bound_input(specifications: Sequence[str], limit: int) -> tuple[bytes, list[str]]:
    paths = expanded_paths(specifications)
    pieces: list[bytes] = []
    remaining = limit
    for path in paths:
        if remaining <= 0:
            break
        data = path.read_bytes()[:remaining]
        pieces.append(data)
        remaining -= len(data)
        if remaining > 0:
            pieces.append(b"\n")
            remaining -= 1
    result = b"".join(pieces)
    if len(result) < 4096:
        raise ValueError("bound input is too small for the preregistered experiment")
    return result, [str(path) for path in paths]


def configure_determinism(seed: int, threads: int) -> None:
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(threads)
    torch.use_deterministic_algorithms(True)


def distribution(patches: Sequence[bytes]) -> dict[str, float | int]:
    lengths = np.asarray([len(patch) for patch in patches], dtype=np.int64)
    return {
        "patches": len(patches),
        "raw_bytes": int(lengths.sum()),
        "bytes_per_patch": float(lengths.mean()),
        "p50_patch_bytes": float(np.quantile(lengths, 0.50)),
        "p95_patch_bytes": float(np.quantile(lengths, 0.95)),
        "maximum_patch_bytes": int(lengths.max()),
    }


def run_experiment(arguments: argparse.Namespace) -> dict[str, object]:
    configure_determinism(arguments.seed, arguments.threads)
    device = torch.device(arguments.device)
    train, train_paths = read_bound_input(arguments.train, arguments.train_limit)
    validation, validation_paths = read_bound_input(arguments.validation, arguments.validation_limit)
    artifact_directory = Path(arguments.artifact_dir)
    artifact_directory.mkdir(parents=True, exist_ok=True)

    static_started = time.perf_counter()
    static_tokenizer = StaticByteBPE.train(train, arguments.vocab_size, arguments.max_patch)
    static_tokenizer_path = artifact_directory / "static-byte-bpe.json"
    static_tokenizer.save(static_tokenizer_path)
    static_train_patches = static_tokenizer.encode(train)
    static_validation_patches = static_tokenizer.encode(validation)
    static_segmentation_wall = time.perf_counter() - static_started
    static_train_distribution = distribution(static_train_patches)

    boundary_model, boundary_training = train_boundary_predictor(
        train,
        arguments.boundary_dimension,
        arguments.boundary_steps,
        arguments.boundary_batch_size,
        arguments.boundary_sequence,
        arguments.boundary_learning_rate,
        arguments.seed,
        device,
    )
    torch.save(
        {"state_dict": boundary_model.state_dict(), "dimension": arguments.boundary_dimension},
        artifact_directory / "boundary-model.pt",
    )
    latent_started = time.perf_counter()
    train_scores = causal_entropy_scores(boundary_model, train, device)
    calibration_bytes = min(arguments.calibration_bytes, len(train))
    threshold, _ = calibrate_threshold(
        train[:calibration_bytes],
        train_scores[:calibration_bytes],
        float(static_train_distribution["bytes_per_patch"]),
        arguments.max_patch,
    )
    latent_train_patches = patches_from_scores(
        train, train_scores, threshold, arguments.max_patch
    )
    validation_scores = causal_entropy_scores(boundary_model, validation, device)
    latent_validation_patches = patches_from_scores(
        validation, validation_scores, threshold, arguments.max_patch
    )
    latent_segmentation_wall = time.perf_counter() - latent_started

    static_train_corpus = PatchCorpus(static_train_patches, arguments.max_patch)
    static_validation_corpus = PatchCorpus(static_validation_patches, arguments.max_patch)
    latent_train_corpus = PatchCorpus(latent_train_patches, arguments.max_patch)
    latent_validation_corpus = PatchCorpus(latent_validation_patches, arguments.max_patch)
    model_arguments = {
        "dimension": arguments.dimension,
        "heads": arguments.heads,
        "layers": arguments.layers,
        "feed_forward": arguments.feed_forward,
        "patch_context": arguments.patch_context,
        "max_patch": arguments.max_patch,
    }
    torch.manual_seed(arguments.seed + 1)
    template = PatchLanguageModel(**model_arguments)
    initial_state = copy.deepcopy(template.state_dict())
    del template

    _, static_arm = train_patch_arm(
        "static-byte-bpe",
        initial_state,
        static_train_corpus,
        static_validation_corpus,
        model_arguments,
        arguments.lm_steps,
        arguments.batch_size,
        arguments.learning_rate,
        arguments.seed + 2,
        device,
    )
    latent_model, latent_arm = train_patch_arm(
        "latent-entropy-patches",
        initial_state,
        latent_train_corpus,
        latent_validation_corpus,
        model_arguments,
        arguments.lm_steps,
        arguments.batch_size,
        arguments.learning_rate,
        arguments.seed + 2,
        device,
    )
    torch.save(
        {"state_dict": latent_model.state_dict(), "model_arguments": model_arguments},
        artifact_directory / "latent-patch-lm.pt",
    )

    static_validation = static_arm["validation"]
    latent_validation = latent_arm["validation"]
    train_byte_ratio = latent_arm["raw_bytes_seen"] / static_arm["raw_bytes_seen"]
    validation_byte_ratio = latent_validation["raw_bytes"] / static_validation["raw_bytes"]
    parameter_match = static_arm["parameters"] == latent_arm["parameters"]
    patch_compute_match = (
        static_arm["patch_positions_seen"] == latent_arm["patch_positions_seen"]
        and static_arm["decoder_slots_computed"] == latent_arm["decoder_slots_computed"]
    )
    exact = (
        b"".join(static_train_patches) == train
        and b"".join(static_validation_patches) == validation
        and b"".join(latent_train_patches) == train
        and b"".join(latent_validation_patches) == validation
    )
    integrity = exact and parameter_match and patch_compute_match
    exposure_matched = 0.95 <= train_byte_ratio <= 1.05
    evaluation_matched = 0.99 <= validation_byte_ratio <= 1.01
    quality_win = (
        latent_validation["total_bits_per_raw_byte"]
        <= 0.99 * static_validation["total_bits_per_raw_byte"]
    )
    model_throughput_ratio = (
        latent_validation["model_bytes_per_second"]
        / static_validation["model_bytes_per_second"]
    )
    promotion = integrity and exposure_matched and evaluation_matched and quality_win
    decision = "advance-latent" if promotion else "retain-static-control"

    result = {
        "schema": "sero.latent_v1_result.v1",
        "experiment": "sero-latent-v1",
        "decision": decision,
        "inputs": {
            "train_paths": train_paths,
            "validation_paths": validation_paths,
            "train_bytes": len(train),
            "validation_bytes": len(validation),
            "train_sha256": sha256(train),
            "validation_sha256": sha256(validation),
            "training_only_tokenizer_fit": True,
            "training_only_threshold_calibration": True,
        },
        "configuration": {
            "seed": arguments.seed,
            "device": str(device),
            "threads": arguments.threads,
            "static_vocabulary_target": arguments.vocab_size,
            "maximum_patch_bytes": arguments.max_patch,
            "calibration_bytes": calibration_bytes,
            "boundary_dimension": arguments.boundary_dimension,
            "boundary_steps": arguments.boundary_steps,
            "language_model": model_arguments,
            "language_model_steps": arguments.lm_steps,
            "batch_size": arguments.batch_size,
            "learning_rate": arguments.learning_rate,
        },
        "static_tokenizer": {
            "vocabulary_size": static_tokenizer.vocabulary_size,
            "artifact": str(static_tokenizer_path),
            "artifact_sha256": sha256(static_tokenizer_path.read_bytes()),
            "training_distribution": static_train_distribution,
            "validation_distribution": distribution(static_validation_patches),
            "training_and_segmentation_wall_seconds": static_segmentation_wall,
        },
        "latent_tokenizer": {
            "threshold_bits": threshold,
            "boundary_training": boundary_training,
            "training_distribution": distribution(latent_train_patches),
            "validation_distribution": distribution(latent_validation_patches),
            "scoring_and_segmentation_wall_seconds": latent_segmentation_wall,
        },
        "arms": {"static": static_arm, "latent": latent_arm},
        "fairness": {
            "identical_model_parameters": parameter_match,
            "identical_patch_positions_and_decoder_slots": patch_compute_match,
            "latent_to_static_training_raw_bytes": train_byte_ratio,
            "latent_to_static_validation_raw_bytes": validation_byte_ratio,
            "latent_to_static_model_throughput": model_throughput_ratio,
        },
        "gates": {
            "exact_roundtrip_both": exact,
            "training_exposure_within_five_percent": exposure_matched,
            "validation_coverage_within_one_percent": evaluation_matched,
            "latent_total_bpb_at_least_one_percent_better": quality_win,
            "promotion": promotion,
        },
        "interpretation": (
            "The latent segmenter passed the fixed-compute downstream ablation."
            if promotion
            else "The learned boundaries did not clear the preregistered fixed-compute quality gate."
        ),
    }
    return result


def self_test() -> None:
    configure_determinism(7, 1)
    fixture = bytes(range(256)) * 8 + "Sero learns across words. Καλημέρα.\n".encode()
    tokenizer = StaticByteBPE.train(fixture, 300, 8)
    static_patches = tokenizer.encode(fixture)
    assert b"".join(static_patches) == fixture
    assert max(map(len, static_patches)) <= 8

    model = BoundaryPredictor(8)
    left = fixture[:256]
    right = left[:160] + bytes(value ^ 0x5A for value in left[160:])
    left_scores = causal_entropy_scores(model, left, torch.device("cpu"), chunk_size=31)
    right_scores = causal_entropy_scores(model, right, torch.device("cpu"), chunk_size=29)
    assert np.array_equal(left_scores[:161], right_scores[:161]), "boundary score used future bytes"
    threshold, latent_patches = calibrate_threshold(left, left_scores, 3.0, 8)
    assert math.isfinite(threshold)
    assert b"".join(latent_patches) == left and max(map(len, latent_patches)) <= 8

    corpus = PatchCorpus(latent_patches * 2, 8)
    arguments = {
        "dimension": 16,
        "heads": 2,
        "layers": 1,
        "feed_forward": 32,
        "patch_context": 4,
        "max_patch": 8,
    }
    torch.manual_seed(11)
    patch_model = PatchLanguageModel(**arguments)
    values, lengths = corpus.batch(np.asarray([0, 2]), 4, torch.device("cpu"))
    logits = patch_model(values, lengths)
    loss, _ = loss_components(logits, values, lengths)
    assert torch.isfinite(loss)
    loss.backward()
    assert all(parameter.grad is not None for parameter in patch_model.parameters())

    changed = values.clone()
    changed[:, -1, 0] ^= 1
    with torch.no_grad():
        original_logits = patch_model(values, lengths).reshape(2, 4, 9, 257)
        changed_logits = patch_model(changed, lengths).reshape(2, 4, 9, 257)
    assert torch.equal(original_logits[:, :-1], changed_logits[:, :-1]), (
        "global patch model used a future patch"
    )
    print("Sero Latent v1 self-test passed")


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--train", action="append", default=[])
    command.add_argument("--validation", action="append", default=[])
    command.add_argument("--train-limit", type=int, default=1024 * 1024)
    command.add_argument("--validation-limit", type=int, default=128 * 1024)
    command.add_argument("--vocab-size", type=int, default=4096)
    command.add_argument("--max-patch", type=int, default=8)
    command.add_argument("--calibration-bytes", type=int, default=262144)
    command.add_argument("--boundary-dimension", type=int, default=32)
    command.add_argument("--boundary-steps", type=int, default=200)
    command.add_argument("--boundary-batch-size", type=int, default=64)
    command.add_argument("--boundary-sequence", type=int, default=64)
    command.add_argument("--boundary-learning-rate", type=float, default=0.003)
    command.add_argument("--dimension", type=int, default=48)
    command.add_argument("--heads", type=int, default=4)
    command.add_argument("--layers", type=int, default=2)
    command.add_argument("--feed-forward", type=int, default=128)
    command.add_argument("--patch-context", type=int, default=16)
    command.add_argument("--lm-steps", type=int, default=300)
    command.add_argument("--batch-size", type=int, default=8)
    command.add_argument("--learning-rate", type=float, default=0.001)
    command.add_argument("--seed", type=int, default=0)
    command.add_argument("--threads", type=int, default=4)
    command.add_argument("--device", default="cpu")
    command.add_argument("--artifact-dir", default="build/sero-latent-v1")
    command.add_argument("--result", default="benchmarks/sero-latent-v1/result.json")
    command.add_argument("--self-test", action="store_true")
    return command


def main() -> None:
    arguments = parser().parse_args()
    if arguments.self_test:
        self_test()
        return
    if not arguments.train or not arguments.validation:
        raise SystemExit("--train and --validation are required outside --self-test")
    result = run_experiment(arguments)
    output = Path(arguments.result)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(stable_json(result), encoding="utf-8")
    print(stable_json({
        "decision": result["decision"],
        "static_total_bits_per_raw_byte": result["arms"]["static"]["validation"]["total_bits_per_raw_byte"],
        "latent_total_bits_per_raw_byte": result["arms"]["latent"]["validation"]["total_bits_per_raw_byte"],
        "result": str(output),
    }), end="")


if __name__ == "__main__":
    main()

"""Static byte-BPE tokenizer and Transformer control for Sero Latent V3."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
from pathlib import Path
from typing import Any, Iterable, Sequence

import torch
from torch import Tensor, nn
import torch.nn.functional as F
from tokenizers import Tokenizer, models, trainers

from model import CausalTransformer, RMSNorm


PRIVATE_BYTE_BASE = 0xE000


def bytes_to_training_text(value: bytes) -> str:
    return "".join(chr(PRIVATE_BYTE_BASE + byte) for byte in value)


def training_text_to_bytes(value: str) -> bytes:
    decoded = bytearray()
    for character in value:
        byte = ord(character) - PRIVATE_BYTE_BASE
        if byte < 0 or byte > 255:
            raise ValueError("token contains a character outside the private byte alphabet")
        decoded.append(byte)
    return bytes(decoded)


class StaticByteBPE:
    """A deterministic, reversible BPE trained on training bytes only."""

    def __init__(self, tokenizer: Tokenizer) -> None:
        self.tokenizer = tokenizer
        self._token_bytes = [
            training_text_to_bytes(tokenizer.id_to_token(token_id))
            for token_id in range(tokenizer.get_vocab_size())
        ]
        if any(not value for value in self._token_bytes):
            raise ValueError("BPE contains an empty token")

    @classmethod
    def train(
        cls,
        windows: Iterable[bytes],
        vocab_size: int = 4096,
        max_token_length: int = 8,
    ) -> "StaticByteBPE":
        tokenizer = Tokenizer(models.BPE(unk_token=None))
        trainer = trainers.BpeTrainer(
            vocab_size=vocab_size,
            min_frequency=2,
            show_progress=False,
            initial_alphabet=[chr(PRIVATE_BYTE_BASE + byte) for byte in range(256)],
            max_token_length=max_token_length,
            special_tokens=[],
        )
        tokenizer.train_from_iterator((bytes_to_training_text(window) for window in windows), trainer=trainer)
        result = cls(tokenizer)
        if result.vocab_size < 256:
            raise RuntimeError("BPE training did not preserve the full byte alphabet")
        return result

    @classmethod
    def load(cls, path: Path) -> "StaticByteBPE":
        return cls(Tokenizer.from_file(str(path)))

    @property
    def vocab_size(self) -> int:
        return self.tokenizer.get_vocab_size()

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.tokenizer.to_str().encode("utf-8")).hexdigest()

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.tokenizer.save(str(path), pretty=True)

    def encode(self, value: bytes) -> list[int]:
        ids = self.tokenizer.encode(bytes_to_training_text(value), add_special_tokens=False).ids
        if self.decode(ids) != value:
            raise RuntimeError("BPE round-trip failed")
        return ids

    def decode(self, token_ids: Sequence[int]) -> bytes:
        return b"".join(self._token_bytes[token_id] for token_id in token_ids)

    def token_byte_lengths(self, token_ids: Sequence[int]) -> list[int]:
        return [len(self._token_bytes[token_id]) for token_id in token_ids]


@dataclass(frozen=True)
class BPEConfig:
    byte_context: int = 256
    dim: int = 96
    heads: int = 4
    layers: int = 4
    ffn_dim: int = 256

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BPETransformer(nn.Module):
    def __init__(self, vocab_size: int, config: BPEConfig) -> None:
        super().__init__()
        if vocab_size < 256:
            raise ValueError("BPE vocabulary must include all 256 bytes")
        self.vocab_size = vocab_size
        self.config = config
        self.embedding = nn.Embedding(vocab_size, config.dim)
        self.bos = nn.Parameter(torch.empty(config.dim))
        self.position = nn.Parameter(torch.empty(config.byte_context, config.dim))
        self.stack = CausalTransformer(config.dim, config.heads, config.layers, config.ffn_dim)
        self.output_norm = RMSNorm(config.dim)
        self.output_bias = nn.Parameter(torch.zeros(vocab_size))
        nn.init.normal_(self.embedding.weight, mean=0.0, std=0.02)
        nn.init.normal_(self.bos, mean=0.0, std=0.02)
        nn.init.normal_(self.position, mean=0.0, std=0.02)

    def forward(self, token_ids: Tensor, valid_mask: Tensor) -> Tensor:
        if token_ids.ndim != 2 or valid_mask.shape != token_ids.shape:
            raise ValueError("token_ids and valid_mask must have matching [batch, time] shapes")
        if token_ids.shape[1] > self.config.byte_context:
            raise ValueError("token sequence exceeds the raw-byte context limit")
        shifted = torch.empty(
            token_ids.shape[0], token_ids.shape[1], self.config.dim,
            dtype=self.embedding.weight.dtype, device=token_ids.device,
        )
        shifted[:, 0] = self.bos
        if token_ids.shape[1] > 1:
            shifted[:, 1:] = self.embedding(token_ids[:, :-1])
        hidden = shifted + self.position[:token_ids.shape[1]]
        hidden = self.stack(hidden, valid_mask)
        hidden = self.output_norm(hidden)
        return F.linear(hidden, self.embedding.weight, self.output_bias)

    def loss(self, token_ids: Tensor, valid_mask: Tensor, raw_byte_count: int) -> tuple[Tensor, dict[str, Tensor]]:
        logits = self(token_ids, valid_mask)
        losses = F.cross_entropy(
            logits.reshape(-1, self.vocab_size), token_ids.reshape(-1), reduction="none"
        ).reshape_as(token_ids)
        nll = (losses * valid_mask).sum()
        if raw_byte_count <= 0:
            raise ValueError("raw_byte_count must be positive")
        objective = nll / float(raw_byte_count)
        return objective, {
            "nll_nats": nll.detach(),
            "byte_count": torch.tensor(raw_byte_count, device=token_ids.device),
            "token_count": valid_mask.sum().detach(),
        }

    def estimated_madds_per_sample(self, expected_tokens: float) -> float:
        cfg = self.config
        tokens = expected_tokens
        per_layer = tokens * (4.0 * cfg.dim * cfg.dim + 2.0 * cfg.dim * cfg.ffn_dim)
        per_layer += 2.0 * tokens * tokens * cfg.dim
        output = tokens * cfg.dim * self.vocab_size
        return cfg.layers * per_layer + output


def encode_batch(
    tokenizer: StaticByteBPE,
    windows: Sequence[bytes],
    device: torch.device,
) -> tuple[Tensor, Tensor, int, int]:
    encoded = [tokenizer.encode(window) for window in windows]
    max_length = max(len(token_ids) for token_ids in encoded)
    token_ids = torch.zeros(len(encoded), max_length, dtype=torch.long, device=device)
    valid = torch.zeros(len(encoded), max_length, dtype=torch.bool, device=device)
    for batch_index, ids in enumerate(encoded):
        count = len(ids)
        token_ids[batch_index, :count] = torch.tensor(ids, dtype=torch.long, device=device)
        valid[batch_index, :count] = True
    return token_ids, valid, sum(map(len, windows)), int(valid.sum().item())

"""Dense causal Transformer for Sero 1."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import torch
from torch import Tensor, nn
import torch.nn.functional as F


class RMSNorm(nn.Module):
    def __init__(self, dimension: int, epsilon: float = 1e-6) -> None:
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dimension))
        self.epsilon = epsilon

    def forward(self, value: Tensor) -> Tensor:
        floated = value.float()
        scale = floated.pow(2).mean(dim=-1, keepdim=True)
        normalized = floated * torch.rsqrt(scale + self.epsilon)
        return normalized.to(value.dtype) * self.weight


@dataclass(frozen=True)
class Sero1Config:
    vocabulary_size: int = 4096
    token_context: int = 512
    dimension: int = 256
    heads: int = 8
    layers: int = 6
    feed_forward: int = 1056
    dropout: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class Sero1Model(nn.Module):
    def __init__(self, config: Sero1Config) -> None:
        super().__init__()
        if config.dimension % config.heads:
            raise ValueError("model dimension must be divisible by the head count")
        self.config = config
        self.token_embedding = nn.Embedding(config.vocabulary_size, config.dimension)
        self.input_bos = nn.Parameter(torch.empty(config.dimension))
        self.position = nn.Parameter(torch.empty(config.token_context, config.dimension))
        layer = nn.TransformerEncoderLayer(
            d_model=config.dimension,
            nhead=config.heads,
            dim_feedforward=config.feed_forward,
            dropout=config.dropout,
            activation=F.silu,
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(
            layer, num_layers=config.layers, enable_nested_tensor=False,
        )
        self.final_norm = RMSNorm(config.dimension)
        self.output_bias = nn.Parameter(torch.zeros(config.vocabulary_size))
        nn.init.normal_(self.token_embedding.weight, mean=0.0, std=0.02)
        nn.init.normal_(self.input_bos, mean=0.0, std=0.02)
        nn.init.normal_(self.position, mean=0.0, std=0.02)

    def forward(self, target_ids: Tensor, valid_mask: Tensor) -> Tensor:
        if target_ids.ndim != 2 or target_ids.shape != valid_mask.shape:
            raise ValueError("target ids and valid mask must match [batch, time]")
        if target_ids.shape[1] > self.config.token_context:
            raise ValueError("token sequence exceeds the frozen context")
        if target_ids.dtype != torch.long or valid_mask.dtype != torch.bool:
            raise ValueError("target ids must be long and valid mask must be bool")
        if torch.any(~valid_mask[:, 0]):
            raise ValueError("every sequence must contain at least one token")
        shifted = torch.empty(
            target_ids.shape[0], target_ids.shape[1], self.config.dimension,
            dtype=self.token_embedding.weight.dtype, device=target_ids.device,
        )
        shifted[:, 0] = self.input_bos
        if target_ids.shape[1] > 1:
            shifted[:, 1:] = self.token_embedding(target_ids[:, :-1])
        hidden = shifted + self.position[:target_ids.shape[1]]
        length = target_ids.shape[1]
        causal = torch.triu(
            torch.ones(length, length, dtype=torch.bool, device=target_ids.device), diagonal=1,
        )
        hidden = self.transformer(hidden, mask=causal, src_key_padding_mask=~valid_mask)
        hidden = self.final_norm(hidden)
        return F.linear(hidden, self.token_embedding.weight, self.output_bias)

    def loss(
        self, target_ids: Tensor, valid_mask: Tensor,
    ) -> tuple[Tensor, dict[str, Tensor]]:
        logits = self(target_ids, valid_mask)
        losses = F.cross_entropy(
            logits.reshape(-1, self.config.vocabulary_size),
            target_ids.reshape(-1), reduction="none",
        ).reshape_as(target_ids)
        nll = (losses * valid_mask).sum()
        tokens = valid_mask.sum()
        return nll / tokens.clamp_min(1), {
            "nll_nats": nll.detach(), "tokens": tokens.detach(),
        }


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())

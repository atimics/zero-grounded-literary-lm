"""Causal latent tokenizer model for the preregistered Sero Latent V3 test.

The model predicts bytes only.  It has no end-patch, escape, unknown, or latent
codebook symbols.  Hard chunk decisions are used in the forward pass while a
soft confidence path and the ratio loss provide gradients to the router.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any

import torch
from torch import Tensor, nn
import torch.nn.functional as F


BYTE_VOCAB_SIZE = 256
BOS_ID = 256


@dataclass(frozen=True)
class LatentConfig:
    byte_context: int = 256
    local_dim: int = 48
    local_heads: int = 4
    local_encoder_layers: int = 2
    local_decoder_layers: int = 2
    local_ffn_dim: int = 128
    local_window: int = 64
    global_dim: int = 88
    global_heads: int = 4
    global_layers: int = 4
    global_ffn_dim: int = 240
    router_dim: int = 32
    boundary_threshold: float = 0.5
    ratio_loss_weight: float = 0.03
    compression_ratio_target: float = 4.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class LatentOutput:
    logits: Tensor
    ratio_loss: Tensor
    boundary_probability: Tensor
    hard_boundary: Tensor
    chunk_counts: Tensor


class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))
        self.eps = eps

    def forward(self, value: Tensor) -> Tensor:
        scale = value.float().pow(2).mean(dim=-1, keepdim=True)
        normalized = value * torch.rsqrt(scale.to(value.dtype) + self.eps)
        return normalized * self.weight


def causal_mask(length: int, device: torch.device, window: int | None = None) -> Tensor:
    """Return a boolean attention mask where True means attention is blocked."""

    positions = torch.arange(length, device=device)
    query = positions[:, None]
    key = positions[None, :]
    blocked = key > query
    if window is not None:
        blocked = blocked | (key < query - window + 1)
    return blocked


class CausalTransformer(nn.Module):
    def __init__(
        self,
        dim: int,
        heads: int,
        layers: int,
        ffn_dim: int,
        window: int | None = None,
    ) -> None:
        super().__init__()
        layer = nn.TransformerEncoderLayer(
            d_model=dim,
            nhead=heads,
            dim_feedforward=ffn_dim,
            dropout=0.0,
            activation=F.silu,
            batch_first=True,
            norm_first=True,
        )
        self.layers = nn.TransformerEncoder(layer, num_layers=layers, enable_nested_tensor=False)
        self.norm = RMSNorm(dim)
        self.window = window

    def forward(self, value: Tensor, valid_mask: Tensor) -> Tensor:
        mask = causal_mask(value.shape[1], value.device, self.window)
        encoded = self.layers(value, mask=mask, src_key_padding_mask=~valid_mask)
        return self.norm(encoded)


class CosineBoundaryRouter(nn.Module):
    """Embedding-space boundary detector using adjacent causal states."""

    def __init__(self, input_dim: int, router_dim: int, threshold: float) -> None:
        super().__init__()
        self.query = nn.Linear(input_dim, router_dim, bias=False)
        self.key = nn.Linear(input_dim, router_dim, bias=False)
        self.threshold = threshold

    def forward(self, states: Tensor, valid_mask: Tensor) -> tuple[Tensor, Tensor]:
        query = F.normalize(self.query(states), dim=-1, eps=1e-6)
        key = F.normalize(self.key(states), dim=-1, eps=1e-6)
        similarity = (query[:, 1:] * key[:, :-1]).sum(dim=-1)
        probability = torch.zeros(states.shape[:2], dtype=states.dtype, device=states.device)
        probability[:, 0] = 1.0
        probability[:, 1:] = 0.5 * (1.0 - similarity)
        probability = probability * valid_mask.to(probability.dtype)
        hard = (probability >= self.threshold) & valid_mask
        hard[:, 0] = valid_mask[:, 0]
        return probability, hard


def hnet_ratio_loss(
    probability: Tensor,
    hard: Tensor,
    valid_mask: Tensor,
    compression_ratio_target: float,
) -> Tensor:
    """H-Net equation 10, evaluated per sample.

    Under confident routing, its minimum is a selected fraction of 1 / N.
    Here N is measured from the training-only BPE tokenizer rather than guessed.
    """

    if compression_ratio_target <= 1.0:
        raise ValueError("compression_ratio_target must be greater than one")
    valid_count = valid_mask.sum(dim=1).clamp_min(1).to(probability.dtype)
    hard_rate = ((hard & valid_mask).sum(dim=1).to(probability.dtype) / valid_count).detach()
    soft_rate = (probability * valid_mask).sum(dim=1) / valid_count
    target = probability.new_tensor(compression_ratio_target)
    ratio = target / (target - 1.0)
    objective = (target - 1.0) * hard_rate * soft_rate
    objective = objective + (1.0 - hard_rate) * (1.0 - soft_rate)
    return (ratio * objective).mean()


class SeroLatentModel(nn.Module):
    def __init__(self, config: LatentConfig) -> None:
        super().__init__()
        if config.byte_context < 2:
            raise ValueError("byte_context must be at least 2")
        if not 0.0 < config.boundary_threshold < 1.0:
            raise ValueError("boundary_threshold must be between zero and one")
        self.config = config
        self.byte_embedding = nn.Embedding(BYTE_VOCAB_SIZE + 1, config.local_dim)
        self.local_position = nn.Parameter(torch.empty(config.byte_context, config.local_dim))
        self.local_encoder = CausalTransformer(
            config.local_dim,
            config.local_heads,
            config.local_encoder_layers,
            config.local_ffn_dim,
            config.local_window,
        )
        self.router = CosineBoundaryRouter(config.local_dim, config.router_dim, config.boundary_threshold)
        self.to_global = nn.Linear(config.local_dim, config.global_dim, bias=False)
        self.global_position = nn.Parameter(torch.empty(config.byte_context, config.global_dim))
        self.global_stack = CausalTransformer(
            config.global_dim,
            config.global_heads,
            config.global_layers,
            config.global_ffn_dim,
        )
        self.to_local = nn.Linear(config.global_dim, config.local_dim, bias=False)
        self.residual_projection = nn.Linear(config.local_dim, config.local_dim, bias=False)
        self.residual_scale = nn.Parameter(torch.tensor(0.1))
        self.local_decoder = CausalTransformer(
            config.local_dim,
            config.local_heads,
            config.local_decoder_layers,
            config.local_ffn_dim,
            config.local_window,
        )
        self.output_norm = RMSNorm(config.local_dim)
        self.output_bias = nn.Parameter(torch.zeros(BYTE_VOCAB_SIZE))
        self.reset_parameters()

    def reset_parameters(self) -> None:
        nn.init.normal_(self.local_position, mean=0.0, std=0.02)
        nn.init.normal_(self.global_position, mean=0.0, std=0.02)
        nn.init.normal_(self.byte_embedding.weight, mean=0.0, std=0.02)
        nn.init.xavier_uniform_(self.residual_projection.weight)

    def _shifted_inputs(self, target_bytes: Tensor) -> Tensor:
        inputs = torch.empty_like(target_bytes)
        inputs[:, 0] = BOS_ID
        inputs[:, 1:] = target_bytes[:, :-1]
        return inputs

    def _compress(
        self,
        encoded: Tensor,
        probability: Tensor,
        hard: Tensor,
        valid_mask: Tensor,
    ) -> tuple[Tensor, Tensor]:
        """Run the global model on hard chunks, smooth, then causally upsample."""

        batch, length, _ = encoded.shape
        chunk_counts = hard.sum(dim=1)
        max_chunks = int(chunk_counts.max().item())
        global_input = encoded.new_zeros(batch, max_chunks, self.config.global_dim)
        global_valid = torch.zeros(batch, max_chunks, dtype=torch.bool, device=encoded.device)
        selected_probability = probability.new_zeros(batch, max_chunks)

        for batch_index in range(batch):
            indices = torch.nonzero(hard[batch_index] & valid_mask[batch_index], as_tuple=False).flatten()
            count = indices.numel()
            selected_probability[batch_index, :count] = probability[batch_index, indices]
            projected = self.to_global(encoded[batch_index, indices])
            global_input[batch_index, :count] = projected + self.global_position[:count]
            global_valid[batch_index, :count] = True

        global_output = self.global_stack(global_input, global_valid)
        smooth_steps: list[Tensor] = []
        previous = torch.zeros_like(global_output[:, 0])
        for chunk_index in range(max_chunks):
            p = selected_probability[:, chunk_index].unsqueeze(-1)
            candidate = p * global_output[:, chunk_index] + (1.0 - p) * previous
            previous = torch.where(global_valid[:, chunk_index].unsqueeze(-1), candidate, previous)
            smooth_steps.append(previous)
        smooth_stack = torch.stack(smooth_steps, dim=1)
        segment = hard.to(torch.long).cumsum(dim=1).sub(1).clamp_min(0)
        segment = torch.minimum(segment, chunk_counts.sub(1).unsqueeze(1))
        gather_index = segment.unsqueeze(-1).expand(-1, -1, self.config.global_dim)
        upsampled = torch.gather(smooth_stack, dim=1, index=gather_index)

        confidence = torch.where(hard, probability, 1.0 - probability)
        straight_through = confidence + (1.0 - confidence).detach()
        upsampled = upsampled * straight_through.unsqueeze(-1)
        upsampled = upsampled * valid_mask.unsqueeze(-1).to(upsampled.dtype)
        return upsampled, chunk_counts

    def forward(self, target_bytes: Tensor, valid_mask: Tensor | None = None) -> LatentOutput:
        if target_bytes.ndim != 2:
            raise ValueError("target_bytes must have shape [batch, time]")
        if target_bytes.shape[1] > self.config.byte_context:
            raise ValueError("input exceeds configured byte context")
        if target_bytes.dtype != torch.long:
            raise ValueError("target_bytes must use torch.long")
        if torch.any((target_bytes < 0) | (target_bytes >= BYTE_VOCAB_SIZE)):
            raise ValueError("target_bytes contains a value outside 0..255")
        if valid_mask is None:
            valid_mask = torch.ones_like(target_bytes, dtype=torch.bool)
        if valid_mask.shape != target_bytes.shape or valid_mask.dtype != torch.bool:
            raise ValueError("valid_mask must be a boolean tensor matching target_bytes")
        if torch.any(~valid_mask[:, 0]):
            raise ValueError("every sample must contain at least one valid byte")

        length = target_bytes.shape[1]
        inputs = self._shifted_inputs(target_bytes)
        local = self.byte_embedding(inputs) + self.local_position[:length]
        encoded = self.local_encoder(local, valid_mask)
        probability, hard = self.router(encoded, valid_mask)
        global_by_byte, chunk_counts = self._compress(encoded, probability, hard, valid_mask)
        decoded_input = self.to_local(global_by_byte)
        decoded_input = decoded_input + self.residual_scale * self.residual_projection(encoded)
        decoded = self.local_decoder(decoded_input, valid_mask)
        decoded = self.output_norm(decoded)
        logits = F.linear(decoded, self.byte_embedding.weight[:BYTE_VOCAB_SIZE], self.output_bias)
        ratio_loss = hnet_ratio_loss(
            probability, hard, valid_mask, self.config.compression_ratio_target
        )
        return LatentOutput(logits, ratio_loss, probability, hard, chunk_counts)

    def loss(self, target_bytes: Tensor, valid_mask: Tensor | None = None) -> tuple[Tensor, dict[str, Tensor]]:
        if valid_mask is None:
            valid_mask = torch.ones_like(target_bytes, dtype=torch.bool)
        output = self(target_bytes, valid_mask)
        token_loss = F.cross_entropy(
            output.logits.reshape(-1, BYTE_VOCAB_SIZE),
            target_bytes.reshape(-1),
            reduction="none",
        ).reshape_as(target_bytes)
        nll = (token_loss * valid_mask).sum()
        byte_count = valid_mask.sum()
        mean_nll = nll / byte_count.clamp_min(1)
        objective = mean_nll + self.config.ratio_loss_weight * output.ratio_loss
        metrics = {
            "nll_nats": nll.detach(),
            "byte_count": byte_count.detach(),
            "ratio_loss": output.ratio_loss.detach(),
            "chunk_count": output.chunk_counts.sum().detach(),
        }
        return objective, metrics

    def parameter_groups(self, base_learning_rate: float, outer_multiplier: float) -> list[dict[str, Any]]:
        outer_names = ("local_encoder", "local_decoder", "router")
        outer: list[nn.Parameter] = []
        core: list[nn.Parameter] = []
        for name, parameter in self.named_parameters():
            (outer if name.startswith(outer_names) else core).append(parameter)
        return [
            {"params": core, "lr": base_learning_rate},
            {"params": outer, "lr": base_learning_rate * outer_multiplier},
        ]

    def estimated_madds_per_sample(self, expected_chunks: float | None = None) -> float:
        """Transparent inference multiply-add estimate for the parity gate."""

        cfg = self.config
        length = float(cfg.byte_context)
        chunks = expected_chunks if expected_chunks is not None else length * 0.5

        def block_cost(tokens: float, dim: int, ffn: int, attention_span: float) -> float:
            projections = tokens * (4.0 * dim * dim + 2.0 * dim * ffn)
            attention = 2.0 * tokens * attention_span * dim
            return projections + attention

        local_span = min(length, float(cfg.local_window))
        local_layers = cfg.local_encoder_layers + cfg.local_decoder_layers
        local = local_layers * block_cost(length, cfg.local_dim, cfg.local_ffn_dim, local_span)
        global_cost = cfg.global_layers * block_cost(chunks, cfg.global_dim, cfg.global_ffn_dim, chunks)
        router = 2.0 * length * cfg.local_dim * cfg.router_dim
        bridges = chunks * cfg.local_dim * cfg.global_dim
        bridges += length * cfg.global_dim * cfg.local_dim
        residual = length * cfg.local_dim * cfg.local_dim
        smoothing = 5.0 * length * cfg.global_dim
        byte_output = length * cfg.local_dim * BYTE_VOCAB_SIZE
        return local + global_cost + router + bridges + residual + smoothing + byte_output


def bits_per_byte(nll_nats: float, byte_count: int) -> float:
    if byte_count <= 0:
        raise ValueError("byte_count must be positive")
    return nll_nats / (float(byte_count) * math.log(2.0))

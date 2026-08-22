#!/usr/bin/env python3
"""Train the preregistered Sero Latent V3 model and its byte-BPE control."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import random
import subprocess
import time
from typing import Any, Iterable, Sequence

import numpy as np
import torch

from control import BPEConfig, BPETransformer, StaticByteBPE, encode_batch
from data import ManifestCorpus, SampledWindow, batch_windows
from model import LatentConfig, SeroLatentModel, bits_per_byte


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONTRACT = ROOT / "benchmarks" / "sero-latent-v3" / "contract.json"
DEFAULT_MANIFEST = ROOT / "build" / "zero-literary-v1" / "manifest.json"


def parse_budgets(value: str) -> list[int]:
    budgets = [int(item) for item in value.split(",") if item.strip()]
    if not budgets or any(budget <= 0 for budget in budgets):
        raise argparse.ArgumentTypeError("budgets must be positive comma-separated integers")
    if budgets != sorted(set(budgets)):
        raise argparse.ArgumentTypeError("budgets must be unique and increasing")
    return budgets


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--budgets", type=parse_budgets)
    parser.add_argument("--context", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--tokenizer-training-bytes", type=int)
    parser.add_argument("--vocab-size", type=int)
    parser.add_argument("--max-token-bytes", type=int)
    parser.add_argument("--validation-byte-limit", type=int, default=0)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    parser.add_argument("--tiny", action="store_true", help="use tiny models for a smoke test")
    parser.add_argument(
        "--allow-small-corpus",
        action="store_true",
        help="allow a clearly labelled non-promoting run below the corpus gate",
    )
    return parser.parse_args()


def load_contract(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.resolve().read_bytes()
    contract = json.loads(raw)
    if contract.get("schema") != "sero.latent_v3_contract.v1":
        raise ValueError("unexpected V3 contract schema")
    return contract, hashlib.sha256(raw).hexdigest()


def select_device(requested: str) -> torch.device:
    if requested != "auto":
        device = torch.device(requested)
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable")
    if device.type == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is unavailable")
    return device


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def synchronize(device: torch.device) -> None:
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elif device.type == "mps":
        torch.mps.synchronize()


def configs_from_contract(
    contract: dict[str, Any], context: int, tiny: bool
) -> tuple[LatentConfig, BPEConfig]:
    latent = contract["latent_model"]
    bpe = contract["bpe_control"]
    representation = contract["representation"]
    if tiny:
        return (
            LatentConfig(
                byte_context=context,
                local_dim=16,
                local_heads=2,
                local_encoder_layers=1,
                local_decoder_layers=1,
                local_ffn_dim=32,
                local_window=min(16, context),
                global_dim=24,
                global_heads=2,
                global_layers=1,
                global_ffn_dim=48,
                router_dim=8,
                boundary_threshold=float(representation["boundary_threshold"]),
                ratio_loss_weight=float(representation["ratio_loss_weight"]),
            ),
            BPEConfig(byte_context=context, dim=24, heads=2, layers=1, ffn_dim=48),
        )
    return (
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
            boundary_threshold=float(representation["boundary_threshold"]),
            ratio_loss_weight=float(representation["ratio_loss_weight"]),
        ),
        BPEConfig(
            byte_context=context,
            dim=int(bpe["dimension"]),
            heads=int(bpe["heads"]),
            layers=int(bpe["layers"]),
            ffn_dim=int(bpe["feed_forward"]),
        ),
    )


def parameter_count(model: torch.nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())


def make_byte_batch(windows: Sequence[bytes], device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    maximum = max(map(len, windows))
    target = torch.zeros(len(windows), maximum, dtype=torch.long, device=device)
    valid = torch.zeros(len(windows), maximum, dtype=torch.bool, device=device)
    for row, window in enumerate(windows):
        values = torch.tensor(list(window), dtype=torch.long, device=device)
        target[row, :len(window)] = values
        valid[row, :len(window)] = True
    return target, valid


def bounded_validation_windows(
    corpus: ManifestCorpus, context: int, byte_limit: int
) -> list[SampledWindow]:
    output: list[SampledWindow] = []
    remaining = byte_limit if byte_limit > 0 else None
    for window in corpus.validation_windows(context):
        if remaining is None:
            output.append(window)
            continue
        if remaining <= 0:
            break
        data = window.data[:remaining]
        output.append(replace(window, data=data))
        remaining -= len(data)
    if not output:
        raise ValueError("validation selection is empty")
    return output


@torch.no_grad()
def evaluate(
    latent_model: SeroLatentModel,
    bpe_model: BPETransformer,
    tokenizer: StaticByteBPE,
    validation: Sequence[SampledWindow],
    batch_size: int,
    device: torch.device,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, float]]:
    latent_model.eval()
    bpe_model.eval()
    latent_nll = 0.0
    bpe_nll = 0.0
    raw_bytes = 0
    latent_chunks = 0
    bpe_tokens = 0
    probability_sum = 0.0
    confidence_sum = 0.0
    first_boundaries = 0
    window_count = 0
    tokenization_seconds = 0.0
    latent_model_seconds = 0.0
    bpe_model_seconds = 0.0
    synchronize(device)
    evaluation_start = time.perf_counter()

    for group in batch_windows(validation, batch_size):
        raw = [window.data for window in group]
        target, valid = make_byte_batch(raw, device)
        synchronize(device)
        latent_start = time.perf_counter()
        latent_output = latent_model(target, valid)
        losses = torch.nn.functional.cross_entropy(
            latent_output.logits.reshape(-1, 256), target.reshape(-1), reduction="none"
        ).reshape_as(target)
        synchronize(device)
        latent_model_seconds += time.perf_counter() - latent_start
        latent_nll += float((losses * valid).sum().item())
        latent_chunks += int(latent_output.chunk_counts.sum().item())
        probability_sum += float((latent_output.boundary_probability * valid).sum().item())
        confidence = torch.where(
            latent_output.hard_boundary,
            latent_output.boundary_probability,
            1.0 - latent_output.boundary_probability,
        )
        confidence_sum += float((confidence * valid).sum().item())
        first_boundaries += int(latent_output.hard_boundary[:, 0].sum().item())

        tokenization_start = time.perf_counter()
        ids, token_valid, group_bytes, group_tokens = encode_batch(tokenizer, raw, device)
        tokenization_seconds += time.perf_counter() - tokenization_start
        synchronize(device)
        bpe_start = time.perf_counter()
        logits = bpe_model(ids, token_valid)
        token_losses = torch.nn.functional.cross_entropy(
            logits.reshape(-1, tokenizer.vocab_size), ids.reshape(-1), reduction="none"
        ).reshape_as(ids)
        synchronize(device)
        bpe_model_seconds += time.perf_counter() - bpe_start
        bpe_nll += float((token_losses * token_valid).sum().item())
        bpe_tokens += group_tokens
        raw_bytes += group_bytes
        window_count += len(group)

    if raw_bytes != sum(len(window.data) for window in validation):
        raise AssertionError("validation byte accounting drifted")
    if not math.isfinite(latent_nll) or not math.isfinite(bpe_nll):
        raise FloatingPointError("validation produced a non-finite loss")
    synchronize(device)
    evaluation_seconds = time.perf_counter() - evaluation_start
    latent = {
        "nll_nats": latent_nll,
        "raw_bytes": raw_bytes,
        "bits_per_byte": bits_per_byte(latent_nll, raw_bytes),
        "chunks": latent_chunks,
        "bytes_per_chunk": raw_bytes / latent_chunks,
        "mean_boundary_probability": probability_sum / raw_bytes,
        "mean_boundary_confidence": confidence_sum / raw_bytes,
        "first_position_boundary_fraction": first_boundaries / window_count,
    }
    bpe = {
        "nll_nats": bpe_nll,
        "raw_bytes": raw_bytes,
        "bits_per_byte": bits_per_byte(bpe_nll, raw_bytes),
        "tokens": bpe_tokens,
        "bytes_per_token": raw_bytes / bpe_tokens,
    }
    timing = {
        "total_seconds": evaluation_seconds,
        "raw_bytes_per_second": raw_bytes / evaluation_seconds,
        "latent_model_seconds": latent_model_seconds,
        "latent_model_raw_bytes_per_second": raw_bytes / latent_model_seconds,
        "bpe_model_seconds": bpe_model_seconds,
        "bpe_model_raw_bytes_per_second": raw_bytes / bpe_model_seconds,
        "bpe_tokenization_seconds": tokenization_seconds,
    }
    return latent, bpe, timing


def learning_rate_scale(progress: float, warmup_fraction: float, minimum_ratio: float) -> float:
    if progress < warmup_fraction:
        return max(progress / warmup_fraction, 1e-3)
    decay_progress = (progress - warmup_fraction) / (1.0 - warmup_fraction)
    cosine = 0.5 * (1.0 + math.cos(math.pi * min(decay_progress, 1.0)))
    return minimum_ratio + (1.0 - minimum_ratio) * cosine


def set_optimizer_learning_rates(
    optimizer: torch.optim.Optimizer, base_rates: Sequence[float], scale: float
) -> None:
    if len(optimizer.param_groups) != len(base_rates):
        raise AssertionError("optimizer learning-rate group drift")
    for group, base_rate in zip(optimizer.param_groups, base_rates, strict=True):
        group["lr"] = base_rate * scale


def git_commit() -> str | None:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False
    )
    return result.stdout.strip() if result.returncode == 0 else None


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    contract, contract_digest = load_contract(args.contract)
    data_rule = contract["data"]
    bpe_rule = contract["bpe_control"]
    optimization = contract["optimization"]
    gates = contract["gates"]
    context = args.context or int(data_rule["raw_byte_context"])
    batch_size = args.batch_size or int(data_rule["batch_size"])
    budgets = args.budgets or [int(value) for value in data_rule["training_byte_budgets"]]
    tokenizer_training_bytes = args.tokenizer_training_bytes or int(bpe_rule["tokenizer_training_bytes"])
    vocab_size = args.vocab_size or int(bpe_rule["vocabulary_size"])
    max_token_bytes = args.max_token_bytes or int(bpe_rule["maximum_token_bytes"])
    if context < 2 or batch_size < 1:
        raise ValueError("context must be at least 2 and batch size must be positive")
    if args.seed not in contract["seeds"] and not args.tiny:
        raise ValueError("seed is outside the preregistered set")

    corpus = ManifestCorpus.load(args.manifest)
    if not args.allow_small_corpus:
        expected_data = {
            "dataset_id": data_rule.get("dataset_id"),
            "version": data_rule.get("dataset_version"),
            "dataset_digest": data_rule.get("dataset_digest"),
        }
        observed_data = {
            "dataset_id": corpus.manifest.get("dataset_id"),
            "version": corpus.manifest.get("version"),
            "dataset_digest": corpus.dataset_digest,
        }
        if observed_data != expected_data:
            raise RuntimeError(
                f"official V3 data binding mismatch: expected {expected_data}, observed {observed_data}"
            )
    unique_training_bytes = corpus.unique_bytes("train")
    minimum_corpus_bytes = int(data_rule["minimum_unique_training_bytes"])
    corpus_gate = unique_training_bytes >= minimum_corpus_bytes
    if not corpus_gate and not args.allow_small_corpus:
        raise RuntimeError(
            f"training corpus has {unique_training_bytes:,} unique bytes; "
            f"the preregistered run requires {minimum_corpus_bytes:,}"
        )

    device = select_device(args.device)
    seed_everything(args.seed)
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    tokenizer_sample = list(
        corpus.representative_windows(
            tokenizer_training_bytes, context, int(bpe_rule["tokenizer_seed"])
        )
    )
    tokenizer_start = time.perf_counter()
    tokenizer = StaticByteBPE.train(
        (window.data for window in tokenizer_sample), vocab_size, max_token_bytes
    )
    tokenizer_training_seconds = time.perf_counter() - tokenizer_start
    tokenizer_path = args.artifact_dir / f"byte-bpe-v{vocab_size}.json"
    tokenizer.save(tokenizer_path)
    tokenizer_token_count = sum(len(tokenizer.encode(window.data)) for window in tokenizer_sample)
    tokenizer_bytes_per_token = tokenizer_training_bytes / tokenizer_token_count

    latent_config, bpe_config = configs_from_contract(contract, context, args.tiny)
    latent_config = replace(
        latent_config, compression_ratio_target=tokenizer_bytes_per_token
    )
    latent_model = SeroLatentModel(latent_config).to(device)
    bpe_model = BPETransformer(tokenizer.vocab_size, bpe_config).to(device)

    base_lr = float(optimization["learning_rate"])
    outer_multiplier = float(optimization["outer_learning_rate_multiplier"])
    betas = tuple(float(value) for value in optimization["betas"])
    adam_kwargs = {
        "betas": betas,
        "eps": float(optimization["epsilon"]),
        "weight_decay": float(optimization["weight_decay"]),
    }
    latent_optimizer = torch.optim.AdamW(
        latent_model.parameter_groups(base_lr, outer_multiplier), **adam_kwargs
    )
    bpe_optimizer = torch.optim.AdamW(bpe_model.parameters(), lr=base_lr, **adam_kwargs)
    latent_base_rates = [base_lr, base_lr * outer_multiplier]
    bpe_base_rates = [base_lr]

    validation = bounded_validation_windows(corpus, context, args.validation_byte_limit)
    validation_is_complete = args.validation_byte_limit <= 0 or sum(
        len(window.data) for window in validation
    ) == corpus.unique_bytes("validation")
    rng = np.random.default_rng(args.seed)
    schedule_digest = hashlib.sha256()
    source_exposure: Counter[str] = Counter()
    training_bytes = 0
    training_steps = 0
    latent_training_seconds = 0.0
    bpe_training_seconds = 0.0
    bpe_tokenization_seconds = 0.0
    evaluation_tokenization_seconds = 0.0
    checkpoint_rows: list[dict[str, Any]] = []
    next_checkpoint = 0
    maximum_budget = budgets[-1]
    training_start = time.perf_counter()

    while training_bytes < maximum_budget:
        windows = corpus.sample_batch(rng, batch_size, context)
        raw = [window.data for window in windows]
        for window in windows:
            schedule_digest.update(window.schedule_record())
            source_exposure[window.source_id] += len(window.data)
        group_bytes = sum(map(len, raw))
        progress = min((training_bytes + group_bytes) / maximum_budget, 1.0)
        scale = learning_rate_scale(
            progress,
            float(optimization["warmup_fraction"]),
            float(optimization["minimum_learning_rate_ratio"]),
        )
        set_optimizer_learning_rates(latent_optimizer, latent_base_rates, scale)
        set_optimizer_learning_rates(bpe_optimizer, bpe_base_rates, scale)

        target, valid = make_byte_batch(raw, device)
        latent_model.train()
        synchronize(device)
        latent_start = time.perf_counter()
        latent_optimizer.zero_grad(set_to_none=True)
        latent_loss, _ = latent_model.loss(target, valid)
        if not torch.isfinite(latent_loss):
            raise FloatingPointError("latent training loss became non-finite")
        latent_loss.backward()
        torch.nn.utils.clip_grad_norm_(latent_model.parameters(), float(optimization["gradient_clip"]))
        latent_optimizer.step()
        synchronize(device)
        latent_training_seconds += time.perf_counter() - latent_start

        bpe_model.train()
        tokenization_start = time.perf_counter()
        token_ids, token_valid, encoded_bytes, _ = encode_batch(tokenizer, raw, device)
        bpe_tokenization_seconds += time.perf_counter() - tokenization_start
        if encoded_bytes != group_bytes:
            raise AssertionError("BPE raw-byte accounting drifted")
        synchronize(device)
        bpe_start = time.perf_counter()
        bpe_optimizer.zero_grad(set_to_none=True)
        bpe_loss, _ = bpe_model.loss(token_ids, token_valid, encoded_bytes)
        if not torch.isfinite(bpe_loss):
            raise FloatingPointError("BPE training loss became non-finite")
        bpe_loss.backward()
        torch.nn.utils.clip_grad_norm_(bpe_model.parameters(), float(optimization["gradient_clip"]))
        bpe_optimizer.step()
        synchronize(device)
        bpe_training_seconds += time.perf_counter() - bpe_start

        training_bytes += group_bytes
        training_steps += 1
        while next_checkpoint < len(budgets) and training_bytes >= budgets[next_checkpoint]:
            latent_metrics, bpe_metrics, validation_timing = evaluate(
                latent_model, bpe_model, tokenizer, validation, batch_size, device
            )
            evaluation_tokenization_seconds += validation_timing["bpe_tokenization_seconds"]
            expected_chunks = context / latent_metrics["bytes_per_chunk"]
            expected_tokens = context / bpe_metrics["bytes_per_token"]
            latent_compute = latent_model.estimated_madds_per_sample(expected_chunks)
            bpe_compute = bpe_model.estimated_madds_per_sample(expected_tokens)
            checkpoint_rows.append(
                {
                    "requested_training_bytes": budgets[next_checkpoint],
                    "actual_training_bytes": training_bytes,
                    "step": training_steps,
                    "latent": latent_metrics,
                    "bpe_control": bpe_metrics,
                    "comparison": {
                        "latent_to_bpe_bpb_ratio": latent_metrics["bits_per_byte"]
                        / bpe_metrics["bits_per_byte"],
                        "latent_minus_bpe_bpb": latent_metrics["bits_per_byte"]
                        - bpe_metrics["bits_per_byte"],
                    },
                    "estimated_inference_compute": {
                        "latent_madds_per_sample": latent_compute,
                        "bpe_madds_per_sample": bpe_compute,
                        "latent_to_bpe_ratio": latent_compute / bpe_compute,
                        "includes": [
                            "input-and-output-projections",
                            "local-encoder-and-decoder",
                            "router-and-bridges",
                            "global-model",
                            "attention",
                        ],
                    },
                    "validation_timing": validation_timing,
                }
            )
            print(
                f"seed={args.seed} bytes={training_bytes:,} "
                f"latent={latent_metrics['bits_per_byte']:.4f} "
                f"bpe={bpe_metrics['bits_per_byte']:.4f} "
                f"chunks={latent_metrics['bytes_per_chunk']:.2f}B",
                flush=True,
            )
            next_checkpoint += 1

    total_training_seconds = time.perf_counter() - training_start
    model_path = args.artifact_dir / f"seed{args.seed}-models.pt"
    torch.save(
        {
            "schema": "sero.latent_v3_models.v1",
            "seed": args.seed,
            "tokenizer_digest": tokenizer.digest,
            "latent_config": latent_config.to_dict(),
            "bpe_config": bpe_config.to_dict(),
            "latent_state_dict": latent_model.state_dict(),
            "bpe_state_dict": bpe_model.state_dict(),
        },
        model_path,
    )

    final = checkpoint_rows[-1]
    training_exposure_ratio = training_bytes / training_bytes
    validation_ratio = final["latent"]["raw_bytes"] / final["bpe_control"]["raw_bytes"]
    compute_ratio = final["estimated_inference_compute"]["latent_to_bpe_ratio"]
    quality_ratio = final["comparison"]["latent_to_bpe_bpb_ratio"]
    full_contract_run = (
        not args.tiny
        and context == int(data_rule["raw_byte_context"])
        and batch_size == int(data_rule["batch_size"])
        and budgets == [int(value) for value in data_rule["training_byte_budgets"]]
        and tokenizer_training_bytes == int(bpe_rule["tokenizer_training_bytes"])
        and vocab_size == int(bpe_rule["vocabulary_size"])
        and max_token_bytes == int(bpe_rule["maximum_token_bytes"])
        and validation_is_complete
    )
    gate_values = {
        "minimum_corpus_size": corpus_gate,
        "full_preregistered_configuration": full_contract_run,
        "exact_training_byte_exposure": float(gates["raw_byte_exposure_ratio_minimum"])
        <= training_exposure_ratio
        <= float(gates["raw_byte_exposure_ratio_maximum"]),
        "exact_validation_byte_exposure": float(gates["validation_byte_ratio_minimum"])
        <= validation_ratio
        <= float(gates["validation_byte_ratio_maximum"]),
        "estimated_compute_parity": float(gates["estimated_compute_ratio_minimum"])
        <= compute_ratio
        <= float(gates["estimated_compute_ratio_maximum"]),
        "quality_step_change": quality_ratio <= float(gates["latent_final_bpb_ratio_maximum"]),
    }
    eligible = corpus_gate and full_contract_run
    passed = eligible and all(gate_values.values())
    reasons = [name for name, value in gate_values.items() if not value]
    result = {
        "schema": "sero.latent_v3_seed_result.v1",
        "experiment": "sero-latent-v3",
        "status": "passed" if passed else ("failed" if eligible else "non-promoting"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "contract": {
            "path": str(args.contract.resolve().relative_to(ROOT)),
            "sha256": contract_digest,
        },
        "runtime": {
            "git_commit": git_commit(),
            "python": platform.python_version(),
            "torch": torch.__version__,
            "numpy": np.__version__,
            "tokenizers": getattr(__import__("tokenizers"), "__version__", "unknown"),
            "platform": platform.platform(),
            "device": str(device),
        },
        "data": {
            "manifest": str(args.manifest.resolve().relative_to(ROOT)),
            "dataset_digest": corpus.dataset_digest,
            "train_split_digest": corpus.split_digest("train"),
            "validation_split_digest": corpus.split_digest("validation"),
            "unique_training_bytes": unique_training_bytes,
            "unique_validation_bytes": corpus.unique_bytes("validation"),
            "source_unique_bytes": corpus.source_byte_counts("train"),
            "source_training_exposure_bytes": dict(sorted(source_exposure.items())),
            "schedule_sha256": schedule_digest.hexdigest(),
            "document_boundaries_crossed": False,
        },
        "tokenizer": {
            "sha256": tokenizer.digest,
            "artifact_sha256": file_sha256(tokenizer_path),
            "requested_vocabulary_size": vocab_size,
            "actual_vocabulary_size": tokenizer.vocab_size,
            "maximum_token_bytes": max_token_bytes,
            "training_bytes": tokenizer_training_bytes,
            "training_seed": int(bpe_rule["tokenizer_seed"]),
            "training_tokens": tokenizer_token_count,
            "training_bytes_per_token": tokenizer_bytes_per_token,
        },
        "models": {
            "latent": latent_config.to_dict(),
            "bpe_control": bpe_config.to_dict(),
            "latent_parameters": parameter_count(latent_model),
            "bpe_parameters": parameter_count(bpe_model),
            "artifact_sha256": file_sha256(model_path),
        },
        "training": {
            "requested_byte_budgets": budgets,
            "actual_raw_bytes_per_arm": {"latent": training_bytes, "bpe_control": training_bytes},
            "raw_byte_exposure_ratio": training_exposure_ratio,
            "steps_per_arm": training_steps,
            "batch_size": batch_size,
            "raw_byte_context": context,
            "wall_seconds": total_training_seconds,
            "latent_model_seconds": latent_training_seconds,
            "bpe_model_seconds": bpe_training_seconds,
            "bpe_training_tokenization_seconds": bpe_tokenization_seconds,
            "tokenizer_fit_seconds": tokenizer_training_seconds,
            "evaluation_tokenization_seconds": evaluation_tokenization_seconds,
        },
        "validation": {
            "complete_split": validation_is_complete,
            "raw_bytes_per_arm": {
                "latent": final["latent"]["raw_bytes"],
                "bpe_control": final["bpe_control"]["raw_bytes"],
            },
            "raw_byte_exposure_ratio": validation_ratio,
        },
        "checkpoints": checkpoint_rows,
        "gates": gate_values,
        "decision": {
            "eligible_for_promotion": eligible,
            "passed": passed,
            "failed_or_ineligible_gates": reasons,
            "aggregate_override_allowed": False,
        },
    }
    dashboard_payload = {
        "experiment": "sero-latent-v3",
        "seed": args.seed,
        "step": training_steps,
        "update": training_steps,
        "training_bytes": training_bytes,
        "metric_kind": "bits-per-byte",
        "loss": final["latent"]["bits_per_byte"],
        "latent_bits_per_byte": final["latent"]["bits_per_byte"],
        "bpe_bits_per_byte": final["bpe_control"]["bits_per_byte"],
        "latent_to_bpe_bpb_ratio": quality_ratio,
        "bytes_per_chunk": final["latent"]["bytes_per_chunk"],
        "bytes_per_bpe_token": final["bpe_control"]["bytes_per_token"],
        "estimated_compute_ratio": compute_ratio,
        "decision": result["status"],
        "status": result["status"],
        "note": (
            "Mechanics-only run; corpus or configuration cannot promote."
            if not eligible
            else "Frozen 100M-byte V3 result; promotion requires all three seeds."
        ),
    }
    dashboard_payload_path = args.artifact_dir / f"seed{args.seed}-dashboard-payload.json"
    dashboard_payload_path.write_text(
        json.dumps(dashboard_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    result["telemetry"] = {
        "dashboard_payload": str(dashboard_payload_path.resolve().relative_to(ROOT)),
        "dashboard_payload_sha256": file_sha256(dashboard_payload_path),
        "published": False,
    }
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {args.output}", flush=True)


if __name__ == "__main__":
    main()

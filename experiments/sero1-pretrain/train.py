#!/usr/bin/env python3
"""Run the frozen Sero 1 dense language-model experiment."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import random
import subprocess
import time
from typing import Any, Sequence

import numpy as np
import torch

from data import ManifestDocuments, TokenWindow, TokenizedCorpus, batches
from model import Sero1Config, Sero1Model, parameter_count
from tokenizer import Sero1Tokenizer, sha256


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONTRACT = ROOT / "benchmarks" / "sero1-pretrain-v1" / "contract.json"
DEFAULT_MANIFEST = ROOT / "build" / "sero-pretrain-v1" / "manifest.json"
DEFAULT_TOKENIZER = ROOT / "tokenizers" / "sero1-byte-bpe-4096.json"
LN2 = math.log(2.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tokenizer", type=Path, default=DEFAULT_TOKENIZER)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--mode", choices=("calibration", "full"), default="full")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    parser.add_argument(
        "--max-updates", type=int, default=0,
        help="calibration-only update limit (zero means 128)",
    )
    parser.add_argument(
        "--validation-byte-limit", type=int, default=0,
        help="calibration-only validation limit (zero means 131072)",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(stable_json(value), encoding="utf-8")
    temporary.replace(path)


def load_contract(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.resolve().read_bytes()
    contract = json.loads(raw)
    if contract.get("schema") != "sero.pretrain_v1_contract.v1":
        raise ValueError("unexpected Sero 1 contract schema")
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
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
        if hasattr(torch.backends.cuda, "enable_flash_sdp"):
            torch.backends.cuda.enable_flash_sdp(False)
            torch.backends.cuda.enable_mem_efficient_sdp(False)
            torch.backends.cuda.enable_math_sdp(True)
    torch.use_deterministic_algorithms(True)


def synchronize(device: torch.device) -> None:
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elif device.type == "mps":
        torch.mps.synchronize()


def git_commit() -> str | None:
    bound = os.environ.get("SERO_SOURCE_COMMIT", "")
    if bound:
        if len(bound) != 40 or any(character not in "0123456789abcdef" for character in bound):
            raise ValueError("SERO_SOURCE_COMMIT must be a full lowercase Git SHA")
        return bound
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def model_config(contract: dict[str, Any]) -> Sero1Config:
    model = contract["model"]
    tokenizer = contract["tokenizer"]
    return Sero1Config(
        vocabulary_size=int(tokenizer["vocabulary_size"]),
        token_context=int(model["token_context"]),
        dimension=int(model["dimension"]),
        heads=int(model["heads"]),
        layers=int(model["layers"]),
        feed_forward=int(model["feed_forward"]),
        dropout=float(model["dropout"]),
    )


def verify_binding(
    contract: dict[str, Any], documents: ManifestDocuments, tokenizer: Sero1Tokenizer,
) -> None:
    data = contract["data"]
    observed = {
        "dataset_id": documents.manifest.get("dataset_id"),
        "dataset_version": documents.manifest.get("version"),
        "dataset_digest": documents.dataset_digest,
        "unique_training_bytes": documents.raw_bytes("train"),
        "unique_validation_bytes": documents.raw_bytes("validation"),
        "unique_test_bytes": documents.raw_bytes("test"),
    }
    expected = {key: data[key] for key in observed}
    if observed != expected:
        raise RuntimeError(f"frozen corpus binding mismatch: {observed} != {expected}")
    token_rule = contract["tokenizer"]
    if tokenizer.artifact_sha256 != token_rule["artifact_sha256"]:
        raise RuntimeError("frozen tokenizer hash mismatch")
    if tokenizer.vocab_size != int(token_rule["vocabulary_size"]):
        raise RuntimeError("frozen tokenizer vocabulary mismatch")


def epoch_order(count: int, seed: int, epoch: int) -> np.ndarray:
    generator = np.random.default_rng(np.random.SeedSequence([0x5345524F, seed, epoch]))
    return generator.permutation(count)


def schedule_digest(corpus: TokenizedCorpus, seed: int, epochs: int) -> str:
    digest = hashlib.sha256()
    windows = corpus.windows["train"]
    for epoch in range(epochs):
        for index in epoch_order(len(windows), seed, epoch):
            digest.update(windows[int(index)].schedule_record(epoch))
    return digest.hexdigest()


def learning_rate_scale(
    completed_updates: int, total_updates: int, warmup_fraction: float, minimum_ratio: float,
) -> float:
    progress = completed_updates / max(total_updates, 1)
    if progress <= warmup_fraction:
        return max(progress / warmup_fraction, 1e-3)
    decay = min((progress - warmup_fraction) / (1.0 - warmup_fraction), 1.0)
    cosine = 0.5 * (1.0 + math.cos(math.pi * decay))
    return minimum_ratio + (1.0 - minimum_ratio) * cosine


def tensors_for_windows(
    corpus: TokenizedCorpus, split: str, windows: Sequence[TokenWindow], device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    ids, valid, byte_lengths = corpus.batch_arrays(split, windows)
    return (
        torch.from_numpy(ids).to(device=device, dtype=torch.long),
        torch.from_numpy(valid).to(device=device, dtype=torch.bool),
        torch.from_numpy(byte_lengths).to(device=device, dtype=torch.long),
    )


@torch.inference_mode()
def evaluate(
    model: Sero1Model, corpus: TokenizedCorpus, split: str, batch_size: int,
    device: torch.device, raw_byte_limit: int = 0,
) -> dict[str, Any]:
    model.eval()
    chosen = corpus.ordered_windows(split, raw_byte_limit=raw_byte_limit)
    if not chosen:
        raise ValueError(f"{split} evaluation selection is empty")
    total_nll = 0.0
    total_tokens = 0
    total_bytes = 0
    per_source_nll: defaultdict[str, float] = defaultdict(float)
    per_source_tokens: Counter[str] = Counter()
    per_source_bytes: Counter[str] = Counter()
    autocast = device.type == "cuda"
    synchronize(device)
    started = time.perf_counter()
    for group in batches(chosen, batch_size):
        target, valid, byte_lengths = tensors_for_windows(corpus, split, group, device)
        with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=autocast):
            logits = model(target, valid)
            losses = torch.nn.functional.cross_entropy(
                logits.reshape(-1, model.config.vocabulary_size), target.reshape(-1),
                reduction="none",
            ).reshape_as(target)
        row_nll = (losses.float() * valid).sum(dim=1)
        row_tokens = valid.sum(dim=1)
        row_bytes = (byte_lengths * valid).sum(dim=1)
        total_nll += float(row_nll.sum().item())
        total_tokens += int(row_tokens.sum().item())
        total_bytes += int(row_bytes.sum().item())
        for row, window in enumerate(group):
            per_source_nll[window.source_id] += float(row_nll[row].item())
            per_source_tokens[window.source_id] += int(row_tokens[row].item())
            per_source_bytes[window.source_id] += int(row_bytes[row].item())
    synchronize(device)
    seconds = time.perf_counter() - started
    if total_bytes != sum(window.raw_bytes for window in chosen):
        raise AssertionError(f"{split} byte accounting drifted during evaluation")
    if not math.isfinite(total_nll):
        raise FloatingPointError(f"{split} produced a non-finite loss")
    sources = {
        source: {
            "nll_nats": per_source_nll[source],
            "tokens": per_source_tokens[source],
            "raw_bytes": per_source_bytes[source],
            "bits_per_byte": per_source_nll[source] / (LN2 * per_source_bytes[source]),
            "bytes_per_token": per_source_bytes[source] / per_source_tokens[source],
        }
        for source in sorted(per_source_bytes)
    }
    return {
        "split": split,
        "nll_nats": total_nll,
        "tokens": total_tokens,
        "raw_bytes": total_bytes,
        "bits_per_token": total_nll / (LN2 * total_tokens),
        "bits_per_byte": total_nll / (LN2 * total_bytes),
        "bytes_per_token": total_bytes / total_tokens,
        "windows": len(chosen),
        "seconds": seconds,
        "raw_bytes_per_second": total_bytes / seconds,
        "sources": sources,
    }


@torch.inference_mode()
def sample(
    model: Sero1Model, tokenizer: Sero1Tokenizer, prompt: str, device: torch.device,
    new_tokens: int = 128,
) -> dict[str, Any]:
    model.eval()
    prompt_bytes = prompt.encode("utf-8")
    ids, _ = tokenizer.encode(prompt_bytes)
    generated = list(ids)
    for _ in range(new_tokens):
        prefix = generated[-(model.config.token_context - 1):]
        target = torch.tensor([prefix + [0]], dtype=torch.long, device=device)
        valid = torch.ones_like(target, dtype=torch.bool)
        logits = model(target, valid)
        generated.append(int(logits[0, -1].argmax().item()))
    continuation = tokenizer.decode(generated[len(ids):])
    return {
        "prompt": prompt,
        "prompt_token_ids": ids,
        "generated_token_ids": generated[len(ids):],
        "generated_bytes_hex": continuation.hex(),
        "text_lossy_utf8": (prompt_bytes + continuation).decode("utf-8", errors="replace"),
    }


def tensor_digest(model: torch.nn.Module) -> str:
    digest = hashlib.sha256()
    for name, tensor in sorted(model.state_dict().items()):
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        value = tensor.detach().cpu().contiguous()
        digest.update(str(value.dtype).encode("ascii"))
        digest.update(np.asarray(value.shape, dtype=np.int64).tobytes())
        digest.update(value.view(torch.uint8).numpy().tobytes())
    return digest.hexdigest()


def runtime_record(device: torch.device) -> dict[str, Any]:
    record: dict[str, Any] = {
        "git_commit": git_commit(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "device": str(device),
    }
    if device.type == "cuda":
        record.update({
            "device_name": torch.cuda.get_device_name(device),
            "cuda": torch.version.cuda,
            "cudnn": torch.backends.cudnn.version(),
        })
    return record


def main() -> None:
    args = parse_args()
    if args.max_updates < 0 or args.validation_byte_limit < 0:
        raise ValueError("limits cannot be negative")
    if args.mode == "full" and (args.max_updates or args.validation_byte_limit):
        raise ValueError("full runs cannot use calibration limits")
    if args.mode == "calibration" and args.seed != 0:
        raise ValueError("the calibration run is fixed to seed 0")

    started_at = utc_now()
    wall_started = time.perf_counter()
    contract, contract_digest = load_contract(args.contract)
    if args.seed not in [int(seed) for seed in contract["seeds"]]:
        raise ValueError("seed is outside the preregistered set")
    device = select_device(args.device)
    seed_everything(args.seed)

    documents = ManifestDocuments.load(args.manifest)
    tokenizer = Sero1Tokenizer(
        args.tokenizer, maximum_token_bytes=int(contract["tokenizer"]["maximum_token_bytes"]),
    )
    verify_binding(contract, documents, tokenizer)
    config = model_config(contract)
    corpus = TokenizedCorpus(documents, tokenizer, config.token_context)
    model = Sero1Model(config).to(device)
    observed_parameters = parameter_count(model)
    if observed_parameters != int(contract["model"]["expected_parameters"]):
        raise RuntimeError(
            f"model parameter drift: {observed_parameters} != "
            f"{contract['model']['expected_parameters']}"
        )

    training = contract["training"]
    optimization = contract["optimization"]
    batch_size = int(training["batch_size"])
    epochs = int(training["epochs"])
    train_windows = corpus.windows["train"]
    updates_per_epoch = math.ceil(len(train_windows) / batch_size)
    frozen_total_updates = updates_per_epoch * epochs
    calibration_limit = (args.max_updates or 128) if args.mode == "calibration" else 0
    validation_limit = (
        args.validation_byte_limit or 131072
    ) if args.mode == "calibration" else 0

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=float(optimization["learning_rate"]),
        betas=tuple(float(value) for value in optimization["betas"]),
        eps=float(optimization["epsilon"]), weight_decay=float(optimization["weight_decay"]),
    )
    checkpoint_targets = [float(value) for value in training["checkpoint_epochs"]]
    next_checkpoint = 0
    completed_updates = 0
    exposed_bytes = 0
    exposed_tokens = 0
    source_exposure: Counter[str] = Counter()
    checkpoints: list[dict[str, Any]] = []
    training_nll = 0.0
    training_seconds = 0.0
    stop = False
    base_rate = float(optimization["learning_rate"])
    autocast = device.type == "cuda"

    for epoch in range(epochs):
        order = epoch_order(len(train_windows), args.seed, epoch)
        ordered = [train_windows[int(index)] for index in order]
        for group in batches(ordered, batch_size):
            completed_updates += 1
            scale = learning_rate_scale(
                completed_updates, frozen_total_updates,
                float(optimization["warmup_fraction"]),
                float(optimization["minimum_learning_rate_ratio"]),
            )
            optimizer.param_groups[0]["lr"] = base_rate * scale
            target, valid, _ = tensors_for_windows(corpus, "train", group, device)
            model.train()
            optimizer.zero_grad(set_to_none=True)
            synchronize(device)
            step_started = time.perf_counter()
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=autocast):
                loss, totals = model.loss(target, valid)
            if not torch.isfinite(loss):
                raise FloatingPointError(f"non-finite training loss at update {completed_updates}")
            loss.backward()
            gradient_norm = torch.nn.utils.clip_grad_norm_(
                model.parameters(), float(training["gradient_clip"]), error_if_nonfinite=True,
            )
            optimizer.step()
            synchronize(device)
            training_seconds += time.perf_counter() - step_started
            group_tokens = int(totals["tokens"].item())
            group_bytes = sum(window.raw_bytes for window in group)
            training_nll += float(totals["nll_nats"].item())
            exposed_tokens += group_tokens
            exposed_bytes += group_bytes
            for window in group:
                source_exposure[window.source_id] += window.raw_bytes

            if completed_updates == 1 or completed_updates % 100 == 0:
                print(
                    f"update={completed_updates}/{frozen_total_updates} "
                    f"epoch={exposed_bytes / documents.raw_bytes('train'):.4f} "
                    f"loss={float(loss.item()):.6f} grad={float(gradient_norm):.4f} "
                    f"lr={optimizer.param_groups[0]['lr']:.8g}", flush=True,
                )

            if args.mode == "full":
                equivalent_epoch = exposed_bytes / documents.raw_bytes("train")
                while (
                    next_checkpoint < len(checkpoint_targets)
                    and equivalent_epoch >= checkpoint_targets[next_checkpoint]
                ):
                    target_epoch = checkpoint_targets[next_checkpoint]
                    validation = evaluate(model, corpus, "validation", batch_size, device)
                    checkpoint = {
                        "nominal_epoch": target_epoch,
                        "observed_epoch": equivalent_epoch,
                        "raw_byte_overshoot": exposed_bytes - round(
                            target_epoch * documents.raw_bytes("train")
                        ),
                        "update": completed_updates,
                        "training_raw_bytes": exposed_bytes,
                        "training_tokens": exposed_tokens,
                        "learning_rate": optimizer.param_groups[0]["lr"],
                        "validation": validation,
                    }
                    checkpoints.append(checkpoint)
                    print(
                        f"checkpoint={target_epoch:.2f} update={completed_updates} "
                        f"validation_bpb={validation['bits_per_byte']:.6f}", flush=True,
                    )
                    next_checkpoint += 1

            if args.mode == "calibration" and completed_updates >= calibration_limit:
                stop = True
                break
        if stop:
            break

    if args.mode == "full":
        expected_bytes = documents.raw_bytes("train") * epochs
        expected_source = {
            source: count * epochs for source, count in documents.source_bytes("train").items()
        }
        if exposed_bytes != expected_bytes or dict(sorted(source_exposure.items())) != expected_source:
            raise AssertionError("full-run corpus exposure drifted")
        if next_checkpoint != len(checkpoint_targets):
            raise AssertionError("not every frozen validation checkpoint ran")
        final_validation = checkpoints[-1]["validation"]
        final_test = evaluate(model, corpus, "test", batch_size, device)
    else:
        final_validation = evaluate(
            model, corpus, "validation", batch_size, device, raw_byte_limit=validation_limit,
        )
        final_test = None

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    state_path = args.artifact_dir / "model-final.pt"
    torch.save({
        "schema": "sero.pretrain_v1_checkpoint.v1",
        "contract_sha256": contract_digest,
        "seed": args.seed,
        "mode": args.mode,
        "model_config": config.to_dict(),
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "completed_updates": completed_updates,
        "training_raw_bytes": exposed_bytes,
        "training_tokens": exposed_tokens,
    }, state_path)
    model_state_digest = tensor_digest(model)
    artifact_digest = sha256(state_path)
    samples = [
        sample(model, tokenizer, prompt, device)
        for prompt in contract["evaluation"]["sample_prompts"]
    ]

    gate_values: dict[str, bool] = {}
    if args.mode == "full":
        epoch_one = next(
            checkpoint for checkpoint in checkpoints if checkpoint["nominal_epoch"] == 1.0
        )
        gate_values = {
            "validation_bits_per_byte": final_validation["bits_per_byte"] <= float(
                contract["gates"]["validation_bits_per_byte_maximum_each_seed"]
            ),
            "test_bits_per_byte": final_test["bits_per_byte"] <= float(
                contract["gates"]["test_bits_per_byte_maximum_each_seed"]
            ),
            "final_validation_beats_epoch_one": (
                final_validation["bits_per_byte"] < epoch_one["validation"]["bits_per_byte"]
            ),
        }
        decision = "go" if all(gate_values.values()) else "no-go"
    else:
        decision = "non-promoting-calibration"

    elapsed = time.perf_counter() - wall_started
    projected_full_training_seconds = (
        training_seconds * frozen_total_updates / completed_updates
        if completed_updates else None
    )
    result: dict[str, Any] = {
        "schema": "sero.pretrain_v1_seed_result.v1",
        "experiment": contract["experiment"],
        "mode": args.mode,
        "seed": args.seed,
        "started_at": started_at,
        "finished_at": utc_now(),
        "contract": {
            "path": str(args.contract),
            "sha256": contract_digest,
            "status_at_launch": contract["status"],
        },
        "runtime": runtime_record(device),
        "data": {
            "manifest_path": str(args.manifest),
            "dataset_id": documents.manifest["dataset_id"],
            "dataset_version": documents.manifest["version"],
            "dataset_digest": documents.dataset_digest,
            "raw_bytes": {
                split: documents.raw_bytes(split) for split in ("train", "validation", "test")
            },
            "source_bytes": {
                split: documents.source_bytes(split) for split in ("train", "validation", "test")
            },
            "token_counts": {
                split: corpus.token_count(split) for split in ("train", "validation", "test")
            },
            "token_digests": {
                split: corpus.split_digest(split) for split in ("train", "validation", "test")
            },
            "window_counts": {
                split: len(corpus.windows[split]) for split in ("train", "validation", "test")
            },
            "schedule_sha256": schedule_digest(corpus, args.seed, epochs),
            "document_boundaries_crossed": False,
        },
        "tokenizer": {
            "path": str(args.tokenizer),
            "artifact_sha256": tokenizer.artifact_sha256,
            "vocabulary_size": tokenizer.vocab_size,
            "maximum_token_bytes": tokenizer.maximum_token_bytes,
            "train_bytes_per_token": (
                documents.raw_bytes("train") / corpus.token_count("train")
            ),
        },
        "model": {
            "config": config.to_dict(),
            "parameters": observed_parameters,
            "tokens_per_parameter_one_epoch": corpus.token_count("train") / observed_parameters,
            "tokens_per_parameter_full_run": (
                corpus.token_count("train") * epochs / observed_parameters
            ),
            "state_sha256": model_state_digest,
            "artifact": str(state_path),
            "artifact_sha256": artifact_digest,
            "artifact_bytes": state_path.stat().st_size,
        },
        "training": {
            "frozen_epochs": epochs,
            "batch_size": batch_size,
            "updates_per_epoch": updates_per_epoch,
            "frozen_total_updates": frozen_total_updates,
            "completed_updates": completed_updates,
            "raw_bytes": exposed_bytes,
            "tokens": exposed_tokens,
            "source_raw_bytes": dict(sorted(source_exposure.items())),
            "nll_nats": training_nll,
            "mean_token_nll_nats": training_nll / exposed_tokens,
            "seconds": training_seconds,
            "tokens_per_second": exposed_tokens / training_seconds,
            "raw_bytes_per_second": exposed_bytes / training_seconds,
            "final_learning_rate": optimizer.param_groups[0]["lr"],
        },
        "checkpoints": checkpoints,
        "final_validation": final_validation,
        "final_test": final_test,
        "samples": samples,
        "gates": {"values": gate_values, "decision": decision},
        "calibration": ({
            "max_updates": calibration_limit,
            "validation_raw_byte_limit": validation_limit,
            "projected_full_training_seconds": projected_full_training_seconds,
            "projection_excludes_full_validation_and_startup": True,
        } if args.mode == "calibration" else None),
        "timing": {"wall_seconds": elapsed},
        "telemetry": {
            "dashboard_payload": {
                "status": "completed",
                "experiment": contract["experiment"],
                "seed": args.seed,
                "metric_kind": "language-model-bits-per-byte",
                "training_bytes": exposed_bytes,
                "training_tokens": exposed_tokens,
                "epoch": exposed_bytes / documents.raw_bytes("train"),
                "validation_bits_per_byte": final_validation["bits_per_byte"],
                "test_bits_per_byte": (
                    final_test["bits_per_byte"] if final_test is not None else None
                ),
                "tokens_per_parameter": (
                    corpus.token_count("train") * epochs / observed_parameters
                ),
                "decision": decision,
                "note": "Frozen dense Sero 1 pretraining run.",
            },
            "published": False,
        },
    }
    payload = stable_json(result["telemetry"]["dashboard_payload"]).encode("utf-8")
    result["telemetry"]["dashboard_payload_sha256"] = hashlib.sha256(payload).hexdigest()
    atomic_json(args.output, result)
    print(
        f"wrote {args.output} decision={decision} "
        f"validation_bpb={final_validation['bits_per_byte']:.6f}", flush=True,
    )


if __name__ == "__main__":
    main()

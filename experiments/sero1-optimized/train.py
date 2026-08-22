#!/usr/bin/env python3
"""Train the article-safe Sero 1 optimized pilot and its unlikelihood branch."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import random
import subprocess
import sys
import time
from typing import Any, Sequence

import numpy as np
import torch


ROOT = Path(__file__).resolve().parents[2]
PRETRAIN = ROOT / "experiments" / "sero1-pretrain"
sys.path.insert(0, str(PRETRAIN))

from data import (  # noqa: E402
    EodTokenizedCorpus, ManifestDocuments, TokenWindow, batches,
)
from model import Sero1Config, Sero1Model, parameter_count  # noqa: E402
from tokenizer import Sero1Tokenizer, sha256  # noqa: E402

_BASE_TRAIN_SPEC = importlib.util.spec_from_file_location(
    "sero1_pretrain_train", PRETRAIN / "train.py",
)
if _BASE_TRAIN_SPEC is None or _BASE_TRAIN_SPEC.loader is None:
    raise RuntimeError("could not load the Sero 1 pretraining helpers")
_BASE_TRAIN = importlib.util.module_from_spec(_BASE_TRAIN_SPEC)
_BASE_TRAIN_SPEC.loader.exec_module(_BASE_TRAIN)
epoch_order = _BASE_TRAIN.epoch_order
learning_rate_scale = _BASE_TRAIN.learning_rate_scale
synchronize = _BASE_TRAIN.synchronize
tensor_digest = _BASE_TRAIN.tensor_digest


DEFAULT_CONTRACT = ROOT / "benchmarks" / "sero1-optimized-v1" / "contract.json"
DEFAULT_MANIFEST = ROOT / "build" / "sero-pretrain-v2" / "manifest.json"
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
    parser.add_argument(
        "--mode", choices=("calibration", "base", "unlikelihood"), default="base",
    )
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    parser.add_argument("--max-updates", type=int, default=0)
    parser.add_argument("--validation-byte-limit", type=int, default=0)
    return parser.parse_args()


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(stable_json(value), encoding="utf-8")
    temporary.replace(path)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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


def git_commit() -> str | None:
    bound = os.environ.get("SERO_SOURCE_COMMIT", "")
    if bound:
        if len(bound) != 40 or any(character not in "0123456789abcdef" for character in bound):
            raise ValueError("SERO_SOURCE_COMMIT must be a full lowercase Git SHA")
        return bound
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def load_contract(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.resolve().read_bytes()
    contract = json.loads(raw)
    if contract.get("schema") != "sero.optimized_pretrain_contract.v1":
        raise ValueError("unexpected optimized Sero contract schema")
    return contract, hashlib.sha256(raw).hexdigest()


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
    corpus: EodTokenizedCorpus,
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
        raise RuntimeError(f"optimized corpus binding mismatch: {observed} != {expected}")
    token_rule = contract["tokenizer"]
    if tokenizer.artifact_sha256 != token_rule["artifact_sha256"]:
        raise RuntimeError("tokenizer hash mismatch")
    if tokenizer.vocab_size != int(token_rule["vocabulary_size"]):
        raise RuntimeError("tokenizer vocabulary mismatch")
    if corpus.eod_token_id != int(token_rule["end_of_document_token_id"]):
        raise RuntimeError("end-of-document token mismatch")


def schedule_digest(corpus: EodTokenizedCorpus, seed: int, epochs: int) -> str:
    digest = hashlib.sha256()
    windows = corpus.windows["train"]
    for epoch in range(epochs):
        for index in epoch_order(len(windows), seed, epoch):
            digest.update(windows[int(index)].schedule_record(epoch))
    return digest.hexdigest()


def tensors_for_windows(
    corpus: EodTokenizedCorpus, split: str, windows: Sequence[TokenWindow],
    device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    ids, valid, byte_lengths = corpus.batch_arrays(split, windows)
    return (
        torch.from_numpy(ids).to(device=device, dtype=torch.long),
        torch.from_numpy(valid).to(device=device, dtype=torch.bool),
        torch.from_numpy(byte_lengths).to(device=device, dtype=torch.long),
    )


@torch.inference_mode()
def evaluate(
    model: Sero1Model, corpus: EodTokenizedCorpus, split: str, batch_size: int,
    device: torch.device, raw_byte_limit: int = 0,
) -> dict[str, Any]:
    model.eval()
    chosen = corpus.ordered_windows(split, raw_byte_limit=raw_byte_limit)
    if not chosen:
        raise ValueError(f"{split} evaluation selection is empty")
    content_nll = 0.0
    content_tokens = 0
    content_bytes = 0
    eod_nll = 0.0
    eod_tokens = 0
    eod_correct = 0
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
        content_mask = valid & (byte_lengths > 0)
        eod_mask = valid & (byte_lengths == 0)
        row_nll = (losses.float() * content_mask).sum(dim=1)
        row_tokens = content_mask.sum(dim=1)
        row_bytes = (byte_lengths * content_mask).sum(dim=1)
        content_nll += float(row_nll.sum().item())
        content_tokens += int(row_tokens.sum().item())
        content_bytes += int(row_bytes.sum().item())
        eod_nll += float((losses.float() * eod_mask).sum().item())
        eod_tokens += int(eod_mask.sum().item())
        eod_correct += int(((logits.argmax(dim=-1) == target) & eod_mask).sum().item())
        for row, window in enumerate(group):
            per_source_nll[window.source_id] += float(row_nll[row].item())
            per_source_tokens[window.source_id] += int(row_tokens[row].item())
            per_source_bytes[window.source_id] += int(row_bytes[row].item())
    synchronize(device)
    seconds = time.perf_counter() - started
    if content_bytes != sum(window.raw_bytes for window in chosen):
        raise AssertionError(f"{split} content byte accounting drifted")
    return {
        "split": split,
        "content_nll_nats": content_nll,
        "content_tokens": content_tokens,
        "raw_bytes": content_bytes,
        "content_bits_per_token": content_nll / (LN2 * content_tokens),
        "content_bits_per_byte": content_nll / (LN2 * content_bytes),
        "content_bytes_per_token": content_bytes / content_tokens,
        "end_of_document": {
            "tokens": eod_tokens,
            "nll_nats": eod_nll,
            "mean_nll_nats": eod_nll / max(eod_tokens, 1),
            "top1_accuracy": eod_correct / max(eod_tokens, 1),
        },
        "windows": len(chosen),
        "seconds": seconds,
        "raw_bytes_per_second": content_bytes / seconds,
        "sources": {
            source: {
                "content_nll_nats": per_source_nll[source],
                "content_tokens": per_source_tokens[source],
                "raw_bytes": per_source_bytes[source],
                "content_bits_per_byte": per_source_nll[source] /
                (LN2 * per_source_bytes[source]),
            }
            for source in sorted(per_source_bytes)
        },
    }


def loss_for_batch(
    model: Sero1Model, target: torch.Tensor, valid: torch.Tensor,
    negative_ids: torch.Tensor | None, alpha: float,
) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
    logits = model(target, valid)
    losses = torch.nn.functional.cross_entropy(
        logits.reshape(-1, model.config.vocabulary_size), target.reshape(-1),
        reduction="none",
    ).reshape_as(target)
    nll = (losses * valid).sum()
    tokens = valid.sum()
    cross_entropy = nll / tokens.clamp_min(1)
    if negative_ids is None:
        zero = cross_entropy.detach().new_zeros(())
        return cross_entropy, {
            "nll_nats": nll.detach(), "tokens": tokens.detach(),
            "unlikelihood_nll": zero, "unlikelihood_tokens": zero.to(torch.long),
        }
    negative_mask = negative_ids >= 0
    safe_ids = negative_ids.clamp_min(0)
    probabilities = torch.softmax(logits.float(), dim=-1)
    negative_probabilities = probabilities.gather(-1, safe_ids.unsqueeze(-1)).squeeze(-1)
    unlikelihood_values = -torch.log1p(
        -negative_probabilities.clamp(max=1.0 - 1e-6)
    )
    unlikelihood_nll = (unlikelihood_values * negative_mask).sum()
    unlikelihood_tokens = negative_mask.sum()
    unlikelihood = unlikelihood_nll / unlikelihood_tokens.clamp_min(1)
    return cross_entropy + alpha * unlikelihood, {
        "nll_nats": nll.detach(), "tokens": tokens.detach(),
        "unlikelihood_nll": unlikelihood_nll.detach(),
        "unlikelihood_tokens": unlikelihood_tokens.detach(),
    }


@torch.inference_mode()
def sample(
    model: Sero1Model, tokenizer: Sero1Tokenizer, eod_token_id: int, prompt: str,
    device: torch.device, new_tokens: int,
) -> dict[str, Any]:
    model.eval()
    prompt_bytes = prompt.encode("utf-8")
    ids, _ = tokenizer.encode(prompt_bytes)
    generated = list(ids)
    continuation: list[int] = []
    ended = False
    for _ in range(new_tokens):
        prefix = generated[-(model.config.token_context - 1):]
        target = torch.tensor([prefix + [0]], dtype=torch.long, device=device)
        valid = torch.ones_like(target, dtype=torch.bool)
        token_id = int(model(target, valid)[0, -1].argmax().item())
        if token_id == eod_token_id:
            ended = True
            break
        generated.append(token_id)
        continuation.append(token_id)
    data = tokenizer.decode(continuation)
    fourgrams = [tuple(continuation[index:index + 4]) for index in range(
        max(len(continuation) - 3, 0)
    )]
    return {
        "prompt": prompt,
        "prompt_tokens": len(ids),
        "generated_tokens": len(continuation),
        "ended_at_end_of_document": ended,
        "token_distinct_4": len(set(fourgrams)) / len(fourgrams) if fourgrams else 0.0,
        "generated_bytes_hex": data.hex(),
        "text_lossy_utf8": (prompt_bytes + data).decode("utf-8", errors="replace"),
    }


def save_checkpoint(
    path: Path, contract_digest: str, seed: int, mode: str, model: Sero1Model,
    optimizer: torch.optim.Optimizer, completed_updates: int, completed_epochs: int,
    training_raw_bytes: int, training_tokens: int, source_exposure: Counter[str],
    training_nll: float, checkpoints: list[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "schema": "sero.optimized_pretrain_checkpoint.v1",
        "contract_sha256": contract_digest,
        "seed": seed,
        "mode": mode,
        "model_config": model.config.to_dict(),
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "completed_updates": completed_updates,
        "completed_epochs": completed_epochs,
        "training_raw_bytes": training_raw_bytes,
        "training_tokens": training_tokens,
        "source_exposure": dict(source_exposure),
        "training_nll_nats": training_nll,
        "checkpoints": checkpoints,
    }, path)


def main() -> None:
    args = parse_args()
    if args.seed < 0 or args.max_updates < 0 or args.validation_byte_limit < 0:
        raise ValueError("seed and limits cannot be negative")
    if args.mode == "unlikelihood" and args.resume is None:
        raise ValueError("unlikelihood mode requires --resume from the frozen branch epoch")
    if args.mode != "unlikelihood" and args.resume is not None:
        raise ValueError("--resume is only valid for the unlikelihood branch")
    started_at = utc_now()
    wall_started = time.perf_counter()
    contract, contract_digest = load_contract(args.contract)
    if args.seed != int(contract["pilot_seed"]):
        raise ValueError("only the frozen diagnostic seed is open")
    device = select_device(args.device)
    seed_everything(args.seed)
    documents = ManifestDocuments.load(args.manifest)
    tokenizer = Sero1Tokenizer(args.tokenizer)
    config = model_config(contract)
    corpus = EodTokenizedCorpus(documents, tokenizer, config.token_context)
    verify_binding(contract, documents, tokenizer, corpus)
    model = Sero1Model(config).to(device)
    if parameter_count(model) != int(contract["model"]["expected_parameters"]):
        raise RuntimeError("model parameter count drifted")
    optimization = contract["optimization"]
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=float(optimization["learning_rate"]),
        betas=tuple(float(value) for value in optimization["betas"]),
        eps=float(optimization["epsilon"]), weight_decay=float(optimization["weight_decay"]),
    )
    training = contract["training"]
    batch_size = int(training["batch_size"])
    epochs = int(training["epochs"])
    train_windows = corpus.windows["train"]
    updates_per_epoch = math.ceil(len(train_windows) / batch_size)
    total_updates = updates_per_epoch * epochs
    completed_updates = 0
    start_epoch = 0
    exposed_bytes = 0
    exposed_tokens = 0
    source_exposure: Counter[str] = Counter()
    training_nll = 0.0
    checkpoints: list[dict[str, Any]] = []
    if args.mode == "unlikelihood":
        resume = torch.load(args.resume, map_location="cpu", weights_only=True)
        if (
            resume.get("schema") != "sero.optimized_pretrain_checkpoint.v1"
            or resume.get("contract_sha256") != contract_digest
            or int(resume.get("seed")) != args.seed
        ):
            raise ValueError("unlikelihood resume checkpoint binding failed")
        branch_epoch = int(float(training["unlikelihood_branch_epoch"]))
        if int(resume["completed_epochs"]) != branch_epoch:
            raise ValueError("resume checkpoint is not the frozen branch epoch")
        model.load_state_dict(resume["model_state"], strict=True)
        optimizer.load_state_dict(resume["optimizer_state"])
        completed_updates = int(resume["completed_updates"])
        start_epoch = branch_epoch
        exposed_bytes = int(resume["training_raw_bytes"])
        exposed_tokens = int(resume["training_tokens"])
        source_exposure.update(resume["source_exposure"])
        training_nll = float(resume["training_nll_nats"])
        checkpoints = list(resume["checkpoints"])
    checkpoint_targets = [float(value) for value in training["checkpoint_epochs"]]
    next_checkpoint = sum(value <= start_epoch for value in checkpoint_targets)
    maximum_updates = (args.max_updates or 128) if args.mode == "calibration" else 0
    validation_limit = (
        args.validation_byte_limit or 131072
    ) if args.mode == "calibration" else 0
    base_rate = float(optimization["learning_rate"])
    autocast = device.type == "cuda"
    training_seconds = 0.0
    unlikelihood_nll = 0.0
    unlikelihood_tokens = 0
    stop = False
    for epoch in range(start_epoch, epochs):
        order = epoch_order(len(train_windows), args.seed, epoch)
        ordered = [train_windows[int(index)] for index in order]
        for group in batches(ordered, batch_size):
            completed_updates += 1
            scale = learning_rate_scale(
                completed_updates, total_updates,
                float(optimization["warmup_fraction"]),
                float(optimization["minimum_learning_rate_ratio"]),
            )
            optimizer.param_groups[0]["lr"] = base_rate * scale
            target, valid, _ = tensors_for_windows(corpus, "train", group, device)
            negative_ids = None
            alpha = 0.0
            if args.mode == "unlikelihood":
                negative = corpus.batch_negative_token_ids(
                    "train", group, int(contract["objectives"]["branch_unlikelihood_ngram"]),
                )
                negative_ids = torch.from_numpy(negative).to(device=device, dtype=torch.long)
                alpha = float(contract["objectives"]["branch_unlikelihood_alpha"])
            model.train()
            optimizer.zero_grad(set_to_none=True)
            synchronize(device)
            step_started = time.perf_counter()
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=autocast):
                loss, totals = loss_for_batch(model, target, valid, negative_ids, alpha)
            if not torch.isfinite(loss):
                raise FloatingPointError(f"non-finite loss at update {completed_updates}")
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
            unlikelihood_nll += float(totals["unlikelihood_nll"].item())
            unlikelihood_tokens += int(totals["unlikelihood_tokens"].item())
            for window in group:
                source_exposure[window.source_id] += window.raw_bytes
            if completed_updates == 1 or completed_updates % 100 == 0:
                print(
                    f"mode={args.mode} update={completed_updates}/{total_updates} "
                    f"epoch={exposed_bytes / documents.raw_bytes('train'):.4f} "
                    f"loss={float(loss.item()):.6f} grad={float(gradient_norm):.4f} "
                    f"lr={optimizer.param_groups[0]['lr']:.8g}", flush=True,
                )
            if args.mode != "calibration":
                equivalent_epoch = exposed_bytes / documents.raw_bytes("train")
                while (
                    next_checkpoint < len(checkpoint_targets)
                    and equivalent_epoch >= checkpoint_targets[next_checkpoint]
                ):
                    target_epoch = checkpoint_targets[next_checkpoint]
                    validation = evaluate(model, corpus, "validation", batch_size, device)
                    checkpoint_record = {
                        "nominal_epoch": target_epoch,
                        "observed_epoch": equivalent_epoch,
                        "update": completed_updates,
                        "learning_rate": optimizer.param_groups[0]["lr"],
                        "objective": args.mode,
                        "validation": validation,
                    }
                    checkpoints.append(checkpoint_record)
                    print(
                        f"checkpoint={target_epoch:.1f} objective={args.mode} "
                        f"validation_bpb={validation['content_bits_per_byte']:.6f} "
                        f"eod_acc={validation['end_of_document']['top1_accuracy']:.4f}",
                        flush=True,
                    )
                    next_checkpoint += 1
                    if (
                        args.mode == "base"
                        and target_epoch == float(training["unlikelihood_branch_epoch"])
                    ):
                        save_checkpoint(
                            args.artifact_dir / "model-branch-epoch5.pt", contract_digest,
                            args.seed, args.mode, model, optimizer, completed_updates,
                            int(target_epoch), exposed_bytes, exposed_tokens, source_exposure,
                            training_nll, checkpoints,
                        )
            if args.mode == "calibration" and completed_updates >= maximum_updates:
                stop = True
                break
        if stop:
            break
    if args.mode == "calibration":
        final_validation = evaluate(
            model, corpus, "validation", batch_size, device, raw_byte_limit=validation_limit,
        )
        final_test = None
        decision = "non-promoting-calibration"
    else:
        expected_epochs = epochs if args.mode in {"base", "unlikelihood"} else 0
        if completed_updates != updates_per_epoch * expected_epochs:
            raise AssertionError("optimized full run did not complete its frozen updates")
        final_validation = checkpoints[-1]["validation"]
        final_test = evaluate(model, corpus, "test", batch_size, device)
        decision = "diagnostic-complete"
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    final_path = args.artifact_dir / "model-final.pt"
    save_checkpoint(
        final_path, contract_digest, args.seed, args.mode, model, optimizer,
        completed_updates, (epochs if args.mode != "calibration" else 0), exposed_bytes,
        exposed_tokens, source_exposure, training_nll, checkpoints,
    )
    samples = [
        sample(
            model, tokenizer, corpus.eod_token_id, prompt, device,
            int(contract["evaluation"]["sample_new_tokens"]),
        )
        for prompt in contract["evaluation"]["sample_prompts"]
    ]
    elapsed = time.perf_counter() - wall_started
    result = {
        "schema": "sero.optimized_pretrain_seed_result.v1",
        "experiment": contract["experiment"],
        "mode": args.mode,
        "seed": args.seed,
        "started_at": started_at,
        "finished_at": utc_now(),
        "contract": {"path": str(args.contract), "sha256": contract_digest},
        "runtime": {
            "git_commit": git_commit(), "python": platform.python_version(),
            "platform": platform.platform(), "torch": torch.__version__,
            "numpy": np.__version__, "device": str(device),
            **({
                "device_name": torch.cuda.get_device_name(device), "cuda": torch.version.cuda,
                "cudnn": torch.backends.cudnn.version(),
            } if device.type == "cuda" else {}),
        },
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
            "content_token_counts": {
                split: corpus.content_token_count(split)
                for split in ("train", "validation", "test")
            },
            "end_of_document_counts": {
                split: corpus.eod_count(split) for split in ("train", "validation", "test")
            },
            "training_token_counts": {
                split: corpus.token_count(split) for split in ("train", "validation", "test")
            },
            "window_counts": {
                split: len(corpus.windows[split]) for split in ("train", "validation", "test")
            },
            "schedule_sha256": schedule_digest(corpus, args.seed, epochs),
            "split_unit": "original-source-article",
            "document_boundaries_crossed": False,
            "unmarked_document_boundaries": 0,
        },
        "tokenizer": {
            "path": str(args.tokenizer), "artifact_sha256": tokenizer.artifact_sha256,
            "vocabulary_size": tokenizer.vocab_size,
            "end_of_document_token_id": corpus.eod_token_id,
        },
        "model": {
            "config": config.to_dict(), "parameters": parameter_count(model),
            "state_sha256": tensor_digest(model), "artifact": str(final_path),
            "artifact_sha256": sha256(final_path), "artifact_bytes": final_path.stat().st_size,
        },
        "training": {
            "epochs": epochs, "batch_size": batch_size,
            "updates_per_epoch": updates_per_epoch, "completed_updates": completed_updates,
            "raw_bytes": exposed_bytes, "tokens": exposed_tokens,
            "source_raw_bytes": dict(sorted(source_exposure.items())),
            "cross_entropy_nll_nats": training_nll,
            "unlikelihood_nll": unlikelihood_nll,
            "unlikelihood_tokens": unlikelihood_tokens,
            "seconds": training_seconds,
            "tokens_per_second": exposed_tokens / max(training_seconds, 1e-9),
            "objective": args.mode,
        },
        "checkpoints": checkpoints,
        "final_validation": final_validation,
        "final_test": final_test,
        "samples": samples,
        "decision": decision,
        "timing": {"wall_seconds": elapsed},
        "calibration": ({
            "max_updates": maximum_updates,
            "validation_raw_byte_limit": validation_limit,
            "projected_full_training_seconds": training_seconds * total_updates /
            max(completed_updates, 1),
        } if args.mode == "calibration" else None),
    }
    atomic_json(args.output, result)
    print(
        f"wrote {args.output} objective={args.mode} "
        f"validation_bpb={final_validation['content_bits_per_byte']:.6f}", flush=True,
    )


if __name__ == "__main__":
    main()

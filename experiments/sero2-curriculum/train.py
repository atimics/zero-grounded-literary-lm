#!/usr/bin/env python3
"""Train the fixed-capacity Sero curriculum pilot from scratch."""

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
OPTIMIZED = ROOT / "experiments" / "sero1-optimized"
sys.path.insert(0, str(PRETRAIN))

from data import EodTokenizedCorpus, ManifestDocuments, TokenWindow, batches  # noqa: E402
from model import Sero1Config, Sero1Model, parameter_count  # noqa: E402
from tokenizer import Sero1Tokenizer, sha256  # noqa: E402

_HELPER_SPEC = importlib.util.spec_from_file_location(
    "sero1_optimized_train_helpers", OPTIMIZED / "train.py",
)
if _HELPER_SPEC is None or _HELPER_SPEC.loader is None:
    raise RuntimeError("could not load Sero training helpers")
_HELPERS = importlib.util.module_from_spec(_HELPER_SPEC)
_HELPER_SPEC.loader.exec_module(_HELPERS)
atomic_json = _HELPERS.atomic_json
evaluate = _HELPERS.evaluate
git_commit = _HELPERS.git_commit
learning_rate_scale = _HELPERS.learning_rate_scale
sample = _HELPERS.sample
seed_everything = _HELPERS.seed_everything
select_device = _HELPERS.select_device
synchronize = _HELPERS.synchronize
tensor_digest = _HELPERS.tensor_digest
tensors_for_windows = _HELPERS.tensors_for_windows


DEFAULT_CONTRACT = ROOT / "benchmarks" / "sero2-curriculum-v1" / "contract.json"
DEFAULT_MANIFEST = ROOT / "build" / "sero-pretrain-curriculum-v1" / "manifest.json"
DEFAULT_TOKENIZER = ROOT / "tokenizers" / "sero1-byte-bpe-4096.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tokenizer", type=Path, default=DEFAULT_TOKENIZER)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--mode", choices=("calibration", "full"), default="full")
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    parser.add_argument("--max-updates", type=int, default=0)
    parser.add_argument("--validation-byte-limit", type=int, default=0)
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_contract(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.resolve().read_bytes()
    contract = json.loads(raw)
    if contract.get("schema") == "sero.curriculum_pretrain_replication_contract.v1":
        binding = contract["parent_contract"]
        parent_path = ROOT / binding["path"]
        parent_raw = parent_path.read_bytes()
        if hashlib.sha256(parent_raw).hexdigest() != binding["sha256"]:
            raise ValueError("replication parent contract hash mismatch")
        parent = json.loads(parent_raw)
        if parent.get("schema") != "sero.curriculum_pretrain_contract.v1":
            raise ValueError("unexpected replication parent contract schema")
        overrides = {
            key: value for key, value in contract.items()
            if key not in {"schema", "parent_contract"}
        }
        contract = {
            **parent, **overrides,
            "schema": "sero.curriculum_pretrain_contract.v1",
            "replication_parent_contract": binding,
        }
    elif contract.get("schema") != "sero.curriculum_pretrain_contract.v1":
        raise ValueError("unexpected Sero curriculum contract schema")
    return contract, hashlib.sha256(raw).hexdigest()


def seed_binding(rule: dict[str, Any], name: str, seed: int) -> Any:
    by_seed = rule.get(f"{name}_by_seed")
    if by_seed is not None:
        try:
            return by_seed[str(seed)]
        except KeyError as error:
            raise ValueError(f"{name} is not bound for seed {seed}") from error
    return rule[name]


def model_config(contract: dict[str, Any]) -> Sero1Config:
    model = contract["model"]
    tokenizer = contract["tokenizer"]
    return Sero1Config(
        vocabulary_size=int(tokenizer["vocabulary_size"]),
        token_context=int(model["token_context"]),
        dimension=int(model["dimension"]), heads=int(model["heads"]),
        layers=int(model["layers"]), feed_forward=int(model["feed_forward"]),
        dropout=float(model["dropout"]),
    )


def verify_binding(
    contract: dict[str, Any], documents: ManifestDocuments,
    tokenizer: Sero1Tokenizer, corpus: EodTokenizedCorpus, seed: int,
) -> None:
    data = contract["data"]
    observed = {
        "dataset_id": documents.manifest["dataset_id"],
        "dataset_version": documents.manifest["version"],
        "dataset_digest": documents.dataset_digest,
        "unique_training_bytes": documents.raw_bytes("train"),
        "unique_validation_bytes": documents.raw_bytes("validation"),
        "unique_test_bytes": documents.raw_bytes("test"),
        "training_documents": len(documents.splits["train"]),
        "validation_documents": len(documents.splits["validation"]),
        "test_documents": len(documents.splits["test"]),
    }
    expected = {key: data[key] for key in observed}
    if observed != expected:
        raise RuntimeError(f"curriculum corpus binding mismatch: {observed} != {expected}")
    if documents.manifest["curriculum_sha256"] != data["curriculum_sha256"]:
        raise RuntimeError("curriculum artifact hash mismatch")
    if documents.manifest["source_registry_sha256"] != data["source_registry_sha256"]:
        raise RuntimeError("source registry hash mismatch")
    token_rule = contract["tokenizer"]
    if tokenizer.artifact_sha256 != token_rule["artifact_sha256"]:
        raise RuntimeError("tokenizer hash mismatch")
    if tokenizer.vocab_size != int(token_rule["vocabulary_size"]):
        raise RuntimeError("tokenizer vocabulary mismatch")
    if corpus.eod_token_id != int(token_rule["end_of_document_token_id"]):
        raise RuntimeError("end-of-document token mismatch")
    curriculum_path = documents.path.parent / documents.manifest["curriculum"]
    curriculum = json.loads(curriculum_path.read_text(encoding="utf-8"))
    if contract["training"].get("stages_must_match_corpus", True):
        if curriculum["stages"] != contract["training"]["stages"]:
            raise RuntimeError("contract stages drifted from the corpus curriculum")
    elif seed_binding(contract["training"], "parent_schedule_sha256", seed) != \
            seed_binding(contract["initialization"], "parent_schedule_sha256", seed):
        raise RuntimeError("continuation schedule is not bound to its parent schedule")


def stable_number(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:4], "little")


def permutation(count: int, seed: int, *parts: int) -> np.ndarray:
    sequence = np.random.SeedSequence([seed, *parts])
    return np.random.default_rng(sequence).permutation(count)


def build_schedule(
    corpus: EodTokenizedCorpus, contract: dict[str, Any], seed: int,
) -> tuple[list[dict[str, Any]], str]:
    """Build the exact staged schedule before the first optimizer update."""
    windows = corpus.windows["train"]
    domain_sources = {
        domain: set(sources) for domain, sources in contract["domains"].items()
    }
    source_domain = {
        source: domain for domain, sources in domain_sources.items() for source in sources
    }
    if set(source_domain) != {window.source_id for window in windows}:
        raise RuntimeError("every training source must map to exactly one curriculum domain")
    domain_indices = {
        domain: [index for index, window in enumerate(windows)
                 if window.source_id in sources]
        for domain, sources in domain_sources.items()
    }
    if any(not indices for indices in domain_indices.values()):
        raise RuntimeError("every curriculum domain must have training windows")

    digest = hashlib.sha256()
    stages: list[dict[str, Any]] = []
    for stage_index, rule in enumerate(contract["training"]["stages"]):
        selected: list[int] = []
        domain_records: dict[str, Any] = {}
        for domain in sorted(domain_indices):
            target = round(int(rule["target_raw_bytes"]) * float(rule["domain_weights"][domain]))
            indices = domain_indices[domain]
            exposed = 0
            cycle = 0
            chosen: list[int] = []
            while exposed < target:
                order = permutation(
                    len(indices), seed, stage_index, stable_number(domain), cycle,
                )
                for offset in order:
                    index = indices[int(offset)]
                    chosen.append(index)
                    exposed += windows[index].raw_bytes
                    if exposed >= target:
                        break
                cycle += 1
            selected.extend(chosen)
            domain_records[domain] = {
                "target_raw_bytes": target,
                "scheduled_raw_bytes": exposed,
                "windows": len(chosen), "cycles_touched": cycle,
            }
        order = permutation(len(selected), seed, stage_index, 0x53544147)
        shuffled = [windows[selected[int(index)]] for index in order]
        source_bytes: Counter[str] = Counter()
        for window in shuffled:
            source_bytes[window.source_id] += window.raw_bytes
            digest.update(str(rule["id"]).encode("utf-8"))
            digest.update(b"\0")
            digest.update(window.schedule_record(stage_index))
        stages.append({
            "id": str(rule["id"]), "windows": shuffled,
            "target_raw_bytes": int(rule["target_raw_bytes"]),
            "scheduled_raw_bytes": sum(window.raw_bytes for window in shuffled),
            "domains": domain_records,
            "source_raw_bytes": dict(sorted(source_bytes.items())),
        })
    return stages, digest.hexdigest()


def save_checkpoint(
    path: Path, contract_digest: str, seed: int, model: Sero1Model,
    optimizer: torch.optim.Optimizer, completed_updates: int,
    completed_stages: int, exposed_bytes: int, exposed_tokens: int,
    source_exposure: Counter[str], training_nll: float,
    checkpoints: list[dict[str, Any]], schedule_digest: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "schema": "sero.curriculum_pretrain_checkpoint.v1",
        "contract_sha256": contract_digest, "seed": seed,
        "model_config": model.config.to_dict(), "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(), "completed_updates": completed_updates,
        "completed_stages": completed_stages, "training_raw_bytes": exposed_bytes,
        "training_tokens": exposed_tokens,
        "source_exposure": dict(sorted(source_exposure.items())),
        "training_nll_nats": training_nll, "checkpoints": checkpoints,
        "schedule_sha256": schedule_digest,
    }, path)


def gate_result(contract: dict[str, Any], test: dict[str, Any]) -> dict[str, Any]:
    gates = contract["success_gates"]
    checks = {
        "overall_test_bpb": {
            "value": test["content_bits_per_byte"],
            "maximum": gates["maximum_test_content_bits_per_byte"],
        },
        "end_of_document_top1": {
            "value": test["end_of_document"]["top1_accuracy"],
            "minimum": gates["minimum_test_end_of_document_top1_accuracy"],
        },
    }
    for source, maximum in gates["maximum_test_source_content_bits_per_byte"].items():
        checks[f"source:{source}"] = {
            "value": test["sources"][source]["content_bits_per_byte"],
            "maximum": maximum,
        }
    for check in checks.values():
        value = float(check["value"])
        check["passed"] = math.isfinite(value) and (
            value <= float(check["maximum"]) if "maximum" in check
            else value >= float(check["minimum"])
        )
    return {"passed": all(check["passed"] for check in checks.values()), "checks": checks}


def main() -> None:
    args = parse_args()
    if args.seed < 0 or args.max_updates < 0 or args.validation_byte_limit < 0:
        raise ValueError("seed and limits cannot be negative")
    started_at = utc_now()
    wall_started = time.perf_counter()
    contract, contract_digest = load_contract(args.contract)
    open_seeds = [int(seed) for seed in contract.get(
        "open_seeds", [contract["pilot_seed"]],
    )]
    if args.seed not in open_seeds:
        raise ValueError(f"seed {args.seed} is not open in the frozen contract")
    device = select_device(args.device)
    seed_everything(args.seed)
    documents = ManifestDocuments.load(args.manifest)
    tokenizer = Sero1Tokenizer(args.tokenizer)
    config = model_config(contract)
    corpus = EodTokenizedCorpus(documents, tokenizer, config.token_context)
    verify_binding(contract, documents, tokenizer, corpus, args.seed)
    stages, schedule_digest = build_schedule(corpus, contract, args.seed)
    expected_schedules = contract.get("expected_schedule_sha256_by_seed")
    if expected_schedules is not None and \
            schedule_digest != expected_schedules.get(str(args.seed)):
        raise RuntimeError("replication schedule hash mismatch")
    model = Sero1Model(config).to(device)
    if parameter_count(model) != int(contract["model"]["expected_parameters"]):
        raise RuntimeError("model parameter count drifted")
    initialization = contract.get("initialization")
    train_from_scratch = bool(contract["pilot_decisions"]["train_from_scratch"])
    if train_from_scratch and args.resume is not None:
        raise ValueError("the frozen contract requires training from scratch")
    if not train_from_scratch and args.resume is None:
        raise ValueError("the frozen continuation contract requires --resume")
    initialization_record: dict[str, Any] = {"train_from_scratch": train_from_scratch}
    if args.resume is not None:
        if not isinstance(initialization, dict):
            raise ValueError("continuation contract has no initialization binding")
        checkpoint_sha256 = seed_binding(initialization, "checkpoint_sha256", args.seed)
        parent_contract_sha256 = seed_binding(
            initialization, "parent_contract_sha256", args.seed,
        )
        parent_schedule_sha256 = seed_binding(
            initialization, "parent_schedule_sha256", args.seed,
        )
        if sha256(args.resume) != checkpoint_sha256:
            raise ValueError("continuation checkpoint hash mismatch")
        checkpoint = torch.load(args.resume, map_location="cpu", weights_only=True)
        if checkpoint.get("schema") != "sero.curriculum_pretrain_checkpoint.v1":
            raise ValueError("continuation checkpoint schema mismatch")
        if checkpoint.get("contract_sha256") != parent_contract_sha256:
            raise ValueError("continuation parent contract mismatch")
        if checkpoint.get("schedule_sha256") != parent_schedule_sha256:
            raise ValueError("continuation parent schedule mismatch")
        if int(checkpoint.get("seed")) != args.seed:
            raise ValueError("continuation checkpoint seed mismatch")
        if checkpoint.get("model_config") != config.to_dict():
            raise ValueError("continuation model configuration mismatch")
        model.load_state_dict(checkpoint["model_state"], strict=True)
        initialization_record.update({
            "checkpoint_path": str(args.resume),
            "checkpoint_sha256": checkpoint_sha256,
            "parent_contract_sha256": parent_contract_sha256,
            "parent_schedule_sha256": parent_schedule_sha256,
            "optimizer_state_reused": False,
        })
    optimization = contract["optimization"]
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=float(optimization["learning_rate"]),
        betas=tuple(float(value) for value in optimization["betas"]),
        eps=float(optimization["epsilon"]), weight_decay=float(optimization["weight_decay"]),
    )
    batch_size = int(contract["training"]["batch_size"])
    total_updates = sum(math.ceil(len(stage["windows"]) / batch_size) for stage in stages)
    maximum_updates = (args.max_updates or 128) if args.mode == "calibration" else 0
    validation_limit = (
        args.validation_byte_limit or 131072
    ) if args.mode == "calibration" else 0
    completed_updates = 0
    exposed_bytes = 0
    exposed_tokens = 0
    source_exposure: Counter[str] = Counter()
    training_nll = 0.0
    training_seconds = 0.0
    checkpoints: list[dict[str, Any]] = []
    stop = False
    base_rate = float(optimization["learning_rate"])
    autocast = device.type == "cuda"

    for stage_index, stage in enumerate(stages):
        for group in batches(stage["windows"], batch_size):
            completed_updates += 1
            scale = learning_rate_scale(
                completed_updates, total_updates,
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
                raise FloatingPointError(f"non-finite loss at update {completed_updates}")
            loss.backward()
            gradient_norm = torch.nn.utils.clip_grad_norm_(
                model.parameters(), float(contract["training"]["gradient_clip"]),
                error_if_nonfinite=True,
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
                    f"stage={stage['id']} update={completed_updates}/{total_updates} "
                    f"loss={float(loss.item()):.6f} grad={float(gradient_norm):.4f} "
                    f"lr={optimizer.param_groups[0]['lr']:.8g}", flush=True,
                )
            if args.mode == "calibration" and completed_updates >= maximum_updates:
                stop = True
                break
        if stop:
            break
        validation = evaluate(model, corpus, "validation", batch_size, device)
        record = {
            "stage": stage["id"], "stage_index": stage_index,
            "update": completed_updates, "training_raw_bytes": exposed_bytes,
            "learning_rate": optimizer.param_groups[0]["lr"], "validation": validation,
        }
        checkpoints.append(record)
        save_checkpoint(
            args.artifact_dir / f"model-stage-{stage_index + 1}-{stage['id']}.pt",
            contract_digest, args.seed, model, optimizer, completed_updates,
            stage_index + 1, exposed_bytes, exposed_tokens, source_exposure,
            training_nll, checkpoints, schedule_digest,
        )
        print(
            f"checkpoint={stage['id']} validation_bpb="
            f"{validation['content_bits_per_byte']:.6f} "
            f"eod_acc={validation['end_of_document']['top1_accuracy']:.4f}", flush=True,
        )

    if args.mode == "calibration":
        final_validation = evaluate(
            model, corpus, "validation", batch_size, device,
            raw_byte_limit=validation_limit,
        )
        final_test = None
        gates = None
        decision = "non-promoting-calibration"
    else:
        if completed_updates != total_updates or len(checkpoints) != len(stages):
            raise AssertionError("full curriculum run did not finish its frozen schedule")
        final_validation = checkpoints[-1]["validation"]
        final_test = evaluate(model, corpus, "test", batch_size, device)
        gates = gate_result(contract, final_test)
        replication_role = contract.get("replication_role")
        if replication_role == "parent":
            decision = "replication-parent-ready"
        elif replication_role == "final":
            decision = "replication-seed-passed" if gates["passed"] \
                else "replication-seed-failed"
        else:
            decision = "seed0-passed-open-replication" if gates["passed"] \
                else "seed0-failed-stop"

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    final_path = args.artifact_dir / "model-final.pt"
    save_checkpoint(
        final_path, contract_digest, args.seed, model, optimizer, completed_updates,
        (len(stages) if args.mode == "full" else 0), exposed_bytes, exposed_tokens,
        source_exposure, training_nll, checkpoints, schedule_digest,
    )
    samples = [
        sample(
            model, tokenizer, corpus.eod_token_id, prompt, device,
            int(contract["evaluation"]["sample_new_tokens"]),
        )
        for prompt in contract["evaluation"]["sample_prompts"]
    ]
    result = {
        "schema": "sero.curriculum_pretrain_seed_result.v1",
        "experiment": contract["experiment"], "mode": args.mode, "seed": args.seed,
        "started_at": started_at, "finished_at": utc_now(),
        "contract": {"path": str(args.contract), "sha256": contract_digest},
        "runtime": {
            "git_commit": git_commit(), "python": platform.python_version(),
            "platform": platform.platform(), "torch": torch.__version__,
            "numpy": np.__version__, "device": str(device),
            **({"device_name": torch.cuda.get_device_name(device), "cuda": torch.version.cuda,
                "cudnn": torch.backends.cudnn.version()} if device.type == "cuda" else {}),
        },
        "initialization": initialization_record,
        "data": {
            "manifest_path": str(args.manifest), "dataset_id": documents.manifest["dataset_id"],
            "dataset_version": documents.manifest["version"],
            "dataset_digest": documents.dataset_digest,
            "raw_bytes": {split: documents.raw_bytes(split)
                          for split in ("train", "validation", "test")},
            "content_token_counts": {split: corpus.content_token_count(split)
                                     for split in ("train", "validation", "test")},
            "end_of_document_counts": {split: corpus.eod_count(split)
                                       for split in ("train", "validation", "test")},
            "window_counts": {split: len(corpus.windows[split])
                              for split in ("train", "validation", "test")},
            "schedule_sha256": schedule_digest,
        },
        "model": {
            "config": config.to_dict(), "parameters": parameter_count(model),
            "state_sha256": tensor_digest(model), "artifact": str(final_path),
            "artifact_sha256": sha256(final_path), "artifact_bytes": final_path.stat().st_size,
        },
        "curriculum": [{key: value for key, value in stage.items() if key != "windows"}
                       for stage in stages],
        "training": {
            "batch_size": batch_size, "total_updates": total_updates,
            "completed_updates": completed_updates, "raw_bytes": exposed_bytes,
            "tokens": exposed_tokens, "source_raw_bytes": dict(sorted(source_exposure.items())),
            "cross_entropy_nll_nats": training_nll, "seconds": training_seconds,
            "tokens_per_second": exposed_tokens / max(training_seconds, 1e-9),
        },
        "checkpoints": checkpoints, "final_validation": final_validation,
        "final_test": final_test, "success_gates": gates, "samples": samples,
        "decision": decision, "timing": {"wall_seconds": time.perf_counter() - wall_started},
        "calibration": ({
            "max_updates": maximum_updates,
            "validation_raw_byte_limit": validation_limit,
            "projected_full_training_seconds": training_seconds * total_updates /
            max(completed_updates, 1),
        } if args.mode == "calibration" else None),
    }
    atomic_json(args.output, result)
    print(
        f"wrote {args.output} mode={args.mode} "
        f"validation_bpb={final_validation['content_bits_per_byte']:.6f}", flush=True,
    )


if __name__ == "__main__":
    main()

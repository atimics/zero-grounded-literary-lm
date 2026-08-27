#!/usr/bin/env python3
"""Compare frozen Sero checkpoints on held-out context and free generation."""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import platform
import statistics
import sys
import time
from typing import Any, Iterable, Sequence

import torch


ROOT = Path(__file__).resolve().parents[2]
PRETRAIN = ROOT / "experiments" / "sero1-pretrain"
sys.path.insert(0, str(PRETRAIN))

from data import EodTokenizedCorpus, ManifestDocuments  # noqa: E402
from model import Sero1Config, Sero1Model  # noqa: E402
from tokenizer import Sero1Tokenizer, sha256  # noqa: E402


def load_module(name: str, path: Path) -> Any:
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


GENERATION = load_module("sero1_generation_eval", PRETRAIN / "evaluate_generation.py")
OPTIMIZED = load_module("sero1_optimized_train", Path(__file__).with_name("train.py"))
DEFAULT_CONTRACT = ROOT / "benchmarks" / "sero2-curriculum-eval-v1" / "contract.json"
DEFAULT_MANIFEST = ROOT / "build" / "sero-pretrain-curriculum-v1" / "manifest.json"
DEFAULT_TOKENIZER = ROOT / "tokenizers" / "sero1-byte-bpe-4096.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tokenizer", type=Path, default=DEFAULT_TOKENIZER)
    parser.add_argument(
        "--checkpoint", action="append", required=True, metavar="LABEL=PATH",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    return parser.parse_args()


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def mean(values: Iterable[float]) -> float:
    rows = list(values)
    return sum(rows) / len(rows) if rows else 0.0


def parse_checkpoints(values: Sequence[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        label, separator, path = value.partition("=")
        if not separator or not label or not path or label in result:
            raise ValueError(f"checkpoint must be a unique LABEL=PATH: {value}")
        result[label] = Path(path).resolve()
    return result


def load_model(
    label: str, path: Path, rule: dict[str, Any], device: torch.device,
) -> Sero1Model:
    if sha256(path) != rule["sha256"]:
        raise ValueError(f"{label} checkpoint hash mismatch")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("schema") != rule["schema"]:
        raise ValueError(f"{label} checkpoint schema mismatch")
    if int(checkpoint.get("seed")) != int(rule["seed"]):
        raise ValueError(f"{label} checkpoint seed mismatch")
    if "mode" in rule and checkpoint.get("mode") != rule["mode"]:
        raise ValueError(f"{label} checkpoint mode mismatch")
    model = Sero1Model(Sero1Config(**checkpoint["model_config"]))
    model.load_state_dict(checkpoint["model_state"], strict=True)
    return model.to(device).eval()


def summarize_context(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: defaultdict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["checkpoint"], row["prompt_tokens"])].append(row)
    result = []
    for (checkpoint, prompt_tokens), values in sorted(grouped.items()):
        scores = [row["score"]["bits_per_byte"] for row in values]
        result.append({
            "checkpoint": checkpoint,
            "prompt_tokens": prompt_tokens,
            "cases": len(values),
            "mean_bits_per_byte": mean(scores),
            "population_sd_bits_per_byte": statistics.pstdev(scores),
            "mean_top1_token_accuracy": mean(
                row["score"]["top1_token_accuracy"] for row in values
            ),
        })
    return result


def context_gains(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed = {
        (row["checkpoint"], row["case_id"], row["prompt_tokens"]): row
        for row in rows
    }
    result = []
    for checkpoint in sorted({row["checkpoint"] for row in rows}):
        identities = sorted({row["case_id"] for row in rows if row["checkpoint"] == checkpoint})
        lengths = sorted({row["prompt_tokens"] for row in rows if row["checkpoint"] == checkpoint})
        baseline = min(lengths)
        for length in lengths:
            if length == baseline:
                continue
            deltas = [
                indexed[(checkpoint, identity, length)]["score"]["bits_per_byte"]
                - indexed[(checkpoint, identity, baseline)]["score"]["bits_per_byte"]
                for identity in identities
            ]
            standard_error = statistics.stdev(deltas) / math.sqrt(len(deltas))
            result.append({
                "checkpoint": checkpoint,
                "baseline_prompt_tokens": baseline,
                "prompt_tokens": length,
                "pairs": len(deltas),
                "mean_bits_per_byte_change": mean(deltas),
                "normal_approximation_95_ci": [
                    mean(deltas) - 1.96 * standard_error,
                    mean(deltas) + 1.96 * standard_error,
                ],
                "lower_loss_pairs": sum(delta < 0 for delta in deltas),
            })
    return result


def summarize_free(rows: list[dict[str, Any]], keys: Sequence[str]) -> list[dict[str, Any]]:
    grouped: defaultdict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[tuple(row[key] for key in keys)].append(row)
    result = []
    for group, values in sorted(grouped.items()):
        summary = dict(zip(keys, group))
        summary.update({
            "samples": len(values),
            "mean_generated_tokens": mean(
                row["generation"]["metrics"]["tokens"] for row in values
            ),
            "mean_token_distinct_4": mean(
                row["generation"]["metrics"]["token_ngrams"]["4"]["distinct_ratio"]
                for row in values
            ),
            "severe_loop_rate": mean(
                float(row["generation"]["metrics"]["severe_loop"]) for row in values
            ),
            "end_of_document_rate": mean(
                float(row["generation"]["ended_at_stop_token"]) for row in values
            ),
            "utf8_valid_rate": mean(
                float(row["generation"]["metrics"]["utf8_valid"]) for row in values
            ),
        })
        result.append(summary)
    return result


def percentage(value: float) -> str:
    return f"{100 * value:.1f}%"


def clean(value: str, limit: int = 300) -> str:
    value = value.replace("\r", "").replace("\n", " ↵ ").replace("|", "\\|")
    return value if len(value) <= limit else value[:limit].rstrip() + "…"


def render_report(result: dict[str, Any]) -> str:
    lines = [
        "# Sero curriculum seed-0 comparison",
        "",
        "This diagnostic compares the control, staged-curriculum, and",
        "retention-consolidated checkpoints on the same held-out data and prompts.",
        "",
        "## Complete held-out splits",
        "",
        "| Checkpoint | Validation BPB | Test BPB | Test EOD top-1 |",
        "| :--- | ---: | ---: | ---: |",
    ]
    for label, row in result["complete_split_evaluation"].items():
        lines.append(
            f"| {label} | {row['validation']['content_bits_per_byte']:.4f} | "
            f"{row['test']['content_bits_per_byte']:.4f} | "
            f"{percentage(row['test']['end_of_document']['top1_accuracy'])} |"
        )
    lines.extend([
        "",
        "The complete split uses the contamination-gated curriculum test set. Content BPB",
        "excludes the synthetic end-of-document token; EOD accuracy is reported separately.",
        "",
        "## Multi-token held-out context",
        "",
        "| Checkpoint | Prompt tokens | Cases | Reference BPB | Top-1 token accuracy |",
        "| :--- | ---: | ---: | ---: | ---: |",
    ])
    for row in result["summaries"]["context"]:
        lines.append(
            f"| {row['checkpoint']} | {row['prompt_tokens']} | {row['cases']} | "
            f"{row['mean_bits_per_byte']:.4f} | "
            f"{percentage(row['mean_top1_token_accuracy'])} |"
        )
    lines.extend([
        "",
        "## Free generation",
        "",
        "| Checkpoint | Decoder | Samples | Distinct-4 | Severe loops | EOD stops |",
        "| :--- | :--- | ---: | ---: | ---: | ---: |",
    ])
    for row in result["summaries"]["free_by_checkpoint_decoder"]:
        lines.append(
            f"| {row['checkpoint']} | {row['decoder']} | {row['samples']} | "
            f"{percentage(row['mean_token_distinct_4'])} | "
            f"{percentage(row['severe_loop_rate'])} | "
            f"{percentage(row['end_of_document_rate'])} |"
        )
    lines.extend(["", "## Representative outputs", ""])
    for row in result["free_generations"]:
        if row["prompt_id"] not in {"history", "ice", "arithmetic", "javascript", "story"}:
            continue
        if row["decoder"] != "greedy":
            continue
        lines.extend([
            f"### {row['checkpoint']} — {row['prompt_id']}",
            "",
            f"Prompt: `{clean(row['prompt_text'], 180)}`",
            "",
            f"> {clean(row['generation']['text_lossy_utf8'])}",
            "",
        ])
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    args = parse_args()
    started_at = utc_now()
    wall_started = time.perf_counter()
    raw_contract = args.contract.resolve().read_bytes()
    contract = json.loads(raw_contract)
    if contract.get("schema") != "sero.optimized_generation_eval_contract.v1":
        raise ValueError("unexpected optimized generation evaluation contract")
    paths = parse_checkpoints(args.checkpoint)
    rules = contract["checkpoints"]
    if set(paths) != set(rules):
        raise ValueError("checkpoint labels do not match the frozen contract")
    documents = ManifestDocuments.load(args.manifest)
    if documents.dataset_digest != contract["dataset_digest"]:
        raise ValueError("comparison dataset hash mismatch")
    tokenizer = Sero1Tokenizer(args.tokenizer)
    if tokenizer.artifact_sha256 != contract["tokenizer_sha256"]:
        raise ValueError("comparison tokenizer hash mismatch")
    device = GENERATION.select_device(args.device)
    corpus = EodTokenizedCorpus(documents, tokenizer, int(contract["token_context"]))
    context_cases = GENERATION.held_out_cases(
        documents, tokenizer, contract["held_out_context"],
    )
    complete: dict[str, Any] = {}
    context_rows: list[dict[str, Any]] = []
    free_rows: list[dict[str, Any]] = []
    for label in contract["checkpoint_order"]:
        print(f"loading {label}: {paths[label]}", flush=True)
        model = load_model(label, paths[label], rules[label], device)
        complete[label] = {
            split: OPTIMIZED.evaluate(model, corpus, split, 16, device)
            for split in ("validation", "test")
        }
        for case in context_cases:
            for length, prompt in sorted(case["prompts"].items(), key=lambda item: int(item[0])):
                context_rows.append({
                    "checkpoint": label,
                    "case_id": case["id"],
                    "document_id": case["document_id"],
                    "source_id": case["source_id"],
                    "prompt_tokens": int(length),
                    "score": GENERATION.score_reference(
                        model, tokenizer, prompt["token_ids"], case["reference_token_ids"], device,
                    ),
                })
        for prompt in contract["free_generation"]["prompts"]:
            prompt_ids, _ = tokenizer.encode(prompt["text"].encode("utf-8"))
            for decoder in contract["free_generation"]["decoders"]:
                for repeat in range(int(decoder.get("repeats", 1))):
                    generation = GENERATION.generate(
                        model, tokenizer, prompt_ids,
                        int(contract["free_generation"]["new_tokens"]), decoder,
                        GENERATION.deterministic_seed(
                            "optimized", label, prompt["id"], decoder["id"], str(repeat),
                        ),
                        device, stop_token_id=corpus.eod_token_id,
                    )
                    generation.pop("generated_token_ids")
                    free_rows.append({
                        "checkpoint": label,
                        "prompt_id": prompt["id"],
                        "category": prompt["category"],
                        "prompt_text": prompt["text"],
                        "prompt_tokens": len(prompt_ids),
                        "decoder": decoder["id"],
                        "repeat": repeat,
                        "generation": generation,
                    })
            print(f"checkpoint={label} prompt={prompt['id']} complete", flush=True)
        del model
    result = {
        "schema": "sero.optimized_generation_eval_result.v1",
        "experiment": contract["experiment"],
        "started_at": started_at,
        "finished_at": utc_now(),
        "contract_sha256": hashlib.sha256(raw_contract).hexdigest(),
        "dataset_digest": documents.dataset_digest,
        "tokenizer_sha256": tokenizer.artifact_sha256,
        "runtime": {
            "python": platform.python_version(), "torch": torch.__version__,
            "platform": platform.platform(), "device": str(device),
        },
        "checkpoints": [
            {"label": label, "sha256": rules[label]["sha256"]}
            for label in contract["checkpoint_order"]
        ],
        "complete_split_evaluation": complete,
        "context_evaluations": context_rows,
        "free_generations": free_rows,
        "summaries": {
            "context": summarize_context(context_rows),
            "context_gains": context_gains(context_rows),
            "free_by_checkpoint_decoder": summarize_free(
                free_rows, ("checkpoint", "decoder"),
            ),
            "free_by_checkpoint_category_decoder": summarize_free(
                free_rows, ("checkpoint", "category", "decoder"),
            ),
        },
        "timing": {"wall_seconds": time.perf_counter() - wall_started},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(stable_json(result), encoding="utf-8")
    args.report.write_text(render_report(result), encoding="utf-8")
    print(f"wrote {args.output} and {args.report}", flush=True)


if __name__ == "__main__":
    main()

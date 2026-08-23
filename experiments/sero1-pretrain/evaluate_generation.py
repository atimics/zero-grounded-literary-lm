#!/usr/bin/env python3
"""Evaluate Sero 1 context use and free-generation failure modes."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import statistics
import time
from typing import Any, Iterable, Sequence

import torch

from data import ManifestDocuments
from model import Sero1Config, Sero1Model
from tokenizer import Sero1Tokenizer, sha256


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONTRACT = ROOT / "benchmarks" / "sero1-generation-eval-v1" / "contract.json"
DEFAULT_MANIFEST = ROOT / "build" / "sero-pretrain-v1" / "manifest.json"
DEFAULT_TOKENIZER = ROOT / "tokenizers" / "sero1-byte-bpe-4096.json"
DEFAULT_OUTPUT = ROOT / "benchmarks" / "sero1-generation-eval-v1" / "result.json"
DEFAULT_REPORT = ROOT / "benchmarks" / "sero1-generation-eval-v1" / "RESULT.md"
LN2 = math.log(2.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tokenizer", type=Path, default=DEFAULT_TOKENIZER)
    parser.add_argument(
        "--checkpoint", action="append", required=True, metavar="SEED=PATH",
        help="one final Sero 1 checkpoint per seed",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    return parser.parse_args()


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


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


def parse_checkpoints(values: Sequence[str]) -> dict[int, Path]:
    result: dict[int, Path] = {}
    for value in values:
        seed_text, separator, path_text = value.partition("=")
        if not separator or not seed_text.isdigit() or not path_text:
            raise ValueError(f"checkpoint must use SEED=PATH: {value}")
        seed = int(seed_text)
        if seed in result:
            raise ValueError(f"duplicate checkpoint seed {seed}")
        result[seed] = Path(path_text).resolve()
    return result


def load_model(path: Path, expected_seed: int, device: torch.device) -> Sero1Model:
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("schema") != "sero.pretrain_v1_checkpoint.v1":
        raise ValueError(f"unexpected checkpoint schema in {path}")
    if int(checkpoint.get("seed")) != expected_seed or checkpoint.get("mode") != "full":
        raise ValueError(f"checkpoint identity mismatch for seed {expected_seed}")
    config = Sero1Config(**checkpoint["model_config"])
    model = Sero1Model(config)
    model.load_state_dict(checkpoint["model_state"], strict=True)
    model.to(device).eval()
    return model


def mean(values: Iterable[float]) -> float:
    rows = list(values)
    return sum(rows) / len(rows) if rows else 0.0


def population_sd(values: Iterable[float]) -> float:
    rows = list(values)
    return statistics.pstdev(rows) if len(rows) > 1 else 0.0


def ngram_metrics(values: Sequence[Any], n: int) -> dict[str, float | int]:
    total = max(len(values) - n + 1, 0)
    if total == 0:
        return {"total": 0, "distinct": 0, "distinct_ratio": 0.0, "maximum_count": 0}
    counts = Counter(tuple(values[index:index + n]) for index in range(total))
    return {
        "total": total,
        "distinct": len(counts),
        "distinct_ratio": len(counts) / total,
        "maximum_count": max(counts.values()),
    }


def generation_metrics(token_ids: Sequence[int], data: bytes) -> dict[str, Any]:
    try:
        text = data.decode("utf-8")
        valid_utf8 = True
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
        valid_utf8 = False
    words = re.findall(r"\w+|[^\w\s]", text.casefold(), flags=re.UNICODE)
    token_ngrams = {str(n): ngram_metrics(token_ids, n) for n in range(1, 5)}
    word_ngrams = {str(n): ngram_metrics(words, n) for n in range(1, 5)}
    token_four = token_ngrams["4"]
    severe_loop = (
        int(token_four["total"]) > 0
        and (
            float(token_four["distinct_ratio"]) < 0.5
            or int(token_four["maximum_count"]) >= 4
        )
    )
    return {
        "tokens": len(token_ids),
        "bytes": len(data),
        "utf8_valid": valid_utf8,
        "token_ngrams": token_ngrams,
        "word_ngrams": word_ngrams,
        "severe_loop": severe_loop,
    }


def exact_prefix_length(left: Sequence[int], right: Sequence[int]) -> int:
    count = 0
    for left_value, right_value in zip(left, right):
        if left_value != right_value:
            break
        count += 1
    return count


def deterministic_seed(*parts: Any) -> int:
    encoded = "\0".join(str(part) for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(encoded).digest()[:8], "little") % (2**63 - 1)


def choose_token(
    logits: torch.Tensor, generated: Sequence[int], decoder: dict[str, Any],
    generator: torch.Generator,
) -> int:
    temperature = decoder.get("temperature")
    if temperature is None:
        return int(logits.argmax().item())
    adjusted = logits.float().clone()
    penalty = float(decoder["repetition_penalty"])
    if penalty != 1.0:
        for token_id in set(generated):
            adjusted[token_id] = (
                adjusted[token_id] * penalty
                if adjusted[token_id] < 0
                else adjusted[token_id] / penalty
            )
    adjusted /= float(temperature)
    top_p = float(decoder["top_p"])
    sorted_logits, sorted_indices = torch.sort(adjusted, descending=True)
    sorted_probabilities = torch.softmax(sorted_logits, dim=-1)
    cumulative = torch.cumsum(sorted_probabilities, dim=-1)
    remove = cumulative - sorted_probabilities >= top_p
    sorted_probabilities[remove] = 0.0
    sorted_probabilities /= sorted_probabilities.sum()
    selected = torch.multinomial(sorted_probabilities.cpu(), 1, generator=generator)
    return int(sorted_indices[int(selected.item())].item())


@torch.inference_mode()
def generate(
    model: Sero1Model, tokenizer: Sero1Tokenizer, prompt_ids: Sequence[int],
    new_tokens: int, decoder: dict[str, Any], generator_seed: int, device: torch.device,
    stop_token_id: int | None = None,
) -> dict[str, Any]:
    if not prompt_ids:
        raise ValueError("generation prompts cannot be empty")
    generated = list(prompt_ids)
    continuation: list[int] = []
    generator = torch.Generator(device="cpu")
    generator.manual_seed(generator_seed)
    entropy_bits: list[float] = []
    chosen_surprisal_bits: list[float] = []
    ended_at_stop_token = False
    for _ in range(new_tokens):
        prefix = generated[-(model.config.token_context - 1):]
        target = torch.tensor([prefix + [0]], dtype=torch.long, device=device)
        valid = torch.ones_like(target, dtype=torch.bool)
        logits = model(target, valid)[0, -1].float()
        raw_probabilities = torch.softmax(logits, dim=-1)
        entropy_bits.append(float((-(raw_probabilities * torch.log2(
            raw_probabilities.clamp_min(torch.finfo(raw_probabilities.dtype).tiny)
        ))).sum().item()))
        token_id = choose_token(logits, continuation, decoder, generator)
        chosen_surprisal_bits.append(float(-torch.log2(raw_probabilities[token_id]).item()))
        if stop_token_id is not None and token_id == stop_token_id:
            ended_at_stop_token = True
            break
        generated.append(token_id)
        continuation.append(token_id)
    data = tokenizer.decode(continuation)
    result = {
        "generated_token_ids": continuation,
        "generated_bytes_hex": data.hex(),
        "text_lossy_utf8": data.decode("utf-8", errors="replace"),
        "mean_model_entropy_bits": mean(entropy_bits),
        "mean_chosen_token_surprisal_bits": mean(chosen_surprisal_bits),
        "metrics": generation_metrics(continuation, data),
    }
    if stop_token_id is not None:
        result["ended_at_stop_token"] = ended_at_stop_token
    return result


@torch.inference_mode()
def score_reference(
    model: Sero1Model, tokenizer: Sero1Tokenizer, prompt_ids: Sequence[int],
    reference_ids: Sequence[int], device: torch.device,
) -> dict[str, Any]:
    combined = list(prompt_ids) + list(reference_ids)
    target = torch.tensor([combined], dtype=torch.long, device=device)
    valid = torch.ones_like(target, dtype=torch.bool)
    logits = model(target, valid)[0, len(prompt_ids):]
    expected = target[0, len(prompt_ids):]
    losses = torch.nn.functional.cross_entropy(logits, expected, reduction="none")
    reference_bytes = tokenizer.decode(reference_ids)
    return {
        "nll_nats": float(losses.sum().item()),
        "bits_per_byte": float(losses.sum().item()) / (LN2 * len(reference_bytes)),
        "top1_token_accuracy": float((logits.argmax(dim=-1) == expected).float().mean().item()),
        "reference_tokens": len(reference_ids),
        "reference_bytes": len(reference_bytes),
    }


def held_out_cases(
    documents: ManifestDocuments, tokenizer: Sero1Tokenizer, specification: dict[str, Any],
) -> list[dict[str, Any]]:
    split = str(specification["split"])
    prompt_lengths = [int(value) for value in specification["prompt_token_lengths"]]
    maximum_prompt = max(prompt_lengths)
    continuation_tokens = int(specification["continuation_tokens"])
    per_source = int(specification["documents_per_source"])
    grouped: defaultdict[str, list[Any]] = defaultdict(list)
    for document in documents.splits[split]:
        grouped[document.source_id].append(document)
    cases: list[dict[str, Any]] = []
    for source_id in sorted(grouped):
        chosen = 0
        for document in sorted(grouped[source_id], key=lambda row: row.document_id):
            token_ids, _ = tokenizer.encode(document.data)
            available = len(token_ids) - maximum_prompt - continuation_tokens
            if available < 1:
                continue
            offset = maximum_prompt + (
                int.from_bytes(hashlib.sha256(document.document_id.encode("utf-8")).digest()[:8], "little")
                % (available + 1)
            )
            reference_ids = token_ids[offset:offset + continuation_tokens]
            prompts = {
                str(length): {
                    "token_ids": token_ids[offset - length:offset],
                    "text_lossy_utf8": tokenizer.decode(
                        token_ids[offset - length:offset]
                    ).decode("utf-8", errors="replace"),
                }
                for length in prompt_lengths
            }
            cases.append({
                "id": f"{source_id}-{chosen}",
                "document_id": document.document_id,
                "source_id": source_id,
                "continuation_token_offset": offset,
                "prompts": prompts,
                "reference_token_ids": reference_ids,
                "reference_text_lossy_utf8": tokenizer.decode(reference_ids).decode(
                    "utf-8", errors="replace",
                ),
            })
            chosen += 1
            if chosen == per_source:
                break
        if chosen != per_source:
            raise ValueError(f"only found {chosen} eligible held-out documents for {source_id}")
    return cases


def summary_rows(rows: list[dict[str, Any]], keys: Sequence[str]) -> list[dict[str, Any]]:
    grouped: defaultdict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[tuple(row[key] for key in keys)].append(row)
    summaries: list[dict[str, Any]] = []
    for group, values in sorted(grouped.items(), key=lambda item: item[0]):
        result = dict(zip(keys, group))
        result.update({
            "count": len(values),
            "mean_reference_bits_per_byte": mean(
                value["reference_score"]["bits_per_byte"] for value in values
            ) if "reference_score" in values[0] else None,
            "sd_reference_bits_per_byte": population_sd(
                value["reference_score"]["bits_per_byte"] for value in values
            ) if "reference_score" in values[0] else None,
            "mean_top1_token_accuracy": mean(
                value["reference_score"]["top1_token_accuracy"] for value in values
            ) if "reference_score" in values[0] else None,
            "mean_token_distinct_4": mean(
                value["generation"]["metrics"]["token_ngrams"]["4"]["distinct_ratio"]
                for value in values
            ),
            "mean_word_distinct_4": mean(
                value["generation"]["metrics"]["word_ngrams"]["4"]["distinct_ratio"]
                for value in values
            ),
            "severe_loop_rate": mean(
                float(value["generation"]["metrics"]["severe_loop"]) for value in values
            ),
            "utf8_valid_rate": mean(
                float(value["generation"]["metrics"]["utf8_valid"]) for value in values
            ),
        })
        if "reference_score" in values[0]:
            result.update({
                "mean_exact_reference_prefix_tokens": mean(
                    value["exact_reference_prefix_tokens"] for value in values
                ),
                "mean_reference_position_match_rate": mean(
                    value["reference_position_match_rate"] for value in values
                ),
            })
        summaries.append(result)
    return summaries


def paired_context_gains(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed = {
        (int(row["seed"]), str(row["case_id"]), int(row["prompt_tokens"])): row
        for row in rows
    }
    identities = sorted({(key[0], key[1]) for key in indexed})
    lengths = sorted({key[2] for key in indexed})
    baseline = min(lengths)
    summaries: list[dict[str, Any]] = []
    for length in lengths:
        if length == baseline:
            continue
        deltas = [
            indexed[(seed, case_id, length)]["reference_score"]["bits_per_byte"]
            - indexed[(seed, case_id, baseline)]["reference_score"]["bits_per_byte"]
            for seed, case_id in identities
        ]
        delta_mean = mean(deltas)
        standard_error = statistics.stdev(deltas) / math.sqrt(len(deltas))
        summaries.append({
            "baseline_prompt_tokens": baseline,
            "prompt_tokens": length,
            "pairs": len(deltas),
            "mean_bits_per_byte_change": delta_mean,
            "sd_bits_per_byte_change": statistics.stdev(deltas),
            "normal_approximation_95_ci": [
                delta_mean - 1.96 * standard_error,
                delta_mean + 1.96 * standard_error,
            ],
            "lower_loss_pairs": sum(delta < 0 for delta in deltas),
        })
    return summaries


def public_held_out_cases(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{
        "id": case["id"],
        "document_id": case["document_id"],
        "source_id": case["source_id"],
        "continuation_token_offset": case["continuation_token_offset"],
        "prompts": {
            length: {"text_lossy_utf8": prompt["text_lossy_utf8"]}
            for length, prompt in case["prompts"].items()
        },
        "reference_text_lossy_utf8": case["reference_text_lossy_utf8"],
    } for case in cases]


def format_percentage(value: float) -> str:
    return f"{100.0 * value:.1f}%"


def clean_cell(value: str, limit: int = 360) -> str:
    collapsed = value.replace("\r", "").replace("\n", " ↵ ").replace("|", "\\|")
    return collapsed if len(collapsed) <= limit else collapsed[:limit].rstrip() + "…"


def render_report(result: dict[str, Any]) -> str:
    context = next(
        summary for summary in result["summaries"]["held_out_by_prompt_length"]
        if int(summary["prompt_tokens"]) == 1
    )
    lines = [
        "# Sero 1 expanded generation evaluation",
        "",
        "This is a post-training diagnostic, not a new promotion gate. It evaluates the exact",
        "three promoted Sero 1 checkpoints.",
        "",
        "## Held-out context test",
        "",
        "Each row scores the same 64-token held-out continuations using different amounts",
        "of real preceding test text. It also greedily generates 64 tokens from each prompt.",
        "",
        "| Prompt tokens | Reference BPB | Change vs 1 token | Top-1 token accuracy | Greedy distinct-4 | Severe loops |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    gains = {
        int(row["prompt_tokens"]): row
        for row in result["summaries"]["paired_context_gains"]
    }
    for row in result["summaries"]["held_out_by_prompt_length"]:
        delta = float(row["mean_reference_bits_per_byte"]) - float(
            context["mean_reference_bits_per_byte"]
        )
        lines.append(
            f"| {row['prompt_tokens']} | {row['mean_reference_bits_per_byte']:.4f} | "
            f"{delta:+.4f} | {format_percentage(row['mean_top1_token_accuracy'])} | "
            f"{format_percentage(row['mean_token_distinct_4'])} | "
            f"{format_percentage(row['severe_loop_rate'])} |"
        )
    lines.extend([
        "",
        "The 128-token prompt reduced loss in "
        f"{gains[128]['lower_loss_pairs']} of {gains[128]['pairs']} paired cases. Its mean "
        f"change was {gains[128]['mean_bits_per_byte_change']:.4f} BPB (normal-approximation "
        f"95% interval {gains[128]['normal_approximation_95_ci'][0]:.4f} to "
        f"{gains[128]['normal_approximation_95_ci'][1]:.4f}). This shows that the model uses "
        "longer context for prediction, even though greedy continuations still loop.",
        "",
        "## Free-generation decoding test",
        "",
        "| Decoder | Samples | Token distinct-4 | Word distinct-4 | Severe loops | Valid UTF-8 |",
        "| :--- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in result["summaries"]["free_by_decoder"]:
        lines.append(
            f"| {row['decoder']} | {row['count']} | "
            f"{format_percentage(row['mean_token_distinct_4'])} | "
            f"{format_percentage(row['mean_word_distinct_4'])} | "
            f"{format_percentage(row['severe_loop_rate'])} | "
            f"{format_percentage(row['utf8_valid_rate'])} |"
        )
    lines.extend([
        "",
        "The repetition penalty is an inference aid, not evidence that the weights learned",
        "better facts or reasoning. The representative outputs remain semantically confused",
        "even when their n-grams are diverse.",
        "",
        "### Results by prompt family",
        "",
        "| Family | Decoder | Token distinct-4 | Severe loops |",
        "| :--- | :--- | ---: | ---: |",
    ])
    for row in result["summaries"]["free_by_category_decoder"]:
        lines.append(
            f"| {row['category']} | {row['decoder']} | "
            f"{format_percentage(row['mean_token_distinct_4'])} | "
            f"{format_percentage(row['severe_loop_rate'])} |"
        )
    lines.extend(["", "## Representative seed-0 outputs", ""])
    example_ids = {"control-in", "history", "question-answer", "committee"}
    examples = [
        row for row in result["free_generations"]
        if row["seed"] == 0 and row["prompt_id"] in example_ids and row["repeat"] == 0
    ]
    for row in examples:
        lines.extend([
            f"### {row['prompt_id']} — {row['decoder']}",
            "",
            f"Prompt: `{clean_cell(row['prompt_text'], 180)}`",
            "",
            f"> {clean_cell(row['generation']['text_lossy_utf8'])}",
            "",
        ])
    lines.extend([
        "## Scope",
        "",
        "The context test uses disjoint held-out test documents. Free prompts include",
        "Wikipedia-like prose, narrative/dialogue, question-answer, assistant, and code",
        "formats. Sampling can expose usable probability mass, but it cannot repair missing",
        "knowledge or long-range structure in the weights.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    started_at = utc_now()
    wall_started = time.perf_counter()
    contract_raw = args.contract.resolve().read_bytes()
    contract = json.loads(contract_raw)
    if contract.get("schema") != "sero.generation_eval_contract.v1":
        raise ValueError("unexpected generation evaluation contract schema")
    checkpoints = parse_checkpoints(args.checkpoint)
    expected_hashes = {
        int(seed): value for seed, value in contract["checkpoint_sha256_by_seed"].items()
    }
    if set(checkpoints) != set(expected_hashes):
        raise ValueError(f"checkpoint seeds {sorted(checkpoints)} != {sorted(expected_hashes)}")
    for seed, path in checkpoints.items():
        observed = sha256(path)
        if observed != expected_hashes[seed]:
            raise ValueError(f"seed {seed} checkpoint hash mismatch: {observed}")
    tokenizer = Sero1Tokenizer(args.tokenizer)
    if tokenizer.artifact_sha256 != contract["tokenizer_sha256"]:
        raise ValueError("tokenizer hash mismatch")
    documents = ManifestDocuments.load(args.manifest)
    cases = held_out_cases(documents, tokenizer, contract["held_out_context"])
    device = select_device(args.device)
    held_out_rows: list[dict[str, Any]] = []
    free_rows: list[dict[str, Any]] = []
    greedy_decoder = next(
        decoder for decoder in contract["free_generation"]["decoders"]
        if decoder["id"] == "greedy"
    )
    for seed, checkpoint_path in sorted(checkpoints.items()):
        print(f"loading seed {seed}: {checkpoint_path}", flush=True)
        model = load_model(checkpoint_path, seed, device)
        for case in cases:
            reference_ids = case["reference_token_ids"]
            for prompt_length, prompt in sorted(
                case["prompts"].items(), key=lambda item: int(item[0]),
            ):
                generated = generate(
                    model, tokenizer, prompt["token_ids"], len(reference_ids), greedy_decoder,
                    deterministic_seed("held-out", seed, case["id"], prompt_length), device,
                )
                generated_ids = generated["generated_token_ids"]
                generated.pop("generated_token_ids")
                held_out_rows.append({
                    "seed": seed,
                    "case_id": case["id"],
                    "document_id": case["document_id"],
                    "source_id": case["source_id"],
                    "prompt_tokens": int(prompt_length),
                    "prompt_text_lossy_utf8": prompt["text_lossy_utf8"],
                    "reference_text_lossy_utf8": case["reference_text_lossy_utf8"],
                    "reference_score": score_reference(
                        model, tokenizer, prompt["token_ids"], reference_ids, device,
                    ),
                    "exact_reference_prefix_tokens": exact_prefix_length(
                        generated_ids, reference_ids,
                    ),
                    "reference_position_match_rate": mean(
                        float(left == right) for left, right in zip(generated_ids, reference_ids)
                    ),
                    "generation": generated,
                })
        for prompt in contract["free_generation"]["prompts"]:
            prompt_ids, _ = tokenizer.encode(prompt["text"].encode("utf-8"))
            for decoder in contract["free_generation"]["decoders"]:
                for repeat in range(int(decoder["repeats"])):
                    generation = generate(
                        model, tokenizer, prompt_ids,
                        int(contract["free_generation"]["new_tokens"]), decoder,
                        deterministic_seed("free", seed, prompt["id"], decoder["id"], repeat),
                        device,
                    )
                    generation.pop("generated_token_ids")
                    free_rows.append({
                        "seed": seed,
                        "prompt_id": prompt["id"],
                        "category": prompt["category"],
                        "prompt_text": prompt["text"],
                        "prompt_tokens": len(prompt_ids),
                        "decoder": decoder["id"],
                        "repeat": repeat,
                        "generation_seed": deterministic_seed(
                            "free", seed, prompt["id"], decoder["id"], repeat,
                        ),
                        "generation": generation,
                    })
            print(f"seed={seed} prompt={prompt['id']} complete", flush=True)
        del model
    result = {
        "schema": "sero.generation_eval_result.v1",
        "experiment": contract["experiment"],
        "source_experiment": contract["source_experiment"],
        "started_at": started_at,
        "finished_at": utc_now(),
        "contract_sha256": hashlib.sha256(contract_raw).hexdigest(),
        "dataset_digest": documents.dataset_digest,
        "tokenizer_sha256": tokenizer.artifact_sha256,
        "checkpoints": [
            {"seed": seed, "sha256": expected_hashes[seed]}
            for seed in sorted(checkpoints)
        ],
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "platform": platform.platform(),
            "device": str(device),
        },
        "held_out_cases": public_held_out_cases(cases),
        "held_out_evaluations": held_out_rows,
        "free_generations": free_rows,
        "summaries": {
            "held_out_by_prompt_length": summary_rows(held_out_rows, ["prompt_tokens"]),
            "held_out_by_seed_prompt_length": summary_rows(
                held_out_rows, ["seed", "prompt_tokens"],
            ),
            "held_out_by_source_prompt_length": summary_rows(
                held_out_rows, ["source_id", "prompt_tokens"],
            ),
            "paired_context_gains": paired_context_gains(held_out_rows),
            "free_by_decoder": summary_rows(free_rows, ["decoder"]),
            "free_by_seed_decoder": summary_rows(free_rows, ["seed", "decoder"]),
            "free_by_category_decoder": summary_rows(free_rows, ["category", "decoder"]),
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

#!/usr/bin/env python3
"""Compare matched 6M and 20M generation diagnostics."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--scale", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args()


def load(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.resolve().read_bytes()
    value = json.loads(raw)
    if value.get("schema") != "sero.generation_eval_result.v1":
        raise ValueError(f"unexpected generation result schema in {path}")
    return value, hashlib.sha256(raw).hexdigest()


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def indexed(rows: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    return {str(row[key]): row for row in rows}


def delta(baseline: float, scale: float) -> dict[str, float]:
    return {
        "baseline": baseline,
        "scale": scale,
        "absolute_change": scale - baseline,
        "relative_change_percent": 100.0 * (scale - baseline) / baseline,
    }


def clean(value: str, limit: int = 500) -> str:
    value = value.replace("\r", "").replace("\n", " ↵ ")
    return value if len(value) <= limit else value[:limit].rstrip() + "…"


def format_percent(value: float) -> str:
    return f"{100.0 * value:.1f}%"


def main() -> None:
    args = parse_args()
    baseline, baseline_sha = load(args.baseline)
    scale, scale_sha = load(args.scale)
    for key in ("dataset_digest", "tokenizer_sha256"):
        if baseline[key] != scale[key]:
            raise ValueError(f"matched comparison requires the same {key}")
    if baseline["held_out_cases"] != scale["held_out_cases"]:
        raise ValueError("held-out cases differ")

    baseline_context = indexed(
        baseline["summaries"]["held_out_by_prompt_length"], "prompt_tokens",
    )
    scale_context = indexed(
        scale["summaries"]["held_out_by_prompt_length"], "prompt_tokens",
    )
    if set(baseline_context) != set(scale_context):
        raise ValueError("context lengths differ")
    context = []
    for prompt_tokens in sorted(baseline_context, key=int):
        left = baseline_context[prompt_tokens]
        right = scale_context[prompt_tokens]
        context.append({
            "prompt_tokens": int(prompt_tokens),
            "reference_bits_per_byte": delta(
                float(left["mean_reference_bits_per_byte"]),
                float(right["mean_reference_bits_per_byte"]),
            ),
            "top1_token_accuracy": delta(
                float(left["mean_top1_token_accuracy"]),
                float(right["mean_top1_token_accuracy"]),
            ),
            "greedy_severe_loop_rate": delta(
                float(left["severe_loop_rate"]), float(right["severe_loop_rate"]),
            ),
        })

    baseline_decoders = indexed(baseline["summaries"]["free_by_decoder"], "decoder")
    scale_decoders = indexed(scale["summaries"]["free_by_decoder"], "decoder")
    if set(baseline_decoders) != set(scale_decoders):
        raise ValueError("decoder sets differ")
    decoders = []
    for decoder in sorted(baseline_decoders):
        left = baseline_decoders[decoder]
        right = scale_decoders[decoder]
        decoders.append({
            "decoder": decoder,
            "severe_loop_rate": delta(
                float(left["severe_loop_rate"]), float(right["severe_loop_rate"]),
            ),
            "token_distinct_4": delta(
                float(left["mean_token_distinct_4"]),
                float(right["mean_token_distinct_4"]),
            ),
            "word_distinct_4": delta(
                float(left["mean_word_distinct_4"]),
                float(right["mean_word_distinct_4"]),
            ),
        })

    result = {
        "schema": "sero.scale_generation_comparison.v1",
        "experiment": "sero20m-scale-generation-v1",
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "baseline_result_sha256": baseline_sha,
        "scale_result_sha256": scale_sha,
        "dataset_digest": baseline["dataset_digest"],
        "tokenizer_sha256": baseline["tokenizer_sha256"],
        "context_comparison": context,
        "decoder_comparison": decoders,
        "interpretation_rule": (
            "Generation is a diagnostic. Lower held-out BPB is predictive improvement; "
            "sample quality and repetition metrics do not by themselves prove intelligence."
        ),
    }

    lines = [
        "# Sero 20M matched scale-generation comparison",
        "",
        "The same held-out documents, prompts, tokenizer, and decoders were used for both models.",
        "",
        "## Held-out continuation prediction",
        "",
        "| Prompt tokens | 6M BPB | 20M BPB | Relative change | 6M top-1 | 20M top-1 |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in context:
        bpb = row["reference_bits_per_byte"]
        top1 = row["top1_token_accuracy"]
        lines.append(
            f"| {row['prompt_tokens']} | {bpb['baseline']:.4f} | {bpb['scale']:.4f} | "
            f"{bpb['relative_change_percent']:+.1f}% | {format_percent(top1['baseline'])} | "
            f"{format_percent(top1['scale'])} |"
        )
    lines.extend([
        "",
        "## Free generation",
        "",
        "| Decoder | 6M severe loops | 20M severe loops | 6M token distinct-4 | 20M token distinct-4 |",
        "| :--- | ---: | ---: | ---: | ---: |",
    ])
    for row in decoders:
        loops = row["severe_loop_rate"]
        distinct = row["token_distinct_4"]
        lines.append(
            f"| {row['decoder']} | {format_percent(loops['baseline'])} | "
            f"{format_percent(loops['scale'])} | {format_percent(distinct['baseline'])} | "
            f"{format_percent(distinct['scale'])} |"
        )
    lines.extend([
        "",
        "## Selected 20M outputs",
        "",
    ])
    selected = {"mountain-flicker", "mountain-poem", "question-answer", "assistant"}
    for row in scale["free_generations"]:
        if row["prompt_id"] not in selected or row["repeat"] != 0:
            continue
        lines.extend([
            f"### {row['prompt_id']} — {row['decoder']}",
            "",
            f"Prompt: `{clean(row['prompt_text'], 180)}`",
            "",
            f"> {clean(row['generation']['text_lossy_utf8'])}",
            "",
        ])
    lines.extend([
        "## Interpretation",
        "",
        result["interpretation_rule"],
        "",
    ])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(stable_json(result), encoding="utf-8")
    args.report.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()

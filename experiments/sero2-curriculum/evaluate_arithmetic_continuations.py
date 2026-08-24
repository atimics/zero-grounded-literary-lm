#!/usr/bin/env python3
"""Measure arithmetic truth inside Sero completion text, excluding every prompt byte."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from decimal import Decimal
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import platform
import re
import statistics
import sys
import time
from typing import Any, Iterable, Sequence


ROOT = Path(__file__).resolve().parents[2]
PRETRAIN = ROOT / "experiments" / "sero1-pretrain"
sys.path.insert(0, str(PRETRAIN))

from evaluate_generation import (  # noqa: E402
    deterministic_seed,
    generate,
    load_model,
    select_device,
    stable_json,
    utc_now,
)
from tokenizer import Sero1Tokenizer, sha256  # noqa: E402


DEFAULT_CONTRACT = (
    ROOT / "benchmarks" / "sero20m-arithmetic-continuation-v1" / "contract.json"
)
DEFAULT_TOKENIZER = ROOT / "tokenizers" / "sero1-byte-bpe-4096.json"
DEFAULT_OUTPUT = (
    ROOT / "benchmarks" / "sero20m-arithmetic-continuation-v1" / "result.json"
)
DEFAULT_REPORT = (
    ROOT / "benchmarks" / "sero20m-arithmetic-continuation-v1" / "RESULT.md"
)

NUMBER_PATTERN = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
NUMBER_RE = re.compile(rf"(?<![\w.]){NUMBER_PATTERN}(?!\w)")
EQUATION_RE = re.compile(
    rf"(?<![\w.])(?P<left>{NUMBER_PATTERN})\s*"
    rf"(?P<operator>[+\-−*×xX/÷])\s*"
    rf"(?P<right>{NUMBER_PATTERN})\s*"
    rf"(?P<relation>=|≈)\s*"
    rf"(?P<claimed>{NUMBER_PATTERN})(?!\w)"
)
OPERATORS = ("+", "-", "*", "/")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--tokenizer", type=Path, default=DEFAULT_TOKENIZER)
    parser.add_argument(
        "--checkpoint", action="append", required=True, metavar="LABEL=PATH",
        help="checkpoint label and local path; labels must match the contract",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    return parser.parse_args()


def parse_checkpoints(values: Sequence[str]) -> dict[str, Path]:
    checkpoints: dict[str, Path] = {}
    for value in values:
        label, separator, path_text = value.partition("=")
        if not separator or not label or not path_text:
            raise ValueError(f"checkpoint must use LABEL=PATH: {value}")
        if label in checkpoints:
            raise ValueError(f"duplicate checkpoint label: {label}")
        checkpoints[label] = Path(path_text).resolve()
    return checkpoints


def fraction_from_text(value: str) -> Fraction:
    return Fraction(Decimal(value.replace(",", "")))


def normalize_operator(value: str) -> str:
    return {
        "−": "-", "*": "*", "×": "*", "x": "*", "X": "*", "÷": "/",
    }.get(value, value)


def apply_operator(left: Fraction, operator: str, right: Fraction) -> Fraction | None:
    if operator == "+":
        return left + right
    if operator == "-":
        return left - right
    if operator == "*":
        return left * right
    if operator == "/":
        return None if right == 0 else left / right
    raise ValueError(f"unsupported operator: {operator}")


def fraction_text(value: Fraction | None) -> str | None:
    if value is None:
        return None
    if value.denominator == 1:
        return str(value.numerator)
    return f"{value.numerator}/{value.denominator}"


def relation_is_true(
    expected: Fraction | None, claimed: Fraction, relation: str, tolerance: float,
) -> bool:
    if expected is None:
        return False
    if relation == "=":
        return expected == claimed
    return abs(float(expected - claimed)) <= max(tolerance, tolerance * abs(float(expected)))


def one_edit_repairs(
    left: Fraction,
    operator: str,
    right: Fraction,
    claimed: Fraction,
    number_pool: set[Fraction],
) -> list[str]:
    repairs: list[str] = []
    if left != right and apply_operator(right, operator, left) == claimed:
        repairs.append("swap_operands")
    if any(
        alternative != operator and apply_operator(left, alternative, right) == claimed
        for alternative in OPERATORS
    ):
        repairs.append("replace_operator")
    expected = apply_operator(left, operator, right)
    if expected is not None and expected != claimed and expected in number_pool:
        repairs.append("replace_result_with_generated_number")
    if any(
        candidate != left and apply_operator(candidate, operator, right) == claimed
        for candidate in number_pool
    ):
        repairs.append("replace_left_with_generated_number")
    if any(
        candidate != right and apply_operator(left, operator, candidate) == claimed
        for candidate in number_pool
    ):
        repairs.append("replace_right_with_generated_number")
    return repairs


def analyze_continuation(text: str, approximate_tolerance: float) -> dict[str, Any]:
    """Analyze only the supplied continuation. The prompt is deliberately not accepted."""
    number_pool = {fraction_from_text(match.group(0)) for match in NUMBER_RE.finditer(text)}
    equations: list[dict[str, Any]] = []
    for match in EQUATION_RE.finditer(text):
        left = fraction_from_text(match.group("left"))
        right = fraction_from_text(match.group("right"))
        claimed = fraction_from_text(match.group("claimed"))
        operator = normalize_operator(match.group("operator"))
        relation = match.group("relation")
        expected = apply_operator(left, operator, right)
        correct = relation_is_true(expected, claimed, relation, approximate_tolerance)
        repairs = [] if correct else one_edit_repairs(
            left, operator, right, claimed, number_pool,
        )
        equations.append({
            "text": match.group(0),
            "start_byte": len(text[:match.start()].encode("utf-8")),
            "end_byte": len(text[:match.end()].encode("utf-8")),
            "left": fraction_text(left),
            "operator": operator,
            "right": fraction_text(right),
            "relation": relation,
            "claimed": fraction_text(claimed),
            "expected": fraction_text(expected),
            "correct": correct,
            "one_edit_repairs_using_continuation_numbers": repairs,
        })
    false_equations = [equation for equation in equations if not equation["correct"]]
    return {
        "generated_number_count": len(list(NUMBER_RE.finditer(text))),
        "unique_generated_numbers": len(number_pool),
        "parseable_equations": len(equations),
        "true_equations": sum(bool(equation["correct"]) for equation in equations),
        "false_equations": len(false_equations),
        "all_equations_true": bool(equations) and not false_equations,
        "one_edit_repairable_false_equations": sum(
            bool(equation["one_edit_repairs_using_continuation_numbers"])
            for equation in false_equations
        ),
        "equations": equations,
    }


def mean(values: Iterable[float]) -> float:
    rows = list(values)
    return sum(rows) / len(rows) if rows else 0.0


def ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def summarize(rows: list[dict[str, Any]], keys: Sequence[str]) -> list[dict[str, Any]]:
    grouped: defaultdict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[tuple(row[key] for key in keys)].append(row)
    summaries: list[dict[str, Any]] = []
    for identity, values in sorted(grouped.items(), key=lambda item: item[0]):
        equations = [
            equation for value in values for equation in value["arithmetic"]["equations"]
        ]
        false_equations = [equation for equation in equations if not equation["correct"]]
        generated_tokens = sum(int(value["generation"]["metrics"]["tokens"]) for value in values)
        arithmetic_continuations = sum(
            int(value["arithmetic"]["parseable_equations"] > 0) for value in values
        )
        true_equations = sum(int(equation["correct"]) for equation in equations)
        repairable = sum(
            int(bool(equation["one_edit_repairs_using_continuation_numbers"]))
            for equation in false_equations
        )
        summary = dict(zip(keys, identity))
        summary.update({
            "continuations": len(values),
            "generated_tokens": generated_tokens,
            "arithmetic_continuations": arithmetic_continuations,
            "arithmetic_continuation_rate": ratio(arithmetic_continuations, len(values)),
            "parseable_equations": len(equations),
            "equations_per_1000_generated_tokens": (
                1000.0 * len(equations) / generated_tokens if generated_tokens else 0.0
            ),
            "true_equations": true_equations,
            "false_equations": len(false_equations),
            "equation_truth_precision": ratio(true_equations, len(equations)),
            "all_equations_true_rate_among_arithmetic_continuations": ratio(
                sum(int(value["arithmetic"]["all_equations_true"]) for value in values),
                arithmetic_continuations,
            ),
            "one_edit_repair_rate_among_false_equations": ratio(repairable, len(false_equations)),
        })
        summaries.append(summary)
    return summaries


def summarize_operators(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: defaultdict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for row in rows:
        for equation in row["arithmetic"]["equations"]:
            key = (row["model"], equation["operator"])
            counts[key]["total"] += 1
            counts[key]["true"] += int(equation["correct"])
    return [
        {
            "model": model,
            "operator": operator,
            "equations": values["total"],
            "true_equations": values["true"],
            "equation_truth_precision": ratio(values["true"], values["total"]),
        }
        for (model, operator), values in sorted(counts.items())
    ]


def percentage(value: float | None) -> str:
    return "n/a" if value is None else f"{100.0 * value:.1f}%"


def clean(value: str, limit: int = 420) -> str:
    collapsed = value.replace("\r", "").replace("\n", " ↵ ").replace("|", "\\|")
    return collapsed if len(collapsed) <= limit else collapsed[:limit].rstrip() + "…"


def render_report(result: dict[str, Any]) -> str:
    overall = result["summaries"]["by_model"]
    lines = [
        "# Sero intrinsic arithmetic-continuation evaluation",
        "",
        "This evaluates arithmetic claims made inside generated continuation bytes. Prompt",
        "bytes are never passed to the arithmetic parser. There is no expected answer and no",
        "credit for responding to a question.",
        "",
        "## Main result",
        "",
        "| Model | Outputs with equations | Equations / 1K tokens | True equations | Fully true arithmetic outputs | Repairable false equations |",
        "| :--- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in overall:
        lines.append(
            f"| {row['model']} | {percentage(row['arithmetic_continuation_rate'])} "
            f"({row['arithmetic_continuations']}/{row['continuations']}) | "
            f"{row['equations_per_1000_generated_tokens']:.2f} | "
            f"{percentage(row['equation_truth_precision'])} "
            f"({row['true_equations']}/{row['parseable_equations']}) | "
            f"{percentage(row['all_equations_true_rate_among_arithmetic_continuations'])} | "
            f"{percentage(row['one_edit_repair_rate_among_false_equations'])} |"
        )
    lines.extend([
        "",
        "The repair column asks whether one change can make a false equation true by swapping",
        "the operands, changing the operator, or moving a number that the model generated",
        "elsewhere in the same continuation. It is a binding diagnostic, not arithmetic credit.",
        "",
        "## By decoder",
        "",
        "| Model | Decoder | Outputs with equations | Equations | True equations | Repairable false equations |",
        "| :--- | :--- | ---: | ---: | ---: | ---: |",
    ])
    for row in result["summaries"]["by_model_decoder"]:
        lines.append(
            f"| {row['model']} | {row['decoder']} | "
            f"{percentage(row['arithmetic_continuation_rate'])} | "
            f"{row['parseable_equations']} | {percentage(row['equation_truth_precision'])} | "
            f"{percentage(row['one_edit_repair_rate_among_false_equations'])} |"
        )
    lines.extend([
        "",
        "## By prefix family",
        "",
        "| Model | Family | Outputs with equations | Equations | True equations |",
        "| :--- | :--- | ---: | ---: | ---: |",
    ])
    for row in result["summaries"]["by_model_category"]:
        lines.append(
            f"| {row['model']} | {row['category']} | "
            f"{percentage(row['arithmetic_continuation_rate'])} | "
            f"{row['parseable_equations']} | {percentage(row['equation_truth_precision'])} |"
        )
    false_examples: list[tuple[dict[str, Any], dict[str, Any]]] = []
    true_examples: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for row in result["continuations"]:
        for equation in row["arithmetic"]["equations"]:
            target = true_examples if equation["correct"] else false_examples
            if len([entry for entry in target if entry[0]["model"] == row["model"]]) < 4:
                target.append((row, equation))
    lines.extend(["", "## Example claims", "", "### False", ""])
    if not false_examples:
        lines.append("No false parseable equations were generated.")
    for row, equation in false_examples:
        repairs = ", ".join(equation["one_edit_repairs_using_continuation_numbers"]) or "none"
        lines.extend([
            f"- **{row['model']} / {row['prompt_id']} / {row['decoder']}:** "
            f"`{equation['text']}`; expected `{equation['expected']}`; one-edit repair: {repairs}",
            f"  Continuation: “{clean(row['generation']['text_lossy_utf8'])}”",
        ])
    lines.extend(["", "### True", ""])
    if not true_examples:
        lines.append("No true parseable equations were generated.")
    for row, equation in true_examples:
        lines.append(
            f"- **{row['model']} / {row['prompt_id']} / {row['decoder']}:** "
            f"`{equation['text']}`"
        )
    lines.extend([
        "",
        "## Limits",
        "",
        "This first version scores explicit integer or decimal equations using +, −, ×, or ÷.",
        "It does not yet judge prose such as ‘ten more than five is fifteen,’ algebra, units,",
        "or whether a generated derivation is relevant to its prefix. Sampling results describe",
        "the model distribution; greedy results describe its most likely continuation.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    started_at = utc_now()
    wall_started = time.perf_counter()
    contract_raw = args.contract.resolve().read_bytes()
    contract = json.loads(contract_raw)
    if contract.get("schema") != "sero.arithmetic_continuation_eval_contract.v1":
        raise ValueError("unexpected arithmetic continuation contract schema")
    checkpoints = parse_checkpoints(args.checkpoint)
    expected = contract["checkpoints"]
    if set(checkpoints) != set(expected):
        raise ValueError(f"checkpoint labels {sorted(checkpoints)} != {sorted(expected)}")
    for label, path in checkpoints.items():
        observed = sha256(path)
        if observed != expected[label]["sha256"]:
            raise ValueError(f"{label} checkpoint hash mismatch: {observed}")
    tokenizer = Sero1Tokenizer(args.tokenizer)
    if tokenizer.artifact_sha256 != contract["tokenizer_sha256"]:
        raise ValueError("tokenizer hash mismatch")
    device = select_device(args.device)
    rows: list[dict[str, Any]] = []
    generation_spec = contract["generation"]
    stop_token_id = int(generation_spec["stop_token_id"])
    tolerance = float(contract["scoring"]["approximate_relation_tolerance"])
    for label in contract["model_order"]:
        binding = expected[label]
        checkpoint_path = checkpoints[label]
        print(f"loading {label}: {checkpoint_path}", flush=True)
        model = load_model(checkpoint_path, int(binding["seed"]), device)
        for prompt in generation_spec["prompts"]:
            prompt_ids, _ = tokenizer.encode(prompt["text"].encode("utf-8"))
            for decoder in generation_spec["decoders"]:
                for repeat in range(int(decoder["repeats"])):
                    generation_seed = deterministic_seed(
                        "intrinsic-arithmetic-v1", prompt["id"], decoder["id"], repeat,
                    )
                    generated = generate(
                        model, tokenizer, prompt_ids, int(generation_spec["new_tokens"]),
                        decoder, generation_seed, device, stop_token_id=stop_token_id,
                    )
                    generated.pop("generated_token_ids")
                    arithmetic = analyze_continuation(
                        generated["text_lossy_utf8"], tolerance,
                    )
                    rows.append({
                        "model": label,
                        "prompt_id": prompt["id"],
                        "category": prompt["category"],
                        "prompt_text_not_scored": prompt["text"],
                        "prompt_tokens_not_scored": len(prompt_ids),
                        "decoder": decoder["id"],
                        "repeat": repeat,
                        "generation_seed": generation_seed,
                        "generation": generated,
                        "arithmetic": arithmetic,
                    })
            print(f"model={label} prompt={prompt['id']} complete", flush=True)
        del model
    result = {
        "schema": "sero.arithmetic_continuation_eval_result.v1",
        "experiment": contract["experiment"],
        "started_at": started_at,
        "finished_at": utc_now(),
        "contract_sha256": hashlib.sha256(contract_raw).hexdigest(),
        "tokenizer_sha256": tokenizer.artifact_sha256,
        "prompt_boundary_policy": contract["prompt_boundary_policy"],
        "checkpoints": [
            {"model": label, **expected[label]} for label in contract["model_order"]
        ],
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "device": str(device),
        },
        "continuations": rows,
        "summaries": {
            "by_model": summarize(rows, ["model"]),
            "by_model_decoder": summarize(rows, ["model", "decoder"]),
            "by_model_category": summarize(rows, ["model", "category"]),
            "by_model_operator": summarize_operators(rows),
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

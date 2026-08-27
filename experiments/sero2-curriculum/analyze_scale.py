#!/usr/bin/env python3
"""Build the final Sero 6M-to-20M scale summary from immutable results."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any


BASELINE_PARAMETERS = 6_021_312
SCALE_PARAMETERS = 20_011_136
BASELINE_FINAL_BPB_MEAN = 1.3284973669528224
BASELINE_FINAL_EOD_MEAN = 0.8876181004475385
MAXIMUM_SCALE_FINAL_BPB = 1.2620724986051812
STAGED_SCHEDULE_SHA256 = "79139c590c044befe176e818210baf82b311393c8dffa3fcb203317a2053215f"
FINAL_SCHEDULE_SHA256 = "c889af19be110b9fd905bb7fec6679fb1eda01cb27911b6e5b883e35c54b33d0"
BASELINE_SEED0_SOURCES = {
    "english-wikibooks": 1.5550870457889838,
    "english-wikinews": 1.4921099053417708,
    "gsm8k": 1.0729550350060237,
    "mdn-web-docs": 1.1617253643443537,
    "openassistant-english": 1.346254853012611,
    "simple-wikipedia": 1.5003806775823991,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-result", type=Path, required=True)
    parser.add_argument("--final-result", type=Path, required=True)
    parser.add_argument("--staged-status", type=Path, required=True)
    parser.add_argument("--final-status", type=Path, required=True)
    parser.add_argument("--generation-comparison", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args()


def read(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.resolve().read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def percent_change(baseline: float, candidate: float) -> float:
    return 100.0 * (candidate - baseline) / baseline


def source_bpb(result: dict[str, Any]) -> dict[str, float]:
    return {
        source: float(metrics["content_bits_per_byte"])
        for source, metrics in result["final_test"]["sources"].items()
    }


def validate_result(
    result: dict[str, Any], experiment: str, expected_schedule: str,
) -> None:
    if result.get("schema") != "sero.curriculum_pretrain_seed_result.v1":
        raise ValueError(f"unexpected result schema for {experiment}")
    if result.get("experiment") != experiment or result.get("mode") != "full":
        raise ValueError(f"result identity mismatch for {experiment}")
    if int(result.get("seed")) != 0:
        raise ValueError(f"only frozen seed 0 is valid for {experiment}")
    if int(result["model"]["parameters"]) != SCALE_PARAMETERS:
        raise ValueError(f"model capacity mismatch for {experiment}")
    if result["data"]["schedule_sha256"] != expected_schedule:
        raise ValueError(f"schedule mismatch for {experiment}")


def validate_status(
    status: dict[str, Any], result_sha: str, result: dict[str, Any], label: str,
) -> None:
    if status.get("status") != "complete" or status.get("phase") != "complete":
        raise ValueError(f"{label} AWS status is not complete")
    if status.get("result_sha256") != result_sha:
        raise ValueError(f"{label} result hash does not match signed status")
    if status.get("model_artifact_sha256") != result["model"]["artifact_sha256"]:
        raise ValueError(f"{label} model hash does not match signed status")


def main() -> None:
    args = parse_args()
    staged, staged_sha = read(args.staged_result)
    final, final_sha = read(args.final_result)
    staged_status, staged_status_sha = read(args.staged_status)
    final_status, final_status_sha = read(args.final_status)
    generation, generation_sha = read(args.generation_comparison)

    validate_result(staged, "sero20m-curriculum-v1", STAGED_SCHEDULE_SHA256)
    validate_result(final, "sero20m-consolidation-v1", FINAL_SCHEDULE_SHA256)
    validate_status(staged_status, staged_sha, staged, "staged")
    validate_status(final_status, final_sha, final, "final")
    if final["initialization"]["checkpoint_sha256"] != staged["model"]["artifact_sha256"]:
        raise ValueError("consolidation did not initialize from the staged 20M checkpoint")
    if staged["data"]["dataset_digest"] != final["data"]["dataset_digest"]:
        raise ValueError("dataset changed between 20M stages")
    if generation.get("schema") != "sero.scale_generation_comparison.v1":
        raise ValueError("unexpected generation comparison schema")

    staged_bpb = float(staged["final_test"]["content_bits_per_byte"])
    final_bpb = float(final["final_test"]["content_bits_per_byte"])
    final_eod = float(final["final_test"]["end_of_document"]["top1_accuracy"])
    final_sources = source_bpb(final)
    source_comparison = {
        source: {
            "baseline_6m_seed0": BASELINE_SEED0_SOURCES[source],
            "scale_20m_seed0": value,
            "relative_change_percent": percent_change(BASELINE_SEED0_SOURCES[source], value),
        }
        for source, value in sorted(final_sources.items())
    }
    overall_scale_passed = final_bpb <= MAXIMUM_SCALE_FINAL_BPB
    retention_passed = bool(final["success_gates"]["passed"])
    prediction_passed = overall_scale_passed and retention_passed
    generation_passed = bool(generation["all_frozen_diagnostic_thresholds_passed"])
    if prediction_passed and generation_passed:
        decision = "seed0-scale-step-change-supported"
    elif prediction_passed:
        decision = "predictive-scale-gain-without-generation-step-change"
    else:
        decision = "scale-only-step-change-not-supported"

    total_tokens = int(staged["training"]["tokens"]) + int(final["training"]["tokens"])
    result = {
        "schema": "sero.scale_seed0_summary.v1",
        "experiment": "sero20m-two-stage-scale-v1",
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataset_digest": staged["data"]["dataset_digest"],
        "artifacts": {
            "staged_result_sha256": staged_sha,
            "final_result_sha256": final_sha,
            "staged_status_sha256": staged_status_sha,
            "final_status_sha256": final_status_sha,
            "staged_model_sha256": staged["model"]["artifact_sha256"],
            "final_model_sha256": final["model"]["artifact_sha256"],
            "generation_comparison_sha256": generation_sha,
        },
        "capacity": {
            "baseline_parameters": BASELINE_PARAMETERS,
            "scale_parameters": SCALE_PARAMETERS,
            "multiplier": SCALE_PARAMETERS / BASELINE_PARAMETERS,
        },
        "training": {
            "staged_updates": staged["training"]["completed_updates"],
            "final_updates": final["training"]["completed_updates"],
            "total_updates": (
                staged["training"]["completed_updates"]
                + final["training"]["completed_updates"]
            ),
            "staged_raw_bytes": staged["training"]["raw_bytes"],
            "final_raw_bytes": final["training"]["raw_bytes"],
            "total_raw_bytes": (
                staged["training"]["raw_bytes"] + final["training"]["raw_bytes"]
            ),
            "staged_tokens": staged["training"]["tokens"],
            "final_tokens": final["training"]["tokens"],
            "total_tokens": total_tokens,
            "tokens_per_parameter": total_tokens / SCALE_PARAMETERS,
        },
        "prediction": {
            "staged_test_content_bits_per_byte": staged_bpb,
            "final_test_content_bits_per_byte": final_bpb,
            "consolidation_change_percent": percent_change(staged_bpb, final_bpb),
            "baseline_6m_three_seed_mean": BASELINE_FINAL_BPB_MEAN,
            "change_from_6m_mean_percent": percent_change(BASELINE_FINAL_BPB_MEAN, final_bpb),
            "maximum_for_five_percent_improvement": MAXIMUM_SCALE_FINAL_BPB,
            "five_percent_scale_gate_passed": overall_scale_passed,
            "baseline_6m_eod_mean": BASELINE_FINAL_EOD_MEAN,
            "final_eod_top1_accuracy": final_eod,
            "source_comparison": source_comparison,
            "all_frozen_final_gates_passed": final["success_gates"]["passed"],
        },
        "generation": {
            "comparison_sha256": generation_sha,
            "all_frozen_diagnostic_thresholds_passed": generation_passed,
            "diagnostic_checks": generation["diagnostic_checks"],
        },
        "aws": {
            "staged_estimated_ec2_usd": staged_status["estimated_ec2_usd"],
            "final_estimated_ec2_usd": final_status["estimated_ec2_usd"],
            "total_estimated_ec2_usd": (
                staged_status["estimated_ec2_usd"] + final_status["estimated_ec2_usd"]
            ),
        },
        "decision": {
            "value": decision,
            "predictive_scale_gate_passed": prediction_passed,
            "generation_diagnostic_passed": generation_passed,
            "general_intelligence_proven": false,
            "replication_required_before_lineage_promotion": true,
        },
    }

    lines = [
        "# Sero 20M scale result",
        "",
        f"Decision: **{decision}**.",
        "",
        "| Measure | 6M baseline | 20M | Change |",
        "| :--- | ---: | ---: | ---: |",
        f"| Parameters | {BASELINE_PARAMETERS:,} | {SCALE_PARAMETERS:,} | "
        f"{SCALE_PARAMETERS / BASELINE_PARAMETERS:.2f}x |",
        f"| Final test BPB | {BASELINE_FINAL_BPB_MEAN:.4f} | {final_bpb:.4f} | "
        f"{percent_change(BASELINE_FINAL_BPB_MEAN, final_bpb):+.1f}% |",
        f"| End-of-document top-1 | {100 * BASELINE_FINAL_EOD_MEAN:.1f}% | "
        f"{100 * final_eod:.1f}% | {100 * (final_eod - BASELINE_FINAL_EOD_MEAN):+.1f} points |",
        "",
        f"The frozen five-percent prediction gate was "
        f"{'passed' if prediction_passed else 'failed'}. The matched generation diagnostic "
        f"was {'passed' if generation_passed else 'failed'}.",
        "",
        "## Sources",
        "",
        "| Source | 6M seed 0 BPB | 20M BPB | Change |",
        "| :--- | ---: | ---: | ---: |",
    ]
    for source, row in source_comparison.items():
        lines.append(
            f"| {source} | {row['baseline_6m_seed0']:.4f} | "
            f"{row['scale_20m_seed0']:.4f} | {row['relative_change_percent']:+.1f}% |"
        )
    lines.extend([
        "",
        "## Scope",
        "",
        "This seed-0 result can support or reject the scale hypothesis for this training recipe.",
        "It does not prove general intelligence, and it requires replication before promotion.",
        "",
    ])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(stable_json(result), encoding="utf-8")
    args.report.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()

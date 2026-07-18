#!/usr/bin/env python3
"""Compile and validate a standardized seed-level training result."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


EXPECTED_CASES = 500
QUANTITY_GATES = (
    "closed",
    "syntax",
    "operation",
    "arguments",
    "exact_request",
    "oracle_arithmetic",
    "committed",
    "exact_artifact",
)
THRESHOLDS = {
    "closed": 0.99,
    "syntax": 0.99,
    "operation": 0.95,
    "arguments": 0.95,
    "exact_request": 0.95,
    "oracle_arithmetic": 1.0,
    "committed": 0.95,
    "exact_artifact": 0.95,
    "rejected_state_mutations": 0,
    "replay_regression": 0.02,
}


def parse_args() -> argparse.Namespace:
    if sys.argv[1:] == ["--self-test"]:
        return argparse.Namespace(self_test=True)
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--requests", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--replay", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--teacher-registry", default="teachers/registry.json")
    parser.add_argument("--corpus-manifest", default="corpus/faculty/q22/manifest.json")
    args = parser.parse_args()
    args.self_test = False
    return args


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def extract_replay_loss(log_path: Path) -> float:
    text = log_path.read_text(encoding="utf-8")
    matches = re.findall(r"evaluation-only val ([0-9]+(?:\.[0-9]+)?)", text)
    if not matches:
        raise ValueError(f"could not extract replay loss from {log_path}")
    loss = float(matches[-1])
    if not math.isfinite(loss) or loss <= 0:
        raise ValueError(f"invalid replay loss in {log_path}")
    return loss


def validate_quantity(report: dict) -> dict:
    quantity = report.get("quantity", report)
    if not isinstance(quantity, dict):
        raise ValueError("quantity result must be an object")
    cases = quantity.get("cases")
    if type(cases) is not int or cases != EXPECTED_CASES:
        raise ValueError(f"quantity evaluation must contain exactly {EXPECTED_CASES} cases")
    for field in QUANTITY_GATES:
        value = quantity.get(field)
        if type(value) is not int or not 0 <= value <= cases:
            raise ValueError(f"quantity field {field} must be an integer in [0, {cases}]")
    rejected = quantity.get("rejected_state_mutations")
    if type(rejected) is not int or rejected < 0:
        raise ValueError("rejected_state_mutations must be a non-negative integer")
    return quantity


def verified_teacher_hashes(registry_path: Path) -> dict[str, str]:
    registry = read_json(registry_path)
    if registry.get("schema") != "zero.teacher_registry.v1":
        raise ValueError("unsupported teacher registry schema")
    hashes: dict[str, str] = {}
    for teacher in registry.get("teachers", []):
        teacher_id = teacher.get("id")
        artifact = Path(teacher.get("artifact", ""))
        expected = teacher.get("artifact_sha256")
        if not teacher_id or not artifact.is_file() or not expected:
            raise ValueError(f"missing teacher artifact or metadata for {teacher_id!r}")
        actual = sha256(artifact)
        if actual != expected:
            raise ValueError(f"teacher {teacher_id} hash mismatch")
        hashes[teacher_id] = actual
    if len(hashes) != registry.get("teacher_count"):
        raise ValueError("teacher registry count mismatch")
    return hashes


def validate_model(path: Path) -> None:
    with path.open("rb") as handle:
        if handle.read(8) != b"LITQ8V1\0":
            raise ValueError(f"{path} is not a LITQ8V1 model")


def compute_gates(quantity: dict, regression: float) -> tuple[dict, dict]:
    rates = {field: quantity[field] / quantity["cases"] for field in QUANTITY_GATES}
    rates["rejected_state_mutations"] = quantity["rejected_state_mutations"]
    rates["replay_regression"] = regression
    gates = {field: rates[field] >= THRESHOLDS[field] for field in QUANTITY_GATES}
    gates["rejected_state_mutations"] = (
        rates["rejected_state_mutations"] <= THRESHOLDS["rejected_state_mutations"]
    )
    gates["replay"] = regression <= THRESHOLDS["replay_regression"]
    return rates, gates


def self_test() -> int:
    valid = {"cases": EXPECTED_CASES, "rejected_state_mutations": 0}
    valid.update({field: EXPECTED_CASES for field in QUANTITY_GATES})
    validate_quantity({"quantity": valid})
    rates, gates = compute_gates(valid, 0.021)
    if gates["replay"] or not all(gates[field] for field in QUANTITY_GATES):
        raise ValueError("gate self-test failed")
    if rates["exact_artifact"] != 1.0:
        raise ValueError("rate self-test failed")
    try:
        validate_quantity({"quantity": {"cases": EXPECTED_CASES, "closed": EXPECTED_CASES}})
    except ValueError:
        pass
    else:
        raise ValueError("partial quantity report was accepted")
    print("result compiler self-test passed")
    return 0


def compile_manifest(args: argparse.Namespace) -> int:
    request_path = Path(args.requests)
    baseline_path = Path(args.baseline)
    replay_path = Path(args.replay)
    model_path = Path(args.model)
    corpus_manifest_path = Path(args.corpus_manifest)
    quantity = validate_quantity(read_json(request_path))
    baseline_loss = extract_replay_loss(baseline_path)
    student_loss = extract_replay_loss(replay_path)
    regression = (student_loss - baseline_loss) / baseline_loss
    validate_model(model_path)
    corpus_manifest = read_json(corpus_manifest_path)
    if not isinstance(corpus_manifest.get("schema"), str):
        raise ValueError("corpus manifest has no schema")
    teacher_hashes = verified_teacher_hashes(Path(args.teacher_registry))

    rates, gates = compute_gates(quantity, regression)
    all_pass = all(gates.values())

    output = Path(args.out)
    try:
        reported_model_path = str(model_path.relative_to(output))
    except ValueError:
        reported_model_path = str(model_path)

    manifest = {
        "schema": "zero.training_result.v1",
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "experiment": args.experiment,
        "seed": args.seed,
        "decision": "go" if all_pass else "no-go",
        "promotion_eligible": False,
        "promotion_blocker": "All three declared seeds must pass before promotion",
        "evaluation": {"cases": quantity["cases"], "split": "promotion"},
        "gates": gates,
        "rates": rates,
        "thresholds": THRESHOLDS,
        "replay": {
            "baseline_loss": baseline_loss,
            "student_loss": student_loss,
            "relative_regression": regression,
        },
        "model": {
            "path": reported_model_path,
            "bytes": model_path.stat().st_size,
            "sha256": sha256(model_path),
        },
        "immutable_teachers": teacher_hashes,
        "inputs": {
            "requests": {"path": str(request_path), "sha256": sha256(request_path)},
            "baseline": {"path": str(baseline_path), "sha256": sha256(baseline_path)},
            "replay": {"path": str(replay_path), "sha256": sha256(replay_path)},
            "corpus_manifest": {
                "path": str(corpus_manifest_path),
                "schema": corpus_manifest["schema"],
                "sha256": sha256(corpus_manifest_path),
            },
        },
        "provenance": {
            "git_commit": args.commit,
            "ci_run_id": args.run_id,
            "host": os.uname().nodename,
        },
    }

    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    rows = []
    for gate in QUANTITY_GATES:
        rows.append(
            f"| {gate.replace('_', ' ').title()} | {rates[gate] * 100:.1f}% | "
            f"{THRESHOLDS[gate] * 100:.1f}% | {'yes' if gates[gate] else 'no'} |"
        )
    rows.append(
        f"| Rejected state mutations | {rates['rejected_state_mutations']} | 0 | "
        f"{'yes' if gates['rejected_state_mutations'] else 'no'} |"
    )
    rows.append(
        f"| Historical replay loss | {student_loss:.4f} "
        f"({regression * 100:.1f}% vs {baseline_loss:.4f}) | <= 2.0% regression | "
        f"{'yes' if gates['replay'] else 'no'} |"
    )
    results = (
        f"# ZERO.4-{args.experiment.upper()} seed {args.seed}\n\n"
        f"Decision: **{manifest['decision']}** for this seed; not promotion-eligible "
        "until all three declared seeds pass.\n\n"
        "| Gate | Result | Required | Pass |\n"
        "| --- | ---: | ---: | :---: |\n"
        + "\n".join(rows)
        + f"\n\nModel SHA-256: `{manifest['model']['sha256']}`.\n"
    )
    results_path = output / "RESULTS.md"
    results_path.write_text(results, encoding="utf-8")
    print(f"Manifest written to {manifest_path}")
    print(f"Results written to {results_path}")
    print(f"Decision: {manifest['decision']}")
    # A scientific no-go is a valid completed result, not an infrastructure error.
    return 0


def main() -> int:
    try:
        args = parse_args()
        return self_test() if args.self_test else compile_manifest(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

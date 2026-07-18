#!/usr/bin/env python3
"""Validate ZERO.4 result records and experiment-directory registration."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


DECISION_RE = re.compile(r"^Decision:\s*\*\*(go|no-go)(?:[^*]*)\*\*", re.MULTILINE)
MODEL_HASH_RE = re.compile(r"(?:Model )?SHA-256:\s*`?[0-9a-f]{64}`?", re.IGNORECASE)
REGISTERED_RE = re.compile(r"`benchmarks/(zero4-[a-z0-9.-]+)`", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results-root", default="benchmarks")
    parser.add_argument("--registry", default="EXPERIMENTS.md")
    parser.add_argument("--teacher-registry", default="teachers/registry.json")
    parser.add_argument("--skip-registry", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"FAIL: invalid JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise SystemExit(f"FAIL: {path} must contain a JSON object")
    return value


def decision_from_manifest(manifest: dict) -> str | None:
    decision = manifest.get("decision")
    return decision if decision in {"go", "no-go"} else None


def verify_result(result_path: Path, expected_teachers: dict[str, str]) -> None:
    text = result_path.read_text(encoding="utf-8")
    match = DECISION_RE.search(text)
    if not match:
        raise SystemExit(f"FAIL: {result_path} has no canonical Decision line")
    decision = match.group(1)
    if decision == "go" and not MODEL_HASH_RE.search(text):
        raise SystemExit(f"FAIL: {result_path} records go without a model SHA-256")

    manifest_path = result_path.with_name("manifest.json")
    if not manifest_path.is_file():
        raise SystemExit(f"FAIL: {result_path} has no sibling manifest.json")
    manifest = load_json(manifest_path)
    schema = manifest.get("schema")
    if not isinstance(schema, str) or not schema.startswith("zero."):
        raise SystemExit(f"FAIL: {manifest_path} has no supported schema")
    manifest_decision = decision_from_manifest(manifest)
    if manifest_decision is not None and manifest_decision != decision:
        raise SystemExit(
            f"FAIL: decision mismatch between {result_path} and {manifest_path}"
        )

    hashes = manifest.get("immutable_teachers")
    if hashes is not None:
        if not isinstance(hashes, dict):
            raise SystemExit(f"FAIL: immutable_teachers in {manifest_path} is not an object")
        for teacher_id, actual in hashes.items():
            expected = expected_teachers.get(teacher_id)
            if expected is None:
                raise SystemExit(f"FAIL: unknown teacher {teacher_id} in {manifest_path}")
            if actual != expected:
                raise SystemExit(f"FAIL: teacher {teacher_id} hash mismatch in {manifest_path}")
    print(f"OK result: {result_path} ({decision})")


def verify_registry(results_root: Path, registry_path: Path) -> None:
    if results_root.name.startswith("zero4-"):
        benchmark_root = results_root.parent
    else:
        benchmark_root = results_root
    actual = {
        path.name
        for path in benchmark_root.glob("zero4-*")
        if path.is_dir()
    }
    registry_text = registry_path.read_text(encoding="utf-8")
    registered = set(REGISTERED_RE.findall(registry_text))
    missing = sorted(actual - registered)
    stale = sorted(registered - actual)
    if missing:
        raise SystemExit(
            "FAIL: benchmark directories missing from EXPERIMENTS.md: "
            + ", ".join(missing)
        )
    if stale:
        raise SystemExit(
            "FAIL: EXPERIMENTS.md references missing benchmark directories: "
            + ", ".join(stale)
        )
    print(f"OK registry: {len(actual)} ZERO.4 benchmark directories")


def main() -> int:
    args = parse_args()
    root = Path(args.results_root)
    if not root.is_dir():
        raise SystemExit(f"FAIL: result root does not exist: {root}")
    teacher_registry = load_json(Path(args.teacher_registry))
    expected_teachers = {
        teacher["id"]: teacher["artifact_sha256"]
        for teacher in teacher_registry.get("teachers", [])
    }
    results = sorted(
        root.glob("zero4-*/**/RESULTS.md")
        if root.name == "benchmarks"
        else root.glob("**/RESULTS.md")
    )
    if not results:
        raise SystemExit(f"FAIL: no RESULTS.md files below {root}")
    for result in results:
        verify_result(result, expected_teachers)
    if not args.skip_registry:
        verify_registry(root, Path(args.registry))
    print(f"Verified {len(results)} result records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the frozen teacher registry and, when requested, its artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default="teachers/registry.json")
    parser.add_argument(
        "--registry-only",
        action="store_true",
        help="validate metadata without requiring ignored binary artifacts",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    registry_path = Path(args.registry)
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    if registry.get("schema") != "zero.teacher_registry.v1":
        raise SystemExit("FAIL: unsupported teacher registry schema")
    teachers = registry.get("teachers")
    if not isinstance(teachers, list) or not teachers:
        raise SystemExit("FAIL: registry has no teachers")
    if registry.get("teacher_count") != len(teachers):
        raise SystemExit("FAIL: teacher_count does not match teachers array")

    seen_ids: set[str] = set()
    seen_artifacts: set[str] = set()
    for teacher in teachers:
        teacher_id = teacher.get("id")
        artifact_name = teacher.get("artifact")
        expected = teacher.get("artifact_sha256")
        if not isinstance(teacher_id, str) or not teacher_id:
            raise SystemExit("FAIL: teacher is missing an id")
        if teacher_id in seen_ids:
            raise SystemExit(f"FAIL: duplicate teacher id {teacher_id}")
        seen_ids.add(teacher_id)
        if not isinstance(artifact_name, str) or artifact_name in seen_artifacts:
            raise SystemExit(f"FAIL: invalid or duplicate artifact for {teacher_id}")
        seen_artifacts.add(artifact_name)
        if not isinstance(expected, str) or len(expected) != 64:
            raise SystemExit(f"FAIL: invalid SHA-256 for {teacher_id}")
        try:
            int(expected, 16)
        except ValueError as error:
            raise SystemExit(f"FAIL: invalid SHA-256 for {teacher_id}") from error

        artifact = Path(artifact_name)
        if args.registry_only:
            print(f"OK metadata: {teacher_id} -> {artifact}")
            continue
        if not artifact.is_file():
            raise SystemExit(f"FAIL: missing teacher artifact {artifact}")
        actual = sha256(artifact)
        if actual != expected:
            raise SystemExit(
                f"FAIL: {artifact} hash mismatch\n"
                f"  expected: {expected}\n  actual:   {actual}"
            )
        print(f"OK artifact: {teacher_id} ({actual})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

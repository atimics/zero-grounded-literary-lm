#!/usr/bin/env python3
"""Verify a complete ZERO/Sero dataset downloaded from immutable storage."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def stable_value(value: object) -> object:
    if isinstance(value, list):
        return [stable_value(item) for item in value]
    if isinstance(value, dict):
        return {key: stable_value(value[key]) for key in sorted(value)}
    return value


def stable_json(value: object) -> bytes:
    return (json.dumps(stable_value(value), ensure_ascii=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--digest", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    manifest_path = root / "manifest.json"
    ready_path = root / "READY"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ready = json.loads(ready_path.read_text(encoding="utf-8"))
    observed = manifest.pop("dataset_digest")
    if observed != args.digest:
        raise ValueError("manifest digest does not match the requested dataset")
    calculated = hashlib.sha256(stable_json(manifest)).hexdigest()
    if calculated != observed:
        raise ValueError("manifest body digest failed")
    manifest["dataset_digest"] = observed
    if ready.get("dataset_digest") != observed:
        raise ValueError("READY dataset digest failed")
    if ready.get("manifest_sha256") != file_hash(manifest_path):
        raise ValueError("READY manifest binding failed")
    for artifact in manifest["artifacts"]:
        path = root / artifact["path"]
        if not path.is_file():
            raise FileNotFoundError(f"missing dataset artifact {artifact['path']}")
        if path.stat().st_size != int(artifact["bytes"]):
            raise ValueError(f"artifact byte count failed: {artifact['path']}")
        if file_hash(path) != artifact["sha256"]:
            raise ValueError(f"artifact digest failed: {artifact['path']}")
    print(f"verified {manifest['dataset_id']}/{manifest['version']} {observed}")


if __name__ == "__main__":
    main()

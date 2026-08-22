#!/usr/bin/env python3
"""Aggregate the frozen three-seed Sero 1 experiment."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics
from typing import Any


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--results", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    contract_raw = args.contract.read_bytes()
    contract = json.loads(contract_raw)
    contract_digest = hashlib.sha256(contract_raw).hexdigest()
    results = sorted((read(path) for path in args.results), key=lambda row: int(row["seed"]))
    expected_seeds = [int(seed) for seed in contract["seeds"]]
    if [int(result["seed"]) for result in results] != expected_seeds:
        raise ValueError("seed results do not exactly match the frozen contract")
    if any(result.get("schema") != "sero.pretrain_v1_seed_result.v1" for result in results):
        raise ValueError("unexpected seed-result schema")
    if any(result.get("mode") != "full" for result in results):
        raise ValueError("calibration results cannot enter the aggregate")
    bindings = {
        (
            result["contract"]["sha256"], result["data"]["dataset_digest"],
            result["tokenizer"]["artifact_sha256"], result["runtime"]["git_commit"],
        )
        for result in results
    }
    if len(bindings) != 1:
        raise ValueError("contract, data, tokenizer, or source changed between seeds")
    binding = next(iter(bindings))
    if binding[0] != contract_digest:
        raise ValueError("result contract digest does not match the supplied contract")

    validation = [float(result["final_validation"]["bits_per_byte"]) for result in results]
    test = [float(result["final_test"]["bits_per_byte"]) for result in results]
    rows = [{
        "seed": int(result["seed"]),
        "validation_bits_per_byte": result["final_validation"]["bits_per_byte"],
        "test_bits_per_byte": result["final_test"]["bits_per_byte"],
        "epoch_one_validation_bits_per_byte": next(
            checkpoint["validation"]["bits_per_byte"]
            for checkpoint in result["checkpoints"]
            if checkpoint["nominal_epoch"] == 1.0
        ),
        "model_state_sha256": result["model"]["state_sha256"],
        "decision": result["gates"]["decision"],
    } for result in results]
    all_pass = all(result["gates"]["decision"] == "go" for result in results)
    aggregate = {
        "schema": "sero.pretrain_v1_aggregate.v1",
        "experiment": contract["experiment"],
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "contract_sha256": contract_digest,
        "dataset_digest": binding[1],
        "tokenizer_sha256": binding[2],
        "git_commit": binding[3],
        "seeds": rows,
        "means": {
            "validation_bits_per_byte": statistics.fmean(validation),
            "test_bits_per_byte": statistics.fmean(test),
        },
        "population_standard_deviations": {
            "validation_bits_per_byte": statistics.pstdev(validation),
            "test_bits_per_byte": statistics.pstdev(test),
        },
        "minimums": {
            "validation_bits_per_byte": min(validation),
            "test_bits_per_byte": min(test),
        },
        "maximums": {
            "validation_bits_per_byte": max(validation),
            "test_bits_per_byte": max(test),
        },
        "all_seed_conjunction_passed": all_pass,
        "aggregate_override_used": False,
        "decision": "promote-sero1" if all_pass else "do-not-promote-sero1",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(aggregate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {args.output}: {aggregate['decision']}")


if __name__ == "__main__":
    main()

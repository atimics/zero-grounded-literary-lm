#!/usr/bin/env python3
"""Aggregate the three frozen Sero Latent V3 seed results."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--results", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    contract = read_json(args.contract)
    expected_seeds = [int(seed) for seed in contract["seeds"]]
    results = [read_json(path) for path in args.results]
    results.sort(key=lambda result: int(result["seed"]))
    if [int(result["seed"]) for result in results] != expected_seeds:
        raise ValueError("result seeds do not exactly match the frozen contract")
    if any(result.get("schema") != "sero.latent_v3_seed_result.v1" for result in results):
        raise ValueError("unexpected seed result schema")
    contract_digests = {result["contract"]["sha256"] for result in results}
    dataset_digests = {result["data"]["dataset_digest"] for result in results}
    tokenizer_digests = {result["tokenizer"]["sha256"] for result in results}
    if len(contract_digests) != 1 or len(dataset_digests) != 1 or len(tokenizer_digests) != 1:
        raise ValueError("contract, dataset, or tokenizer changed between seeds")

    rows: list[dict[str, Any]] = []
    latent_values: list[float] = []
    bpe_values: list[float] = []
    ratios: list[float] = []
    for result in results:
        final = result["checkpoints"][-1]
        latent = float(final["latent"]["bits_per_byte"])
        bpe = float(final["bpe_control"]["bits_per_byte"])
        ratio = latent / bpe
        latent_values.append(latent)
        bpe_values.append(bpe)
        ratios.append(ratio)
        rows.append(
            {
                "seed": int(result["seed"]),
                "status": result["status"],
                "latent_bits_per_byte": latent,
                "bpe_bits_per_byte": bpe,
                "latent_to_bpe_ratio": ratio,
                "bytes_per_learned_chunk": final["latent"]["bytes_per_chunk"],
                "bytes_per_bpe_token": final["bpe_control"]["bytes_per_token"],
                "estimated_compute_ratio": final["estimated_inference_compute"][
                    "latent_to_bpe_ratio"
                ],
                "passed": bool(result["decision"]["passed"]),
            }
        )

    all_pass = all(result["decision"]["passed"] for result in results)
    aggregate = {
        "schema": "sero.latent_v3_aggregate.v1",
        "experiment": "sero-latent-v3",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "contract_sha256": next(iter(contract_digests)),
        "dataset_digest": next(iter(dataset_digests)),
        "tokenizer_sha256": next(iter(tokenizer_digests)),
        "seeds": rows,
        "means": {
            "latent_bits_per_byte": statistics.fmean(latent_values),
            "bpe_bits_per_byte": statistics.fmean(bpe_values),
            "latent_to_bpe_ratio": statistics.fmean(ratios),
        },
        "population_standard_deviations": {
            "latent_bits_per_byte": statistics.pstdev(latent_values),
            "bpe_bits_per_byte": statistics.pstdev(bpe_values),
            "latent_to_bpe_ratio": statistics.pstdev(ratios),
        },
        "decision": "promote-latent-v3" if all_pass else "do-not-promote-latent-v3",
        "all_seed_conjunction_passed": all_pass,
        "aggregate_override_used": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(aggregate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()

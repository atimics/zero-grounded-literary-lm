#!/usr/bin/env python3
"""Small deterministic tests for the intrinsic arithmetic parser."""

from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("evaluate_arithmetic_continuations.py")
SPEC = importlib.util.spec_from_file_location("sero_arithmetic_continuations", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load arithmetic evaluator")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def main() -> None:
    correct = MODULE.analyze_continuation(
        "10 x 2 = 20. Also, 30 - 10 = 20.", 1e-9,
    )
    assert correct["parseable_equations"] == 2
    assert correct["true_equations"] == 2
    assert correct["all_equations_true"] is True

    binding = MODULE.analyze_continuation(
        "10 x 2 = 30. Therefore, 10 - 30 = 20.", 1e-9,
    )
    assert binding["parseable_equations"] == 2
    assert binding["true_equations"] == 0
    assert binding["one_edit_repairable_false_equations"] == 2
    repairs = [
        equation["one_edit_repairs_using_continuation_numbers"]
        for equation in binding["equations"]
    ]
    assert "replace_result_with_generated_number" in repairs[0]
    assert "swap_operands" in repairs[1]

    mixed = MODULE.analyze_continuation(
        "1,200 / 4 = 300; 2 / 0 = 0; 1 / 3 ≈ 0.3333333", 1e-6,
    )
    assert mixed["parseable_equations"] == 3
    assert mixed["true_equations"] == 2
    assert mixed["false_equations"] == 1

    print("arithmetic continuation evaluator tests passed")


if __name__ == "__main__":
    main()

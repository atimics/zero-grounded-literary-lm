"""Small native checks for the five retention arms and their failure records."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from run_zero4_retention_controls import (ARMS, ROOT, ProcessLog, checkpoint, run_study,
                                          select_at_budget, sha, training_args, write_json,
                                          finish_owner_cost, verify_sample_roster,
                                          check_retention_ranges, retention_changes)
from build_zero4_retention_source import build_source

LM = ROOT / "build/literary_retention_lm"


def binding(path):
    return {"path": str(path.resolve()), "sha256": sha(path)}


def mixed_source_probe(processes, initial, task_path, directory):
    directory.mkdir()
    (directory / "letters.txt").write_text("alpha beta gamma delta. letters form words.\n" * 200)
    (directory / "numbers.txt").write_text("1 2 3 5 8 13 21. count each value once.\n" * 200)
    sources = [{"kind": kind, "file": binding(path)} for kind, path in [
        ("foundation", ROOT / "corpus/zero-foundation.txt"),
        ("text", ROOT / "corpus/blake.txt"),
        ("text", directory / "letters.txt"),
        ("text", directory / "numbers.txt"),
        ("channel", task_path),
        ("text", ROOT / "corpus/blake.txt")]]
    arguments = [str(LM), "--init", initial["path"], "--eval-only", "--validation", "13",
                 "--evaluation-json", str(directory / "mixed.json")]
    for index, source in enumerate(sources):
        arguments += ["--" + source["kind"], source["file"]["path"], "--sample-weight", str(index + 1)]
    processes.run(arguments, "setup", "mixed_source_evaluation")
    mixed = json.loads((directory / "mixed.json").read_bytes())
    checked = check_retention_ranges(mixed, sources, 13)
    assert [row["weight"] for row in checked] == [1, 2, 3, 4, 5, 6]
    assert mixed["evaluated_windows"] == 12
    assert mixed["learned_state_before"] == mixed["learned_state_after"]
    individual = []
    for index, source in enumerate(sources):
        output = directory / f"source-{index}.json"
        processes.run([str(LM), "--init", initial["path"], "--eval-only", "--validation", "2",
                       "--" + source["kind"], source["file"]["path"],
                       "--sample-weight", str(index + 1), "--evaluation-json", str(output)],
                      "setup", "individual_source_evaluation")
        row = json.loads(output.read_bytes())
        single = check_retention_ranges(row, [source], 2)[0]
        assert single["loss"] == checked[index]["loss"]
        assert row["learned_state_before"] == row["learned_state_after"] == mixed["learned_state_before"]
        individual.append({"index": index, "loss": single["loss"], "result_sha256": sha(output)})
    assert sha(Path(initial["path"])) == initial["sha256"]
    return {"sources": checked, "requested_windows": 13, "evaluated_windows": 12,
            "combined_loss": mixed["loss"], "mixed_result_sha256": sha(directory / "mixed.json"),
            "individual": individual, "all_source_losses_match": True,
            "learned_state_preserved": True}


def smoke(directory):
    setup = directory / "setup"
    setup.mkdir()
    processes = ProcessLog(setup, 60, 180)
    processes.run([str(LM), "--preset", "literary", "--context", "256", "--dim", "8", "--heads", "2",
                   "--layers", "1", "--ff", "16", "--text", str(ROOT / "corpus/zero-foundation.txt"),
                   "--steps", "1", "--batch", "1", "--report", "1", "--validation", "1",
                   "--seed", "5", "--save", str(setup / "initial.ckpt"), "--tokens", "0"], "setup", "toy_initialization")
    processes.run([str(ROOT / "freeze_literary_teacher"), str(setup / "initial.ckpt"),
                   str(setup / "initial.teacher")], "setup", "freeze_toy")
    processes.run(["node", str(ROOT / "scripts/generate_zero4_q2.mjs"), "--out", str(setup / "task"),
                   "--quantity", "100", "--seed", "55321", "--request-mode", "operation"], "setup", "generate_known_smoke")
    initial = binding(setup / "initial.teacher")
    source_names = ["literary_lm.c", "channel_protocol.h", "zero1_protocol.h", "export_literary.c",
                    "quantity_request_eval.c", "quantity_oracle.c", "quantity_oracle.h",
                    "faculty_controller.c", "faculty_protocol.h", "literary_infer.c", "literary_infer.h",
                    "scripts/run_zero4_retention_controls.py", "scripts/check_zero4_retention_controls.py",
                    "scripts/generate_zero4_q2.mjs", "freeze_literary_teacher.c", "Makefile", "Makefile.zero4-retention",
                    "scripts/zero4_retention.patch", "scripts/build_zero4_retention_source.py"]
    manifest = {
        "schema": "zero.retention_controls.v1", "scope": "engineering_smoke", "arms": ARMS,
        "initial_model": initial, "task_train": binding(setup / "task/quantity-request.tok"),
        "task_eval": binding(setup / "task/quantity-request.promotion.tsv"),
        "replay": [{"kind": "text", "file": binding(ROOT / "corpus/zero-foundation.txt"),
                    "weight": 1, "distill": [0, 0.15, 0]} for _ in range(6)],
        "retention_eval": [{"kind": "text", "file": binding(ROOT / "corpus/blake.txt")} for _ in range(6)],
        "teachers": [{"file": initial, "weight": 0.15}], "zero1_teacher": None,
        "tokenizer": None, "sources": [binding(ROOT / name) for name in source_names],
        "binaries": {key: binding(ROOT / file) for key, file in
                     {"lm": "build/literary_retention_lm", "export": "export_literary", "quantity": "quantity_request_eval"}.items()},
        "seeds": [71], "attempts": 4, "chunk_attempts": 1, "batch": 1,
        "learning_rate": 1, "task_weight": 100, "guard_budget": 0.015,
        "dropout": 0, "warmup": 0, "validation_batches": 6, "case_limit": 5,
        "selection_cpu_us": [1_000_000_000], "child_wall_seconds": 60, "total_wall_seconds": 180,
    }
    write_json(directory / "manifest.json", manifest)
    result = run_study(manifest, ROOT, directory / "run")
    if result["status"] != "complete":
        raise AssertionError(json.dumps(result, indent=2))
    assert len(result["arms"]) == 5
    assert result["sample_parity"] == [{"seed": 71, "common_samples": 4,
                                        "sample_counts": {arm: 4 for arm in ARMS[2:]}}]
    for state in result["arms"]:
        assert state["status"] == "complete"
        assert len(state["snapshots"]) == (1 if state["arm"] == "frozen" else 5)
        assert state["snapshots"][0]["model_sha256"] == initial["sha256"]
        for snapshot in state["snapshots"]:
            assert len(snapshot["retention_by_source"]) == 6
            assert all(row["windows"] == 1 for row in snapshot["retention_by_source"])
            assert all(row["loss"] == snapshot["retention_by_source"][0]["loss"]
                       for row in snapshot["retention_by_source"])
        for snapshot in state["snapshots"][1:]:
            retained = directory / "run" / state["owner"] / snapshot["retained_checkpoint"]
            assert sha(retained) == snapshot["model_sha256"]
            assert checkpoint(retained) == snapshot["checkpoint"]
        if state["arm"] != "frozen":
            progress = checkpoint(directory / "run" / state["owner"] / "active.ckpt")
            assert progress["attempts"] == 4
    assert sha(setup / "initial.teacher") == initial["sha256"]
    left = training_args(manifest, ROOT, "replay_guard", 71, directory / "same", 0)
    right = training_args(manifest, ROOT, "replay_projection", 71, directory / "same", 0)
    assert [(a, b) for a, b in zip(left, right) if a != b] == [("cumulative-backtracking", "cumulative-tangent")]
    # The numerical fixture exercises an active projection directly.
    processes.run([str(LM), "--self-test"], "setup", "native_gradient_checks")
    # Compare full checkpoint bytes, including RNG and optimizer state, with
    # the frozen trainer after the same four training chunks in every arm.
    for arm in ARMS[1:]:
        original = setup / ("original-" + arm)
        original.mkdir()
        for offset in range(manifest["attempts"]):
            command = training_args(manifest, ROOT, arm, 71, original, offset)
            command[0] = str(ROOT / "literary_lm")
            flag = command.index("--training-samples")
            del command[flag:flag + 2]
            processes.run(command, "setup", "frozen_trainer_parity")
        assert (original / "active.ckpt").read_bytes() == (directory / "run" / f"seed-71-{arm}" / "active.ckpt").read_bytes()
    replay_path = directory / "run/seed-71-frozen/retention-000000.json"
    before = replay_path.read_bytes()
    try:
        processes.run([str(LM), "--init", str(setup / "initial.teacher"),
                       "--text", str(ROOT / "corpus/blake.txt"), "--eval-only",
                       "--evaluation-json", str(replay_path), "--validation", "1"], "setup", "existing_output")
    except ValueError:
        pass
    else:
        raise AssertionError("existing evaluation output overwritten")
    assert replay_path.read_bytes() == before
    source_probe = mixed_source_probe(processes, initial, setup / "task/quantity-request.tok",
                                     setup / "mixed-source-probe")
    write_json(directory / "SOURCE-PROBE.json", source_probe)
    return result, manifest


class BudgetTests(unittest.TestCase):
    @staticmethod
    def range_fixture(requested=6, losses=None):
        sources = [{"kind": "text", "file": {"sha256": str(index) * 64}} for index in range(6)]
        losses = losses or [1.0] * 6
        windows = max(requested // 6, 1)
        record = {"schema": "zero.literary_eval.v2", "loss": sum(losses) / 6,
                  "requested_validation_batches": requested, "validation_batches": max(requested, 6),
                  "evaluated_windows": windows * 6,
                  "ranges": [{"index": index, "channel": 0, "foundation": 0, "weight": 1,
                              "windows": windows, "loss": loss} for index, loss in enumerate(losses)]}
        return record, sources

    def test_unchanged_mean_retains_worst_source_damage(self):
        original, sources = self.range_fixture()
        changed, _ = self.range_fixture(losses=[2, 0.8, 0.8, 0.8, 0.8, 0.8])
        baseline = check_retention_ranges(original, sources, 6)
        rows = check_retention_ranges(changed, sources, 6)
        measured = retention_changes(rows, baseline)
        self.assertAlmostEqual(original["loss"], changed["loss"])
        self.assertEqual(max(row["relative_regression"] for row in measured), 1)
        self.assertAlmostEqual(measured[1]["relative_regression"], -0.2)

    def test_source_loss_roster_kind_and_finite_values(self):
        original, sources = self.range_fixture()
        for field, replacement in [("index", 1), ("channel", 1), ("foundation", 1),
                                   ("weight", 0), ("loss", float("nan")), ("windows", 2)]:
            changed = deepcopy(original)
            changed["ranges"][0][field] = replacement
            with self.assertRaises(ValueError):
                check_retention_ranges(changed, sources, 6)
        changed = deepcopy(original)
        changed["ranges"].pop()
        with self.assertRaises(ValueError):
            check_retention_ranges(changed, sources, 6)

    def test_actual_window_count_and_aggregate_are_checked(self):
        record, sources = self.range_fixture(requested=13)
        self.assertEqual(len(check_retention_ranges(record, sources, 13)), 6)
        self.assertEqual(record["evaluated_windows"], 12)
        for field, value in [("evaluated_windows", 13), ("requested_validation_batches", 12), ("loss", 2)]:
            changed = deepcopy(record)
            changed[field] = value
            with self.assertRaises(ValueError):
                check_retention_ranges(changed, sources, 13)
        record, sources = self.range_fixture(requested=1)
        self.assertEqual(sum(row["windows"] for row in check_retention_ranges(record, sources, 1)), 6)

    def test_baseline_sources_must_match(self):
        record, sources = self.range_fixture()
        rows = check_retention_ranges(record, sources, 6)
        changed = deepcopy(rows)
        changed[0]["source_sha256"] = "f" * 64
        with self.assertRaises(ValueError):
            retention_changes(changed, rows)

    def test_source_builder_rejects_changed_base_and_changed_patch(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            output = directory / "trainer.c"
            output.write_text("preserved")
            source = directory / "base.c"
            source.write_bytes((ROOT / "literary_lm.c").read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "frozen trainer"):
                build_source(source, ROOT / "scripts/zero4_retention.patch", output)
            patch = directory / "changed.patch"
            patch.write_text((ROOT / "scripts/zero4_retention.patch").read_text().replace(
                "+    const char *evaluation_json_path;", "+    const char *changed_json_path;"))
            assert patch.read_bytes() != (ROOT / "scripts/zero4_retention.patch").read_bytes()
            with self.assertRaisesRegex(ValueError, "instrumented trainer"):
                build_source(ROOT / "literary_lm.c", patch, output)
            self.assertEqual(output.read_text(), "preserved")

    def test_missing_manifest_fields_leave_a_terminal_record(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name) / "failed"
            with self.assertRaises(KeyError):
                run_study({}, ROOT, directory)
            result = json.loads((directory / "result.json").read_bytes())
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["process_count"], 0)

    def test_roster_rejects_partial_or_reordered_samples(self):
        with tempfile.TemporaryDirectory() as name:
            path = Path(name) / "samples.jsonl"
            path.write_text('{"attempt":1,"batch":0}\n')
            with self.assertRaises(ValueError):
                verify_sample_roster(path, 2, 1)
            path.write_text('{"attempt":2,"batch":0}\n{"attempt":1,"batch":0}\n')
            with self.assertRaises(ValueError):
                verify_sample_roster(path, 2, 1)

    def test_completed_point_includes_controller_and_shared_setup(self):
        import time
        with tempfile.TemporaryDirectory() as name:
            log = ProcessLog(Path(name), 1, 1)
            log.records = [{"owner": "a", "cpu_us": 17}]
            state = {"owner": "a", "controller_cpu_us": 11, "shared_setup_charge_us": 5,
                     "snapshots": [{"cpu_us": 17}]}
            finish_owner_cost(state, log, time.process_time_ns(), 0)
            self.assertGreaterEqual(state["snapshots"][0]["cpu_us"], 33)
            self.assertIsNone(select_at_budget([{"attempts": 1, **state["snapshots"][0]}], 32))

    def test_selection_uses_latest_completed_point_inside_cpu_budget(self):
        rows = [{"attempts": 0, "cpu_us": 5, "quality": 1},
                {"attempts": 10, "cpu_us": 20, "quality": 0},
                {"attempts": 20, "cpu_us": 30, "quality": 2}]
        self.assertIsNone(select_at_budget(rows, 4))
        self.assertEqual(select_at_budget(rows, 20), rows[1])
        self.assertEqual(select_at_budget(rows, 29), rows[1])

    def test_failed_child_keeps_output_and_completed_cpu(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            processes = ProcessLog(directory, 5, 10)
            with self.assertRaises(ValueError):
                processes.run(["python3", "-c", "print('retained', flush=True); raise SystemExit(7)"], "test", "failure")
            record = json.loads((directory / "process-00000.json").read_bytes())
            self.assertEqual(record["exit_code"], 7)
            self.assertIn("cpu_us", record)
            self.assertEqual((directory / "process-00000.stdout").read_text(), "retained\n")

    def test_timeout_reaps_child_and_keeps_partial_output(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            processes = ProcessLog(directory, 0.5, 5)
            with self.assertRaises(ValueError):
                processes.run(["python3", "-c", "import time; print('started', flush=True); time.sleep(5)"], "test", "timeout")
            record = json.loads((directory / "process-00000.json").read_bytes())
            self.assertTrue(record["timed_out"])
            self.assertLess(record["exit_code"], 0)
            self.assertEqual((directory / "process-00000.stdout").read_text(), "started\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(BudgetTests)
    if not unittest.TextTestRunner().run(suite).wasSuccessful():
        raise SystemExit(1)
    directory = (args.out or Path(tempfile.mkdtemp(prefix="zero4-retention-smoke-"))).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    print(f"Native smoke directory: {directory}", flush=True)
    result, manifest = smoke(directory)
    changed = deepcopy(manifest)
    changed["initial_model"]["sha256"] = "0" * 64
    try:
        run_study(changed, ROOT, directory / "bad-binding")
    except ValueError:
        pass
    else:
        raise AssertionError("changed input binding accepted")
    assert json.loads((directory / "bad-binding/result.json").read_bytes())["status"] == "failed"
    tight = deepcopy(manifest)
    tight["selection_cpu_us"] = [1]
    limited = run_study(tight, ROOT, directory / "tiny-budget")
    assert limited["status"] == "complete"
    assert limited["process_count"] == 15
    assert all(state["at_cpu_budget"][0]["snapshot"] is None for state in limited["arms"])
    assert all(len(state["snapshots"]) == 1 for state in limited["arms"])
    try:
        run_study(manifest, ROOT, directory / "run")
    except FileExistsError:
        pass
    else:
        raise AssertionError("existing output reused")
    projection_rows = [json.loads(line) for line in (directory / "run/seed-71-replay_projection/attempts.jsonl").read_text().splitlines()]
    projection = {"attempts": len(projection_rows),
                  "projected_trials": sum(trial["projection_applied"] for row in projection_rows for trial in row["backtrack_trials"]),
                  "backtracked_attempts": sum(row["backtrack_trial_count"] > 1 for row in projection_rows)}
    summary = {"schema": "zero.retention_controls_smoke.v1", "scope": "engineering_smoke",
               "fixture": {"generator_seed": 55321, "requested_training_and_validation_cases": 100,
                           "training_seed": 71, "initial_model_sha256": manifest["initial_model"]["sha256"],
                           "task_train_sha256": manifest["task_train"]["sha256"],
                           "task_eval_sha256": manifest["task_eval"]["sha256"],
                           "replay_sha256": manifest["replay"][0]["file"]["sha256"],
                           "retention_eval_sha256": manifest["retention_eval"][0]["file"]["sha256"]},
               "instrumented_source_sha256": sha(ROOT / "build/literary_retention.c"),
               "source_loss_probe": json.loads((directory / "SOURCE-PROBE.json").read_bytes()),
               "frozen_trainer_state_parity": {"arms": ARMS[1:], "attempts_each": 4, "identical": True},
               "retained_training_checkpoints": 16,
               "performance_evidence": False, "arms": [{"arm": state["arm"], "status": state["status"],
                  "snapshots": len(state["snapshots"]), "last_attempt": state["snapshots"][-1]["attempts"],
                  "final_retention_by_source": state["snapshots"][-1]["retention_by_source"],
                  "worst_source_relative_regression": state["snapshots"][-1]["worst_source_relative_regression"],
                  "final_quantity": state["snapshots"][-1]["quantity"]} for state in result["arms"]],
               "projection_path": projection,
               "paired_replay_samples": result["sample_parity"], "process_count": result["process_count"],
               "sources": {str(Path(row["path"]).relative_to(ROOT)): row["sha256"] for row in manifest["sources"]}}
    write_json(directory / "SMOKE.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

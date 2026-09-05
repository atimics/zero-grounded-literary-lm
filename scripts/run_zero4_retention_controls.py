"""Run five ZERO.4 retention arms from bound files and preserve every process."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import struct
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ARMS = ["frozen", "task_only", "replay", "replay_guard", "replay_projection"]
MODES = {"replay_guard": "cumulative-backtracking", "replay_projection": "cumulative-tangent"}
THREAD_ENV = {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1",
              "VECLIB_MAXIMUM_THREADS": "1", "MKL_NUM_THREADS": "1", "LC_ALL": "C"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")
    temporary.replace(path)


def bound_path(binding, root):
    path = (root / binding["path"]).resolve()
    require(path.is_file() and sha(path) == binding["sha256"], "file binding differs: " + str(path))
    return path


def check_manifest(manifest, root):
    require(manifest["schema"] == "zero.retention_controls.v1", "manifest schema differs")
    require(manifest["scope"] in ["engineering_smoke", "prospective_cloud"], "unknown scope")
    require(manifest["arms"] == ARMS, "arm roster differs")
    require(len(manifest["replay"]) == 6 and len(manifest["retention_eval"]) == 6,
            "six replay and retention ranges are required")
    require(manifest["seeds"] and len(set(manifest["seeds"])) == len(manifest["seeds"])
            and all(type(seed) is int and seed > 0 for seed in manifest["seeds"]), "invalid seeds")
    for key in ["attempts", "chunk_attempts", "batch", "validation_batches", "case_limit"]:
        require(type(manifest[key]) is int and manifest[key] > 0, "invalid " + key)
    require(manifest["attempts"] % manifest["chunk_attempts"] == 0, "partial training chunk")
    require(manifest["case_limit"] <= 2048, "quantity evaluator case limit exceeded")
    for key in ["learning_rate", "task_weight", "child_wall_seconds", "total_wall_seconds"]:
        require(math.isfinite(manifest[key]) and manifest[key] > 0, "invalid " + key)
    require(manifest["guard_budget"] == 0.015, "historical guard threshold differs")
    budgets = manifest["selection_cpu_us"]
    require(budgets and budgets == sorted(set(budgets))
            and all(type(value) is int and value > 0 for value in budgets), "invalid CPU budgets")
    require(manifest["dropout"] == 0 and manifest["warmup"] == 0,
            "this control uses the frozen constant learning schedule")
    bindings = [manifest[key] for key in ["initial_model", "task_train", "task_eval"]]
    bindings += list(manifest["binaries"].values()) + manifest["sources"]
    bindings += [row["file"] for row in manifest["replay"] + manifest["retention_eval"]]
    bindings += [row["file"] for row in manifest["teachers"]]
    if manifest["zero1_teacher"] is not None:
        bindings.append(manifest["zero1_teacher"])
    for binding in bindings:
        bound_path(binding, root)
    if manifest.get("tokenizer"):
        bound_path(manifest["tokenizer"], root)
    initial = bound_path(manifest["initial_model"], root).read_bytes()
    require(len(initial) >= 64 and initial[:8] == b"ZEROTCH1"
            and struct.unpack_from("<I", initial, 8)[0] == 1
            and struct.unpack_from("<9I", initial, 8)[8] & 1,
            "initial model must be a frozen rotary teacher supported by the evaluator")
    require(set(manifest["binaries"]) == {"lm", "export", "quantity"}, "binary roster differs")
    require(1 <= len(manifest["teachers"]) <= 2, "invalid same-architecture teacher roster")
    require(manifest["teachers"][-1]["file"]["sha256"] == manifest["initial_model"]["sha256"],
            "guard reference differs from initialization")
    for row in manifest["replay"] + manifest["retention_eval"]:
        require(row["kind"] in ["text", "foundation", "channel"], "invalid replay kind")
    for row in manifest["replay"]:
        require(row["weight"] > 0 and math.isfinite(row["weight"]), "invalid replay weight")
        require(len(row["distill"]) == 3 and all(math.isfinite(x) and 0 <= x <= 1 for x in row["distill"])
                and sum(row["distill"]) <= 1, "invalid distillation weights")
    if manifest["scope"] == "prospective_cloud":
        require(manifest["fresh_data_record"] and manifest["machine_record"],
                "cloud study needs frozen fresh-data and machine records")
        bound_path(manifest["fresh_data_record"], root)
        bound_path(manifest["machine_record"], root)
        for name in ["replay", "retention_eval"]:
            require(len({row["file"]["sha256"] for row in manifest[name]}) == 6,
                    "cloud study needs six distinct " + name + " sources")
        require({row["file"]["sha256"] for row in manifest["replay"]}.isdisjoint(
                    {row["file"]["sha256"] for row in manifest["retention_eval"]}),
                "held-out retention files overlap replay files")
    return manifest


class ProcessLog:
    def __init__(self, directory, child_wall_seconds, total_wall_seconds):
        self.directory = directory
        self.child_wall_seconds = child_wall_seconds
        self.deadline = time.monotonic() + total_wall_seconds
        self.records = []

    def run(self, command, owner, stage):
        number = len(self.records)
        prefix = self.directory / f"process-{number:05d}"
        record = {"ordinal": number, "owner": owner, "stage": stage, "command": list(map(str, command)),
                  "status": "running", "thread_environment": THREAD_ENV}
        write_json(prefix.with_suffix(".json"), record)
        self.records.append(record)
        started = time.monotonic()
        child = None
        try:
            require(started < self.deadline, "controller wall limit reached")
            with prefix.with_suffix(".stdout").open("xb") as stdout, prefix.with_suffix(".stderr").open("xb") as stderr:
                child = subprocess.Popen(record["command"], stdout=stdout, stderr=stderr,
                                         env={**os.environ, **THREAD_ENV}, start_new_session=True)
                killed = False
                while True:
                    pid, status, usage = os.wait4(child.pid, os.WNOHANG)
                    if pid:
                        child.returncode = os.waitstatus_to_exitcode(status)
                        break
                    if not killed and time.monotonic() >= min(self.deadline, started + self.child_wall_seconds):
                        os.killpg(child.pid, signal.SIGKILL)
                        killed = True
                    time.sleep(0.02)
                record.update({"exit_code": child.returncode, "timed_out": killed,
                               "cpu_us": round((usage.ru_utime + usage.ru_stime) * 1_000_000),
                               "wall_us": round((time.monotonic() - started) * 1_000_000),
                               "status": "timeout" if killed else "success" if child.returncode == 0 else "failed",
                               "stdout_sha256": sha(prefix.with_suffix(".stdout")),
                               "stderr_sha256": sha(prefix.with_suffix(".stderr"))})
            require(record["status"] == "success", f"{stage} {record['status']}; see {prefix}")
            return record
        except BaseException as error:
            if child is not None and child.returncode is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                _, status, usage = os.wait4(child.pid, 0)
                child.returncode = os.waitstatus_to_exitcode(status)
                record.update({"exit_code": child.returncode,
                               "cpu_us": round((usage.ru_utime + usage.ru_stime) * 1_000_000)})
            if child is None:
                record["cpu_us"] = 0
            record["wall_us"] = round((time.monotonic() - started) * 1_000_000)
            record.update({"status": record["status"] if record["status"] in ["failed", "timeout"] else "failed",
                           "error": str(error)})
            raise
        finally:
            write_json(prefix.with_suffix(".json"), record)
            write_json(self.directory / "processes.json", self.records)

    def cpu(self, owner):
        return sum(row.get("cpu_us", 0) for row in self.records if row["owner"] == owner)


def checkpoint(path):
    data = Path(path).read_bytes()
    require(len(data) >= 80 and data[:8] == b"ZEROLM2\0" and struct.unpack_from("<I", data, 8)[0] == 4,
            "checkpoint format differs")
    return {"committed": struct.unpack_from("<Q", data, 48)[0],
            "rng": struct.unpack_from("<Q", data, 56)[0],
            "attempts": struct.unpack_from("<Q", data, 64)[0],
            "rejections": struct.unpack_from("<I", data, 72)[0],
            "mode": struct.unpack_from("<I", data, 76)[0]}


def data_args(rows, root, training=False):
    result = []
    for row in rows:
        result += ["--" + row["kind"], str(bound_path(row["file"], root))]
        if training:
            result += ["--sample-weight", str(row["weight"]), "--distill", ",".join(map(str, row["distill"]))]
    return result


def training_args(manifest, root, arm, seed, directory, offset):
    model = directory / "active.ckpt"
    result = [str(bound_path(manifest["binaries"]["lm"], root)),
              "--resume" if offset else "--init", str(model if offset else bound_path(manifest["initial_model"], root))]
    if manifest.get("tokenizer"):
        result += ["--tokenizer", str(bound_path(manifest["tokenizer"], root))]
    if arm != "task_only":
        for teacher in manifest["teachers"]:
            result += ["--teacher", str(bound_path(teacher["file"], root)), "--teacher-weight", str(teacher["weight"])]
        if manifest["zero1_teacher"]:
            result += ["--zero1-teacher", str(bound_path(manifest["zero1_teacher"], root)), "--zero1-weight", "0.25"]
        result += data_args(manifest["replay"], root, True)
    result += ["--hard-channel", str(bound_path(manifest["task_train"], root)),
               "--sample-weight", str(manifest["task_weight"]), "--steps", str(manifest["chunk_attempts"]),
               "--batch", str(manifest["batch"]), "--lr", str(manifest["learning_rate"]),
               "--warmup", "0", "--dropout", "0", "--patience", "0", "--report", "1000000",
               "--validation", str(manifest["validation_batches"]), "--seed", str(seed),
               "--save", str(model), "--tokens", "0", "--training-samples", str(directory / "samples.jsonl")]
    if arm in MODES:
        result += ["--transaction-mode", MODES[arm], "--transaction-log", str(directory / "attempts.jsonl"),
                   "--transaction-phase", "acquisition", "--transaction-probe", "1",
                   "--transaction-budget", str(manifest["guard_budget"]), "--transaction-max-rejections", "8"]
    return result


def measure(manifest, root, processes, owner, directory, model, initial, offset):
    model_sha = sha(model)
    replay_file = directory / f"retention-{offset:06d}.json"
    arguments = [str(bound_path(manifest["binaries"]["lm"], root)), "--init" if initial else "--resume", str(model),
                 "--eval-only", "--evaluation-json", str(replay_file), "--validation", str(manifest["validation_batches"])]
    if manifest.get("tokenizer"):
        arguments += ["--tokenizer", str(bound_path(manifest["tokenizer"], root))]
    arguments += data_args(manifest["retention_eval"], root)
    processes.run(arguments, owner, "retention_evaluation")
    replay = json.loads(replay_file.read_bytes())
    require(replay["schema"] == "zero.literary_eval.v1" and math.isfinite(replay["loss"])
            and replay["loss"] > 0, "invalid retention loss")
    require(replay["learned_state_before"] == replay["learned_state_after"], "evaluation changed learned state")
    quantized = directory / f"checkpoint-{offset:06d}.litq8"
    processes.run([str(bound_path(manifest["binaries"]["export"], root)), str(model), str(quantized)], owner, "export")
    quantity_file = directory / f"quantity-{offset:06d}.json"
    processes.run([str(bound_path(manifest["binaries"]["quantity"], root)), str(quantized),
                   str(bound_path(manifest["task_eval"], root)), "--json", str(quantity_file),
                   "--limit", str(manifest["case_limit"]), "--jobs", "1"], owner, "quantity_evaluation")
    quantity = json.loads(quantity_file.read_bytes())["quantity"]
    require(quantity["cases"] == manifest["case_limit"], "quantity case coverage differs")
    for key in ["closed", "syntax", "operation", "arguments", "exact_request", "oracle_arithmetic", "committed", "exact_artifact"]:
        require(type(quantity[key]) is int and 0 <= quantity[key] <= quantity["cases"], "invalid quantity count")
    require(sha(model) == model_sha, "evaluation changed model file")
    return {"attempts": offset, "model_sha256": model_sha, "quantized_sha256": sha(quantized),
            "retention_loss": replay["loss"], "quantity": quantity,
            "cpu_us": processes.cpu(owner), "learned_state": replay["learned_state_after"]}


def select_at_budget(snapshots, budget):
    eligible = [row for row in snapshots if row["cpu_us"] <= budget]
    return max(eligible, key=lambda row: row["attempts"]) if eligible else None


def finish_owner_cost(state, processes, started, previous_snapshots):
    state["controller_cpu_us"] += round((time.process_time_ns() - started) / 1000)
    if len(state["snapshots"]) > previous_snapshots:
        state["snapshots"][-1]["cpu_us"] = (processes.cpu(state["owner"])
            + state["controller_cpu_us"] + state["shared_setup_charge_us"])


def check_sample_parity(directory, seed):
    logs = []
    for arm in ["replay", "replay_guard", "replay_projection"]:
        file = directory / f"seed-{seed}-{arm}" / "samples.jsonl"
        logs.append([json.loads(line) for line in file.read_text().splitlines()] if file.exists() else [])
    common = min(map(len, logs))
    require(all(rows[:common] == logs[0][:common] for rows in logs), "paired replay training samples differ")
    return {"seed": seed, "common_samples": common, "sample_counts": dict(zip(ARMS[2:], map(len, logs)))}


def verify_sample_roster(path, attempts, batch_size):
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    require(len(rows) == attempts * batch_size, "consumed sample count differs from completed attempts")
    require([(row["attempt"], row["batch"]) for row in rows]
            == [(attempt, batch) for attempt in range(1, attempts + 1) for batch in range(batch_size)],
            "sample attempt roster differs")
    return rows


def run_study(manifest, root, output):
    started_cpu = time.process_time_ns()
    started_wall = time.monotonic()
    output.mkdir(parents=True, exist_ok=False)
    processes = None
    result = {"schema": "zero.retention_controls_result.v1",
              "scope": manifest.get("scope", "unknown") if isinstance(manifest, dict) else "unknown",
              "performance_evidence": False,
              "timing_status": "raw_measurements_require_verified_cloud_receipt",
              "arms": [], "sample_parity": [], "status": "running"}
    try:
        write_json(output / "manifest.json", manifest)
        processes = ProcessLog(output, manifest["child_wall_seconds"], manifest["total_wall_seconds"])
        check_manifest(manifest, root)
        shared_setup_cpu_us = round((time.process_time_ns() - started_cpu) / 1000)
        for seed_index, seed in enumerate(manifest["seeds"]):
            order = ARMS[seed_index % len(ARMS):] + ARMS[:seed_index % len(ARMS)]
            states = {}
            for arm in order:
                owner = f"seed-{seed}-{arm}"
                directory = output / owner
                directory.mkdir()
                state = {"seed": seed, "arm": arm, "owner": owner, "snapshots": [], "status": "running",
                         "controller_cpu_us": 0, "shared_setup_charge_us": shared_setup_cpu_us}
                result["arms"].append(state)
                states[arm] = state
                owner_started = time.process_time_ns()
                try:
                    state["snapshots"].append(measure(manifest, root, processes, owner, directory,
                                                       bound_path(manifest["initial_model"], root), True, 0))
                    if arm == "frozen":
                        state["status"] = "complete"
                except Exception as error:
                    state.update(status="failed", error=str(error))
                finally:
                    finish_owner_cost(state, processes, owner_started, 0)
                if state["status"] == "running" and state["snapshots"][-1]["cpu_us"] >= max(manifest["selection_cpu_us"]):
                    state["status"] = "selection_budget_reached"
            for offset in range(0, manifest["attempts"], manifest["chunk_attempts"]):
                for arm in order:
                    state = states[arm]
                    if state["status"] != "running":
                        continue
                    directory = output / state["owner"]
                    owner_started = time.process_time_ns()
                    previous_snapshots = len(state["snapshots"])
                    try:
                        processes.run(training_args(manifest, root, arm, seed, directory, offset), state["owner"], "training")
                        progress = checkpoint(directory / "active.ckpt")
                        require(offset < progress["attempts"] <= offset + manifest["chunk_attempts"], "attempt count differs")
                        verify_sample_roster(directory / "samples.jsonl", progress["attempts"], manifest["batch"])
                        snapshot = measure(manifest, root, processes, state["owner"], directory,
                                           directory / "active.ckpt", False, progress["attempts"])
                        snapshot["checkpoint"] = progress
                        state["snapshots"].append(snapshot)
                        if progress["attempts"] != offset + manifest["chunk_attempts"] or progress["rejections"] >= 8:
                            state["status"] = "guard_exhausted"
                        elif progress["attempts"] == manifest["attempts"]:
                            state["status"] = "complete"
                        elif processes.cpu(state["owner"]) >= max(manifest["selection_cpu_us"]):
                            state["status"] = "selection_budget_reached"
                    except Exception as error:
                        state.update(status="failed", error=str(error))
                    finally:
                        finish_owner_cost(state, processes, owner_started, previous_snapshots)
                    if state["status"] == "running" and state["snapshots"][-1]["cpu_us"] >= max(manifest["selection_cpu_us"]):
                        state["status"] = "selection_budget_reached"
                    write_json(output / "result.json", result)
            result["sample_parity"].append(check_sample_parity(output, seed))
        for state in result["arms"]:
            state["child_cpu_us"] = processes.cpu(state["owner"])
            state["total_cpu_us"] = state["child_cpu_us"] + state["controller_cpu_us"] + state["shared_setup_charge_us"]
            state["at_cpu_budget"] = [{"budget_cpu_us": budget, "snapshot": select_at_budget(state["snapshots"], budget)}
                                      for budget in manifest["selection_cpu_us"]]
        result["status"] = "failed" if any(row["status"] == "failed" for row in result["arms"]) else "complete"
        return result
    except BaseException as error:
        result.update(status="failed", error=str(error))
        raise
    finally:
        records = processes.records if processes is not None else []
        result["process_count"] = len(records)
        result["controller_cpu_us"] = round((time.process_time_ns() - started_cpu) / 1000)
        result["total_child_cpu_us"] = sum(row.get("cpu_us", 0) for row in records)
        result["controller_wall_us"] = round((time.monotonic() - started_wall) * 1_000_000)
        write_json(output / "result.json", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", default=ROOT, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    result = run_study(json.loads(args.manifest.read_bytes()), args.root.resolve(), args.out.resolve())
    print(json.dumps({"status": result["status"], "output": str(args.out), "processes": result["process_count"]}))
    if result["status"] != "complete":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

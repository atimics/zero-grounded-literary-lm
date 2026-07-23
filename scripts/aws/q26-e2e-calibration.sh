#!/bin/bash
# Run the diagnostic-only Q2.6 end-to-end OpenBLAS calibration.

set -Eeuo pipefail

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_RUN_ID:?ZERO_RUN_ID is required}"
: "${ZERO_COMMIT:?ZERO_COMMIT is required}"
: "${ZERO_BUDGET_FILE:?ZERO_BUDGET_FILE is required}"
: "${ZERO_BUDGET_SHA256:?ZERO_BUDGET_SHA256 is required}"
: "${ZERO_LAUNCH_EPOCH:?ZERO_LAUNCH_EPOCH is required}"
: "${ZERO_WORKLOAD_DEADLINE_EPOCH:?ZERO_WORKLOAD_DEADLINE_EPOCH is required}"
: "${ZERO_HOURLY_RATE_USD:?ZERO_HOURLY_RATE_USD is required}"
: "${ZERO_MAX_COMPUTE_USD:?ZERO_MAX_COMPUTE_USD is required}"
: "${ZERO_MAX_ATTEMPTS:?ZERO_MAX_ATTEMPTS is required}"

RESULTS_ROOT=/tmp/zero-q26-e2e-calibration
STATUS_FILE="$RESULTS_ROOT/status.json"
RESULT_FILE="$RESULTS_ROOT/result.json"
BACKEND_LOG="$RESULTS_ROOT/backend.log"
DRIVER_OUT="$RESULTS_ROOT/driver"
WORKLOAD_LOG=/var/log/zero-q26-e2e-calibration.log
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT" "$DRIVER_OUT"
exec > >(tee -a "$WORKLOAD_LOG") 2>&1
set -x

write_fallback_result() {
  exit_code=$1
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ZERO_EXIT_CODE="$exit_code" ZERO_FINISHED_AT="$finished_at" ZERO_PHASE="$PHASE" \
    ZERO_RESULT_FILE="$RESULT_FILE" ZERO_STATUS_FILE="$STATUS_FILE" \
    ZERO_STARTED_AT="$STARTED_AT" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.q26_e2e_calibration_result.v1",
    "id": "openblas-e2e-calibration-v1",
    "status": "infrastructure-error",
    "phase": os.environ["ZERO_PHASE"],
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "scientific_inference_allowed": False,
}
with open(os.environ["ZERO_RESULT_FILE"], "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
status = {
    "schema": "zero.aws_q26_e2e_calibration_status.v1",
    **{key: value for key, value in record.items() if key != "schema"},
}
with open(os.environ["ZERO_STATUS_FILE"], "w", encoding="utf-8") as handle:
    json.dump(status, handle, indent=2)
    handle.write("\n")
PY
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if [ ! -s "$RESULT_FILE" ] || [ ! -s "$STATUS_FILE" ]; then
    write_fallback_result "$exit_code"
  fi
  aws s3 sync "$RESULTS_ROOT/" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/results/" \
    --no-cli-pager
  aws s3 cp "$WORKLOAD_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-q26-e2e-calibration.log" \
    --no-cli-pager
  # The observer treats root status as permission to terminate. Publish it only
  # after all result files are durable.
  aws s3 cp "$STATUS_FILE" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
    --no-cli-pager
  exit "$exit_code"
}
trap finish EXIT

publish_heartbeat() {
  heartbeat_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  heartbeat_epoch=$(date +%s)
  ZERO_HEARTBEAT_AT="$heartbeat_at" ZERO_HEARTBEAT_EPOCH="$heartbeat_epoch" \
    ZERO_PHASE="$PHASE" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_q26_e2e_calibration_heartbeat.v1",
    "status": "running",
    "phase": os.environ["ZERO_PHASE"],
    "at": os.environ["ZERO_HEARTBEAT_AT"],
    "elapsed_instance_seconds": max(
        0,
        int(os.environ["ZERO_HEARTBEAT_EPOCH"])
        - int(os.environ["ZERO_LAUNCH_EPOCH"]),
    ),
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
}
with open("/tmp/zero-q26-e2e-heartbeat.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
  aws s3 cp /tmp/zero-q26-e2e-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/heartbeat.json" \
    --no-cli-pager
}

export LITERARY_BACKEND=openblas
export OPENBLAS_NUM_THREADS=16
export OMP_NUM_THREADS=16

PHASE=source
publish_heartbeat
install -d -m 0755 /tmp/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/source.tar.gz" \
  /tmp/zero-source.tar.gz \
  --no-cli-pager
tar -xzf /tmp/zero-source.tar.gz -C /tmp/zero
cd /tmp/zero

actual_budget_sha256=$(sha256sum "$ZERO_BUDGET_FILE" | awk '{print $1}')
test "$actual_budget_sha256" = "$ZERO_BUDGET_SHA256"
node scripts/check_q26_e2e_calibration_budget.mjs "$ZERO_BUDGET_FILE"

PHASE=assets
publish_heartbeat
aws s3 sync "s3://${ZERO_BUCKET}/assets/corpus/" corpus/ --no-cli-pager
python3 scripts/verify_teacher_artifacts.py
node scripts/generate_zero4_q2.mjs \
  --out corpus/faculty/q22 --quantity 10000 --seed 5 \
  --request-mode operation
node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q22

PHASE=build
publish_heartbeat
make -j16 literary_lm export_literary quantity_request_eval
node scripts/check_zero4_q26.mjs --self-test
node scripts/train_zero4_q26.mjs --self-test
node scripts/calibrate_zero4_q26_e2e.mjs --self-test
./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
  --text corpus/zero-foundation.txt --steps 0 --tokens 0 \
  | tee "$BACKEND_LOG"

PHASE=measurement
publish_heartbeat
DRIVER_STARTED_EPOCH=$(date +%s)
remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - DRIVER_STARTED_EPOCH))
driver_exit=124
if [ "$remaining" -gt 0 ]; then
  set +e
  timeout --signal=TERM --kill-after=10s "${remaining}s" \
    stdbuf -oL -eL node scripts/calibrate_zero4_q26_e2e.mjs \
      --budget "$ZERO_BUDGET_FILE" \
      --out "$DRIVER_OUT" \
      --prefix "$RESULTS_ROOT/seed89" \
    2>&1 | tee "$RESULTS_ROOT/driver.log"
  driver_exit=${PIPESTATUS[0]}
  set -e
fi
DRIVER_FINISHED_EPOCH=$(date +%s)

backend=unknown
if grep -q "literary_lm: backend=OpenBLAS" "$BACKEND_LOG" 2>/dev/null \
    || grep -q "literary_lm: backend=OpenBLAS" "$RESULTS_ROOT/driver.log" 2>/dev/null; then
  backend=OpenBLAS
fi

PHASE=publication
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
ZERO_BACKEND="$backend" ZERO_DRIVER_EXIT="$driver_exit" \
  ZERO_DRIVER_STARTED_EPOCH="$DRIVER_STARTED_EPOCH" \
  ZERO_DRIVER_FINISHED_EPOCH="$DRIVER_FINISHED_EPOCH" \
  ZERO_FINISHED_AT="$finished_at" ZERO_FINISHED_EPOCH="$finished_epoch" \
  ZERO_RESULT_FILE="$RESULT_FILE" ZERO_STATUS_FILE="$STATUS_FILE" \
  ZERO_STARTED_AT="$STARTED_AT" ZERO_DRIVER_OUT="$DRIVER_OUT" \
  python3 - <<'PY'
import json
import math
import os
from pathlib import Path

driver_out = Path(os.environ["ZERO_DRIVER_OUT"])
measurement_path = driver_out / "driver-measurement.json"
events_path = driver_out / "events.jsonl"
attempts_path = driver_out / "optimizer-attempts.jsonl"

events = []
if events_path.exists():
    events = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
attempt_records = []
if attempts_path.exists():
    attempt_records = [
        json.loads(line)
        for line in attempts_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

def count(event_type):
    return sum(event.get("type") == event_type for event in events)

def elapsed(event_type):
    return sum(
        float(event.get("elapsed_seconds", 0))
        for event in events
        if event.get("type") == event_type
    )

if measurement_path.exists():
    driver = json.loads(measurement_path.read_text(encoding="utf-8"))
else:
    completed_attempts = len(attempt_records)
    committed = max(
        (int(record.get("committed_update", 0)) for record in attempt_records),
        default=0,
    )
    driver = {
        "schema": "zero.q26_e2e_driver_measurement.v1",
        "status": "budget-exhausted"
        if int(os.environ["ZERO_DRIVER_EXIT"]) in (124, 137, 143)
        else "infrastructure-error",
        "seed": 89,
        "attempt_cap": int(os.environ["ZERO_MAX_ATTEMPTS"]),
        "completed_optimizer_attempts": completed_attempts,
        "completed_committed_updates": committed,
        "acceptance_rate": committed / completed_attempts
        if completed_attempts
        else None,
        "sentinel_evaluations": count("sentinel-quantity"),
        "full_evaluations": count("full-quantity"),
        "promotion_evaluations": 0,
        "timing_seconds": {
            "driver_total": max(
                0,
                int(os.environ["ZERO_DRIVER_FINISHED_EPOCH"])
                - int(os.environ["ZERO_DRIVER_STARTED_EPOCH"]),
            ),
            "baseline_sentinel_replay": elapsed("baseline-sentinel-replay"),
            "baseline_full_replay": elapsed("baseline-full-replay"),
            "optimizer_transactions": elapsed("optimizer-transaction"),
            "recovery_checkpoints": elapsed("recovery-checkpoint"),
            "sentinel_quantity": elapsed("sentinel-quantity"),
            "sentinel_replay": elapsed("sentinel-replay"),
            "full_quantity": elapsed("full-quantity"),
            "full_replay": elapsed("full-replay"),
            "attempt_log_verification": elapsed("attempt-log-verification"),
        },
        "event_count": len(events),
    }

driver_exit = int(os.environ["ZERO_DRIVER_EXIT"])
if os.environ["ZERO_BACKEND"] != "OpenBLAS":
    status = "infrastructure-error"
elif driver_exit in (124, 137, 143):
    status = "budget-exhausted"
elif driver_exit != 0:
    status = "infrastructure-error"
elif driver.get("status") == "complete":
    status = "complete"
else:
    status = "insufficient-cadence"

attempts = int(driver.get("completed_optimizer_attempts", 0))
committed = int(driver.get("completed_committed_updates", 0))
timing = driver.get("timing_seconds", {})
sentinel_count = int(driver.get("sentinel_evaluations", 0))
full_count = int(driver.get("full_evaluations", 0))
acceptance_rate = committed / attempts if attempts else None
hourly_rate = float(os.environ["ZERO_HOURLY_RATE_USD"])
cold_start = max(
    0,
    int(os.environ["ZERO_DRIVER_STARTED_EPOCH"])
    - int(os.environ["ZERO_LAUNCH_EPOCH"]),
)

projection = {
    "target_optimizer_attempts_per_seed": 1400,
    "target_seed_count": 2,
    "method": (
        "component extrapolation from diagnostic acquisition attempts; "
        "committed-update evaluation counts use the observed acceptance rate; "
        "finalization allowance equals one observed full quantity evaluation"
    ),
    "available": False,
}
if attempts and sentinel_count and full_count:
    target_attempts = 1400
    target_committed = target_attempts * acceptance_rate
    projected_sentinel_count = math.floor(target_committed / 25)
    projected_full_count = math.floor(target_committed / 100)
    baseline_seconds = (
        float(timing.get("baseline_sentinel_replay", 0))
        + float(timing.get("baseline_full_replay", 0))
    )
    optimizer_seconds = (
        float(timing.get("optimizer_transactions", 0))
        * target_attempts
        / attempts
    )
    sentinel_seconds = (
        (
            float(timing.get("recovery_checkpoints", 0))
            + float(timing.get("sentinel_quantity", 0))
            + float(timing.get("sentinel_replay", 0))
        )
        / sentinel_count
        * projected_sentinel_count
    )
    full_seconds = (
        (
            float(timing.get("full_quantity", 0))
            + float(timing.get("full_replay", 0))
        )
        / full_count
        * projected_full_count
    )
    finalization_seconds = float(timing.get("full_quantity", 0)) / full_count
    verification_seconds = float(timing.get("attempt_log_verification", 0))
    observed_timed = sum(float(value) for key, value in timing.items() if key != "driver_total")
    fixed_driver_overhead = max(
        0,
        float(timing.get("driver_total", 0)) - observed_timed,
    )
    per_seed_seconds = (
        cold_start
        + baseline_seconds
        + optimizer_seconds
        + sentinel_seconds
        + full_seconds
        + finalization_seconds
        + verification_seconds
        + fixed_driver_overhead
    )
    per_seed_compute = per_seed_seconds * hourly_rate / 3600
    projection.update({
        "available": True,
        "observed_acceptance_rate": acceptance_rate,
        "projected_committed_updates_per_seed": target_committed,
        "projected_sentinel_evaluations_per_seed": projected_sentinel_count,
        "projected_full_evaluations_per_seed": projected_full_count,
        "estimated_components_seconds_per_seed": {
            "cold_start_build_and_assets": cold_start,
            "baseline_evaluations": baseline_seconds,
            "optimizer_transactions": optimizer_seconds,
            "recovery_and_sentinel_evaluations": sentinel_seconds,
            "full_evaluations": full_seconds,
            "finalization_allowance": finalization_seconds,
            "attempt_log_verification": verification_seconds,
            "fixed_driver_overhead": fixed_driver_overhead,
        },
        "estimated_total_seconds_per_seed": per_seed_seconds,
        "estimated_compute_usd_per_seed": per_seed_compute,
        "estimated_total_seconds_two_seeds": per_seed_seconds * 2,
        "estimated_compute_usd_two_seeds": per_seed_compute * 2,
    })

launch_epoch = int(os.environ["ZERO_LAUNCH_EPOCH"])
finished_epoch = int(os.environ["ZERO_FINISHED_EPOCH"])
result = {
    "schema": "zero.q26_e2e_calibration_result.v1",
    "id": "openblas-e2e-calibration-v1",
    "status": status,
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "scientific_inference_allowed": False,
    "venue": {
        "provider": "aws",
        "region": os.environ["AWS_DEFAULT_REGION"],
        "instance_type": "c6i.4xlarge",
        "backend": os.environ["ZERO_BACKEND"],
        "openblas_threads": 16,
        "on_demand_usd_per_hour": hourly_rate,
    },
    "budget": {
        "max_instance_seconds": int(os.environ["ZERO_MAX_INSTANCE_SECONDS"]),
        "workload_timeout_seconds": int(os.environ["ZERO_WORKLOAD_TIMEOUT_SECONDS"]),
        "max_compute_usd": float(os.environ["ZERO_MAX_COMPUTE_USD"]),
    },
    "measurement": {
        "seed": 89,
        "attempt_cap": int(os.environ["ZERO_MAX_ATTEMPTS"]),
        "completed_optimizer_attempts": attempts,
        "completed_committed_updates": committed,
        "acceptance_rate": acceptance_rate,
        "sentinel_evaluations": sentinel_count,
        "full_evaluations": full_count,
        "promotion_evaluations": int(driver.get("promotion_evaluations", 0)),
        "cold_start_build_and_assets_seconds": cold_start,
        "driver_wall_seconds": max(
            0,
            int(os.environ["ZERO_DRIVER_FINISHED_EPOCH"])
            - int(os.environ["ZERO_DRIVER_STARTED_EPOCH"]),
        ),
        "total_observed_instance_seconds": max(0, finished_epoch - launch_epoch),
        "driver_exit_code": driver_exit,
        "timing_seconds": timing,
    },
    "projection": projection,
}
with open(os.environ["ZERO_RESULT_FILE"], "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
remote_status = {
    "schema": "zero.aws_q26_e2e_calibration_status.v1",
    "status": status,
    "exit_code": driver_exit,
    "started_at": result["started_at"],
    "finished_at": result["finished_at"],
    "git_commit": result["git_commit"],
    "budget_sha256": result["budget_sha256"],
    "scientific_inference_allowed": False,
    "result": "results/result.json",
}
with open(os.environ["ZERO_STATUS_FILE"], "w", encoding="utf-8") as handle:
    json.dump(remote_status, handle, indent=2)
    handle.write("\n")
PY

case "$(jq -r .status "$RESULT_FILE")" in
  complete|budget-exhausted|insufficient-cadence) ;;
  *) exit 1 ;;
esac
echo "Q2.6 end-to-end calibration $(jq -r .status "$RESULT_FILE")"

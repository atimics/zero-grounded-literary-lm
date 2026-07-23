#!/bin/bash
# Run the diagnostic-only parallel quantity-evaluator AWS calibration.

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

RESULTS_ROOT=/tmp/zero-parallel-quantity-eval-calibration
STATUS_FILE="$RESULTS_ROOT/status.json"
RESULT_FILE="$RESULTS_ROOT/result.json"
MEASUREMENTS_FILE="$RESULTS_ROOT/measurements.json"
WORKLOAD_LOG=/var/log/zero-parallel-quantity-eval-calibration.log
MODEL=benchmarks/zero4-q26-v1/seed2/selected.litq8
SENTINEL=corpus/faculty/q22/quantity-request.sentinel.tsv
PUBLIC=corpus/faculty/q22/quantity-request.public.tsv
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT"
printf '{}\n' > "$MEASUREMENTS_FILE"
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
    "schema": "zero.quantity_eval_calibration_result.v1",
    "id": "parallel-quantity-eval-calibration-v1",
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
    "schema": "zero.aws_quantity_eval_calibration_status.v1",
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
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-parallel-quantity-eval-calibration.log" \
    --no-cli-pager
  # Root status is the observer's permission to terminate. Publish it last.
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
    "schema": "zero.aws_quantity_eval_calibration_heartbeat.v1",
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
with open("/tmp/zero-parallel-quantity-eval-heartbeat.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
  aws s3 cp /tmp/zero-parallel-quantity-eval-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/heartbeat.json" \
    --no-cli-pager
}

record_measurement() {
  name=$1
  cases=$2
  jobs=$3
  seconds=$4
  output=$5
  output_sha256=$(sha256sum "$output" | awk '{print $1}')
  ZERO_MEASUREMENT_NAME="$name" ZERO_CASES="$cases" ZERO_JOBS="$jobs" \
    ZERO_SECONDS="$seconds" ZERO_OUTPUT_SHA256="$output_sha256" \
    ZERO_MEASUREMENTS_FILE="$MEASUREMENTS_FILE" python3 - <<'PY'
import json
import os

path = os.environ["ZERO_MEASUREMENTS_FILE"]
with open(path, encoding="utf-8") as handle:
    measurements = json.load(handle)
cases = int(os.environ["ZERO_CASES"])
seconds = float(os.environ["ZERO_SECONDS"])
measurements[os.environ["ZERO_MEASUREMENT_NAME"]] = {
    "cases": cases,
    "jobs": int(os.environ["ZERO_JOBS"]),
    "wall_seconds": seconds,
    "cases_per_second": cases / seconds,
    "json_sha256": os.environ["ZERO_OUTPUT_SHA256"],
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(measurements, handle, indent=2)
    handle.write("\n")
PY
}

run_evaluation() {
  name=$1
  data=$2
  cases=$3
  jobs=$4
  output="$RESULTS_ROOT/${name}.json"
  PHASE="$name"
  publish_heartbeat
  now=$(date +%s)
  remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - now))
  if [ "$remaining" -le 0 ]; then
    DRIVER_EXIT=124
    return 1
  fi
  started_ns=$(date +%s%N)
  set +e
  timeout --signal=TERM --kill-after=10s "${remaining}s" \
    ./quantity_request_eval "$MODEL" "$data" \
      --json "$output" --limit "$cases" --jobs "$jobs"
  evaluation_exit=$?
  set -e
  finished_ns=$(date +%s%N)
  if [ "$evaluation_exit" -ne 0 ]; then
    DRIVER_EXIT="$evaluation_exit"
    return 1
  fi
  seconds=$(python3 -c \
    'import sys; print((int(sys.argv[2]) - int(sys.argv[1])) / 1_000_000_000)' \
    "$started_ns" "$finished_ns")
  record_measurement "$name" "$cases" "$jobs" "$seconds" "$output"
}

classify_exit() {
  case "$1" in
    124|137|143) echo budget-exhausted ;;
    *) echo infrastructure-error ;;
  esac
}

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
node scripts/check_parallel_quantity_eval_budget.mjs "$ZERO_BUDGET_FILE"
test "$(uname -m)" = x86_64
test "$(nproc)" = 16

PHASE=build
publish_heartbeat
LITERARY_BACKEND=portable make -j16 quantity_request_eval

PHASE=corpus
publish_heartbeat
node scripts/generate_zero4_q2.mjs \
  --out corpus/faculty/q22 --quantity 10000 --seed 5 \
  --request-mode operation
node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q22
test "$(($(wc -l < "$SENTINEL") - 1))" = 64
test "$(($(wc -l < "$PUBLIC") - 1))" = 500

PHASE=warmup
publish_heartbeat
./quantity_request_eval "$MODEL" "$SENTINEL" \
  --json "$RESULTS_ROOT/warmup.json" --limit 1 --jobs 1 >/dev/null
MEASUREMENT_STARTED_EPOCH=$(date +%s)

DRIVER_EXIT=0
RUN_STATUS=complete
if ! run_evaluation sentinel_serial "$SENTINEL" 64 1; then
  RUN_STATUS=$(classify_exit "$DRIVER_EXIT")
elif ! run_evaluation sentinel_parallel "$SENTINEL" 64 16; then
  RUN_STATUS=$(classify_exit "$DRIVER_EXIT")
elif ! cmp "$RESULTS_ROOT/sentinel_serial.json" \
    "$RESULTS_ROOT/sentinel_parallel.json"; then
  RUN_STATUS=infrastructure-error
  DRIVER_EXIT=1
elif ! run_evaluation public_serial "$PUBLIC" 500 1; then
  RUN_STATUS=$(classify_exit "$DRIVER_EXIT")
elif ! run_evaluation public_parallel "$PUBLIC" 500 16; then
  RUN_STATUS=$(classify_exit "$DRIVER_EXIT")
elif ! cmp "$RESULTS_ROOT/public_serial.json" \
    "$RESULTS_ROOT/public_parallel.json"; then
  RUN_STATUS=infrastructure-error
  DRIVER_EXIT=1
fi

PHASE=publication
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
ZERO_FINISHED_AT="$finished_at" ZERO_FINISHED_EPOCH="$finished_epoch" \
  ZERO_RESULT_FILE="$RESULT_FILE" ZERO_STATUS_FILE="$STATUS_FILE" \
  ZERO_STARTED_AT="$STARTED_AT" ZERO_RUN_STATUS="$RUN_STATUS" \
  ZERO_DRIVER_EXIT="$DRIVER_EXIT" \
  ZERO_MEASUREMENT_STARTED_EPOCH="$MEASUREMENT_STARTED_EPOCH" \
  ZERO_MEASUREMENTS_FILE="$MEASUREMENTS_FILE" python3 - <<'PY'
import json
import math
import os

with open(os.environ["ZERO_MEASUREMENTS_FILE"], encoding="utf-8") as handle:
    evaluations = json.load(handle)
with open(
    "benchmarks/openblas-e2e-calibration-v1/result-30023119249.json",
    encoding="utf-8",
) as handle:
    prior = json.load(handle)

status = os.environ["ZERO_RUN_STATUS"]
hourly_rate = float(os.environ["ZERO_HOURLY_RATE_USD"])
launch_epoch = int(os.environ["ZERO_LAUNCH_EPOCH"])
finished_epoch = int(os.environ["ZERO_FINISHED_EPOCH"])
measurement_started = int(os.environ["ZERO_MEASUREMENT_STARTED_EPOCH"])
measurement = {
    "warmup_cases": 1,
    "promotion_evaluations": 0,
    "optimizer_attempts": 0,
    "cold_start_build_and_generation_seconds": max(
        0, measurement_started - launch_epoch
    ),
    "total_observed_instance_seconds": max(0, finished_epoch - launch_epoch),
    "driver_exit_code": int(os.environ["ZERO_DRIVER_EXIT"]),
    "evaluations": evaluations,
}
projection = {
    "available": False,
    "target_optimizer_attempts_per_seed": 1400,
    "target_seed_count": 2,
}

if status == "complete":
    sentinel_serial = evaluations["sentinel_serial"]
    sentinel_parallel = evaluations["sentinel_parallel"]
    public_serial = evaluations["public_serial"]
    public_parallel = evaluations["public_parallel"]
    sentinel_parity = (
        sentinel_serial["json_sha256"] == sentinel_parallel["json_sha256"]
    )
    public_parity = public_serial["json_sha256"] == public_parallel["json_sha256"]
    measurement["parity"] = {
        "sentinel": sentinel_parity,
        "public": public_parity,
    }
    measurement["speedup"] = {
        "sentinel": (
            sentinel_serial["wall_seconds"] / sentinel_parallel["wall_seconds"]
        ),
        "public": public_serial["wall_seconds"] / public_parallel["wall_seconds"],
    }
    if not sentinel_parity or not public_parity:
        status = "infrastructure-error"
        measurement["driver_exit_code"] = 1
    else:
        prior_timing = prior["measurement"]["timing_seconds"]
        projected_sentinel_count = 56
        projected_full_count = 14
        components = {
            "cold_start_build_and_assets": prior["measurement"][
                "cold_start_build_and_assets_seconds"
            ],
            "baseline_replay_evaluations": (
                prior_timing["baseline_sentinel_replay"]
                + prior_timing["baseline_full_replay"]
            ),
            "optimizer_transactions": (
                prior_timing["optimizer_transactions"] * 14
            ),
            "recovery_checkpoints": (
                prior_timing["recovery_checkpoints"] / 4
                * projected_sentinel_count
            ),
            "sentinel_quantity_evaluations": (
                sentinel_parallel["wall_seconds"] * projected_sentinel_count
            ),
            "sentinel_replay_evaluations": (
                prior_timing["sentinel_replay"] / 4
                * projected_sentinel_count
            ),
            "full_quantity_evaluations": (
                public_parallel["wall_seconds"] * projected_full_count
            ),
            "full_replay_evaluations": (
                prior_timing["baseline_full_replay"] * projected_full_count
            ),
            "finalization_quantity_allowance": public_parallel["wall_seconds"],
            "fixed_driver_and_publication_allowance": 60,
        }
        per_seed_seconds = sum(components.values())
        per_seed_compute = per_seed_seconds * hourly_rate / 3600
        suggested_seconds = math.ceil(per_seed_seconds * 1.2 / 60) * 60
        suggested_compute = (
            math.ceil(suggested_seconds * hourly_rate / 3600 * 100) / 100
        )
        projection = {
            "available": True,
            "method": (
                "component projection using the prior 100-attempt Q2.6 "
                "end-to-end calibration with measured parallel quantity "
                "evaluation substituted at 56 sentinel, 14 full, and one "
                "finalization evaluation per seed"
            ),
            "target_optimizer_attempts_per_seed": 1400,
            "target_seed_count": 2,
            "projected_sentinel_evaluations_per_seed": projected_sentinel_count,
            "projected_full_evaluations_per_seed": projected_full_count,
            "estimated_components_seconds_per_seed": components,
            "estimated_total_seconds_per_seed": per_seed_seconds,
            "estimated_compute_usd_per_seed": per_seed_compute,
            "estimated_total_seconds_two_seeds": per_seed_seconds * 2,
            "estimated_compute_usd_two_seeds": per_seed_compute * 2,
            "suggested_budget_seconds_per_seed_with_20_percent_contingency": (
                suggested_seconds
            ),
            "suggested_budget_usd_per_seed_with_20_percent_contingency": (
                suggested_compute
            ),
            "suggested_budget_seconds_two_seeds_with_20_percent_contingency": (
                suggested_seconds * 2
            ),
            "suggested_budget_usd_two_seeds_with_20_percent_contingency": (
                suggested_compute * 2
            ),
        }

result = {
    "schema": "zero.quantity_eval_calibration_result.v1",
    "id": "parallel-quantity-eval-calibration-v1",
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
        "cpu_architecture": "x86_64",
        "online_vcpus": 16,
        "quantity_backend": "portable-quantized-inference",
        "on_demand_usd_per_hour": hourly_rate,
    },
    "budget": {
        "max_instance_seconds": int(os.environ["ZERO_MAX_INSTANCE_SECONDS"]),
        "workload_timeout_seconds": int(
            os.environ["ZERO_WORKLOAD_TIMEOUT_SECONDS"]
        ),
        "max_compute_usd": float(os.environ["ZERO_MAX_COMPUTE_USD"]),
    },
    "measurement": measurement,
    "projection": projection,
}
with open(os.environ["ZERO_RESULT_FILE"], "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
remote_status = {
    "schema": "zero.aws_quantity_eval_calibration_status.v1",
    "status": status,
    "exit_code": measurement["driver_exit_code"],
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
  complete|budget-exhausted) ;;
  *) exit 1 ;;
esac
echo "Parallel quantity-evaluator calibration $(jq -r .status "$RESULT_FILE")"

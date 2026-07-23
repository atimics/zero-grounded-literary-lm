#!/bin/bash
# Run the diagnostic-only Q2.6 OpenBLAS pilot.

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

RESULTS_ROOT=/tmp/zero-openblas-pilot
STATUS_FILE="$RESULTS_ROOT/status.json"
RESULT_FILE="$RESULTS_ROOT/result.json"
TRAIN_LOG="$RESULTS_ROOT/training.log"
BACKEND_LOG="$RESULTS_ROOT/backend.log"
ATTEMPT_LOG="$RESULTS_ROOT/optimizer-attempts.jsonl"
WORKLOAD_LOG=/var/log/zero-openblas-pilot.log
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT"
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
    "schema": "zero.openblas_pilot_result.v1",
    "id": "openblas-pilot-v1",
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
    "schema": "zero.aws_openblas_pilot_status.v1",
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
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-openblas-pilot.log" \
    --no-cli-pager
  # Publish root status last. The observer treats its presence as permission to
  # terminate the instance, so every required result must already be durable.
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
    "schema": "zero.aws_openblas_pilot_heartbeat.v1",
    "status": "running",
    "phase": os.environ["ZERO_PHASE"],
    "at": os.environ["ZERO_HEARTBEAT_AT"],
    "elapsed_instance_seconds": max(
        0, int(os.environ["ZERO_HEARTBEAT_EPOCH"]) - int(os.environ["ZERO_LAUNCH_EPOCH"])
    ),
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
}
with open("/tmp/zero-openblas-heartbeat.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
  aws s3 cp /tmp/zero-openblas-heartbeat.json \
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
node scripts/check_experiment_budget.mjs \
  "$ZERO_BUDGET_FILE" --stage pilot

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
make -j16 literary_lm
node scripts/check_zero4_q26.mjs --self-test
node scripts/train_zero4_q26.mjs --self-test
./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
  --text corpus/zero-foundation.txt --steps 0 --tokens 0 \
  | tee "$BACKEND_LOG"

python3 - <<'PY'
import hashlib
import json
from pathlib import Path

contract = json.load(open("benchmarks/zero4-q26-v1/contract.json", encoding="utf-8"))
checks = {
    **contract["immutable_teachers"],
}
teacher_paths = {
    "zero1": "teachers/zero1-foundation.teacher",
    "zero2": "teachers/zero2-literary.teacher",
    "zero3": "teachers/zero3-balanced-final.teacher",
}
for teacher, expected in checks.items():
    actual = hashlib.sha256(Path(teacher_paths[teacher]).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"{teacher} teacher hash mismatch")
for filename, expected in contract["replay_corpus"].items():
    actual = hashlib.sha256(Path(filename).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"replay corpus hash mismatch: {filename}")
quantity = contract["quantity_corpus"]
quantity_paths = {
    "manifest_sha256": "corpus/faculty/q22/manifest.json",
    "tokens_sha256": "corpus/faculty/q22/quantity-request.tok",
    "sentinel_sha256": "corpus/faculty/q22/quantity-request.sentinel.tsv",
    "public_sha256": "corpus/faculty/q22/quantity-request.public.tsv",
    "promotion_sha256": "corpus/faculty/q22/quantity-request.promotion.tsv",
}
for field, filename in quantity_paths.items():
    actual = hashlib.sha256(Path(filename).read_bytes()).hexdigest()
    if actual != quantity[field]:
        raise SystemExit(f"quantity corpus hash mismatch: {filename}")
PY

PHASE=measurement
publish_heartbeat
TRAINING_STARTED_EPOCH=$(date +%s)
remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - TRAINING_STARTED_EPOCH))
train_exit=124
if [ "$remaining" -gt 0 ]; then
  set +e
  timeout --signal=TERM --kill-after=10s "${remaining}s" \
    stdbuf -oL -eL ./literary_lm \
      --init teachers/zero3-balanced-final.teacher \
      --teacher teachers/zero2-literary.teacher --teacher-weight 0.20 \
      --teacher teachers/zero3-balanced-final.teacher --teacher-weight 0.20 \
      --zero1-teacher teachers/zero1-foundation.teacher --zero1-weight 0.25 \
      --tokenizer corpus/literary.bpe \
      --foundation corpus/bpe/zero-foundation.tok \
        --sample-weight 1 --distill 0.25,0.05,0.10 \
      --text corpus/bpe/shakespeare.tok \
        --sample-weight 1 --distill 0,0.20,0.15 \
      --text corpus/bpe/blake.tok \
        --sample-weight 1 --distill 0,0.20,0.15 \
      --text corpus/bpe/crowley.tok \
        --sample-weight 1 --distill 0,0.20,0.15 \
      --text corpus/bpe/bible-kjv.tok \
        --sample-weight 1 --distill 0,0.20,0.15 \
      --channel corpus/channel/literary-dialogue.tok \
        --sample-weight 1 --distill 0,0.10,0.20 \
      --hard-channel corpus/faculty/q22/quantity-request.tok \
        --sample-weight 4 \
      --steps "$ZERO_MAX_ATTEMPTS" --batch 2 --lr 0.00002 --warmup 100 --dropout 0.02 \
      --cosine --schedule-total 1000 --report 8 --validation 56 \
      --patience 0 --seed 89 --save "$RESULTS_ROOT/active.ckpt" \
      --tokens 0 --transaction-mode cumulative-tangent \
      --transaction-log "$ATTEMPT_LOG" \
      --transaction-phase acquisition --transaction-probe 1 \
      --transaction-budget 0.015 --transaction-max-rejections 8 \
    2>&1 | tee "$TRAIN_LOG"
  train_exit=${PIPESTATUS[0]}
  set -e
fi
TRAINING_FINISHED_EPOCH=$(date +%s)

backend=unknown
if grep -q "literary_lm: backend=OpenBLAS" "$BACKEND_LOG" 2>/dev/null \
    || grep -q "literary_lm: backend=OpenBLAS" "$TRAIN_LOG" 2>/dev/null; then
  backend=OpenBLAS
fi
attempts=0
if [ -s "$ATTEMPT_LOG" ]; then
  attempts=$(grep -cve '^[[:space:]]*$' "$ATTEMPT_LOG")
  node scripts/check_zero4_q26.mjs \
    benchmarks/zero4-q26-v1/contract.json "$ATTEMPT_LOG"
fi

status=infrastructure-error
case "$train_exit" in
  0) status=complete ;;
  124|137|143) status=budget-exhausted ;;
esac
if [ "$backend" != OpenBLAS ]; then
  status=infrastructure-error
fi

PHASE=publication
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
ZERO_ATTEMPTS="$attempts" ZERO_BACKEND="$backend" ZERO_FINISHED_AT="$finished_at" \
  ZERO_FINISHED_EPOCH="$finished_epoch" ZERO_STATUS="$status" \
  ZERO_TRAIN_EXIT="$train_exit" ZERO_TRAINING_STARTED_EPOCH="$TRAINING_STARTED_EPOCH" \
  ZERO_TRAINING_FINISHED_EPOCH="$TRAINING_FINISHED_EPOCH" \
  ZERO_RESULT_FILE="$RESULT_FILE" ZERO_STATUS_FILE="$STATUS_FILE" \
  ZERO_STARTED_AT="$STARTED_AT" python3 - <<'PY'
import json
import os

attempts = int(os.environ["ZERO_ATTEMPTS"])
launch_epoch = int(os.environ["ZERO_LAUNCH_EPOCH"])
finished_epoch = int(os.environ["ZERO_FINISHED_EPOCH"])
training_started = int(os.environ["ZERO_TRAINING_STARTED_EPOCH"])
training_finished = int(os.environ["ZERO_TRAINING_FINISHED_EPOCH"])
measurement_seconds = max(0, training_finished - training_started)
hourly_rate = float(os.environ["ZERO_HOURLY_RATE_USD"])
projected_seconds = measurement_seconds * 1400 / attempts if attempts else None
projected_cost = projected_seconds * hourly_rate / 3600 if projected_seconds else None

result = {
    "schema": "zero.openblas_pilot_result.v1",
    "id": "openblas-pilot-v1",
    "status": os.environ["ZERO_STATUS"],
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
        "training_wall_seconds": measurement_seconds,
        "cold_start_seconds": max(0, training_started - launch_epoch),
        "total_observed_instance_seconds": max(0, finished_epoch - launch_epoch),
        "training_exit_code": int(os.environ["ZERO_TRAIN_EXIT"]),
        "attempts_per_second": attempts / measurement_seconds
        if attempts and measurement_seconds
        else None,
    },
    "projection": {
        "target_optimizer_attempts": 1400,
        "estimated_wall_seconds": projected_seconds,
        "estimated_compute_usd": projected_cost,
        "method": "linear extrapolation from completed diagnostic attempts; excludes cold start",
    },
}
with open(os.environ["ZERO_RESULT_FILE"], "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
status = {
    "schema": "zero.aws_openblas_pilot_status.v1",
    "status": result["status"],
    "exit_code": int(os.environ["ZERO_TRAIN_EXIT"]),
    "started_at": result["started_at"],
    "finished_at": result["finished_at"],
    "git_commit": result["git_commit"],
    "budget_sha256": result["budget_sha256"],
    "scientific_inference_allowed": False,
    "result": "results/result.json",
}
with open(os.environ["ZERO_STATUS_FILE"], "w", encoding="utf-8") as handle:
    json.dump(status, handle, indent=2)
    handle.write("\n")
PY

if [ "$status" = infrastructure-error ]; then
  exit 1
fi
echo "OpenBLAS pilot $status after $attempts completed optimizer attempts"

#!/bin/bash
# Run one frozen Q2.6-R seed inside its independently bounded AWS instance.

set -Eeuo pipefail

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_RUN_ID:?ZERO_RUN_ID is required}"
: "${ZERO_COMMIT:?ZERO_COMMIT is required}"
: "${ZERO_SEED:?ZERO_SEED is required}"
: "${ZERO_BUDGET_FILE:?ZERO_BUDGET_FILE is required}"
: "${ZERO_BUDGET_SHA256:?ZERO_BUDGET_SHA256 is required}"
: "${ZERO_LAUNCH_EPOCH:?ZERO_LAUNCH_EPOCH is required}"
: "${ZERO_WORKLOAD_DEADLINE_EPOCH:?ZERO_WORKLOAD_DEADLINE_EPOCH is required}"
: "${ZERO_HOURLY_RATE_USD:?ZERO_HOURLY_RATE_USD is required}"
: "${ZERO_MAX_COMPUTE_USD:?ZERO_MAX_COMPUTE_USD is required}"

RESULTS_ROOT="/tmp/zero-results/zero4-q26r-v1/seed${ZERO_SEED}"
STATUS_FILE="/tmp/zero-q26r-seed${ZERO_SEED}-status.json"
WORKLOAD_LOG="/var/log/zero-q26r-seed${ZERO_SEED}.log"
BACKEND_LOG="/tmp/zero-q26r-seed${ZERO_SEED}-backend.log"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT"
exec > >(tee -a "$WORKLOAD_LOG") 2>&1
set -x

classify_exit() {
  case "$1" in
    124|137|143) echo budget-exhausted ;;
    *) echo infrastructure-error ;;
  esac
}

write_fallback_status() {
  exit_code=$1
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  run_status=$(classify_exit "$exit_code")
  ZERO_EXIT_CODE="$exit_code" ZERO_FINISHED_AT="$finished_at" \
    ZERO_PHASE="$PHASE" ZERO_RUN_STATUS="$run_status" \
    ZERO_STARTED_AT="$STARTED_AT" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_q26r_seed_status.v1",
    "experiment": "zero4-q26r-aws-v1",
    "seed": int(os.environ["ZERO_SEED"]),
    "status": os.environ["ZERO_RUN_STATUS"],
    "phase": os.environ["ZERO_PHASE"],
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "scientific_result_available": False,
}
with open(os.environ["STATUS_FILE"], "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if [ ! -s "$STATUS_FILE" ]; then
    write_fallback_status "$exit_code"
  fi
  aws s3 sync "$RESULTS_ROOT/" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/results/" \
    --no-cli-pager
  aws s3 cp "$WORKLOAD_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/zero-q26r-seed${ZERO_SEED}.log" \
    --no-cli-pager
  # Status is the collector's durable completion signal. Publish it last.
  aws s3 cp "$STATUS_FILE" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/status.json" \
    --no-cli-pager
  exit "$exit_code"
}
export STATUS_FILE
trap finish EXIT

publish_heartbeat() {
  heartbeat_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  heartbeat_epoch=$(date +%s)
  ZERO_HEARTBEAT_AT="$heartbeat_at" ZERO_HEARTBEAT_EPOCH="$heartbeat_epoch" \
    ZERO_PHASE="$PHASE" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_q26r_seed_heartbeat.v1",
    "experiment": "zero4-q26r-aws-v1",
    "seed": int(os.environ["ZERO_SEED"]),
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
with open("/tmp/zero-q26r-heartbeat.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
  aws s3 cp /tmp/zero-q26r-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/heartbeat.json" \
    --no-cli-pager
}

case "$ZERO_SEED" in
  1|3) ;;
  *) echo "Q2.6-R accepts only seed 1 or 3; got $ZERO_SEED" >&2; exit 1 ;;
esac

export LITERARY_BACKEND=openblas
export OPENBLAS_NUM_THREADS=16
export OMP_NUM_THREADS=16
export ZERO_QUANTITY_JOBS=16

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
node scripts/check_q26r_aws_budget.mjs "$ZERO_BUDGET_FILE"
test "$(uname -m)" = x86_64
test "$(nproc)" = 16

PHASE=assets
publish_heartbeat
aws s3 sync "s3://${ZERO_BUCKET}/assets/teachers/" teachers/ \
  --exclude registry.json --no-cli-pager
aws s3 sync "s3://${ZERO_BUCKET}/assets/corpus/" corpus/ --no-cli-pager
python3 scripts/verify_teacher_artifacts.py
node scripts/generate_zero4_q2.mjs \
  --out corpus/faculty/q22 --quantity 10000 --seed 5 \
  --request-mode operation
node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q22

PHASE=build
publish_heartbeat
make -j16 literary_lm export_literary quantity_request_eval
node scripts/check_zero4_q26r.mjs --self-test
node scripts/train_zero4_q26.mjs --self-test
./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
  --text corpus/zero-foundation.txt --steps 0 --tokens 0 \
  | tee "$BACKEND_LOG"
grep -q "literary_lm: backend=OpenBLAS" "$BACKEND_LOG"

PHASE=scientific-run
publish_heartbeat
now=$(date +%s)
remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - now))
if [ "$remaining" -le 0 ]; then
  exit 124
fi
set +e
timeout --signal=TERM --kill-after=15s "${remaining}s" \
  stdbuf -oL -eL node scripts/train_zero4_q26.mjs \
    --prefix "/tmp/zero4-q26r-seed${ZERO_SEED}" \
    --out "$RESULTS_ROOT" \
    --data corpus/faculty/q22 \
    --replication-contract benchmarks/zero4-q26r-v1/contract.json \
    --steps 1000 \
    --consolidation-steps 400 \
    --batch 2 \
    --seed "$ZERO_SEED" \
    --recovery-every 25 \
    --full-every 100 \
    --sentinel-replay-batches 12 \
    --full-replay-batches 48
driver_exit=$?
set -e
if [ "$driver_exit" -ne 0 ]; then
  exit "$driver_exit"
fi

PHASE=verification
publish_heartbeat
node scripts/check_zero4_q26r.mjs \
  benchmarks/zero4-q26r-v1/contract.json \
  "$RESULTS_ROOT/optimizer-attempts.jsonl" \
  "$RESULTS_ROOT/result.json"

PHASE=publication
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
result_sha256=$(sha256sum "$RESULTS_ROOT/result.json" | awk '{print $1}')
decision=$(jq -r '.decision' "$RESULTS_ROOT/result.json")
case "$decision" in
  go|no-go) ;;
  *) echo "Invalid Q2.6-R decision: $decision" >&2; exit 1 ;;
esac
ZERO_FINISHED_AT="$finished_at" ZERO_FINISHED_EPOCH="$finished_epoch" \
  ZERO_RESULT_SHA256="$result_sha256" ZERO_DECISION="$decision" \
  ZERO_STARTED_AT="$STARTED_AT" python3 - <<'PY'
import json
import os

launch_epoch = int(os.environ["ZERO_LAUNCH_EPOCH"])
finished_epoch = int(os.environ["ZERO_FINISHED_EPOCH"])
hourly_rate = float(os.environ["ZERO_HOURLY_RATE_USD"])
elapsed = max(0, finished_epoch - launch_epoch)
record = {
    "schema": "zero.aws_q26r_seed_status.v1",
    "experiment": "zero4-q26r-aws-v1",
    "seed": int(os.environ["ZERO_SEED"]),
    "status": "complete",
    "phase": "publication",
    "exit_code": 0,
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "scientific_result_available": True,
    "decision": os.environ["ZERO_DECISION"],
    "result_sha256": os.environ["ZERO_RESULT_SHA256"],
    "observed_instance_seconds": elapsed,
    "observed_compute_usd": elapsed * hourly_rate / 3600,
    "max_instance_seconds": 13620,
    "max_compute_usd": float(os.environ["ZERO_MAX_COMPUTE_USD"]),
    "training_backend": "OpenBLAS",
    "openblas_threads": 16,
    "quantity_evaluator_jobs": 16,
}
with open(os.environ["STATUS_FILE"], "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY

echo "Q2.6-R seed $ZERO_SEED completed with decision $decision"

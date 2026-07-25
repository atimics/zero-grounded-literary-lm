#!/bin/bash
# Run the one-time Q2.7 seed-2 quantity stage inside a bounded AWS instance.

set -Eeuo pipefail

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_RUN_ID:?ZERO_RUN_ID is required}"
: "${ZERO_COMMIT:?ZERO_COMMIT is required}"
: "${ZERO_INSTANCE_ID:?ZERO_INSTANCE_ID is required}"
: "${ZERO_BUDGET_FILE:?ZERO_BUDGET_FILE is required}"
: "${ZERO_BUDGET_SHA256:?ZERO_BUDGET_SHA256 is required}"
: "${ZERO_SOURCE_SHA256:?ZERO_SOURCE_SHA256 is required}"
: "${ZERO_LAUNCH_EPOCH:?ZERO_LAUNCH_EPOCH is required}"
: "${ZERO_WORKLOAD_DEADLINE_EPOCH:?ZERO_WORKLOAD_DEADLINE_EPOCH is required}"
: "${ZERO_HOURLY_RATE_USD:?ZERO_HOURLY_RATE_USD is required}"
: "${ZERO_MAX_INSTANCE_SECONDS:?ZERO_MAX_INSTANCE_SECONDS is required}"
: "${ZERO_MAX_COMPUTE_USD:?ZERO_MAX_COMPUTE_USD is required}"

RESULTS_ROOT=/tmp/zero-results/zero4-q27-v1/seed2
STATUS_FILE=/tmp/zero-q27-seed2-status.json
WORKLOAD_LOG=/var/log/zero-q27-seed2.log
BACKEND_LOG=/tmp/zero-q27-backend.log
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

write_failure_status() {
  exit_code=$1
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  finished_epoch=$(date +%s)
  status=$(classify_exit "$exit_code")
  jq -n \
    --arg status "$status" \
    --arg phase "$PHASE" \
    --arg instance_id "$ZERO_INSTANCE_ID" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    --arg started_at "$STARTED_AT" \
    --arg finished_at "$finished_at" \
    --argjson exit_code "$exit_code" \
    --argjson observed_instance_seconds \
      "$((finished_epoch - ZERO_LAUNCH_EPOCH))" \
    --argjson max_instance_seconds "$ZERO_MAX_INSTANCE_SECONDS" \
    --argjson max_compute_usd "$ZERO_MAX_COMPUTE_USD" \
    '{
      schema: "zero.aws_q27_seed2_status.v1",
      experiment: "zero4-q27-aws-v1",
      seed: 2,
      status: $status,
      phase: $phase,
      instance_id: $instance_id,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256,
      started_at: $started_at,
      finished_at: $finished_at,
      exit_code: $exit_code,
      scientific_result_available: false,
      scientific_decision: null,
      result_sha256: null,
      observed_instance_seconds: $observed_instance_seconds,
      max_instance_seconds: $max_instance_seconds,
      max_compute_usd: $max_compute_usd
    }' > "$STATUS_FILE"
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if [ ! -s "$STATUS_FILE" ]; then
    write_failure_status "$exit_code"
  fi
  publication_exit=0
  aws s3 sync "$RESULTS_ROOT/" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed2/results/" \
    --exclude 'recovery/*' --no-cli-pager || publication_exit=$?
  aws s3 cp "$WORKLOAD_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed2/zero-q27-seed2.log" \
    --no-cli-pager || publication_exit=$?
  if [ "$exit_code" -eq 0 ] && [ "$publication_exit" -ne 0 ]; then
    PHASE=publication
    write_failure_status "$publication_exit"
  fi
  aws s3api put-object \
    --bucket "$ZERO_BUCKET" \
    --key "jobs/${ZERO_RUN_ID}/seed2/status.json" \
    --body "$STATUS_FILE" \
    --content-type application/json \
    --if-none-match '*' \
    --no-cli-pager >/dev/null || publication_exit=$?
  if [ "$exit_code" -eq 0 ] && [ "$publication_exit" -ne 0 ]; then
    exit "$publication_exit"
  fi
  exit "$exit_code"
}
trap finish EXIT

heartbeat() {
  now=$(date +%s)
  jq -n \
    --arg phase "$PHASE" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg instance_id "$ZERO_INSTANCE_ID" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    --argjson elapsed_instance_seconds "$((now - ZERO_LAUNCH_EPOCH))" \
    '{
      schema: "zero.aws_q27_seed2_heartbeat.v1",
      experiment: "zero4-q27-aws-v1",
      seed: 2,
      status: "running",
      phase: $phase,
      at: $at,
      elapsed_instance_seconds: $elapsed_instance_seconds,
      instance_id: $instance_id,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256
    }' > /tmp/zero-q27-heartbeat.json
  aws s3 cp /tmp/zero-q27-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed2/heartbeat.json" \
    --no-cli-pager
}

PHASE=source
heartbeat
install -d -m 0755 /tmp/zero
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/source.tar.gz" \
  /tmp/zero-source.tar.gz --no-cli-pager
test "$(sha256sum /tmp/zero-source.tar.gz | awk '{print $1}')" = \
  "$ZERO_SOURCE_SHA256"
tar -xzf /tmp/zero-source.tar.gz -C /tmp/zero
cd /tmp/zero
test "$(sha256sum "$ZERO_BUDGET_FILE" | awk '{print $1}')" = \
  "$ZERO_BUDGET_SHA256"
node scripts/check_q27_aws_budget.mjs \
  "$ZERO_BUDGET_FILE" --require-authorized
test "$(uname -m)" = x86_64
test "$(nproc)" = 16

export LITERARY_BACKEND=openblas
export OPENBLAS_NUM_THREADS=16
export OMP_NUM_THREADS=16
export ZERO_QUANTITY_JOBS=16

PHASE=assets
heartbeat
aws s3 sync "s3://${ZERO_BUCKET}/assets/corpus/" corpus/ --no-cli-pager
python3 scripts/verify_teacher_artifacts.py
node scripts/generate_zero4_q2.mjs \
  --out corpus/faculty/q22 --quantity 10000 --seed 5 \
  --request-mode operation
node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q22

PHASE=build
heartbeat
make -j16 literary_lm export_literary quantity_request_eval
node scripts/train_zero4_q27.mjs --self-test
make zero4-q27-check
./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
  --text corpus/zero-foundation.txt --steps 0 --tokens 0 |
  tee "$BACKEND_LOG"
grep -q "literary_lm: backend=OpenBLAS" "$BACKEND_LOG"

PHASE=scientific-run
heartbeat
remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - $(date +%s)))
[ "$remaining" -gt 0 ] || exit 124
set +e
timeout --signal=TERM --kill-after=15s "${remaining}s" \
  stdbuf -oL -eL node scripts/train_zero4_q27.mjs \
    --prefix /tmp/zero4-q27-seed2 \
    --out "$RESULTS_ROOT" \
    --data corpus/faculty/q22 \
    --budget "$ZERO_BUDGET_FILE" \
    --steps 1000 \
    --consolidation-steps 400 \
    --batch 2 \
    --seed 2 \
    --recovery-every 25 \
    --full-every 100 \
    --sentinel-replay-batches 12 \
    --full-replay-batches 48
driver_exit=$?
set -e
[ "$driver_exit" -eq 0 ] || exit "$driver_exit"

PHASE=verification
heartbeat
node scripts/check_zero4_q26.mjs \
  benchmarks/zero4-q26-v1/contract.json \
  "$RESULTS_ROOT/optimizer-attempts.jsonl"
node scripts/check_zero4_q27_result.mjs \
  "$RESULTS_ROOT/result.json" \
  benchmarks/zero4-q27-v1/contract.json \
  "$ZERO_BUDGET_FILE" \
  "$RESULTS_ROOT"

PHASE=publication
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
elapsed=$((finished_epoch - ZERO_LAUNCH_EPOCH))
decision=$(jq -r '.decision' "$RESULTS_ROOT/result.json")
case "$decision" in candidate-ready|no-go) ;; *) exit 1 ;; esac
result_sha256=$(sha256sum "$RESULTS_ROOT/result.json" | awk '{print $1}')
observed_compute_usd=$(awk -v seconds="$elapsed" \
  -v rate="$ZERO_HOURLY_RATE_USD" 'BEGIN { printf "%.12f", seconds*rate/3600 }')
jq -n \
  --arg instance_id "$ZERO_INSTANCE_ID" \
  --arg git_commit "$ZERO_COMMIT" \
  --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$finished_at" \
  --arg decision "$decision" \
  --arg result_sha256 "$result_sha256" \
  --argjson observed_instance_seconds "$elapsed" \
  --argjson observed_compute_usd "$observed_compute_usd" \
  --argjson max_instance_seconds "$ZERO_MAX_INSTANCE_SECONDS" \
  --argjson max_compute_usd "$ZERO_MAX_COMPUTE_USD" \
  '{
    schema: "zero.aws_q27_seed2_status.v1",
    experiment: "zero4-q27-aws-v1",
    seed: 2,
    status: "complete",
    phase: "publication",
    instance_id: $instance_id,
    git_commit: $git_commit,
    budget_sha256: $budget_sha256,
    started_at: $started_at,
    finished_at: $finished_at,
    exit_code: 0,
    scientific_result_available: true,
    scientific_decision: $decision,
    result_sha256: $result_sha256,
    observed_instance_seconds: $observed_instance_seconds,
    observed_compute_usd: $observed_compute_usd,
    max_instance_seconds: $max_instance_seconds,
    max_compute_usd: $max_compute_usd,
    training_backend: "OpenBLAS",
    openblas_threads: 16,
    quantity_evaluator_jobs: 16,
    language_gate_evaluated: false
  }' > "$STATUS_FILE"

echo "Q2.7 AWS seed 2 quantity stage completed with decision $decision"

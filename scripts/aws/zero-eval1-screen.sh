#!/bin/bash
# Run the one-time, bounded ZERO-EVAL-1 scientific screen on AWS.

set -Eeuo pipefail

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_RUN_ID:?ZERO_RUN_ID is required}"
: "${ZERO_COMMIT:?ZERO_COMMIT is required}"
: "${ZERO_BUDGET_FILE:?ZERO_BUDGET_FILE is required}"
: "${ZERO_BUDGET_SHA256:?ZERO_BUDGET_SHA256 is required}"
: "${ZERO_SOURCE_ARCHIVE_SHA256:?ZERO_SOURCE_ARCHIVE_SHA256 is required}"
: "${ZERO_SCREEN_ARCHIVE_SHA256:?ZERO_SCREEN_ARCHIVE_SHA256 is required}"
: "${ZERO_LAUNCH_EPOCH:?ZERO_LAUNCH_EPOCH is required}"
: "${ZERO_WORKLOAD_DEADLINE_EPOCH:?ZERO_WORKLOAD_DEADLINE_EPOCH is required}"

RESULTS_ROOT=/tmp/zero-eval1-screen-results
STATUS_FILE=/tmp/zero-eval1-screen-status.json
RESULT_FILE="$RESULTS_ROOT/result.json"
WORKLOAD_LOG=/var/log/zero-eval1-screen.log
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT"
exec > >(tee -a "$WORKLOAD_LOG") 2>&1
set -x

write_failure_status() {
  exit_code=$1
  if [ "$exit_code" -eq 124 ] || [ "$exit_code" -eq 137 ] ||
      [ "$exit_code" -eq 143 ]; then
    status=budget-exhausted
  else
    status=infrastructure-error
  fi
  jq -n \
    --arg status "$status" \
    --arg phase "$PHASE" \
    --argjson exit_code "$exit_code" \
    --arg started_at "$STARTED_AT" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    '{
      schema: "zero.aws_external_eval_screen_status.v1",
      status: $status,
      phase: $phase,
      exit_code: $exit_code,
      started_at: $started_at,
      finished_at: $finished_at,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256,
      result_sha256: null,
      scientific_decision: null
    }' > "$STATUS_FILE"
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if [ "$exit_code" -ne 0 ]; then
    # Never allow a locally prepared success record to survive a failed upload.
    write_failure_status "$exit_code"
  fi
  aws s3 cp "$WORKLOAD_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-eval1-screen.log" \
    --no-cli-pager
  if [ "$exit_code" -ne 0 ]; then
    # Failure publishes only structured status and logs, never partial scores.
    aws s3 cp "$STATUS_FILE" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
      --no-cli-pager
  fi
  exit "$exit_code"
}
trap finish EXIT

heartbeat() {
  now=$(date +%s)
  jq -n \
    --arg phase "$PHASE" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    --argjson elapsed_instance_seconds "$((now - ZERO_LAUNCH_EPOCH))" \
    '{
      schema: "zero.aws_external_eval_screen_heartbeat.v1",
      status: "running",
      phase: $phase,
      at: $at,
      elapsed_instance_seconds: $elapsed_instance_seconds,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256
    }' > /tmp/zero-eval1-screen-heartbeat.json
  aws s3 cp /tmp/zero-eval1-screen-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/heartbeat.json" \
    --no-cli-pager
}

remaining_seconds() {
  remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - $(date +%s)))
  [ "$remaining" -gt 0 ] || return 1
  printf '%s\n' "$remaining"
}

PHASE=source
heartbeat
install -d -m 0755 /tmp/zero /tmp/zero-eval1-screen-input
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/source.tar.gz" \
  /tmp/zero-source.tar.gz --no-cli-pager
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/screen-bundle.tar.gz" \
  /tmp/zero-eval1-screen-bundle.tar.gz --no-cli-pager
test "$(sha256sum /tmp/zero-source.tar.gz | awk '{print $1}')" = \
  "$ZERO_SOURCE_ARCHIVE_SHA256"
test "$(sha256sum /tmp/zero-eval1-screen-bundle.tar.gz | awk '{print $1}')" = \
  "$ZERO_SCREEN_ARCHIVE_SHA256"
tar -xzf /tmp/zero-source.tar.gz -C /tmp/zero
tar -xzf /tmp/zero-eval1-screen-bundle.tar.gz \
  -C /tmp/zero-eval1-screen-input
cd /tmp/zero

test "$(sha256sum "$ZERO_BUDGET_FILE" | awk '{print $1}')" = \
  "$ZERO_BUDGET_SHA256"
node scripts/check_zero_eval1_screen_budget.mjs "$ZERO_BUDGET_FILE"
node scripts/check_zero_eval1_screen.mjs \
  --bundle /tmp/zero-eval1-screen-input
test "$(uname -m)" = x86_64
test "$(nproc)" = 16

PHASE=build
heartbeat
cc -O2 -std=c11 -Wall -Wextra -Wpedantic \
  -DLITERARY_INFER_NO_MAIN external_eval.c literary_infer.c \
  -o external_eval -lm

for item in $(jq -r '.workload.evaluation_order[]' "$ZERO_BUDGET_FILE"); do
  model=${item%%:*}
  task=${item##*:}
  model_path=$(jq -r --arg model "$model" \
    '.models[] | select(.id == $model) | .path' \
    benchmarks/zero-eval-1/screen/contract.json)
  PHASE="evaluate-${model}-${task}"
  heartbeat
  remaining=$(remaining_seconds)
  timeout --signal=TERM --kill-after=10s "${remaining}s" \
    node scripts/run_zero_eval1.mjs \
      --executable ./external_eval \
      --model "$model_path" \
      --model-id "$model" \
      --cases "/tmp/zero-eval1-screen-input/${task}.tsv" \
      --output "$RESULTS_ROOT/${model}-${task}.json" \
      --jobs 16 >/dev/null
done

PHASE=aggregate
heartbeat
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
node scripts/compile_zero_eval1_screen_result.mjs \
  --contract benchmarks/zero-eval-1/screen/contract.json \
  --results "$RESULTS_ROOT" \
  --output "$RESULT_FILE" \
  --commit "$ZERO_COMMIT" \
  --budget-sha256 "$ZERO_BUDGET_SHA256" \
  --launch-epoch "$ZERO_LAUNCH_EPOCH" \
  --finished-epoch "$finished_epoch" \
  --started-at "$STARTED_AT" \
  --finished-at "$finished_at" \
  --hourly-rate 0.68 >/dev/null

PHASE=publication
result_sha256=$(sha256sum "$RESULT_FILE" | awk '{print $1}')
jq -n \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$finished_at" \
  --arg git_commit "$ZERO_COMMIT" \
  --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
  --arg result_sha256 "$result_sha256" \
  '{
    schema: "zero.aws_external_eval_screen_status.v1",
    status: "complete",
    phase: "complete",
    exit_code: 0,
    started_at: $started_at,
    finished_at: $finished_at,
    git_commit: $git_commit,
    budget_sha256: $budget_sha256,
    result_sha256: $result_sha256,
    scientific_decision: "available-after-collector-validation"
  }' > "$STATUS_FILE"

# The complete aggregate is published first; root status is the atomic commit.
aws s3 cp "$RESULT_FILE" \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/results/result.json" \
  --no-cli-pager
aws s3 cp "$STATUS_FILE" \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
  --no-cli-pager

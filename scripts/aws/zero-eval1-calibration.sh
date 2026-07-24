#!/bin/bash
# Run the score-sealed ZERO-EVAL-1 AWS throughput calibration.

set -Eeuo pipefail

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_RUN_ID:?ZERO_RUN_ID is required}"
: "${ZERO_COMMIT:?ZERO_COMMIT is required}"
: "${ZERO_BUDGET_FILE:?ZERO_BUDGET_FILE is required}"
: "${ZERO_BUDGET_SHA256:?ZERO_BUDGET_SHA256 is required}"
: "${ZERO_LAUNCH_EPOCH:?ZERO_LAUNCH_EPOCH is required}"
: "${ZERO_WORKLOAD_DEADLINE_EPOCH:?ZERO_WORKLOAD_DEADLINE_EPOCH is required}"

RESULTS_ROOT=/tmp/zero-eval1-calibration
STATUS_FILE="$RESULTS_ROOT/status.json"
RESULT_FILE="$RESULTS_ROOT/result.json"
WORKLOAD_LOG=/var/log/zero-eval1-calibration.log
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT"
exec > >(tee -a "$WORKLOAD_LOG") 2>&1
set -x

write_fallback_status() {
  exit_code=$1
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
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
    --arg finished_at "$finished_at" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    '{
      schema: "zero.aws_external_eval_calibration_status.v1",
      status: $status,
      phase: $phase,
      exit_code: $exit_code,
      started_at: $started_at,
      finished_at: $finished_at,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256,
      scientific_inference_allowed: false
    }' > "$STATUS_FILE"
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if [ ! -s "$STATUS_FILE" ]; then
    write_fallback_status "$exit_code"
  fi
  aws s3 sync "$RESULTS_ROOT/" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/results/" \
    --no-cli-pager
  aws s3 cp "$WORKLOAD_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-eval1-calibration.log" \
    --no-cli-pager
  # Publishing root status grants the observer permission to terminate.
  aws s3 cp "$STATUS_FILE" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
    --no-cli-pager
  exit "$exit_code"
}
trap finish EXIT

publish_heartbeat() {
  now=$(date +%s)
  jq -n \
    --arg phase "$PHASE" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    --argjson elapsed_instance_seconds "$((now - ZERO_LAUNCH_EPOCH))" \
    '{
      schema: "zero.aws_external_eval_calibration_heartbeat.v1",
      status: "running",
      phase: $phase,
      at: $at,
      elapsed_instance_seconds: $elapsed_instance_seconds,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256
    }' > /tmp/zero-eval1-heartbeat.json
  aws s3 cp /tmp/zero-eval1-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/heartbeat.json" \
    --no-cli-pager
}

remaining_seconds() {
  now=$(date +%s)
  remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - now))
  if [ "$remaining" -le 0 ]; then
    return 1
  fi
  printf '%s\n' "$remaining"
}

PHASE=source
publish_heartbeat
install -d -m 0755 /tmp/zero /tmp/zero-eval1-input
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/source.tar.gz" \
  /tmp/zero-source.tar.gz --no-cli-pager
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/calibration-bundle.tar.gz" \
  /tmp/zero-eval1-calibration-bundle.tar.gz --no-cli-pager
tar -xzf /tmp/zero-source.tar.gz -C /tmp/zero
tar -xzf /tmp/zero-eval1-calibration-bundle.tar.gz \
  -C /tmp/zero-eval1-input
cd /tmp/zero

test "$(sha256sum "$ZERO_BUDGET_FILE" | awk '{print $1}')" = \
  "$ZERO_BUDGET_SHA256"
node scripts/check_zero_eval1_calibration.mjs "$ZERO_BUDGET_FILE"
test "$(uname -m)" = x86_64
test "$(nproc)" = 16
for task in $(jq -r '.workload.task_order[]' "$ZERO_BUDGET_FILE"); do
  input="/tmp/zero-eval1-input/${task}.tsv"
  test "$(sha256sum "$input" | awk '{print $1}')" = \
    "$(jq -r --arg task "$task" \
      '.calibration_datasets[$task].sample_sha256' "$ZERO_BUDGET_FILE")"
  test "$(stat -c %s "$input")" = \
    "$(jq -r --arg task "$task" \
      '.calibration_datasets[$task].sample_bytes' "$ZERO_BUDGET_FILE")"
  test "$(($(wc -l < "$input") - 1))" = 64
done

PHASE=build
publish_heartbeat
LITERARY_BACKEND=portable make -j16 external_eval

for task in $(jq -r '.workload.task_order[]' "$ZERO_BUDGET_FILE"); do
  PHASE="measure-${task}"
  publish_heartbeat
  remaining=$(remaining_seconds)
  timeout --signal=TERM --kill-after=10s "${remaining}s" \
    node scripts/run_zero_eval1.mjs \
      --executable ./external_eval \
      --model docs/model.litq8 \
      --model-id zero4 \
      --cases "/tmp/zero-eval1-input/${task}.tsv" \
      --output "$RESULTS_ROOT/${task}.json" \
      --jobs 16 \
      --timing-only >/dev/null
done

PHASE=publication
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
finished_epoch=$(date +%s)
node scripts/compile_zero_eval1_calibration_result.mjs \
  --budget "$ZERO_BUDGET_FILE" \
  --results "$RESULTS_ROOT" \
  --output "$RESULT_FILE" \
  --commit "$ZERO_COMMIT" \
  --budget-sha256 "$ZERO_BUDGET_SHA256" \
  --launch-epoch "$ZERO_LAUNCH_EPOCH" \
  --finished-epoch "$finished_epoch" \
  --started-at "$STARTED_AT" \
  --finished-at "$finished_at" >/dev/null
jq '{
  schema: "zero.aws_external_eval_calibration_status.v1",
  status,
  phase: "complete",
  exit_code: 0,
  started_at,
  finished_at,
  git_commit,
  budget_sha256,
  scientific_inference_allowed
}' "$RESULT_FILE" > "$STATUS_FILE"
node scripts/check_zero_eval1_calibration.mjs "$ZERO_BUDGET_FILE" \
  --result "$RESULT_FILE" \
  --status "$STATUS_FILE" \
  --commit "$ZERO_COMMIT" \
  --budget-sha256 "$ZERO_BUDGET_SHA256"

#!/bin/bash

set -Eeuo pipefail

for name in ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_BUDGET_FILE \
  ZERO_BUDGET_SHA256 ZERO_SOURCE_SHA256 ZERO_SCREEN_SHA256 \
  ZERO_CANDIDATE_SHA256 ZERO_LAUNCH_EPOCH ZERO_WORKLOAD_DEADLINE_EPOCH \
  ZERO_INSTANCE_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

RESULTS_ROOT=/tmp/zero-q29-language-gate-results
RESULT_FILE="$RESULTS_ROOT/result.json"
STATUS_FILE=/tmp/zero-q29-language-gate-status.json
WORKLOAD_LOG=/var/log/zero-q29-language-gate.log
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PHASE=initializing

mkdir -p "$RESULTS_ROOT"
exec > >(tee -a "$WORKLOAD_LOG") 2>&1
set -x

elapsed_seconds() {
  value=$(($(date +%s) - ZERO_LAUNCH_EPOCH))
  test "$value" -ge 0
  printf '%s\n' "$value"
}

estimated_cost() {
  awk -v seconds="$1" 'BEGIN { printf "%.12f", seconds * 0.68 / 3600 }'
}

write_failure_status() {
  exit_code=$1
  elapsed=$(elapsed_seconds)
  if [ "$exit_code" -eq 124 ] || [ "$exit_code" -eq 137 ] ||
      [ "$exit_code" -eq 143 ]; then
    status=budget-exhausted
  else
    status=infrastructure-error
  fi
  jq -n \
    --arg status "$status" --arg phase "$PHASE" \
    --arg instance_id "$ZERO_INSTANCE_ID" --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    --arg candidate_sha256 "$ZERO_CANDIDATE_SHA256" \
    --arg started_at "$STARTED_AT" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$(estimated_cost "$elapsed")" \
    '{
      schema: "zero.q29_language_gate_status.v1",
      status: $status,
      phase: $phase,
      exit_code: $exit_code,
      instance_id: $instance_id,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256,
      candidate_sha256: $candidate_sha256,
      started_at: $started_at,
      finished_at: $finished_at,
      elapsed_instance_seconds: $elapsed,
      estimated_compute_usd: $cost,
      training_updates: 0,
      promotion_executed: false,
      result_sha256: null,
      scientific_decision: null
    }' > "$STATUS_FILE"
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if [ "$exit_code" -ne 0 ]; then
    write_failure_status "$exit_code"
  fi
  aws s3 cp "$WORKLOAD_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/workload.log" --no-cli-pager
  if [ "$exit_code" -ne 0 ]; then
    aws s3 cp "$STATUS_FILE" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" --no-cli-pager
  fi
  exit "$exit_code"
}
trap finish EXIT

heartbeat() {
  jq -n --arg phase "$PHASE" --arg git_commit "$ZERO_COMMIT" \
    --arg candidate_sha256 "$ZERO_CANDIDATE_SHA256" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson elapsed "$(elapsed_seconds)" \
    '{
      schema: "zero.q29_language_gate_heartbeat.v1",
      phase: $phase,
      git_commit: $git_commit,
      candidate_sha256: $candidate_sha256,
      at: $at,
      elapsed_instance_seconds: $elapsed
    }' > /tmp/zero-q29-language-gate-heartbeat.json
  aws s3 cp /tmp/zero-q29-language-gate-heartbeat.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/heartbeat.json" --no-cli-pager
}

remaining_seconds() {
  remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - $(date +%s)))
  test "$remaining" -gt 0
  printf '%s\n' "$remaining"
}

PHASE=source
heartbeat
install -d -m 0755 /tmp/zero /tmp/zero-q29-screen
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/source.tar.gz" \
  /tmp/zero-q29-source.tar.gz --no-cli-pager
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/screen.tar.gz" \
  /tmp/zero-q29-screen.tar.gz --no-cli-pager
test "$(sha256sum /tmp/zero-q29-source.tar.gz | awk '{print $1}')" = \
  "$ZERO_SOURCE_SHA256"
test "$(sha256sum /tmp/zero-q29-screen.tar.gz | awk '{print $1}')" = \
  "$ZERO_SCREEN_SHA256"
tar -xzf /tmp/zero-q29-source.tar.gz -C /tmp/zero
tar -xzf /tmp/zero-q29-screen.tar.gz -C /tmp/zero-q29-screen
cd /tmp/zero
node scripts/check_zero4_q29_language_gate.mjs
mkdir -p "$(dirname "$ZERO_BUDGET_FILE")"
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/budget.json" \
  "$ZERO_BUDGET_FILE" --no-cli-pager
test "$(sha256sum "$ZERO_BUDGET_FILE" | awk '{print $1}')" = \
  "$ZERO_BUDGET_SHA256"
test "$(sha256sum benchmarks/zero4-q29-v1/language-gate/candidate.litq8 | awk '{print $1}')" = \
  "$ZERO_CANDIDATE_SHA256"
node scripts/check_zero_language_gate.mjs

PHASE=build
heartbeat
cc -O2 -std=c11 -Wall -Wextra -Wpedantic \
  -DLITERARY_INFER_NO_MAIN external_eval.c literary_infer.c \
  -o external_eval -lm

PHASE=evaluate
heartbeat
remaining=$(remaining_seconds)
timeout --signal=TERM --kill-after=10s "${remaining}s" \
  node scripts/run_zero_language_gate.mjs \
    --executable ./external_eval \
    --model benchmarks/zero4-q29-v1/language-gate/candidate.litq8 \
    --model-id zero4-q29-seed2-u50 \
    --blimp /tmp/zero-q29-screen/blimp.tsv \
    --tinystories /tmp/zero-q29-screen/tinystories.tsv \
    --output "$RESULT_FILE" --jobs 16 --budget "$ZERO_BUDGET_FILE" >/dev/null
node scripts/check_zero_language_gate.mjs --result "$RESULT_FILE"

PHASE=publication
heartbeat
finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
elapsed=$(elapsed_seconds)
test "$elapsed" -le 600
cost=$(estimated_cost "$elapsed")
awk -v cost="$cost" 'BEGIN { exit !(cost <= 0.12) }'
result_sha256=$(sha256sum "$RESULT_FILE" | awk '{print $1}')
decision=$(jq -r 'if .decision.pass then "pass" else "fail" end' "$RESULT_FILE")
jq -n \
  --arg instance_id "$ZERO_INSTANCE_ID" --arg git_commit "$ZERO_COMMIT" \
  --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
  --arg candidate_sha256 "$ZERO_CANDIDATE_SHA256" \
  --arg started_at "$STARTED_AT" --arg finished_at "$finished_at" \
  --arg result_sha256 "$result_sha256" --arg decision "$decision" \
  --argjson elapsed "$elapsed" --argjson cost "$cost" \
  '{
    schema: "zero.q29_language_gate_status.v1",
    status: "complete",
    phase: "complete",
    exit_code: 0,
    instance_id: $instance_id,
    git_commit: $git_commit,
    budget_sha256: $budget_sha256,
    candidate_sha256: $candidate_sha256,
    started_at: $started_at,
    finished_at: $finished_at,
    elapsed_instance_seconds: $elapsed,
    estimated_compute_usd: $cost,
    training_updates: 0,
    promotion_executed: false,
    result_sha256: $result_sha256,
    scientific_decision: $decision
  }' > "$STATUS_FILE"

aws s3 cp "$RESULT_FILE" \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/result.json" --no-cli-pager
aws s3 cp "$STATUS_FILE" \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" --no-cli-pager

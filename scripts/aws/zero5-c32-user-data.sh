#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/zero5-c32-bootstrap.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1
set -x

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
tag() { metadata "tags/instance/$1"; }

RUN_ID=$(tag RunId)
SOURCE_COMMIT=$(tag Commit)
SOURCE_KEY=$(tag SourceKey)
SOURCE_SHA256=$(tag SourceSha256)
ASSET_KEY=$(tag AssetKey)
ASSET_SHA256=$(tag AssetSha256)
BASELINE_CACHE_KEY=$(tag BaselineCacheKey)
BASELINE_CACHE_SHA256=$(tag BaselineCacheSha256)
TRAINING_BUCKET=$(tag TrainingBucket)
DATASET_DIGEST=$(tag DatasetDigest)
CONTRACT_SHA256=$(tag ContractSha256)
CONTINUATION_SHA256=$(tag ContinuationSha256)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
PRIOR_COMPUTE_USD=$(tag PriorComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
APPROVAL_ID=$(tag ApprovalId)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/zero5-c32-v1/${RUN_ID}"
STATE_PREFIX="${RESULT_PREFIX}/state"
STATUS_FILE=/tmp/zero5-c32-status.json
TERMINAL_WRITTEN=0
PHASE=bootstrap

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$DATASET_DIGEST" = 4412223f47c07a206ad2703c02ed8bcfd42d27561a287836ed26e9cacccf142d
test "$MAX_INSTANCE_SECONDS" -le 9000
test "$MAX_INSTANCE_SECONDS" -gt 0
test "$MAX_COMPUTE_USD" = 6.75
awk -v prior="$PRIOR_COMPUTE_USD" 'BEGIN { exit !(prior >= 0 && prior < 6.75) }'
test "$HOURLY_PRICE" = 0.68
test "$APPROVAL_ID" = zero5-c32-aws-2026-08-25-v3
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONTINUATION_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
if [ "$BASELINE_CACHE_KEY" = none ] || \
    [ "$BASELINE_CACHE_SHA256" = none ]; then
  test "$BASELINE_CACHE_KEY" = none
  test "$BASELINE_CACHE_SHA256" = none
else
  [[ "$BASELINE_CACHE_KEY" =~ ^experiments/zero5-c32-v1/baselines/[a-z0-9-]+\.json$ ]]
  [[ "$BASELINE_CACHE_SHA256" =~ ^[0-9a-f]{64}$ ]]
fi

remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s)))
test "$remaining" -gt 0
( sleep "$remaining"; shutdown -h now ) &

elapsed_seconds() { printf '%s\n' "$(($(date +%s) - LAUNCH_EPOCH))"; }
estimated_cost() {
  awk -v seconds="$1" -v price="$HOURLY_PRICE" \
    -v prior="$PRIOR_COMPUTE_USD" \
    'BEGIN { printf "%.12f", prior + seconds * price / 3600 }'
}
write_status() {
  status=$1
  exit_code=$2
  result_key=${3:-}
  result_sha256=${4:-}
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status" --arg phase "$PHASE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg instance_type "$INSTANCE_TYPE" --arg git_commit "$SOURCE_COMMIT" \
    --arg dataset_digest "$DATASET_DIGEST" \
    --arg contract_sha256 "$CONTRACT_SHA256" \
    --arg continuation_sha256 "$CONTINUATION_SHA256" \
    --arg started_at "$STARTED_AT" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" \
    '{schema:"zero.c32_aws_status.v1",status:$status,phase:$phase,
      run_id:$run_id,instance_id:$instance_id,instance_type:$instance_type,
      git_commit:$git_commit,dataset_digest:$dataset_digest,
      contract_sha256:$contract_sha256,
      continuation_sha256:$continuation_sha256,started_at:$started_at,
      finished_at:$finished_at,exit_code:$exit_code,
      elapsed_instance_seconds:$elapsed,estimated_ec2_usd:$cost,
      result_key:(if $result_key=="" then null else $result_key end),
      result_sha256:(if $result_sha256=="" then null else $result_sha256 end)}' \
    > "$STATUS_FILE"
}
upload_status() {
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" --only-show-errors
}
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$BOOT_LOG" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" \
      --only-show-errors
    if [ "$TERMINAL_WRITTEN" -eq 0 ]; then
      write_status failed "$exit_code"
      upload_status
    fi
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential ca-certificates curl jq \
  libopenblas-dev nodejs pkg-config unzip
if ! command -v aws >/dev/null 2>&1; then
  AWS_CLI_VERSION=2.34.7
  AWS_CLI_SHA256=d6b6e2291456704a441e970bbdb69466629510dd0b578e8812f7856ac64abba1
  curl --fail --silent --show-error --location \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
    --output /tmp/awscliv2.zip
  echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check
  unzip -q /tmp/awscliv2.zip -d /tmp/awscliv2
  /tmp/awscliv2/aws/install --bin-dir /usr/local/bin \
    --install-dir /usr/local/aws-cli
fi

PHASE=source
write_status running 0
upload_status
install -d -m 0755 /opt/zero/repo
aws s3 cp "s3://${TRAINING_BUCKET}/${SOURCE_KEY}" /tmp/zero-source.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/zero-source.tar.gz | awk '{print $1}')" = \
  "$SOURCE_SHA256"
tar -xzf /tmp/zero-source.tar.gz -C /opt/zero/repo
cd /opt/zero/repo
test "$(cat SOURCE_COMMIT)" = "$SOURCE_COMMIT"
test "$(sha256sum benchmarks/zero5-c32-v1/contract.json | awk '{print $1}')" = \
  "$CONTRACT_SHA256"
test "$(sha256sum benchmarks/zero5-c32-v1/aws-continuation.json | awk '{print $1}')" = \
  "$CONTINUATION_SHA256"

PHASE=assets
write_status running 0
upload_status
aws s3 cp "s3://${TRAINING_BUCKET}/${ASSET_KEY}" /tmp/zero5-c32-assets.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/zero5-c32-assets.tar.gz | awk '{print $1}')" = \
  "$ASSET_SHA256"
tar -xzf /tmp/zero5-c32-assets.tar.gz -C /opt/zero/repo

PHASE=environment
write_status running 0
upload_status
export LITERARY_BACKEND=openblas
export OPENBLAS_NUM_THREADS=8
export OMP_NUM_THREADS=8
export OPENBLAS_DYNAMIC=0
make zero5_c32_lm
node scripts/check_zero5_c32.mjs

OUT=build/zero5-c32-aws-v1/run
install -d -m 0755 "$(dirname "$OUT")"
aws s3 sync "s3://${TRAINING_BUCKET}/${STATE_PREFIX}/" "$OUT/" \
  --only-show-errors || true
if [ "$BASELINE_CACHE_KEY" != none ]; then
  aws s3 cp "s3://${TRAINING_BUCKET}/${BASELINE_CACHE_KEY}" \
    /tmp/zero5-c32-baseline-cache.json --only-show-errors
  test "$(sha256sum /tmp/zero5-c32-baseline-cache.json | awk '{print $1}')" = \
    "$BASELINE_CACHE_SHA256"
  node scripts/zero5_c32_baseline_cache.mjs --mode install \
    --input /tmp/zero5-c32-baseline-cache.json \
    --output "$OUT/baseline.json" --backend openblas
fi

START_EVENT_EXISTS=0
START_MARKER_STAGED=0
if [ -f "$OUT/telemetry-started" ]; then
  START_EVENT_EXISTS=1
  if [ ! -f "$OUT/execution.json" ]; then
    mv "$OUT/telemetry-started" /tmp/zero5-c32-telemetry-started
    START_MARKER_STAGED=1
  fi
fi

publish_event() {
  sequence=$1
  kind=$2
  payload=$3
  node scripts/publish_zero_telemetry.mjs \
    --run-id "$RUN_ID" --sequence "$sequence" --kind "$kind" \
    --occurred-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --dataset-digest "$DATASET_DIGEST" --payload "$payload" \
    --bucket "$TRAINING_BUCKET" --region "$AWS_DEFAULT_REGION" || true
}

if [ "$START_EVENT_EXISTS" -eq 0 ]; then
  jq -n --arg experiment zero5-c32-v1 \
    --arg note "Clean AWS/OpenBLAS C3.2 C/D run started." \
    '{status:"running",experiment:$experiment,seed:0,note:$note}' \
    > /tmp/zero5-c32-start.json
  publish_event 0 run.started /tmp/zero5-c32-start.json
else
  last_c=0
  last_d=0
  test ! -f "$OUT/telemetry-C-update" || \
    last_c=$(cat "$OUT/telemetry-C-update")
  test ! -f "$OUT/telemetry-D-update" || \
    last_d=$(cat "$OUT/telemetry-D-update")
  if [ "$last_d" -gt 0 ]; then
    resume_sequence=$((10000 + last_d + 2))
  else
    resume_sequence=$((last_c + 2))
  fi
  jq -n --arg experiment zero5-c32-v1 \
    --arg note "AWS/OpenBLAS C3.2 run resumed from durable state." \
    '{status:"running",experiment:$experiment,seed:0,note:$note}' \
    > /tmp/zero5-c32-resume.json
  publish_event "$resume_sequence" phase.started /tmp/zero5-c32-resume.json
fi

sync_state() {
  aws s3 sync "$OUT/" "s3://${TRAINING_BUCKET}/${STATE_PREFIX}/" \
    --only-show-errors
}
publish_latest_metric() {
  arm=$1
  offset=$2
  log="$OUT/$arm/training.log"
  marker="$OUT/telemetry-${arm}-update"
  test -f "$log" || return 0
  line=$(awk '/^update[[:space:]]+[0-9]+ train / {value=$0} END {print value}' "$log")
  test -n "$line" || return 0
  update=$(awk '{print $2}' <<<"$line")
  loss=$(awk '{print $6}' <<<"$line")
  [[ "$update" =~ ^[0-9]+$ ]] || return 0
  previous=0
  test ! -f "$marker" || previous=$(cat "$marker")
  test "$update" -gt "$previous" || return 0
  jq -n --arg experiment zero5-c32-v1 --arg arm "$arm" \
    --arg note "AWS/OpenBLAS C3.2 training metric." \
    --argjson update "$update" --argjson loss "$loss" \
    '{status:"running",experiment:$experiment,seed:0,arm:$arm,
      update:$update,loss:$loss,note:$note}' > /tmp/zero5-c32-metric.json
  publish_event "$((offset + update))" metric /tmp/zero5-c32-metric.json
  printf '%s\n' "$update" > "$marker"
}
monitor() {
  while kill -0 "$RUNNER_PID" 2>/dev/null; do
    sync_state || true
    publish_latest_metric C 0 || true
    publish_latest_metric D 10000 || true
    sleep 30
  done
}

PHASE=training
write_status running 0
upload_status
runner_args=(--import-dir build/zero5-c32-v1/import-final
  --c0-dir build/zero5-c0-v1/corpus-one
  --c2-dir build/zero5-c2-v1/run
  --c2-import-dir build/zero5-c2-v1/import-final
  --out "$OUT")
if [ -f "$OUT/execution.json" ]; then
  runner_args+=(--resume-run)
fi
remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 180))
test "$remaining" -gt 0
set +e
timeout --signal=TERM --kill-after=90s "${remaining}s" \
  node scripts/run_zero5_c32.mjs "${runner_args[@]}" &
RUNNER_PID=$!
if [ ! -f "$OUT/telemetry-started" ]; then
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    test -f "$OUT/execution.json" && break
    sleep 1
  done
  test -f "$OUT/execution.json"
  if [ "$START_MARKER_STAGED" -eq 1 ]; then
    mv /tmp/zero5-c32-telemetry-started "$OUT/telemetry-started"
  else
    touch "$OUT/telemetry-started"
  fi
fi
monitor &
MONITOR_PID=$!
wait "$RUNNER_PID"
runner_exit=$?
kill "$MONITOR_PID" >/dev/null 2>&1
wait "$MONITOR_PID" >/dev/null 2>&1
set -e
sync_state

if [ "$runner_exit" -eq 0 ] && [ -s "$OUT/result.json" ]; then
  PHASE=publication
  cp "$OUT/result.json" benchmarks/zero5-c32-v1/result.json
  node scripts/check_zero5_c32.mjs
  result_sha256=$(sha256sum "$OUT/result.json" | awk '{print $1}')
  result_key="${RESULT_PREFIX}/result.json"
  aws s3 cp "$OUT/result.json" \
    "s3://${TRAINING_BUCKET}/${result_key}" --only-show-errors
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  decision=$(jq -r .decision.outcome "$OUT/result.json")
  jq -n --arg experiment zero5-c32-v1 --arg decision "$decision" \
    --arg note "Clean AWS/OpenBLAS C3.2 C/D run completed." \
    --argjson compute_usd "$cost" \
    '{status:"completed",experiment:$experiment,seed:0,
      decision:$decision,compute_usd:$compute_usd,note:$note}' \
    > /tmp/zero5-c32-complete.json
  publish_event 20000 run.completed /tmp/zero5-c32-complete.json
  PHASE=complete
  write_status complete 0 "$result_key" "$result_sha256"
  cost=$(jq -r .estimated_ec2_usd "$STATUS_FILE")
  awk -v cost="$cost" -v ceiling="$MAX_COMPUTE_USD" \
    'BEGIN { exit !(cost <= ceiling) }'
  upload_status
  TERMINAL_WRITTEN=1
  exit 0
fi

PHASE=recoverable
write_status recoverable "$runner_exit"
upload_status
jq -n --arg experiment zero5-c32-v1 \
  --arg note "AWS run stopped before completion; contract-bound S3 checkpoint state is available." \
  '{status:"failed",experiment:$experiment,seed:0,note:$note}' \
  > /tmp/zero5-c32-recoverable.json
last_c=0
last_d=0
test ! -f "$OUT/telemetry-C-update" || last_c=$(cat "$OUT/telemetry-C-update")
test ! -f "$OUT/telemetry-D-update" || last_d=$(cat "$OUT/telemetry-D-update")
if [ "$last_d" -gt 0 ]; then
  recoverable_sequence=$((10000 + last_d + 1))
else
  recoverable_sequence=$((last_c + 1))
fi
publish_event "$recoverable_sequence" run.failed /tmp/zero5-c32-recoverable.json
TERMINAL_WRITTEN=1
exit "$runner_exit"

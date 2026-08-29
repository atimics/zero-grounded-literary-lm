#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/zero5-s1-bootstrap.log
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
TRAINING_BUCKET=$(tag TrainingBucket)
CONTRACT_SHA256=$(tag ContractSha256)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
export S1_LAUNCH_EPOCH="$LAUNCH_EPOCH"
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
APPROVAL_ID=$(tag ApprovalId)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/zero5-s1-scale-v1/${RUN_ID}"
STATE_PREFIX="${RESULT_PREFIX}/state"
STATUS_FILE=/tmp/zero5-s1-status.json
TERMINAL_WRITTEN=0
PHASE=bootstrap

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$MAX_INSTANCE_SECONDS" = 43200
test "$MAX_COMPUTE_USD" = 8.2
test "$HOURLY_PRICE" = 0.68
test "$APPROVAL_ID" = zero5-s1-scale-aws-2026-08-29-v1
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
awk -v seconds="$MAX_INSTANCE_SECONDS" -v price="$HOURLY_PRICE" \
  -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling &&
    (seconds + 1) * price / 3600 > ceiling) }'

remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s)))
test "$remaining" -gt 0
( sleep "$remaining"; shutdown -h now ) &
elapsed_seconds() { printf '%s\n' "$(($(date +%s) - LAUNCH_EPOCH))"; }
estimated_cost() {
  awk -v seconds="$1" -v price="$HOURLY_PRICE" \
    'BEGIN { printf "%.12f", seconds * price / 3600 }'
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
    --arg git_commit "$SOURCE_COMMIT" --arg contract_sha256 "$CONTRACT_SHA256" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" \
    '{schema:"zero5.s1_aws_status.v1",status:$status,phase:$phase,
      run_id:$run_id,instance_id:$instance_id,git_commit:$git_commit,
      contract_sha256:$contract_sha256,exit_code:$exit_code,
      elapsed_instance_seconds:$elapsed,estimated_ec2_usd:$cost,
      result_key:(if $result_key=="" then null else $result_key end),
      result_sha256:(if $result_sha256=="" then null else $result_sha256 end)}' \
    > "$STATUS_FILE"
}
upload_status() {
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" --only-show-errors
}
sync_state() {
  aws s3 sync "$OUT/" "s3://${TRAINING_BUCKET}/${STATE_PREFIX}/" \
    --only-show-errors
}
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  aws s3 cp "$BOOT_LOG" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" \
    --only-show-errors
  if [ "$TERMINAL_WRITTEN" -eq 0 ]; then
    write_status failed "$exit_code"
    upload_status
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

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
aws s3 cp "s3://${TRAINING_BUCKET}/${SOURCE_KEY}" /tmp/source.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/source.tar.gz | awk '{print $1}')" = "$SOURCE_SHA256"
tar -xzf /tmp/source.tar.gz -C /opt/zero/repo
cd /opt/zero/repo
test "$(cat SOURCE_COMMIT)" = "$SOURCE_COMMIT"
test "$(sha256sum benchmarks/zero5-s1-scale-v1/contract.json | awk '{print $1}')" = "$CONTRACT_SHA256"
test "$(jq -r .authorized benchmarks/zero5-s1-scale-v1/contract.json)" = true
test "$(jq -r .authorization.approval_id benchmarks/zero5-s1-scale-v1/contract.json)" = "$APPROVAL_ID"

PHASE=assets
write_status running 0
upload_status
aws s3 cp "s3://${TRAINING_BUCKET}/${ASSET_KEY}" /tmp/assets.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/assets.tar.gz | awk '{print $1}')" = "$ASSET_SHA256"
tar -xzf /tmp/assets.tar.gz -C /opt/zero/repo

PHASE=environment
write_status running 0
upload_status
export LITERARY_BACKEND=openblas
export OPENBLAS_DYNAMIC=0
export OPENBLAS_NUM_THREADS=16
export OMP_NUM_THREADS=16
make zero5_c32_lm_vector_math
node scripts/check_zero5_s1_scale.mjs
node scripts/run_zero5_s1_scale.mjs \
  --contract benchmarks/zero5-s1-scale-v1/contract.json \
  --c43-import build/zero5-c43-v1/import-final \
  --c0-dir build/zero5-c0-v1/corpus-one \
  --c2-dir build/zero5-c2-v1/run \
  --c2-import-dir build/zero5-c2-v1/import-final \
  --preflight-only >/dev/null

OUT=build/zero5-s1-scale-v1/run
install -d -m 0755 "$(dirname "$OUT")"
aws s3 sync "s3://${TRAINING_BUCKET}/${STATE_PREFIX}/" "$OUT/" \
  --only-show-errors || true

PHASE=training
write_status running 0
upload_status
runner_args=(--contract benchmarks/zero5-s1-scale-v1/contract.json
  --c43-import build/zero5-c43-v1/import-final
  --c0-dir build/zero5-c0-v1/corpus-one
  --c2-dir build/zero5-c2-v1/run
  --c2-import-dir build/zero5-c2-v1/import-final
  --out "$OUT")
if [ -f "$OUT/execution.json" ]; then runner_args+=(--resume-run); fi
remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 180))
test "$remaining" -gt 0
set +e
timeout --signal=TERM --kill-after=90s "${remaining}s" \
  node scripts/run_zero5_s1_scale.mjs "${runner_args[@]}" &
RUNNER_PID=$!
while kill -0 "$RUNNER_PID" 2>/dev/null; do
  sync_state || true
  sleep 30
done
wait "$RUNNER_PID"
runner_exit=$?
set -e
sync_state

if [ "$runner_exit" -eq 0 ] && [ -s "$OUT/result.json" ]; then
  PHASE=complete
  result_sha256=$(sha256sum "$OUT/result.json" | awk '{print $1}')
  result_key="${RESULT_PREFIX}/result.json"
  aws s3 cp "$OUT/result.json" "s3://${TRAINING_BUCKET}/${result_key}" \
    --only-show-errors
  write_status complete 0 "$result_key" "$result_sha256"
  awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS_FILE")" \
    -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
  upload_status
  TERMINAL_WRITTEN=1
  exit 0
fi

PHASE=recoverable
write_status recoverable "$runner_exit"
upload_status
TERMINAL_WRITTEN=1
exit "$runner_exit"

#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/zero5-tensor-calibration-bootstrap.log
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
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
APPROVAL_ID=$(tag ApprovalId)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/zero5-tensor-batch-v1/${RUN_ID}"
STATUS_FILE=/tmp/zero5-tensor-calibration-status.json
OUT=/opt/zero/results
PHASE=bootstrap
TERMINAL_WRITTEN=0

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$SOURCE_COMMIT" = ed67d1e114d0b7284107a6c80d2e99cc55d98fd8
test "$MAX_INSTANCE_SECONDS" = 780
test "$MAX_COMPUTE_USD" = 0.15
test "$HOURLY_PRICE" = 0.68
test "$APPROVAL_ID" = zero5-tensor-calibration-2026-08-27-v1
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]

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
  completed=0
  if [ -d "$OUT" ]; then
    completed=$(find "$OUT" -maxdepth 1 -name 'threads-*.json' | wc -l)
  fi
  jq -n --arg status "$status" --arg phase "$PHASE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg git_commit "$SOURCE_COMMIT" --arg approval_id "$APPROVAL_ID" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" --argjson completed "$completed" \
    '{schema:"zero.aws_tensor_batch_calibration_status.v1",status:$status,
      phase:$phase,run_id:$run_id,instance_id:$instance_id,
      git_commit:$git_commit,approval_id:$approval_id,exit_code:$exit_code,
      completed_thread_candidates:$completed,
      elapsed_instance_seconds:$elapsed,estimated_ec2_usd:$cost,
      result_key:(if $result_key=="" then null else $result_key end),
      result_sha256:(if $result_sha256=="" then null else $result_sha256 end)}' \
    > "$STATUS_FILE"
}
upload_status() {
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" --only-show-errors
}
upload_file() {
  local_file=$1
  remote_name=$2
  aws s3 cp "$local_file" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/${remote_name}" \
    --only-show-errors
}
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  upload_file "$BOOT_LOG" bootstrap.log
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
install -d -m 0755 /opt/zero/repo "$OUT"
aws s3 cp "s3://${TRAINING_BUCKET}/${SOURCE_KEY}" /tmp/source.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/source.tar.gz | awk '{print $1}')" = "$SOURCE_SHA256"
tar -xzf /tmp/source.tar.gz -C /opt/zero/repo
cd /opt/zero/repo
test "$(cat SOURCE_COMMIT)" = "$SOURCE_COMMIT"

PHASE=assets
write_status running 0
upload_status
aws s3 cp "s3://${TRAINING_BUCKET}/${ASSET_KEY}" /tmp/assets.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/assets.tar.gz | awk '{print $1}')" = "$ASSET_SHA256"
tar -xzf /tmp/assets.tar.gz -C /opt/zero/repo

PHASE=build
write_status running 0
upload_status
export LITERARY_BACKEND=openblas
export OPENBLAS_DYNAMIC=0
export OMP_DYNAMIC=FALSE
make zero5_c32_lm_fast zero5_c32_lm_tensor zero5_c32_lm_tensor_qkv
./zero5_c32_lm_tensor --self-test
./zero5_c32_lm_tensor_qkv --self-test

PHASE=calibration
write_status running 0
upload_status
for threads in 1 2 4 8 16; do
  remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 90))
  test "$remaining" -gt 0
  candidate_timeout=115
  if [ "$remaining" -lt "$candidate_timeout" ]; then
    candidate_timeout=$remaining
  fi
  set +e
  timeout --signal=TERM --kill-after=15s "${candidate_timeout}s" \
    node scripts/benchmark_zero5_tensor.mjs \
      --asset-root /opt/zero/repo --updates 50 --blas-threads "$threads" \
      --skip-build --out "$OUT/threads-${threads}.json" \
      > "$OUT/threads-${threads}.log" 2>&1
  candidate_exit=$?
  set -e
  upload_file "$OUT/threads-${threads}.log" "threads-${threads}.log"
  test "$candidate_exit" -eq 0
  test -s "$OUT/threads-${threads}.json"
  upload_file "$OUT/threads-${threads}.json" "threads-${threads}.json"
  write_status running 0
  upload_status
done

PHASE=aggregate
jq -s '
  [.[] | .workload.tensor_blas_threads as $threads |
    {threads:$threads,variant:"tensor",tokens_per_second:.tensor.tokens_per_second,
     train_loss:.tensor.train_loss,validation_loss:.tensor.validation_loss,
     gradient_norm:.tensor.gradient_norm},
    {threads:$threads,variant:"tensor-qkv",tokens_per_second:.tensor_qkv.tokens_per_second,
     train_loss:.tensor_qkv.train_loss,validation_loss:.tensor_qkv.validation_loss,
     gradient_norm:.tensor_qkv.gradient_norm}] as $candidates |
  {schema:"zero.aws_tensor_batch_calibration.v1",
   source_commit:"ed67d1e114d0b7284107a6c80d2e99cc55d98fd8",
   instance_type:"c6i.4xlarge",backend:"OpenBLAS",
   dynamic_threading:false,updates_per_candidate:50,
   baseline:.[0].parallel,candidates:$candidates,
   selected:($candidates | sort_by(.tokens_per_second) | reverse | .[0]),
   all_metrics_within_tolerance:([.[].comparison.same_reported_metrics] | all)}
' "$OUT"/threads-*.json > "$OUT/result.json"
result_sha256=$(sha256sum "$OUT/result.json" | awk '{print $1}')
result_key="${RESULT_PREFIX}/result.json"
upload_file "$OUT/result.json" result.json

PHASE=complete
write_status complete 0 "$result_key" "$result_sha256"
awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS_FILE")" \
  -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
upload_status
upload_file "$BOOT_LOG" bootstrap.log
TERMINAL_WRITTEN=1
exit 0

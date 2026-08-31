#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/reasoner34-scout-bootstrap.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
tag() { metadata "tags/instance/$1"; }

EXPERIMENT=$(tag Experiment)
VERSION=$(tag Version)
BINARY=$(tag Binary)
MAKE_TARGET=$(tag MakeTarget)
RESULT_SCHEMA=$(tag ResultSchema)
RUN_ID=$(tag RunId)
SOURCE_COMMIT=$(tag Commit)
SOURCE_KEY=$(tag SourceKey)
SOURCE_SHA256=$(tag SourceSha256)
TRAINING_BUCKET=$(tag TrainingBucket)
CONTRACT_SHA256=$(tag ContractSha256)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
APPROVAL_ID=$(tag ApprovalId)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/${EXPERIMENT}/${RUN_ID}"
STATUS_FILE=/tmp/reasoner34-scout-status.json
TERMINAL_WRITTEN=0
PHASE=bootstrap

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = t3.micro
test "$HOURLY_PRICE" = 0.0104
[[ "$MAX_INSTANCE_SECONDS" =~ ^[0-9]+$ ]]
awk -v seconds="$MAX_INSTANCE_SECONDS" \
  'BEGIN { exit !(seconds > 0 && seconds <= 1800) }'
awk -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(ceiling > 0 && ceiling <= 0.006) }'
[[ "$EXPERIMENT" =~ ^[a-z0-9-]{8,100}$ ]]
[[ "$BINARY" =~ ^[a-zA-Z0-9_]{3,80}$ ]]
[[ "$MAKE_TARGET" =~ ^[a-zA-Z0-9_-]{3,80}$ ]]
[[ "$RESULT_SCHEMA" =~ ^[a-zA-Z0-9_.-]{8,120}$ ]]
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
test -n "$VERSION"
test -n "$APPROVAL_ID"
awk -v seconds="$MAX_INSTANCE_SECONDS" -v price="$HOURLY_PRICE" \
  -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling) }'

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
    --arg experiment "$EXPERIMENT" --arg run_id "$RUN_ID" \
    --arg instance_id "$INSTANCE_ID" --arg git_commit "$SOURCE_COMMIT" \
    --arg contract_sha256 "$CONTRACT_SHA256" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" \
    '{schema:"zero.reasoner34_scout_aws_status.v1",status:$status,
      phase:$phase,experiment:$experiment,run_id:$run_id,
      instance_id:$instance_id,git_commit:$git_commit,
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
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$BOOT_LOG" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" \
      --only-show-errors
    if [ "$TERMINAL_WRITTEN" -eq 0 ] && command -v jq >/dev/null 2>&1; then
      write_status failed "$exit_code"
      upload_status
    fi
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential ca-certificates curl jq unzip
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

PHASE=development
write_status running 0
upload_status
make "$MAKE_TARGET"
"./${BINARY}" --self-test

PHASE=sealed
write_status running 0
upload_status
remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 120))
test "$remaining" -gt 0
set +e
R34_SEALED_EXECUTION=cloud R34_EXECUTION_LOCK=/tmp/sealed-execution.lock \
  R34_SEALED_CLOUD=1 R34_SOURCE_COMMIT="$SOURCE_COMMIT" \
  R34_CONTRACT_SHA256="$CONTRACT_SHA256" \
  R333_SEAL_APPROVAL_ID="$APPROVAL_ID" \
  R35_SEALED_EXECUTION=cloud \
  R35_EXECUTION_LOCK=/tmp/reasoner35-sealed-execution.lock \
  R36_SEALED_EXECUTION=cloud \
  R36_EXECUTION_LOCK=/tmp/reasoner36-sealed-execution.lock \
  R37_SEALED_EXECUTION=cloud \
  R37_EXECUTION_LOCK=/tmp/reasoner37-sealed-execution.lock \
  R38_SEALED_EXECUTION=cloud \
  R38_EXECUTION_LOCK=/tmp/reasoner38-sealed-execution.lock \
  R39_SEALED_EXECUTION=cloud \
  R39_EXECUTION_LOCK=/tmp/reasoner39-sealed-execution.lock \
  timeout --signal=TERM --kill-after=30s "${remaining}s" \
  "./${BINARY}" sealed-run /tmp/result.json > /tmp/sealed-summary.json
runner_exit=$?
set -e
if [ "$runner_exit" -ne 0 ] || [ ! -s /tmp/result.json ]; then
  PHASE=failed
  write_status failed "$runner_exit"
  upload_status
  TERMINAL_WRITTEN=1
  exit "$runner_exit"
fi

jq -e --arg schema "$RESULT_SCHEMA" --arg version "$VERSION" '
  .schema == $schema and .version == $version and
  .development_gate_passed == true and
  (.sealed_gate_passed | type == "boolean")
' /tmp/result.json >/dev/null
result_sha256=$(sha256sum /tmp/result.json | awk '{print $1}')
result_key="${RESULT_PREFIX}/result.json"
aws s3 cp /tmp/result.json "s3://${TRAINING_BUCKET}/${result_key}" \
  --only-show-errors
aws s3 cp /tmp/sealed-summary.json \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/sealed-summary.json" \
  --only-show-errors
PHASE=complete
write_status complete 0 "$result_key" "$result_sha256"
awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS_FILE")" \
  -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
upload_status
TERMINAL_WRITTEN=1
exit 0

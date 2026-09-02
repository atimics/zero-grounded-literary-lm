#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/reasoner42-bootstrap.log
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
RESULT_PREFIX="experiments/reasoner42-abstraction-library-v1/${RUN_ID}"
STATUS_FILE=/tmp/reasoner42-status.json
TERMINAL_WRITTEN=0
PHASE=bootstrap

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = t3.micro
test "$MAX_INSTANCE_SECONDS" = 2400
test "$MAX_COMPUTE_USD" = 0.007
test "$HOURLY_PRICE" = 0.0104
test "$APPROVAL_ID" = reasoner42-abstraction-library-2026-09-01-v1
test "$SOURCE_COMMIT" = a5c8e8c69c309940adce5cb01609b4604e553606
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
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
  status_name=$1
  exit_code=$2
  result_key=${3:-}
  result_sha256=${4:-}
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status_name" --arg phase "$PHASE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg git_commit "$SOURCE_COMMIT" \
    --arg contract_sha256 "$CONTRACT_SHA256" \
    --arg source_sha256 "$SOURCE_SHA256" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" \
    '{schema:"zero.reasoner42_aws_status.v1",status:$status,phase:$phase,
      run_id:$run_id,instance_id:$instance_id,git_commit:$git_commit,
      source_sha256:$source_sha256,contract_sha256:$contract_sha256,
      exit_code:$exit_code,elapsed_instance_seconds:$elapsed,
      estimated_ec2_usd:$cost,
      result_key:(if $result_key=="" then null else $result_key end),
      result_sha256:(if $result_sha256=="" then null else $result_sha256 end)}' \
    >"$STATUS_FILE"
}
upload_status() {
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" --only-show-errors
}
upload_if_present() {
  local path=$1
  local name=$2
  if [ -s "$path" ]; then
    aws s3 cp "$path" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/${name}" --only-show-errors
  fi
}
# shellcheck disable=SC2329  # invoked by the EXIT trap
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1; then
    upload_if_present "$BOOT_LOG" bootstrap.log
    upload_if_present /tmp/sealed-summary.json sealed-summary.json
    upload_if_present /tmp/sealed-stderr.log sealed-stderr.log
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
test "$(sha256sum /tmp/source.tar.gz | awk '{print $1}')" = \
  "$SOURCE_SHA256"
tar -xzf /tmp/source.tar.gz -C /opt/zero/repo
cd /opt/zero/repo

PHASE=development
write_status running 0
upload_status
make reasoner42
./reasoner42 --self-test

PHASE=sealed
write_status running 0
upload_status
remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 180))
test "$remaining" -gt 0
set +e
R42_SEALED_EXECUTION=cloud \
R42_SEAL_APPROVAL_ID="$APPROVAL_ID" \
R42_EXECUTION_LOCK=/opt/zero/reasoner42-execution.lock \
  timeout --signal=TERM --kill-after=30s "${remaining}s" \
  ./reasoner42 sealed-run /tmp/result.json \
  > /tmp/sealed-summary.json 2> /tmp/sealed-stderr.log
runner_exit=$?
set -e
upload_if_present /tmp/sealed-summary.json sealed-summary.json
upload_if_present /tmp/sealed-stderr.log sealed-stderr.log
if [ "$runner_exit" -ne 0 ] || [ ! -s /tmp/result.json ]; then
  if grep -q 'Reasoner 4.2 sealed gate failed' /tmp/sealed-stderr.log; then
    PHASE=sealed-no-go
    write_status no-go "$runner_exit"
  else
    PHASE=failed
    write_status failed "$runner_exit"
  fi
  upload_status
  TERMINAL_WRITTEN=1
  exit "$runner_exit"
fi

jq -e '
  .schema == "zero.reasoner42_abstraction_library.v1" and
  .version == "4.2" and
  .development_gate_passed == true and
  .library_digest == "3cf6bb033d68d2a3" and
  .planned_sealed_raw_programs == 820 and
  .planned_sealed_base_raw_programs == 55987 and
  .sealed_base_tokens == 102 and
  .sealed_library_tokens == 51 and
  .sealed_minimum_certificate_passed == true and
  .sealed.target_programs == 17 and
  .sealed.episodes == 34 and
  .sealed.replay_checks == 2754 and
  .sealed.exact_replays == 2754 and
  .sealed.applications == 102 and
  .sealed.exact_applications == 102 and
  .sealed.reports == 34 and
  .sealed.exact_reports == 34 and
  .sealed.premature_commits == 0 and
  .sealed.maximum_queries <= 2 and
  .sealed.exact == true and
  .sealed_gate_passed == true and
  (.result_digest | test("^[0-9a-f]{16}$"))
' /tmp/result.json >/dev/null
result_sha256=$(sha256sum /tmp/result.json | awk '{print $1}')
result_key="${RESULT_PREFIX}/result.json"
aws s3 cp /tmp/result.json "s3://${TRAINING_BUCKET}/${result_key}" \
  --only-show-errors
PHASE=complete
write_status complete 0 "$result_key" "$result_sha256"
awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS_FILE")" \
  -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
upload_status
TERMINAL_WRITTEN=1
exit 0

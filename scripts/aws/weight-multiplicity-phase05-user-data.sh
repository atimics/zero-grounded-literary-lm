#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/weight-multiplicity-phase05.log
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
PACKAGE_KEY=$(tag PackageKey)
PACKAGE_SHA256=$(tag PackageSha256)
BUCKET=$(tag Bucket)
AWS_DEFAULT_REGION=$(tag Region)
SOURCE_COMMIT=$(tag SourceCommit)
ILXYR_COMMIT=$(tag IlxyrCommit)
CONTRACT_SHA256=$(tag ContractSha256)
APPROVAL_ID=$(tag ApprovalId)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
WORKLOAD_TIMEOUT_SECONDS=$(tag WorkloadTimeoutSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
PREFIX="experiments/weight-multiplicity-phase05-cloud-v1/runs/${RUN_ID}"
STATUS=/tmp/weight-multiplicity-status.json
OUT=/opt/ilxyr/out
PHASE=bootstrap
TERMINAL_WRITTEN=0
SYNC_PID=

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$MAX_INSTANCE_SECONDS" = 31764
test "$WORKLOAD_TIMEOUT_SECONDS" = 30900
test "$MAX_COMPUTE_USD" = 6.00
test "$HOURLY_PRICE" = 0.68
test "$APPROVAL_ID" = weight-multiplicity-phase05-cloud-2026-08-30-v1
[[ "$RUN_ID" =~ ^[0-9]+$ ]]
[[ "$PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
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
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status" --arg phase "$PHASE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg package_sha256 "$PACKAGE_SHA256" \
    --arg source_commit "$SOURCE_COMMIT" --arg ilxyr_commit "$ILXYR_COMMIT" \
    --arg contract_sha256 "$CONTRACT_SHA256" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson cost "$cost" \
    '{schema:"ilxyr.weight_multiplicity_cloud_status.v1",
      status:$status,phase:$phase,run_id:$run_id,instance_id:$instance_id,
      package_sha256:$package_sha256,source_commit:$source_commit,
      ilxyr_commit:$ilxyr_commit,contract_sha256:$contract_sha256,
      exit_code:$exit_code,elapsed_instance_seconds:$elapsed,
      estimated_ec2_usd:$cost}' > "$STATUS"
}
upload_status() {
  aws s3 cp "$STATUS" "s3://${BUCKET}/${PREFIX}/terminal-status.json" \
    --only-show-errors
}
sync_outputs() {
  test -d "$OUT" || return 0
  aws s3 sync "$OUT/" "s3://${BUCKET}/${PREFIX}/state/" --only-show-errors
}
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  test -z "$SYNC_PID" || kill "$SYNC_PID" 2>/dev/null
  sync_outputs
  aws s3 cp "$BOOT_LOG" "s3://${BUCKET}/${PREFIX}/bootstrap.log" \
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
apt-get install -y -qq ca-certificates curl jq nodejs unzip
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

PHASE=package
write_status running 0
upload_status
aws s3 cp "s3://${BUCKET}/${PACKAGE_KEY}" /tmp/package.tar.gz --only-show-errors
test "$(sha256sum /tmp/package.tar.gz | awk '{print $1}')" = "$PACKAGE_SHA256"
install -d -m 0755 /opt/ilxyr/package "$OUT"
tar -xzf /tmp/package.tar.gz -C /opt/ilxyr/package
cd /opt/ilxyr/package
sha256sum --check PACKAGE-SHA256SUMS
test "$(jq -r .execution.source_commit execution-record.json)" = "$SOURCE_COMMIT"
test "$(jq -r .execution.ilxyr_commit execution-record.json)" = "$ILXYR_COMMIT"
test "$(jq -r .execution.contract_sha256 execution-record.json)" = "$CONTRACT_SHA256"
test "$(sha256sum examples/weight-multiplicity/phase05-cloud-experiment.json | awk '{print $1}')" = \
  "$CONTRACT_SHA256"
test "$(sha256sum weight_multiplicity | awk '{print $1}')" = \
  "$(jq -r .oracle_executable_sha256 examples/weight-multiplicity/phase05-cloud-representation-manifest.json)"

( while true; do sync_outputs || true; sleep 30; done ) &
SYNC_PID=$!
export ILXYR_CONTROLLER_REVISION="$ILXYR_COMMIT"

PHASE=default_frontier
write_status running 0
upload_status
unset ZERO_WEIGHT_MEMO_INITIAL_CAPACITY
remaining=$((LAUNCH_EPOCH + WORKLOAD_TIMEOUT_SECONDS - $(date +%s)))
test "$remaining" -gt 0
timeout --signal=TERM --kill-after=60s "${remaining}s" \
  node scripts/run-weight-multiplicity-phase05.mjs \
    --plan examples/weight-multiplicity/phase05-cloud-frontier-plan.json \
    --oracle ./weight_multiplicity \
    --manifest examples/weight-multiplicity/phase05-cloud-representation-manifest.json \
    --out "$OUT/default-frontier.json"

PHASE=presized_selection
write_status running 0
upload_status
node scripts/prepare-weight-multiplicity-memory-audit.mjs select \
  --frontier "$OUT/default-frontier.json" \
  --manifest examples/weight-multiplicity/phase05-cloud-representation-manifest.json \
  --out "$OUT/presized-manifest.json"

PHASE=presized_frontier
write_status running 0
upload_status
export ZERO_WEIGHT_MEMO_INITIAL_CAPACITY=8388608
remaining=$((LAUNCH_EPOCH + WORKLOAD_TIMEOUT_SECONDS - $(date +%s)))
test "$remaining" -gt 0
timeout --signal=TERM --kill-after=60s "${remaining}s" \
  node scripts/run-weight-multiplicity-phase05.mjs \
    --plan examples/weight-multiplicity/phase05-cloud-frontier-plan.json \
    --oracle ./weight_multiplicity --manifest "$OUT/presized-manifest.json" \
    --out "$OUT/presized-frontier.json"

PHASE=comparison
write_status running 0
upload_status
node scripts/prepare-weight-multiplicity-memory-audit.mjs compare \
  --default "$OUT/default-frontier.json" \
  --presized "$OUT/presized-frontier.json" \
  --out "$OUT/memory-policy-comparison.json"
cp execution-record.json "$OUT/execution-record.json"
gzip -n "$OUT/default-frontier.json" "$OUT/presized-frontier.json"
cd "$OUT"
sha256sum default-frontier.json.gz presized-frontier.json.gz \
  memory-policy-comparison.json execution-record.json presized-manifest.json \
  > sha256sums.txt
aws s3 sync "$OUT/" "s3://${BUCKET}/${PREFIX}/results/" --only-show-errors

PHASE=complete
write_status complete 0
awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS")" \
  -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
upload_status
TERMINAL_WRITTEN=1
exit 0

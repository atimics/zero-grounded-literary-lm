#!/bin/bash

set -Eeuo pipefail

AUTH=benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json
action=${1:-}
test "$action" = self-test || test "$action" = dry-run || test "$action" = launch

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

approval_id=$(jq -r .authorization_id "$AUTH")
maximum_attempts=$(jq -r .budget.maximum_attempts "$AUTH")
maximum_seconds=$(jq -r .budget.maximum_seconds_per_attempt "$AUTH")
max_usd=$(jq -r .budget.maximum_compute_usd_per_attempt "$AUTH")
hourly_price=$(jq -r .budget.hourly_price_usd "$AUTH")
test "$approval_id" = zero5-ht1-mergetree-aws-2026-09-04-v1
test "$maximum_attempts" = 5
test "$maximum_seconds" = 9000
test "$max_usd" = 1.7
test "$hourly_price" = 0.68
awk -v seconds="$maximum_seconds" -v price="$hourly_price" \
  -v ceiling="$max_usd" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling &&
    (seconds + 1) * price / 3600 > ceiling) }'
if [ "$action" = self-test ]; then
  echo "ZERO.5 HT1 AWS launch self-test passed"
  exit 0
fi

for name in ZERO5_AMI ZERO5_SECURITY_GROUP_ID ZERO5_SUBNET_ID \
  ZERO5_SOURCE_COMMIT ZERO5_SERIES_ID ZERO5_ATTEMPT ZERO5_SOURCE_KEY \
  ZERO5_SOURCE_SHA256 ZERO5_ASSET_KEY ZERO5_ASSET_SHA256 \
  ZERO5_TRAINING_BUCKET ZERO5_REGION ZERO5_AUTHORIZATION_SHA256; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

test "$ZERO5_REGION" = us-east-1
test "$ZERO5_AUTHORIZATION_SHA256" = "$(digest_file "$AUTH")"
test "$(jq -r .authorized "$AUTH")" = true
[[ "$ZERO5_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO5_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ZERO5_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_AUTHORIZATION_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_SERIES_ID" =~ ^ht1-[a-z0-9-]{8,40}$ ]]
[[ "$ZERO5_ATTEMPT" =~ ^[1-5]$ ]]
test "$ZERO5_ATTEMPT" -le "$maximum_attempts"
run_id="${ZERO5_SERIES_ID}-a${ZERO5_ATTEMPT}"
launch_epoch=$(date +%s)

tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero5-ht1},{Key=Experiment,Value=zero5-ht1-mergetree-v1},{Key=Commit,Value=${ZERO5_SOURCE_COMMIT}},{Key=SeriesId,Value=${ZERO5_SERIES_ID}},{Key=RunId,Value=${run_id}},{Key=Attempt,Value=${ZERO5_ATTEMPT}},{Key=SourceKey,Value=${ZERO5_SOURCE_KEY}},{Key=SourceSha256,Value=${ZERO5_SOURCE_SHA256}},{Key=AssetKey,Value=${ZERO5_ASSET_KEY}},{Key=AssetSha256,Value=${ZERO5_ASSET_SHA256}},{Key=TrainingBucket,Value=${ZERO5_TRAINING_BUCKET}},{Key=AuthorizationSha256,Value=${ZERO5_AUTHORIZATION_SHA256}},{Key=Region,Value=${ZERO5_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${maximum_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${approval_id}}]"
client_token="${ZERO5_SERIES_ID}-attempt-${ZERO5_ATTEMPT}"
request=(ec2 run-instances
  --region "$ZERO5_REGION"
  --image-id "$ZERO5_AMI"
  --instance-type c6i.4xlarge
  --client-token "$client_token"
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${ZERO5_SUBNET_ID},Groups=${ZERO5_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/zero5-ht1-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=zero5-ht1-mergetree-v1},{Key=SeriesId,Value=${ZERO5_SERIES_ID}},{Key=Attempt,Value=${ZERO5_ATTEMPT}}]"
  --query 'Instances[0].InstanceId'
  --output text
  --no-cli-pager)

if [ "$action" = dry-run ]; then
  set +e
  output=$(aws "${request[@]}" --dry-run 2>&1)
  status=$?
  set -e
  test "$status" -ne 0
  grep -q DryRunOperation <<<"$output"
  echo "ZERO.5 HT1 AWS dry-run passed"
  exit 0
fi

test "$(jq -r .launch_readiness.ready "$AUTH")" = true
test "$(jq -r .scope.source_upload_authorized "$AUTH")" = true
test "$(jq -r .scope.private_artifact_upload_authorized "$AUTH")" = true
prefix="experiments/zero5-ht1-mergetree-v1/${ZERO5_SERIES_ID}"
if [ "$ZERO5_ATTEMPT" -gt 1 ]; then
  previous=$((ZERO5_ATTEMPT - 1))
  prior_status=$(aws s3 cp --region "$ZERO5_REGION" \
    "s3://${ZERO5_TRAINING_BUCKET}/${prefix}/attempts/${previous}/status.json" - \
    --only-show-errors | jq -r .status)
  test "$prior_status" = recoverable
fi

put_lock() {
  key=$1
  body=$2
  existing=$(mktemp)
  if aws s3api head-object --region "$ZERO5_REGION" \
      --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" \
      --no-cli-pager >/dev/null 2>&1; then
    aws s3api get-object --region "$ZERO5_REGION" \
      --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" "$existing" \
      --no-cli-pager >/dev/null
    test "$(jq -r .series_id "$existing")" = "$ZERO5_SERIES_ID"
    test "$(jq -r .approval_id "$existing")" = "$approval_id"
    test "$(jq -r .authorization_sha256 "$existing")" = \
      "$ZERO5_AUTHORIZATION_SHA256"
    test "$(jq -r .source_sha256 "$existing")" = "$ZERO5_SOURCE_SHA256"
    test "$(jq -r .asset_sha256 "$existing")" = "$ZERO5_ASSET_SHA256"
  else
    aws s3api put-object --region "$ZERO5_REGION" \
      --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" --body "$body" \
      --content-type application/json --if-none-match '*' \
      --no-cli-pager >/dev/null
  fi
}

lock=$(mktemp)
jq -n --arg series_id "$ZERO5_SERIES_ID" --arg run_id "$run_id" \
  --arg approval_id "$approval_id" \
  --arg authorization_sha256 "$ZERO5_AUTHORIZATION_SHA256" \
  --arg source_sha256 "$ZERO5_SOURCE_SHA256" \
  --arg asset_sha256 "$ZERO5_ASSET_SHA256" \
  --argjson attempt "$ZERO5_ATTEMPT" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$max_usd" \
  '{schema:"zero.ht1_aws_execution_lock.v1",series_id:$series_id,
    run_id:$run_id,attempt:$attempt,approval_id:$approval_id,
    authorization_sha256:$authorization_sha256,
    source_sha256:$source_sha256,asset_sha256:$asset_sha256,
    maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' > "$lock"
put_lock "experiments/zero5-ht1-mergetree-v1/${approval_id}.execution.lock" "$lock"
put_lock "${prefix}/attempts/${ZERO5_ATTEMPT}/execution.lock" "$lock"

receipt_key="${prefix}/attempts/${ZERO5_ATTEMPT}/launch.json"
existing_receipt=$(mktemp)
if aws s3api head-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$receipt_key" \
    --no-cli-pager >/dev/null 2>&1; then
  aws s3api get-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$receipt_key" \
    "$existing_receipt" --no-cli-pager >/dev/null
  test "$(jq -r .series_id "$existing_receipt")" = "$ZERO5_SERIES_ID"
  test "$(jq -r .attempt "$existing_receipt")" = "$ZERO5_ATTEMPT"
  test "$(jq -r .authorization_sha256 "$existing_receipt")" = \
    "$ZERO5_AUTHORIZATION_SHA256"
  test "$(jq -r .source_sha256 "$existing_receipt")" = "$ZERO5_SOURCE_SHA256"
  test "$(jq -r .asset_sha256 "$existing_receipt")" = "$ZERO5_ASSET_SHA256"
  jq -r .instance_id "$existing_receipt"
  exit 0
fi

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
receipt=$(mktemp)
jq -n --arg series_id "$ZERO5_SERIES_ID" --arg run_id "$run_id" \
  --arg instance_id "$instance_id" --arg source_commit "$ZERO5_SOURCE_COMMIT" \
  --arg source_key "$ZERO5_SOURCE_KEY" --arg source_sha256 "$ZERO5_SOURCE_SHA256" \
  --arg asset_key "$ZERO5_ASSET_KEY" --arg asset_sha256 "$ZERO5_ASSET_SHA256" \
  --arg authorization_sha256 "$ZERO5_AUTHORIZATION_SHA256" \
  --arg approval_id "$approval_id" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson attempt "$ZERO5_ATTEMPT" --argjson launch_epoch "$launch_epoch" \
  --argjson maximum_seconds "$maximum_seconds" --argjson maximum_usd "$max_usd" \
  '{schema:"zero.ht1_aws_launch.v1",series_id:$series_id,run_id:$run_id,
    attempt:$attempt,instance_id:$instance_id,source_commit:$source_commit,
    source_key:$source_key,source_sha256:$source_sha256,
    asset_key:$asset_key,asset_sha256:$asset_sha256,
    authorization_sha256:$authorization_sha256,approval_id:$approval_id,
    launched_at:$launched_at,launch_epoch:$launch_epoch,
    maximum_instance_seconds:$maximum_seconds,maximum_ec2_usd:$maximum_usd}' \
  > "$receipt"
receipt_sha256=$(digest_file "$receipt")
aws s3api put-object --region "$ZERO5_REGION" \
  --bucket "$ZERO5_TRAINING_BUCKET" --key "$receipt_key" --body "$receipt" \
  --content-type application/json --metadata "sha256=${receipt_sha256}" \
  --if-none-match '*' --no-cli-pager >/dev/null
printf '%s\n' "$instance_id"

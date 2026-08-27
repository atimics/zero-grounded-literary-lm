#!/bin/bash

set -Eeuo pipefail

for name in ZERO5_AMI ZERO5_SECURITY_GROUP_ID ZERO5_SUBNET_ID \
  ZERO5_SOURCE_COMMIT ZERO5_RUN_ID ZERO5_SOURCE_KEY ZERO5_SOURCE_SHA256 \
  ZERO5_ASSET_KEY ZERO5_ASSET_SHA256 ZERO5_TRAINING_BUCKET ZERO5_REGION \
  ZERO5_CONTRACT_SHA256 ZERO5_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
test "$action" = dry-run || test "$action" = launch || test "$action" = resume
max_usd=3.4
hourly_price=0.68
prior_compute_usd=${ZERO5_PRIOR_COMPUTE_USD:-0}
max_segment_seconds=9000
lock_key=experiments/zero5-c33-v1/execution-v2.lock

test "$ZERO5_REGION" = us-east-1
test "$ZERO5_APPROVAL_ID" = zero5-c33-aws-2026-08-26-v1
[[ "$ZERO5_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO5_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ZERO5_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
awk -v prior="$prior_compute_usd" -v ceiling="$max_usd" \
  'BEGIN { exit !(prior >= 0 && prior < ceiling) }'

if [ "$action" = resume ]; then
  lock_file=$(mktemp)
  aws s3 cp "s3://${ZERO5_TRAINING_BUCKET}/${lock_key}" "$lock_file" \
    --region "$ZERO5_REGION" --only-show-errors
  test "$(jq -r .schema "$lock_file")" = zero.c33_aws_execution_lock.v1
  test "$(jq -r .run_id "$lock_file")" = "$ZERO5_RUN_ID"
  test "$(jq -r .contract_sha256 "$lock_file")" = "$ZERO5_CONTRACT_SHA256"
  test "$(jq -r .approval_id "$lock_file")" = "$ZERO5_APPROVAL_ID"
  prior_status=$(mktemp)
  aws s3 cp \
    "s3://${ZERO5_TRAINING_BUCKET}/experiments/zero5-c33-v1/${ZERO5_RUN_ID}/status.json" \
    "$prior_status" --region "$ZERO5_REGION" --only-show-errors
  test "$(jq -r .status "$prior_status")" = recoverable
  prior_compute_usd=$(jq -r .estimated_ec2_usd "$prior_status")
fi
max_seconds=$(awk -v ceiling="$max_usd" -v prior="$prior_compute_usd" \
  -v price="$hourly_price" -v segment="$max_segment_seconds" \
  'BEGIN {
    value=int((ceiling-prior)*3600/price)
    if (value > segment) value=segment
    if (value < 1) exit 1
    print value
  }')
launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero5-c33},{Key=Experiment,Value=zero5-c33-v1},{Key=Commit,Value=${ZERO5_SOURCE_COMMIT}},{Key=RunId,Value=${ZERO5_RUN_ID}},{Key=SourceKey,Value=${ZERO5_SOURCE_KEY}},{Key=SourceSha256,Value=${ZERO5_SOURCE_SHA256}},{Key=AssetKey,Value=${ZERO5_ASSET_KEY}},{Key=AssetSha256,Value=${ZERO5_ASSET_SHA256}},{Key=TrainingBucket,Value=${ZERO5_TRAINING_BUCKET}},{Key=DatasetDigest,Value=4412223f47c07a206ad2703c02ed8bcfd42d27561a287836ed26e9cacccf142d},{Key=ContractSha256,Value=${ZERO5_CONTRACT_SHA256}},{Key=Region,Value=${ZERO5_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${max_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=PriorComputeUsd,Value=${prior_compute_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${ZERO5_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$ZERO5_REGION"
  --image-id "$ZERO5_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${ZERO5_SUBNET_ID},Groups=${ZERO5_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/zero5-c33-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=zero5-c33-v1},{Key=RunId,Value=${ZERO5_RUN_ID}}]"
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
  echo "ZERO.5 C3.3 AWS dry-run passed"
  exit 0
fi

if [ "$action" = launch ]; then
  lock=$(mktemp)
  jq -n --arg run_id "$ZERO5_RUN_ID" \
    --arg contract_sha256 "$ZERO5_CONTRACT_SHA256" \
    --arg approval_id "$ZERO5_APPROVAL_ID" \
    --arg source_sha256 "$ZERO5_SOURCE_SHA256" \
    --arg asset_sha256 "$ZERO5_ASSET_SHA256" \
    '{schema:"zero.c33_aws_execution_lock.v1",run_id:$run_id,
      contract_sha256:$contract_sha256,approval_id:$approval_id,
      source_sha256:$source_sha256,asset_sha256:$asset_sha256}' > "$lock"
  aws s3api put-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$lock_key" --body "$lock" \
    --content-type application/json --if-none-match '*' \
    --no-cli-pager >/dev/null
fi

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
receipt=$(mktemp)
jq -n --arg run_id "$ZERO5_RUN_ID" --arg instance_id "$instance_id" \
  --arg action "$action" --arg source_commit "$ZERO5_SOURCE_COMMIT" \
  --arg source_sha256 "$ZERO5_SOURCE_SHA256" \
  --arg asset_sha256 "$ZERO5_ASSET_SHA256" \
  --arg contract_sha256 "$ZERO5_CONTRACT_SHA256" \
  --arg approval_id "$ZERO5_APPROVAL_ID" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson launch_epoch "$launch_epoch" --argjson maximum_seconds "$max_seconds" \
  --argjson prior_compute_usd "$prior_compute_usd" \
  --argjson maximum_usd "$max_usd" \
  '{schema:"zero.c33_aws_launch.v1",run_id:$run_id,instance_id:$instance_id,
    action:$action,source_commit:$source_commit,source_sha256:$source_sha256,
    asset_sha256:$asset_sha256,contract_sha256:$contract_sha256,
    approval_id:$approval_id,launched_at:$launched_at,
    launch_epoch:$launch_epoch,prior_compute_usd:$prior_compute_usd,
    maximum_instance_seconds:$maximum_seconds,maximum_ec2_usd:$maximum_usd}' \
  > "$receipt"
receipt_sha256=$(sha256sum "$receipt" | awk '{print $1}')
aws s3api put-object --region "$ZERO5_REGION" \
  --bucket "$ZERO5_TRAINING_BUCKET" \
  --key "experiments/zero5-c33-v1/${ZERO5_RUN_ID}/launch-${launch_epoch}.json" \
  --body "$receipt" --content-type application/json \
  --metadata "sha256=${receipt_sha256}" --if-none-match '*' \
  --no-cli-pager >/dev/null
printf '%s\n' "$instance_id"

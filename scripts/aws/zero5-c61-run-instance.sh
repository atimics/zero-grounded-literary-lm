#!/bin/bash

set -Eeuo pipefail

for name in ZERO5_AMI ZERO5_SECURITY_GROUP_ID ZERO5_SUBNET_ID \
  ZERO5_SOURCE_COMMIT ZERO5_RUN_ID ZERO5_SOURCE_KEY ZERO5_SOURCE_SHA256 \
  ZERO5_ASSET_KEY ZERO5_ASSET_SHA256 ZERO5_TRAINING_BUCKET ZERO5_REGION \
  ZERO5_CONTRACT_SHA256 ZERO5_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
test "$action" = dry-run || test "$action" = launch
max_usd=1.7
hourly_price=0.68
maximum_seconds=9000
lock_key=experiments/zero5-c61-shared-state-v1/execution-v3.lock

test "$ZERO5_REGION" = us-east-1
test "$ZERO5_APPROVAL_ID" = zero5-c61-shared-state-aws-2026-08-29-v1
test "$(jq -r .authorized benchmarks/zero5-c61-shared-state-v1/contract.json)" = true
test "$(jq -r .authorization.approval_id benchmarks/zero5-c61-shared-state-v1/contract.json)" = "$ZERO5_APPROVAL_ID"
test "$(jq -r .execution.venue benchmarks/zero5-c61-shared-state-v1/contract.json)" = "aws us-east-1 c6i.4xlarge on-demand"
test "$(jq -r .execution.maximum_instance_seconds benchmarks/zero5-c61-shared-state-v1/contract.json)" = "$maximum_seconds"
test "$(jq -r .execution.maximum_ec2_usd benchmarks/zero5-c61-shared-state-v1/contract.json)" = "$max_usd"
test "$(jq -r .execution.spot_instances benchmarks/zero5-c61-shared-state-v1/contract.json)" = false
[[ "$ZERO5_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO5_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ZERO5_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
awk -v seconds="$maximum_seconds" -v price="$hourly_price" \
  -v ceiling="$max_usd" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling &&
    (seconds + 1) * price / 3600 > ceiling) }'

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero5-c61},{Key=Experiment,Value=zero5-c61-shared-state-v1},{Key=Commit,Value=${ZERO5_SOURCE_COMMIT}},{Key=RunId,Value=${ZERO5_RUN_ID}},{Key=SourceKey,Value=${ZERO5_SOURCE_KEY}},{Key=SourceSha256,Value=${ZERO5_SOURCE_SHA256}},{Key=AssetKey,Value=${ZERO5_ASSET_KEY}},{Key=AssetSha256,Value=${ZERO5_ASSET_SHA256}},{Key=TrainingBucket,Value=${ZERO5_TRAINING_BUCKET}},{Key=ContractSha256,Value=${ZERO5_CONTRACT_SHA256}},{Key=Region,Value=${ZERO5_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${maximum_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${ZERO5_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$ZERO5_REGION"
  --image-id "$ZERO5_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${ZERO5_SUBNET_ID},Groups=${ZERO5_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/zero5-c61-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=zero5-c61-shared-state-v1},{Key=RunId,Value=${ZERO5_RUN_ID}}]"
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
  echo "ZERO.5 C6.1 AWS dry-run passed"
  exit 0
fi

lock=$(mktemp)
jq -n --arg run_id "$ZERO5_RUN_ID" \
  --arg contract_sha256 "$ZERO5_CONTRACT_SHA256" \
  --arg approval_id "$ZERO5_APPROVAL_ID" \
  --arg source_sha256 "$ZERO5_SOURCE_SHA256" \
  --arg asset_sha256 "$ZERO5_ASSET_SHA256" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$max_usd" \
  '{schema:"zero.c61_aws_execution_lock.v1",run_id:$run_id,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    source_sha256:$source_sha256,asset_sha256:$asset_sha256,
    maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' > "$lock"
aws s3api put-object --region "$ZERO5_REGION" \
  --bucket "$ZERO5_TRAINING_BUCKET" --key "$lock_key" --body "$lock" \
  --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
receipt=$(mktemp)
jq -n --arg run_id "$ZERO5_RUN_ID" --arg instance_id "$instance_id" \
  --arg source_commit "$ZERO5_SOURCE_COMMIT" \
  --arg source_sha256 "$ZERO5_SOURCE_SHA256" \
  --arg asset_sha256 "$ZERO5_ASSET_SHA256" \
  --arg contract_sha256 "$ZERO5_CONTRACT_SHA256" \
  --arg approval_id "$ZERO5_APPROVAL_ID" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson launch_epoch "$launch_epoch" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$max_usd" \
  '{schema:"zero.c61_aws_launch.v1",run_id:$run_id,
    instance_id:$instance_id,source_commit:$source_commit,
    source_sha256:$source_sha256,asset_sha256:$asset_sha256,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    launched_at:$launched_at,launch_epoch:$launch_epoch,
    maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' > "$receipt"
if command -v sha256sum >/dev/null 2>&1; then
  receipt_sha256=$(sha256sum "$receipt" | awk '{print $1}')
else
  receipt_sha256=$(shasum -a 256 "$receipt" | awk '{print $1}')
fi
aws s3api put-object --region "$ZERO5_REGION" \
  --bucket "$ZERO5_TRAINING_BUCKET" \
  --key "experiments/zero5-c61-shared-state-v1/${ZERO5_RUN_ID}/launch.json" \
  --body "$receipt" --content-type application/json \
  --metadata "sha256=${receipt_sha256}" --if-none-match '*' \
  --no-cli-pager >/dev/null
printf '%s\n' "$instance_id"

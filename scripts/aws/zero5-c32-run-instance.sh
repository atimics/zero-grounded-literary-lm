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
max_seconds=9000
max_usd=1.70
hourly_price=0.68

test "$ZERO5_REGION" = us-east-1
test "$ZERO5_APPROVAL_ID" = zero5-c32-aws-2026-08-24-v1
[[ "$ZERO5_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO5_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ZERO5_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO5_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero5-c32},{Key=Experiment,Value=zero5-c32-v1},{Key=Commit,Value=${ZERO5_SOURCE_COMMIT}},{Key=RunId,Value=${ZERO5_RUN_ID}},{Key=SourceKey,Value=${ZERO5_SOURCE_KEY}},{Key=SourceSha256,Value=${ZERO5_SOURCE_SHA256}},{Key=AssetKey,Value=${ZERO5_ASSET_KEY}},{Key=AssetSha256,Value=${ZERO5_ASSET_SHA256}},{Key=TrainingBucket,Value=${ZERO5_TRAINING_BUCKET}},{Key=DatasetDigest,Value=4412223f47c07a206ad2703c02ed8bcfd42d27561a287836ed26e9cacccf142d},{Key=ContractSha256,Value=${ZERO5_CONTRACT_SHA256}},{Key=Region,Value=${ZERO5_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${max_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${ZERO5_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$ZERO5_REGION"
  --image-id "$ZERO5_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${ZERO5_SUBNET_ID},Groups=${ZERO5_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/zero5-c32-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=zero5-c32-v1},{Key=RunId,Value=${ZERO5_RUN_ID}}]"
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
  echo "ZERO.5 C3.2 AWS dry-run passed"
else
  instance_id=$(aws "${request[@]}")
  [[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
  printf '%s\n' "$instance_id"
fi

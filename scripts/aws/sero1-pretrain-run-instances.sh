#!/bin/bash

set -Eeuo pipefail

for name in SERO_AMI SERO_SECURITY_GROUP_ID SERO_SUBNET_ID SERO_SOURCE_COMMIT \
  SERO_RUN_ID SERO_SOURCE_KEY SERO_SOURCE_SHA256 SERO_TRAINING_BUCKET \
  SERO_CORPUS_BUCKET SERO_DATASET_PREFIX SERO_DATASET_DIGEST SERO_REGION \
  SERO_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
mode=${2:-}
seed=${3:-}
test "$action" = dry-run || test "$action" = launch
test "$mode" = calibration || test "$mode" = full
[[ "$seed" =~ ^[012]$ ]]
if [ "$mode" = calibration ]; then
  test "$seed" = 0
  max_seconds=1800
  max_usd=0.503
else
  max_seconds=10800
  max_usd=3.018
fi

test "$SERO_REGION" = us-east-1
test "$SERO_DATASET_DIGEST" = 6919a2a55495ff3364381d0861f6295412362f6dcf5fff46fda751b779a6d6b6
[[ "$SERO_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$SERO_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SERO_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$SERO_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SERO_APPROVAL_ID" =~ ^[A-Za-z0-9_.:-]{8,128}$ ]]

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=sero},{Key=Name,Value=sero1-pretrain-${mode}-seed${seed}},{Key=Experiment,Value=sero1-pretrain-v1},{Key=Mode,Value=${mode}},{Key=Seed,Value=${seed}},{Key=Commit,Value=${SERO_SOURCE_COMMIT}},{Key=RunId,Value=${SERO_RUN_ID}},{Key=SourceKey,Value=${SERO_SOURCE_KEY}},{Key=SourceSha256,Value=${SERO_SOURCE_SHA256}},{Key=TrainingBucket,Value=${SERO_TRAINING_BUCKET}},{Key=CorpusBucket,Value=${SERO_CORPUS_BUCKET}},{Key=DatasetPrefix,Value=${SERO_DATASET_PREFIX}},{Key=DatasetDigest,Value=${SERO_DATASET_DIGEST}},{Key=Region,Value=${SERO_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${max_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=HourlyPrice,Value=1.006},{Key=ApprovalId,Value=${SERO_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$SERO_REGION"
  --image-id "$SERO_AMI"
  --instance-type g5.xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${SERO_SUBNET_ID},Groups=${SERO_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/sero1-pretrain-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":100,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=sero},{Key=Experiment,Value=sero1-pretrain-v1},{Key=RunId,Value=${SERO_RUN_ID}}]"
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
  echo "Sero 1 ${mode} seed ${seed} dry-run passed"
else
  instance_id=$(aws "${request[@]}")
  [[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
  printf '%s\n' "$instance_id"
fi

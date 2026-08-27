#!/bin/bash

set -Eeuo pipefail

for name in SERO_AMI SERO_SECURITY_GROUP_ID SERO_SUBNET_ID SERO_SOURCE_COMMIT \
  SERO_RUN_ID SERO_SOURCE_KEY SERO_SOURCE_SHA256 SERO_TRAINING_BUCKET \
  SERO_CORPUS_BUCKET SERO_DATASET_PREFIX SERO_DATASET_DIGEST SERO_REGION \
  SERO_RESUME_KEY SERO_RESUME_SHA256 SERO_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
test "$action" = dry-run || test "$action" = launch
mode=full
seed=0
max_seconds=14400
max_usd=4.024
contract=benchmarks/sero20m-consolidation-v1/contract.json

test "$SERO_REGION" = us-east-1
test "$SERO_DATASET_DIGEST" = dcad26c0cc44f449d87eb8af0d62d0518dc120a62aad049ff541c2fc149a35d8
test "$SERO_RESUME_SHA256" = "$(jq -r .initialization.checkpoint_sha256 "$contract")"
[[ "$SERO_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$SERO_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SERO_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$SERO_RESUME_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$SERO_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$SERO_APPROVAL_ID" =~ ^[A-Za-z0-9_.:-]{8,128}$ ]]

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=sero},{Key=Name,Value=sero20m-consolidation-full-seed0},{Key=Experiment,Value=sero20m-consolidation-v1},{Key=Mode,Value=${mode}},{Key=Seed,Value=${seed}},{Key=Commit,Value=${SERO_SOURCE_COMMIT}},{Key=RunId,Value=${SERO_RUN_ID}},{Key=SourceKey,Value=${SERO_SOURCE_KEY}},{Key=SourceSha256,Value=${SERO_SOURCE_SHA256}},{Key=TrainingBucket,Value=${SERO_TRAINING_BUCKET}},{Key=CorpusBucket,Value=${SERO_CORPUS_BUCKET}},{Key=DatasetPrefix,Value=${SERO_DATASET_PREFIX}},{Key=DatasetDigest,Value=${SERO_DATASET_DIGEST}},{Key=ResumeKey,Value=${SERO_RESUME_KEY}},{Key=ResumeSha256,Value=${SERO_RESUME_SHA256}},{Key=Region,Value=${SERO_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${max_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=HourlyPrice,Value=1.006},{Key=ApprovalId,Value=${SERO_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$SERO_REGION"
  --image-id "$SERO_AMI"
  --instance-type g5.xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${SERO_SUBNET_ID},Groups=${SERO_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/sero2-curriculum-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":100,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=sero},{Key=Experiment,Value=sero20m-consolidation-v1},{Key=RunId,Value=${SERO_RUN_ID}}]"
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
  echo "Sero 20M consolidation full seed 0 dry-run passed"
else
  instance_id=$(aws "${request[@]}")
  [[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
  printf '%s\n' "$instance_id"
fi

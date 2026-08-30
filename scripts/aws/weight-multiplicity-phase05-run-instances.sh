#!/bin/bash

set -Eeuo pipefail

for name in WM_AMI WM_SECURITY_GROUP_ID WM_SUBNET_ID WM_BUCKET WM_REGION \
  WM_RUN_ID WM_PACKAGE_KEY WM_PACKAGE_SHA256 WM_APPROVAL_ID WM_SOURCE_COMMIT \
  WM_ILXYR_COMMIT WM_CONTRACT_SHA256 WM_LAUNCH_EPOCH; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
test "$action" = dry-run || test "$action" = launch
test "$WM_REGION" = us-east-1
test "$WM_APPROVAL_ID" = weight-multiplicity-phase05-cloud-2026-08-30-v1
[[ "$WM_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$WM_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$WM_PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$WM_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WM_ILXYR_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$WM_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]

tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=weight-multiplicity-phase05},{Key=Experiment,Value=weight-multiplicity-phase05-cloud-v1},{Key=RunId,Value=${WM_RUN_ID}},{Key=PackageKey,Value=${WM_PACKAGE_KEY}},{Key=PackageSha256,Value=${WM_PACKAGE_SHA256}},{Key=Bucket,Value=${WM_BUCKET}},{Key=Region,Value=${WM_REGION}},{Key=SourceCommit,Value=${WM_SOURCE_COMMIT}},{Key=IlxyrCommit,Value=${WM_ILXYR_COMMIT}},{Key=ContractSha256,Value=${WM_CONTRACT_SHA256}},{Key=ApprovalId,Value=${WM_APPROVAL_ID}},{Key=LaunchEpoch,Value=${WM_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=31764},{Key=WorkloadTimeoutSeconds,Value=30900},{Key=MaxComputeUsd,Value=6.00},{Key=HourlyPrice,Value=0.68}]"

request=(ec2 run-instances
  --region "$WM_REGION"
  --image-id "$WM_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${WM_SUBNET_ID},Groups=${WM_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/weight-multiplicity-phase05-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=weight-multiplicity-phase05-cloud-v1},{Key=RunId,Value=${WM_RUN_ID}}]"
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
  echo "weight-multiplicity Phase 0.5 AWS dry-run passed"
  exit 0
fi

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
printf '%s\n' "$instance_id"

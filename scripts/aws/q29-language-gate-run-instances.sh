#!/bin/bash

set -Eeuo pipefail

for name in ZERO_AMI ZERO_SECURITY_GROUP_ID ZERO_SUBNET_ID ZERO_COMMIT \
  ZERO_RUN_ID ZERO_BUCKET ZERO_REGION ZERO_BUDGET_FILE ZERO_BUDGET_SHA256 \
  ZERO_WORKLOAD_SHA256 ZERO_USER_DATA_SHA256 ZERO_SOURCE_SHA256 \
  ZERO_SCREEN_SHA256 ZERO_LAUNCH_EPOCH ZERO_CANDIDATE_SHA256 \
  ZERO_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

test "${ZERO_INSTANCE_TYPE:-}" = c6i.4xlarge
test "$ZERO_REGION" = us-east-1
test "${ZERO_MAX_INSTANCE_SECONDS:-}" = 600
test "${ZERO_WORKLOAD_TIMEOUT_SECONDS:-}" = 540
test "${ZERO_MAX_COMPUTE_USD:-}" = 0.12
[[ "$ZERO_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ZERO_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$ZERO_BUDGET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO_WORKLOAD_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO_USER_DATA_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO_SCREEN_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO_CANDIDATE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
[[ "$ZERO_APPROVAL_ID" =~ ^[A-Za-z0-9_.:-]{8,128}$ ]]

tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero-q29-language-gate},{Key=Experiment,Value=zero4-q29-seed2-language-gate-v1},{Key=Commit,Value=${ZERO_COMMIT}},{Key=RunId,Value=${ZERO_RUN_ID}},{Key=Bucket,Value=${ZERO_BUCKET}},{Key=Region,Value=${ZERO_REGION}},{Key=BudgetFile,Value=${ZERO_BUDGET_FILE}},{Key=BudgetSha256,Value=${ZERO_BUDGET_SHA256}},{Key=WorkloadSha256,Value=${ZERO_WORKLOAD_SHA256}},{Key=SourceSha256,Value=${ZERO_SOURCE_SHA256}},{Key=ScreenSha256,Value=${ZERO_SCREEN_SHA256}},{Key=CandidateSha256,Value=${ZERO_CANDIDATE_SHA256}},{Key=ApprovalId,Value=${ZERO_APPROVAL_ID}},{Key=LaunchEpoch,Value=${ZERO_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=600},{Key=WorkloadTimeoutSeconds,Value=540},{Key=MaxComputeUsd,Value=0.12}]"

request=(ec2 run-instances
  --image-id "$ZERO_AMI"
  --instance-type c6i.4xlarge
  --iam-instance-profile Name=zero-training-ec2
  --security-group-ids "$ZERO_SECURITY_GROUP_ID"
  --subnet-id "$ZERO_SUBNET_ID"
  --user-data file://scripts/aws/q29-language-gate-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":16,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=RunId,Value=${ZERO_RUN_ID}}]"
  --query 'Instances[0].InstanceId' --output text --no-cli-pager)

case "${1:-}" in
  dry-run)
    set +e
    output=$(aws "${request[@]}" --dry-run 2>&1)
    status=$?
    set -e
    test "$status" -ne 0
    grep -q DryRunOperation <<<"$output"
    ;;
  launch)
    instance_id=$(aws "${request[@]}")
    [[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
    printf '%s\n' "$instance_id"
    ;;
  *)
    echo "usage: $0 dry-run|launch" >&2
    exit 2
    ;;
esac

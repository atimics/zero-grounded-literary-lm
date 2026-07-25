#!/bin/bash
# Construct the exact Q2.7 EC2 request once for both preflight and launch.

set -Eeuo pipefail

mode=${1:-}
case "$mode" in
  dry-run|launch) ;;
  *)
    echo "usage: $0 {dry-run|launch}" >&2
    exit 2
    ;;
esac

for name in \
  ZERO_AMI \
  ZERO_INSTANCE_TYPE \
  ZERO_SECURITY_GROUP_ID \
  ZERO_SUBNET_ID \
  ZERO_COMMIT \
  ZERO_RUN_ID \
  ZERO_BUCKET \
  ZERO_REGION \
  ZERO_BUDGET_FILE \
  ZERO_BUDGET_SHA256 \
  ZERO_WORKLOAD_SHA256 \
  ZERO_SOURCE_SHA256 \
  ZERO_LAUNCH_EPOCH \
  ZERO_MAX_INSTANCE_SECONDS \
  ZERO_WORKLOAD_TIMEOUT_SECONDS \
  ZERO_MAX_COMPUTE_USD \
  ZERO_HOURLY_RATE_USD; do
  test -n "${!name:-}" || {
    echo "$name is required" >&2
    exit 2
  }
done

[[ "$ZERO_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$ZERO_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
test "$ZERO_INSTANCE_TYPE" = c6i.4xlarge
test "$ZERO_MAX_INSTANCE_SECONDS" = 6190
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = 6130
test "$ZERO_MAX_COMPUTE_USD" = 1.17
test -s scripts/aws/q27-seed2-user-data.sh

request=(
  --image-id "$ZERO_AMI"
  --instance-type "$ZERO_INSTANCE_TYPE"
  --iam-instance-profile Name=zero-training-ec2
  --security-group-ids "$ZERO_SECURITY_GROUP_ID"
  --subnet-id "$ZERO_SUBNET_ID"
  --user-data file://scripts/aws/q27-seed2-user-data.sh
  --metadata-options
    HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled
  --block-device-mappings
    '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":32,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications
    "ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero4-q27-seed2},{Key=Experiment,Value=zero4-q27-aws-v1},{Key=Commit,Value=${ZERO_COMMIT}},{Key=RunId,Value=${ZERO_RUN_ID}},{Key=Bucket,Value=${ZERO_BUCKET}},{Key=Region,Value=${ZERO_REGION}},{Key=BudgetFile,Value=${ZERO_BUDGET_FILE}},{Key=BudgetSha256,Value=${ZERO_BUDGET_SHA256}},{Key=WorkloadSha256,Value=${ZERO_WORKLOAD_SHA256}},{Key=SourceArchiveSha256,Value=${ZERO_SOURCE_SHA256}},{Key=LaunchEpoch,Value=${ZERO_LAUNCH_EPOCH}},{Key=MaxInstanceSeconds,Value=${ZERO_MAX_INSTANCE_SECONDS}},{Key=WorkloadTimeoutSeconds,Value=${ZERO_WORKLOAD_TIMEOUT_SECONDS}},{Key=MaxComputeUsd,Value=${ZERO_MAX_COMPUTE_USD}},{Key=HourlyRateUsd,Value=${ZERO_HOURLY_RATE_USD}}]"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=zero4-q27-aws-v1},{Key=RunId,Value=${ZERO_RUN_ID}}]"
  --query 'Instances[0].InstanceId'
  --output text
  --no-cli-pager
)

if [ "$mode" = launch ]; then
  aws ec2 run-instances "${request[@]}"
  exit
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
set +e
aws ec2 run-instances "${request[@]}" --dry-run \
  >"$tmpdir/stdout" 2>"$tmpdir/stderr"
dry_run_exit=$?
set -e

test "$dry_run_exit" -ne 0 || {
  echo "EC2 dry-run unexpectedly returned success" >&2
  exit 1
}
if grep -q 'UnauthorizedOperation' "$tmpdir/stderr"; then
  cat "$tmpdir/stderr" >&2
  echo "EC2 dry-run rejected RunInstances or iam:PassRole" >&2
  exit 1
fi
grep -q 'DryRunOperation' "$tmpdir/stderr" || {
  cat "$tmpdir/stderr" >&2
  echo "EC2 dry-run did not return DryRunOperation" >&2
  exit 1
}
echo "DryRunOperation: exact RunInstances request and iam:PassRole authorized"

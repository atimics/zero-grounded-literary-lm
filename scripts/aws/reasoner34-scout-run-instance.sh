#!/bin/bash

set -Eeuo pipefail

for name in SCOUT_EXPERIMENT SCOUT_VERSION SCOUT_BINARY SCOUT_MAKE_TARGET \
  SCOUT_RESULT_SCHEMA SCOUT_CONTRACT SCOUT_AMI SCOUT_SECURITY_GROUP_ID \
  SCOUT_SUBNET_ID SCOUT_SOURCE_COMMIT SCOUT_RUN_ID SCOUT_SOURCE_KEY \
  SCOUT_SOURCE_SHA256 SCOUT_TRAINING_BUCKET SCOUT_REGION \
  SCOUT_CONTRACT_SHA256 SCOUT_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
test "$action" = dry-run || test "$action" = launch
instance_type=t3.micro
hourly_price=0.0104
maximum_seconds=1800
maximum_ec2_usd=0.006
lock_key="experiments/${SCOUT_EXPERIMENT}/execution.lock"

test "$SCOUT_REGION" = us-east-1
test "$(jq -r .authorized "$SCOUT_CONTRACT")" = true
test "$(jq -r .experiment "$SCOUT_CONTRACT")" = "$SCOUT_EXPERIMENT"
test "$(jq -r .version "$SCOUT_CONTRACT")" = "$SCOUT_VERSION"
test "$(jq -r .authorization.approval_id "$SCOUT_CONTRACT")" = "$SCOUT_APPROVAL_ID"
test "$(jq -r .source.implementation_commit "$SCOUT_CONTRACT")" = "$SCOUT_SOURCE_COMMIT"
test "$(jq -r .result.binary "$SCOUT_CONTRACT")" = "$SCOUT_BINARY"
test "$(jq -r .result.make_target "$SCOUT_CONTRACT")" = "$SCOUT_MAKE_TARGET"
test "$(jq -r .result.schema "$SCOUT_CONTRACT")" = "$SCOUT_RESULT_SCHEMA"
test "$(jq -r .execution.instance_type "$SCOUT_CONTRACT")" = "$instance_type"
test "$(jq -r .execution.maximum_instance_seconds "$SCOUT_CONTRACT")" = "$maximum_seconds"
test "$(jq -r .execution.maximum_ec2_usd "$SCOUT_CONTRACT")" = "$maximum_ec2_usd"
test "$(jq -r .price_evidence.usd_per_hour "$SCOUT_CONTRACT")" = "$hourly_price"
[[ "$SCOUT_EXPERIMENT" =~ ^[a-z0-9-]{8,100}$ ]]
[[ "$SCOUT_BINARY" =~ ^[a-zA-Z0-9_]{3,80}$ ]]
[[ "$SCOUT_MAKE_TARGET" =~ ^[a-zA-Z0-9_-]{3,80}$ ]]
[[ "$SCOUT_RESULT_SCHEMA" =~ ^[a-zA-Z0-9_.-]{8,120}$ ]]
[[ "$SCOUT_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$SCOUT_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$SCOUT_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$SCOUT_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SCOUT_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$SCOUT_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$SCOUT_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
awk -v seconds="$maximum_seconds" -v price="$hourly_price" \
  -v ceiling="$maximum_ec2_usd" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling) }'

existing=$(aws s3api list-objects-v2 --region "$SCOUT_REGION" \
  --bucket "$SCOUT_TRAINING_BUCKET" --prefix "$lock_key" --max-keys 1 \
  --query 'Contents[0].Key' --output text --no-cli-pager)
test "$existing" = None

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=${SCOUT_EXPERIMENT}},{Key=Experiment,Value=${SCOUT_EXPERIMENT}},{Key=Version,Value=${SCOUT_VERSION}},{Key=Binary,Value=${SCOUT_BINARY}},{Key=MakeTarget,Value=${SCOUT_MAKE_TARGET}},{Key=ResultSchema,Value=${SCOUT_RESULT_SCHEMA}},{Key=Commit,Value=${SCOUT_SOURCE_COMMIT}},{Key=RunId,Value=${SCOUT_RUN_ID}},{Key=SourceKey,Value=${SCOUT_SOURCE_KEY}},{Key=SourceSha256,Value=${SCOUT_SOURCE_SHA256}},{Key=TrainingBucket,Value=${SCOUT_TRAINING_BUCKET}},{Key=ContractSha256,Value=${SCOUT_CONTRACT_SHA256}},{Key=Region,Value=${SCOUT_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${maximum_seconds}},{Key=MaxComputeUsd,Value=${maximum_ec2_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${SCOUT_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$SCOUT_REGION"
  --image-id "$SCOUT_AMI"
  --instance-type "$instance_type"
  --credit-specification CpuCredits=standard
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${SCOUT_SUBNET_ID},Groups=${SCOUT_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/reasoner34-scout-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":8,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=${SCOUT_EXPERIMENT}},{Key=RunId,Value=${SCOUT_RUN_ID}}]"
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
  echo "$SCOUT_EXPERIMENT AWS dry-run passed"
  exit 0
fi

lock=$(mktemp)
jq -n --arg experiment "$SCOUT_EXPERIMENT" --arg run_id "$SCOUT_RUN_ID" \
  --arg contract_sha256 "$SCOUT_CONTRACT_SHA256" \
  --arg approval_id "$SCOUT_APPROVAL_ID" \
  --arg source_commit "$SCOUT_SOURCE_COMMIT" \
  --arg source_sha256 "$SCOUT_SOURCE_SHA256" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$maximum_ec2_usd" \
  '{schema:"zero.reasoner34_scout_aws_execution_lock.v1",
    experiment:$experiment,run_id:$run_id,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    source_commit:$source_commit,source_sha256:$source_sha256,
    maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' > "$lock"
aws s3api put-object --region "$SCOUT_REGION" \
  --bucket "$SCOUT_TRAINING_BUCKET" --key "$lock_key" --body "$lock" \
  --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
receipt=$(mktemp)
jq -n --arg experiment "$SCOUT_EXPERIMENT" \
  --arg run_id "$SCOUT_RUN_ID" --arg instance_id "$instance_id" \
  --arg source_commit "$SCOUT_SOURCE_COMMIT" \
  --arg source_sha256 "$SCOUT_SOURCE_SHA256" \
  --arg contract_sha256 "$SCOUT_CONTRACT_SHA256" \
  --arg approval_id "$SCOUT_APPROVAL_ID" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson launch_epoch "$launch_epoch" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$maximum_ec2_usd" \
  '{schema:"zero.reasoner34_scout_aws_launch.v1",
    experiment:$experiment,run_id:$run_id,instance_id:$instance_id,
    source_commit:$source_commit,source_sha256:$source_sha256,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    launched_at:$launched_at,launch_epoch:$launch_epoch,
    maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' > "$receipt"
receipt_sha256=$(shasum -a 256 "$receipt" | awk '{print $1}')
aws s3api put-object --region "$SCOUT_REGION" \
  --bucket "$SCOUT_TRAINING_BUCKET" \
  --key "experiments/${SCOUT_EXPERIMENT}/${SCOUT_RUN_ID}/launch.json" \
  --body "$receipt" --content-type application/json \
  --metadata "sha256=${receipt_sha256}" --if-none-match '*' \
  --no-cli-pager >/dev/null
cat "$receipt"

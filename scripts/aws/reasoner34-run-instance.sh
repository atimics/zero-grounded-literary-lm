#!/bin/bash

set -Eeuo pipefail

action=${1:-}
test "$action" = dry-run || test "$action" = launch

for name in R34_AMI R34_SECURITY_GROUP_ID R34_SUBNET_ID \
  R34_SOURCE_COMMIT R34_RUN_ID R34_SOURCE_KEY R34_SOURCE_SHA256 \
  R34_TRAINING_BUCKET R34_REGION R34_CONTRACT_SHA256 R34_APPROVAL_ID; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

contract=benchmarks/reasoner34-nonmonotonic-planning-v1/aws-contract.json
instance_type=t3.micro
hourly_price=0.0104
maximum_seconds=900
maximum_ec2_usd=0.003
lock_key=experiments/reasoner34-nonmonotonic-planning-v1/execution.lock

test "$R34_REGION" = us-east-1
test "$(jq -r .authorized "$contract")" = true
test "$(jq -r .authorization.approval_id "$contract")" = "$R34_APPROVAL_ID"
test "$(jq -r .source.implementation_commit "$contract")" = \
  "$R34_SOURCE_COMMIT"
test "$(jq -r .execution.instance_type "$contract")" = "$instance_type"
test "$(jq -r .execution.maximum_instance_seconds "$contract")" = \
  "$maximum_seconds"
test "$(jq -r .execution.maximum_ec2_usd "$contract")" = \
  "$maximum_ec2_usd"
test "$(jq -r .price_evidence.usd_per_hour "$contract")" = "$hourly_price"
[[ "$R34_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$R34_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$R34_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$R34_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$R34_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$R34_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$R34_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
awk -v seconds="$maximum_seconds" -v price="$hourly_price" \
  -v ceiling="$maximum_ec2_usd" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling) }'

existing=$(aws s3api list-objects-v2 --region "$R34_REGION" \
  --bucket "$R34_TRAINING_BUCKET" --prefix "$lock_key" --max-keys 1 \
  --query 'Contents[0].Key' --output text --no-cli-pager)
test "$existing" = None

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=reasoner34-planning},{Key=Experiment,Value=reasoner34-nonmonotonic-planning-v1},{Key=Commit,Value=${R34_SOURCE_COMMIT}},{Key=RunId,Value=${R34_RUN_ID}},{Key=SourceKey,Value=${R34_SOURCE_KEY}},{Key=SourceSha256,Value=${R34_SOURCE_SHA256}},{Key=TrainingBucket,Value=${R34_TRAINING_BUCKET}},{Key=ContractSha256,Value=${R34_CONTRACT_SHA256}},{Key=Region,Value=${R34_REGION}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${maximum_seconds}},{Key=MaxComputeUsd,Value=${maximum_ec2_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${R34_APPROVAL_ID}}]"

request=(ec2 run-instances
  --region "$R34_REGION"
  --image-id "$R34_AMI"
  --instance-type "$instance_type"
  --credit-specification CpuCredits=standard
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${R34_SUBNET_ID},Groups=${R34_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/reasoner34-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":8,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=reasoner34-nonmonotonic-planning-v1},{Key=RunId,Value=${R34_RUN_ID}}]"
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
  echo "Reasoner (3,3,2) AWS dry-run passed"
  exit 0
fi

lock=$(mktemp)
jq -n --arg run_id "$R34_RUN_ID" \
  --arg contract_sha256 "$R34_CONTRACT_SHA256" \
  --arg approval_id "$R34_APPROVAL_ID" \
  --arg source_commit "$R34_SOURCE_COMMIT" \
  --arg source_sha256 "$R34_SOURCE_SHA256" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$maximum_ec2_usd" \
  '{schema:"zero.reasoner34_aws_execution_lock.v1",run_id:$run_id,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    source_commit:$source_commit,source_sha256:$source_sha256,
    maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' > "$lock"
aws s3api put-object --region "$R34_REGION" \
  --bucket "$R34_TRAINING_BUCKET" --key "$lock_key" --body "$lock" \
  --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
receipt=$(mktemp)
jq -n --arg run_id "$R34_RUN_ID" --arg instance_id "$instance_id" \
  --arg source_commit "$R34_SOURCE_COMMIT" \
  --arg source_sha256 "$R34_SOURCE_SHA256" \
  --arg contract_sha256 "$R34_CONTRACT_SHA256" \
  --arg approval_id "$R34_APPROVAL_ID" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson launch_epoch "$launch_epoch" \
  '{schema:"zero.reasoner34_aws_launch.v1",run_id:$run_id,
    instance_id:$instance_id,source_commit:$source_commit,
    source_sha256:$source_sha256,contract_sha256:$contract_sha256,
    approval_id:$approval_id,launched_at:$launched_at,
    launch_epoch:$launch_epoch}' > "$receipt"
aws s3api put-object --region "$R34_REGION" \
  --bucket "$R34_TRAINING_BUCKET" \
  --key "experiments/reasoner34-nonmonotonic-planning-v1/${R34_RUN_ID}/launch.json" \
  --body "$receipt" --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null
cat "$receipt"

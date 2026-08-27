#!/bin/bash

set -Eeuo pipefail

for name in ZERO5_AMI ZERO5_SECURITY_GROUP_ID ZERO5_SUBNET_ID \
  ZERO5_RUN_ID ZERO5_TRAINING_BUCKET; do
  test -n "${!name:-}" || { echo "$name is required" >&2; exit 1; }
done

action=${1:-}
test "$action" = dry-run || test "$action" = launch

contract=benchmarks/zero5-tensor-batch-v1/aws-contract.json
region=$(jq -r .execution.region "$contract")
instance_type=$(jq -r .execution.instance_type "$contract")
hourly_price=$(jq -r .execution.on_demand_usd_per_hour "$contract")
max_seconds=$(jq -r .execution.maximum_instance_seconds "$contract")
max_usd=$(jq -r .execution.maximum_retry_ec2_usd "$contract")
total_cap_usd=$(jq -r .execution.maximum_total_ec2_usd "$contract")
prior_compute_usd=$(jq -r .execution_amendment.failed_attempt_ec2_usd "$contract")
source_commit=$(jq -r .source.git_commit "$contract")
source_key=$(jq -r .source.archive_key "$contract")
source_sha256=$(jq -r .source.archive_sha256 "$contract")
asset_key=$(jq -r .assets.archive_key "$contract")
asset_sha256=$(jq -r .assets.archive_sha256 "$contract")
approval_id=$(jq -r .authorization.approval_id "$contract")
contract_sha256=$(sha256sum "$contract" | awk '{print $1}')
user_data=scripts/aws/zero5-tensor-calibration-user-data.sh

test "$region" = us-east-1
test "$instance_type" = c6i.4xlarge
test "$hourly_price" = 0.68
test "$max_seconds" = 606
test "$max_usd" = 0.114466666667
test "$prior_compute_usd" = 0.035511111111
test "$total_cap_usd" = 0.15
test "$source_commit" = ed67d1e114d0b7284107a6c80d2e99cc55d98fd8
test "$approval_id" = zero5-tensor-calibration-2026-08-27-v1
test "$(jq -r .status "$contract")" = authorized-retry
test "$(jq -r .authorization.maximum_total_ec2_usd "$contract")" = "$total_cap_usd"
test "$(sha256sum "$user_data" | awk '{print $1}')" = \
  "$(jq -r .execution.user_data_sha256 "$contract")"
[[ "$ZERO5_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO5_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$ZERO5_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$ZERO5_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
awk -v seconds="$max_seconds" -v price="$hourly_price" \
  -v retry_cap="$max_usd" -v prior="$prior_compute_usd" \
  -v total_cap="$total_cap_usd" \
  'BEGIN { retry=seconds*price/3600;
    exit !(retry <= retry_cap && prior + retry <= total_cap) }'

launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=zero5-tensor-calibration-retry},{Key=Experiment,Value=zero5-tensor-batch-v1},{Key=Commit,Value=${source_commit}},{Key=RunId,Value=${ZERO5_RUN_ID}},{Key=SourceKey,Value=${source_key}},{Key=SourceSha256,Value=${source_sha256}},{Key=AssetKey,Value=${asset_key}},{Key=AssetSha256,Value=${asset_sha256}},{Key=TrainingBucket,Value=${ZERO5_TRAINING_BUCKET}},{Key=ContractSha256,Value=${contract_sha256}},{Key=Region,Value=${region}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${max_seconds}},{Key=MaxComputeUsd,Value=${max_usd}},{Key=PriorComputeUsd,Value=${prior_compute_usd}},{Key=TotalComputeCapUsd,Value=${total_cap_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${approval_id}}]"

request=(ec2 run-instances
  --region "$region"
  --image-id "$ZERO5_AMI"
  --instance-type "$instance_type"
  --iam-instance-profile Name=zero-training-ec2
  --network-interfaces "DeviceIndex=0,SubnetId=${ZERO5_SUBNET_ID},Groups=${ZERO5_SECURITY_GROUP_ID},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data "file://${user_data}"
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=zero5-tensor-batch-v1},{Key=RunId,Value=${ZERO5_RUN_ID}}]"
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
  echo "ZERO.5 tensor AWS dry-run passed"
  exit 0
fi

lock_key=experiments/zero5-tensor-batch-v1/execution-v2.lock
lock=$(mktemp)
jq -n --arg run_id "$ZERO5_RUN_ID" \
  --arg contract_sha256 "$contract_sha256" \
  --arg approval_id "$approval_id" \
  --arg source_sha256 "$source_sha256" \
  --arg asset_sha256 "$asset_sha256" \
  --argjson prior_compute_usd "$prior_compute_usd" \
  --argjson maximum_retry_usd "$max_usd" \
  --argjson maximum_total_usd "$total_cap_usd" \
  '{schema:"zero.aws_tensor_batch_execution_lock.v1",run_id:$run_id,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    source_sha256:$source_sha256,asset_sha256:$asset_sha256,
    prior_compute_usd:$prior_compute_usd,
    maximum_retry_usd:$maximum_retry_usd,
    maximum_total_usd:$maximum_total_usd}' > "$lock"
aws s3api put-object --region "$region" \
  --bucket "$ZERO5_TRAINING_BUCKET" --key "$lock_key" --body "$lock" \
  --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null

instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
receipt=$(mktemp)
jq -n --arg run_id "$ZERO5_RUN_ID" --arg instance_id "$instance_id" \
  --arg source_commit "$source_commit" \
  --arg source_sha256 "$source_sha256" \
  --arg asset_sha256 "$asset_sha256" \
  --arg contract_sha256 "$contract_sha256" \
  --arg approval_id "$approval_id" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson launch_epoch "$launch_epoch" \
  --argjson maximum_seconds "$max_seconds" \
  --argjson prior_compute_usd "$prior_compute_usd" \
  --argjson maximum_retry_usd "$max_usd" \
  --argjson maximum_total_usd "$total_cap_usd" \
  '{schema:"zero.aws_tensor_batch_launch.v1",run_id:$run_id,
    instance_id:$instance_id,source_commit:$source_commit,
    source_sha256:$source_sha256,asset_sha256:$asset_sha256,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    launched_at:$launched_at,launch_epoch:$launch_epoch,
    prior_compute_usd:$prior_compute_usd,
    maximum_instance_seconds:$maximum_seconds,
    maximum_retry_ec2_usd:$maximum_retry_usd,
    maximum_total_ec2_usd:$maximum_total_usd}' \
  > "$receipt"
receipt_sha256=$(sha256sum "$receipt" | awk '{print $1}')
aws s3api put-object --region "$region" \
  --bucket "$ZERO5_TRAINING_BUCKET" \
  --key "experiments/zero5-tensor-batch-v1/${ZERO5_RUN_ID}/launch.json" \
  --body "$receipt" --content-type application/json \
  --metadata "sha256=${receipt_sha256}" --if-none-match '*' \
  --no-cli-pager >/dev/null
printf '%s\n' "$instance_id"

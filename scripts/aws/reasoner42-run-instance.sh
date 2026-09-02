#!/bin/bash

set -Eeuo pipefail

action=${1:-}
test "$action" = dry-run || test "$action" = launch
: "${R42_RUN_ID:?R42_RUN_ID is required}"
contract=benchmarks/reasoner42-abstraction-library-v1/contract.json
region=$(jq -r .execution.region "$contract")
image_id=$(jq -r .execution.image_id "$contract")
instance_type=$(jq -r .execution.instance_type "$contract")
subnet_id=$(jq -r .execution.subnet_id "$contract")
security_group_id=$(jq -r .execution.security_group_id "$contract")
instance_profile=$(jq -r .execution.instance_profile "$contract")
bucket=$(jq -r .execution.training_bucket "$contract")
source_commit=$(jq -r .source.implementation_commit "$contract")
source_sha256=$(jq -r .source.bundle_sha256 "$contract")
source_destination=$(jq -r .source.destination "$contract")
source_key=${source_destination#s3://"${bucket}"/}
approval_id=$(jq -r .authorization.approval_id "$contract")
maximum_seconds=$(jq -r .execution.maximum_instance_seconds "$contract")
maximum_ec2_usd=$(jq -r .execution.maximum_ec2_usd "$contract")
hourly_price=$(jq -r .price_evidence.usd_per_hour "$contract")
lock_key=experiments/reasoner42-abstraction-library-v1/execution.lock

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

node scripts/check_reasoner42_contract.mjs
test "$(jq -r .authorized "$contract")" = true
test "$region" = us-east-1
test "$instance_type" = t3.micro
test "$source_commit" = a5c8e8c69c309940adce5cb01609b4604e553606
test "$approval_id" = reasoner42-abstraction-library-2026-09-01-v1
test "$maximum_seconds" = 2400
test "$maximum_ec2_usd" = 0.007
test "$hourly_price" = 0.0104
[[ "$R42_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$image_id" =~ ^ami-[0-9a-f]+$ ]]
[[ "$subnet_id" =~ ^subnet-[0-9a-f]+$ ]]
[[ "$security_group_id" =~ ^sg-[0-9a-f]+$ ]]
[[ "$source_sha256" =~ ^[0-9a-f]{64}$ ]]
awk -v seconds="$maximum_seconds" -v price="$hourly_price" \
  -v ceiling="$maximum_ec2_usd" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling) }'
source_head=$(mktemp)
trap 'rm -f "$source_head"' EXIT
aws s3api head-object --region "$region" --bucket "$bucket" \
  --key "$source_key" --no-cli-pager >"$source_head"
test "$(jq -r '.Metadata.sha256 // ""' "$source_head")" = "$source_sha256"
existing=$(aws s3api list-objects-v2 --region "$region" --bucket "$bucket" \
  --prefix "$lock_key" --max-keys 1 --query 'Contents[0].Key' \
  --output text --no-cli-pager)
test "$existing" = None
contract_sha256=$(digest_file "$contract")
launch_epoch=$(date +%s)
tags="ResourceType=instance,Tags=[{Key=Project,Value=zero},{Key=Name,Value=reasoner42-seal},{Key=Experiment,Value=reasoner42-abstraction-library-v1},{Key=Commit,Value=${source_commit}},{Key=RunId,Value=${R42_RUN_ID}},{Key=SourceKey,Value=${source_key}},{Key=SourceSha256,Value=${source_sha256}},{Key=TrainingBucket,Value=${bucket}},{Key=ContractSha256,Value=${contract_sha256}},{Key=Region,Value=${region}},{Key=LaunchEpoch,Value=${launch_epoch}},{Key=MaxInstanceSeconds,Value=${maximum_seconds}},{Key=MaxComputeUsd,Value=${maximum_ec2_usd}},{Key=HourlyPrice,Value=${hourly_price}},{Key=ApprovalId,Value=${approval_id}}]"
request=(ec2 run-instances
  --region "$region"
  --image-id "$image_id"
  --instance-type "$instance_type"
  --credit-specification CpuCredits=standard
  --iam-instance-profile "Name=${instance_profile}"
  --network-interfaces "DeviceIndex=0,SubnetId=${subnet_id},Groups=${security_group_id},AssociatePublicIpAddress=true,DeleteOnTermination=true"
  --user-data file://scripts/aws/reasoner42-user-data.sh
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=enabled"
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":8,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]'
  --instance-initiated-shutdown-behavior terminate
  --tag-specifications "$tags"
    "ResourceType=volume,Tags=[{Key=Project,Value=zero},{Key=Experiment,Value=reasoner42-abstraction-library-v1},{Key=RunId,Value=${R42_RUN_ID}}]"
  --query 'Instances[0].InstanceId'
  --output text
  --no-cli-pager)

if [ "$action" = dry-run ]; then
  set +e
  output=$(aws "${request[@]}" --dry-run 2>&1)
  exit_code=$?
  set -e
  test "$exit_code" -ne 0
  grep -q DryRunOperation <<<"$output"
  echo "Reasoner 4.2 AWS dry-run passed"
  exit 0
fi

lock=$(mktemp)
receipt=$(mktemp)
trap 'rm -f "$source_head" "$lock" "$receipt"' EXIT
jq -n --arg run_id "$R42_RUN_ID" --arg contract_sha256 "$contract_sha256" \
  --arg approval_id "$approval_id" --arg source_commit "$source_commit" \
  --arg source_sha256 "$source_sha256" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$maximum_ec2_usd" \
  '{schema:"zero.reasoner42_aws_execution_lock.v1",run_id:$run_id,
    contract_sha256:$contract_sha256,approval_id:$approval_id,
    source_commit:$source_commit,source_sha256:$source_sha256,
    maximum_instance_seconds:$maximum_seconds,maximum_ec2_usd:$maximum_usd}' \
  >"$lock"
aws s3api put-object --region "$region" --bucket "$bucket" --key "$lock_key" \
  --body "$lock" --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null
instance_id=$(aws "${request[@]}")
[[ "$instance_id" =~ ^i-[0-9a-f]+$ ]]
jq -n --arg run_id "$R42_RUN_ID" --arg instance_id "$instance_id" \
  --arg source_commit "$source_commit" --arg source_sha256 "$source_sha256" \
  --arg contract_sha256 "$contract_sha256" --arg approval_id "$approval_id" \
  --arg launched_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson launch_epoch "$launch_epoch" \
  --argjson maximum_seconds "$maximum_seconds" \
  --argjson maximum_usd "$maximum_ec2_usd" \
  '{schema:"zero.reasoner42_aws_launch.v1",run_id:$run_id,
    instance_id:$instance_id,source_commit:$source_commit,
    source_sha256:$source_sha256,contract_sha256:$contract_sha256,
    approval_id:$approval_id,launched_at:$launched_at,
    launch_epoch:$launch_epoch,maximum_instance_seconds:$maximum_seconds,
    maximum_ec2_usd:$maximum_usd}' >"$receipt"
receipt_sha256=$(digest_file "$receipt")
aws s3api put-object --region "$region" --bucket "$bucket" \
  --key "experiments/reasoner42-abstraction-library-v1/${R42_RUN_ID}/launch.json" \
  --body "$receipt" --content-type application/json \
  --metadata "sha256=${receipt_sha256}" --if-none-match '*' \
  --no-cli-pager >/dev/null
cat "$receipt"

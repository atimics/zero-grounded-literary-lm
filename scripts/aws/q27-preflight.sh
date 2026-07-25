#!/bin/bash
# Prove Q2.7 AWS infrastructure without acquiring an execution lock or compute.

set -Eeuo pipefail

for name in \
  ZERO_AMI \
  ZERO_SECURITY_GROUP_ID \
  ZERO_SUBNET_ID \
  ZERO_BUCKET \
  ZERO_RUN_ID \
  ZERO_REGION; do
  test -n "${!name:-}" || {
    echo "$name is required" >&2
    exit 2
  }
done

[[ "$ZERO_AMI" =~ ^ami-[0-9a-f]+$ ]]
[[ "$ZERO_SECURITY_GROUP_ID" =~ ^sg-[0-9a-f]+$ ]]
[[ "$ZERO_SUBNET_ID" =~ ^subnet-[0-9a-f]+$ ]]

output=${ZERO_PREFLIGHT_OUTPUT:-/tmp/zero-q27-preflight.json}
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

aws ec2 describe-images \
  --image-ids "$ZERO_AMI" \
  --output json --no-cli-pager >"$tmpdir/image.json"
jq -e --arg ami "$ZERO_AMI" '
  .Images | length == 1
  and .[0].ImageId == $ami
  and .[0].OwnerId == "099720109477"
  and .[0].State == "available"
  and .[0].Architecture == "x86_64"
  and .[0].VirtualizationType == "hvm"
  and .[0].RootDeviceType == "ebs"
' "$tmpdir/image.json" >/dev/null

aws ec2 describe-subnets \
  --subnet-ids "$ZERO_SUBNET_ID" \
  --output json --no-cli-pager >"$tmpdir/subnet.json"
jq -e --arg subnet "$ZERO_SUBNET_ID" '
  .Subnets | length == 1
  and .[0].SubnetId == $subnet
  and .[0].State == "available"
  and .[0].AvailableIpAddressCount > 0
' "$tmpdir/subnet.json" >/dev/null
subnet_vpc=$(jq -r '.Subnets[0].VpcId' "$tmpdir/subnet.json")
[[ "$subnet_vpc" =~ ^vpc-[0-9a-f]+$ ]]

aws ec2 describe-security-groups \
  --group-ids "$ZERO_SECURITY_GROUP_ID" \
  --output json --no-cli-pager >"$tmpdir/security-group.json"
jq -e \
  --arg group "$ZERO_SECURITY_GROUP_ID" \
  --arg vpc "$subnet_vpc" '
    .SecurityGroups | length == 1
    and .[0].GroupId == $group
    and .[0].VpcId == $vpc
  ' "$tmpdir/security-group.json" >/dev/null

: >"$tmpdir/assets.jsonl"
for key in \
  assets/corpus/bpe/zero-foundation.tok \
  assets/corpus/bpe/shakespeare.tok \
  assets/corpus/bpe/blake.tok \
  assets/corpus/bpe/crowley.tok \
  assets/corpus/bpe/bible-kjv.tok \
  assets/corpus/channel/literary-dialogue.tok; do
  aws s3api head-object \
    --bucket "$ZERO_BUCKET" --key "$key" \
    --output json --no-cli-pager >"$tmpdir/head.json"
  jq -ce --arg key "$key" '
    select(.ContentLength > 0)
    | {key: $key, content_length: .ContentLength, etag: .ETag}
  ' "$tmpdir/head.json" >>"$tmpdir/assets.jsonl"
done
jq -s 'select(length == 6)' "$tmpdir/assets.jsonl" >"$tmpdir/assets.json"

marker_key="jobs/${ZERO_RUN_ID}/preflight/write-once.json"
jq -n \
  --arg run_id "$ZERO_RUN_ID" \
  --arg region "$ZERO_REGION" \
  '{
    schema: "zero.aws_write_once_preflight.v1",
    experiment: "zero4-q27-aws-v1",
    ci_run_id: $run_id,
    region: $region
  }' >"$tmpdir/write-once.json"
aws s3api put-object \
  --bucket "$ZERO_BUCKET" \
  --key "$marker_key" \
  --body "$tmpdir/write-once.json" \
  --content-type application/json \
  --if-none-match '*' --no-cli-pager >/dev/null
set +e
aws s3api put-object \
  --bucket "$ZERO_BUCKET" \
  --key "$marker_key" \
  --body "$tmpdir/write-once.json" \
  --content-type application/json \
  --if-none-match '*' --no-cli-pager \
  >"$tmpdir/write-once-repeat.out" 2>"$tmpdir/write-once-repeat.err"
repeat_exit=$?
set -e
test "$repeat_exit" -ne 0
grep -Eq 'PreconditionFailed|412' "$tmpdir/write-once-repeat.err" || {
  cat "$tmpdir/write-once-repeat.err" >&2
  echo "S3 did not prove conditional write-once enforcement" >&2
  exit 1
}

scripts/aws/q27-run-instances.sh dry-run >"$tmpdir/ec2-dry-run.txt"

jq -n \
  --arg ami "$ZERO_AMI" \
  --arg subnet_id "$ZERO_SUBNET_ID" \
  --arg security_group_id "$ZERO_SECURITY_GROUP_ID" \
  --arg vpc_id "$subnet_vpc" \
  --arg instance_profile zero-training-ec2 \
  --arg write_once_key "$marker_key" \
  --arg request_builder_sha256 \
    "$(sha256sum scripts/aws/q27-run-instances.sh | awk '{print $1}')" \
  --slurpfile assets "$tmpdir/assets.json" \
  '{
    schema: "zero.q27_aws_preflight.v1",
    experiment: "zero4-q27-aws-v1",
    compute_launched: false,
    execution_lock_acquired: false,
    ec2: {
      exact_run_instances_dry_run: "DryRunOperation",
      iam_pass_role_proved_by_exact_dry_run: true,
      instance_profile: $instance_profile,
      request_builder_sha256: $request_builder_sha256
    },
    image: {
      id: $ami,
      owner_id: "099720109477",
      state: "available",
      architecture: "x86_64",
      virtualization_type: "hvm",
      root_device_type: "ebs"
    },
    network: {
      subnet_id: $subnet_id,
      security_group_id: $security_group_id,
      vpc_id: $vpc_id,
      subnet_state: "available",
      available_ip_address_required: true
    },
    s3: {
      write_once_condition_proved: true,
      write_once_marker_key: $write_once_key,
      required_assets: $assets[0]
    }
  }' >"$output"

jq -e '
  .compute_launched == false
  and .execution_lock_acquired == false
  and .ec2.exact_run_instances_dry_run == "DryRunOperation"
  and .ec2.iam_pass_role_proved_by_exact_dry_run == true
  and .s3.write_once_condition_proved == true
  and (.s3.required_assets | length) == 6
' "$output" >/dev/null

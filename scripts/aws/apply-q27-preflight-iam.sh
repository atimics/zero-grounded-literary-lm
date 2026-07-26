#!/bin/bash
# Apply only the read permissions required by the Q2.7 zero-compute preflight.

set -Eeuo pipefail

mode=${1:-}
case "$mode" in
  --check|--apply) ;;
  *)
    echo "usage: $0 {--check|--apply}" >&2
    exit 2
    ;;
esac

role_name=${ZERO_GITHUB_ROLE_NAME:-zero-training-github-actions}
policy_name=${ZERO_GITHUB_POLICY_NAME:-zero-training-github}
test "$role_name" = zero-training-github-actions
test "$policy_name" = zero-training-github

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

aws iam get-role-policy \
  --role-name "$role_name" \
  --policy-name "$policy_name" \
  --query PolicyDocument \
  --output json >"$tmpdir/before.json"
jq -e '
  .Version == "2012-10-17"
  and (.Statement | type) == "array"
' "$tmpdir/before.json" >/dev/null

jq '
  def required:
    [
      "ec2:DescribeImages",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets"
    ];
  if any(.Statement[]; .Sid == "ReadLaunchInfrastructure") then
    .Statement |= map(
      if .Sid == "ReadLaunchInfrastructure" then
        .Effect = "Allow"
        | .Resource = "*"
        | .Action = ((if (.Action | type) == "array" then .Action else [.Action] end)
          + required | unique)
      else .
      end
    )
  else
    .Statement += [{
      Sid: "ReadLaunchInfrastructure",
      Effect: "Allow",
      Action: required,
      Resource: "*"
    }]
  end
' "$tmpdir/before.json" >"$tmpdir/after.json"

jq -e '
  [
    .Statement[]
    | select(
        .Sid == "ReadLaunchInfrastructure"
        and .Effect == "Allow"
        and .Resource == "*"
      )
    | .Action[]
  ] as $actions
  | [
      "ec2:DescribeImages",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets"
    ]
    | all(. as $required | $actions | index($required))
' "$tmpdir/after.json" >/dev/null

if [ "$mode" = --check ]; then
  jq -c '
    .Statement[]
    | select(.Sid == "ReadLaunchInfrastructure")
  ' "$tmpdir/after.json"
  exit
fi

aws iam put-role-policy \
  --role-name "$role_name" \
  --policy-name "$policy_name" \
  --policy-document "file://${tmpdir}/after.json"
aws iam get-role-policy \
  --role-name "$role_name" \
  --policy-name "$policy_name" \
  --query PolicyDocument \
  --output json >"$tmpdir/observed.json"
jq -e '
  [
    .Statement[]
    | select(
        .Sid == "ReadLaunchInfrastructure"
        and .Effect == "Allow"
        and .Resource == "*"
      )
    | .Action[]
  ] as $actions
  | [
      "ec2:DescribeImages",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets"
    ]
    | all(. as $required | $actions | index($required))
' "$tmpdir/observed.json" >/dev/null
echo "Q2.7 preflight IAM read permissions applied and verified"

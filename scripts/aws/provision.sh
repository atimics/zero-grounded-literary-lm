#!/bin/bash
# Provision the AWS roles, artifact bucket, and network metadata used by Train CI.

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="${ZERO_BUCKET:-zero-training-${ACCOUNT_ID}}"
DEFAULT_GITHUB_REPOSITORY=atimics/zero-grounded-literary-lm
DEFAULT_GITHUB_REPOSITORY_SUBJECT=atimics@210085965/zero-grounded-literary-lm@1303249204
GITHUB_REPOSITORY="${ZERO_GITHUB_REPOSITORY:-$DEFAULT_GITHUB_REPOSITORY}"
GITHUB_REPOSITORY_SUBJECT="${ZERO_GITHUB_REPOSITORY_SUBJECT:-}"
if [ -z "$GITHUB_REPOSITORY_SUBJECT" ]; then
  if [ "$GITHUB_REPOSITORY" != "$DEFAULT_GITHUB_REPOSITORY" ]; then
    echo "Set ZERO_GITHUB_REPOSITORY_SUBJECT to the ID-qualified GitHub OIDC repository identity" >&2
    exit 1
  fi
  GITHUB_REPOSITORY_SUBJECT="$DEFAULT_GITHUB_REPOSITORY_SUBJECT"
fi
EC2_ROLE_NAME=zero-training-ec2
GITHUB_ROLE_NAME=zero-training-github-actions

echo "=== Provisioning ZERO training infrastructure in $REGION ==="

if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  echo "Bucket $BUCKET_NAME already exists"
else
  aws s3 mb "s3://${BUCKET_NAME}" --region "$REGION"
fi
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning \
  --bucket "$BUCKET_NAME" \
  --versioning-configuration Status=Enabled

OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  echo "Created GitHub Actions OIDC provider"
fi

GITHUB_TRUST_POLICY=$(mktemp)
cat > "$GITHUB_TRUST_POLICY" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "${OIDC_PROVIDER_ARN}"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
      "StringLike": {"token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPOSITORY_SUBJECT}:*"}
    }
  }]
}
EOF

if aws iam get-role --role-name "$GITHUB_ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy \
    --role-name "$GITHUB_ROLE_NAME" \
    --policy-document "file://${GITHUB_TRUST_POLICY}"
else
  aws iam create-role \
    --role-name "$GITHUB_ROLE_NAME" \
    --assume-role-policy-document "file://${GITHUB_TRUST_POLICY}" >/dev/null
fi
GITHUB_ROLE_ARN=$(aws iam get-role \
  --role-name "$GITHUB_ROLE_NAME" \
  --query Role.Arn \
  --output text)

GITHUB_POLICY=$(mktemp)
cat > "$GITHUB_POLICY" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LaunchTaggedTrainingInstances",
      "Effect": "Allow",
      "Action": "ec2:RunInstances",
      "Resource": "*",
      "Condition": {"StringEquals": {"aws:RequestTag/Project": "zero"}}
    },
    {
      "Sid": "TagAtLaunch",
      "Effect": "Allow",
      "Action": "ec2:CreateTags",
      "Resource": "*",
      "Condition": {"StringEquals": {"ec2:CreateAction": "RunInstances"}}
    },
    {
      "Sid": "ReadInstanceState",
      "Effect": "Allow",
      "Action": ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus"],
      "Resource": "*"
    },
    {
      "Sid": "TerminateOnlyProjectInstances",
      "Effect": "Allow",
      "Action": "ec2:TerminateInstances",
      "Resource": "*",
      "Condition": {"StringEquals": {"aws:ResourceTag/Project": "zero"}}
    },
    {
      "Sid": "ResolveCanonicalUbuntu",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:${REGION}::parameter/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    },
    {
      "Sid": "PassTrainingInstanceRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::${ACCOUNT_ID}:role/${EC2_ROLE_NAME}"
    },
    {
      "Sid": "ListTrainingBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}"
    },
    {
      "Sid": "ReadWriteTrainingObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF
aws iam put-role-policy \
  --role-name "$GITHUB_ROLE_NAME" \
  --policy-name zero-training-github \
  --policy-document "file://${GITHUB_POLICY}"

EC2_TRUST_POLICY=$(mktemp)
cat > "$EC2_TRUST_POLICY" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ec2.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF
if aws iam get-role --role-name "$EC2_ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy \
    --role-name "$EC2_ROLE_NAME" \
    --policy-document "file://${EC2_TRUST_POLICY}"
else
  aws iam create-role \
    --role-name "$EC2_ROLE_NAME" \
    --assume-role-policy-document "file://${EC2_TRUST_POLICY}" >/dev/null
fi

EC2_POLICY=$(mktemp)
cat > "$EC2_POLICY" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF
aws iam put-role-policy \
  --role-name "$EC2_ROLE_NAME" \
  --policy-name zero-training-ec2 \
  --policy-document "file://${EC2_POLICY}"

aws iam create-instance-profile \
  --instance-profile-name "$EC2_ROLE_NAME" >/dev/null 2>&1 || true
aws iam add-role-to-instance-profile \
  --instance-profile-name "$EC2_ROLE_NAME" \
  --role-name "$EC2_ROLE_NAME" >/dev/null 2>&1 || true

VPC_ID="${ZERO_VPC_ID:-}"
if [ -z "$VPC_ID" ]; then
  VPC_ID=$(aws ec2 describe-vpcs \
    --filters Name=is-default,Values=true \
    --query 'Vpcs[0].VpcId' \
    --output text)
fi
if [ -z "$VPC_ID" ] || [ "$VPC_ID" = None ]; then
  echo "Set ZERO_VPC_ID because this account has no default VPC" >&2
  exit 1
fi

SG_ID=$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values=zero-training Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)
if [ -z "$SG_ID" ] || [ "$SG_ID" = None ]; then
  SG_ID=$(aws ec2 create-security-group \
    --group-name zero-training \
    --description 'ZERO training instances; no inbound rules' \
    --vpc-id "$VPC_ID" \
    --query GroupId \
    --output text)
fi

SUBNET_ID="${ZERO_SUBNET_ID:-}"
if [ -z "$SUBNET_ID" ]; then
  SUBNET_ID=$(aws ec2 describe-subnets \
    --filters Name=vpc-id,Values="$VPC_ID" \
    --query 'Subnets[0].SubnetId' \
    --output text)
fi
if [ -z "$SUBNET_ID" ] || [ "$SUBNET_ID" = None ]; then
  echo "Set ZERO_SUBNET_ID because no subnet was found in $VPC_ID" >&2
  exit 1
fi

rm -f "$GITHUB_TRUST_POLICY" "$GITHUB_POLICY" "$EC2_TRUST_POLICY" "$EC2_POLICY"

echo
echo "=== Provisioning complete ==="
echo "GitHub Actions secrets:"
echo "  AWS_TRAINING_ROLE_ARN: $GITHUB_ROLE_ARN"
echo "  AWS_REGION:            $REGION"
echo "  AWS_BUCKET:            $BUCKET_NAME"
echo "  AWS_SECURITY_GROUP_ID: $SG_ID"
echo "  AWS_SUBNET_ID:         $SUBNET_ID"
echo
echo "Upload ignored, hash-verified training assets before dispatch:"
echo "  aws s3 sync teachers/ s3://${BUCKET_NAME}/assets/teachers/ --exclude registry.json"
echo "  aws s3 sync corpus/bpe/ s3://${BUCKET_NAME}/assets/corpus/bpe/"
echo "  aws s3 sync corpus/channel/ s3://${BUCKET_NAME}/assets/corpus/channel/"

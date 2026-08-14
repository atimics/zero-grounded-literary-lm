#!/bin/bash

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${ZERO_DATA_STACK:-ZeroDataPlane}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CORPUS_BUCKET="${ZERO_CORPUS_BUCKET:-zero-corpus-${ACCOUNT_ID}}"
TRAINING_BUCKET="${ZERO_BUCKET:-zero-training-${ACCOUNT_ID}}"

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file infra/zero-data-plane.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    CorpusBucketName="$CORPUS_BUCKET" \
    TrainingBucketName="$TRAINING_BUCKET"

aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table

#!/bin/bash

set -Eeuo pipefail

: "${ZERO5_TRAINING_BUCKET:?ZERO5_TRAINING_BUCKET is required}"
ZERO5_REGION=${ZERO5_REGION:-us-east-1}
test "$ZERO5_REGION" = us-east-1
git diff --quiet
git diff --cached --quiet

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

node scripts/check_zero5_c61_evaluation_recovery.mjs
source_commit=$(git rev-parse HEAD)
recovery_contract=benchmarks/zero5-c61-shared-state-v1/evaluation-recovery-contract-v2.json
recovery_contract_sha256=$(digest_file "$recovery_contract")
asset_key=$(jq -r .execution.asset_archive.key "$recovery_contract")
asset_sha256=$(jq -r .execution.asset_archive.sha256 "$recovery_contract")
head_file=$(mktemp)
aws s3api head-object --region "$ZERO5_REGION" \
  --bucket "$ZERO5_TRAINING_BUCKET" --key "$asset_key" \
  --no-cli-pager > "$head_file"
test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = "$asset_sha256"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
git archive --format=tar \
  --add-virtual-file="SOURCE_COMMIT:${source_commit}" "$source_commit" |
  gzip -n > "$stage/source.tar.gz"
source_sha256=$(digest_file "$stage/source.tar.gz")
source_key="experiments/zero5-c61-shared-state-v1/inputs/source-${source_commit}-${source_sha256}.tar.gz"
if aws s3api head-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$source_key" \
    --no-cli-pager > "$head_file" 2>/dev/null; then
  test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = "$source_sha256"
else
  aws s3api put-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$source_key" \
    --body "$stage/source.tar.gz" --metadata "sha256=${source_sha256}" \
    --content-type application/gzip --if-none-match '*' --no-cli-pager >/dev/null
fi
jq -n --arg source_commit "$source_commit" \
  --arg recovery_contract_sha256 "$recovery_contract_sha256" \
  --arg source_key "$source_key" --arg source_sha256 "$source_sha256" \
  --arg asset_key "$asset_key" --arg asset_sha256 "$asset_sha256" \
  '{schema:"zero.c61_evaluation_aws_stage.v1",
    source_commit:$source_commit,
    recovery_contract_sha256:$recovery_contract_sha256,
    source_key:$source_key,source_sha256:$source_sha256,
    asset_key:$asset_key,asset_sha256:$asset_sha256,
    training_authorized:false}'

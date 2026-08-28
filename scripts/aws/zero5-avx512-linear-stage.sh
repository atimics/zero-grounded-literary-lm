#!/bin/bash

set -Eeuo pipefail

: "${ZERO5_TRAINING_BUCKET:?ZERO5_TRAINING_BUCKET is required}"
ZERO5_REGION=${ZERO5_REGION:-us-east-1}
test "$ZERO5_REGION" = us-east-1

contract=benchmarks/zero5-avx512-linear-v1/aws-contract.json
source_commit=$(jq -r .source.git_commit "$contract")
source_key=$(jq -r .source.archive_key "$contract")
source_sha256=$(jq -r .source.archive_sha256 "$contract")
asset_key=$(jq -r .assets.archive_key "$contract")
asset_sha256=$(jq -r .assets.archive_sha256 "$contract")

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

node scripts/check_zero5_avx512_linear_aws.mjs
git cat-file -e "${source_commit}^{commit}"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
source_archive="$stage/source.tar.gz"
git archive --format=tar.gz --mtime=1970-01-01T00:00:00Z \
  "--add-virtual-file=SOURCE_COMMIT:${source_commit}" \
  "$source_commit" -o "$source_archive"
test "$(digest_file "$source_archive")" = "$source_sha256"

head_file="$stage/head.json"
if aws s3api head-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$source_key" \
    --no-cli-pager >"$head_file" 2>/dev/null; then
  test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = "$source_sha256"
else
  aws s3api put-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$source_key" \
    --body "$source_archive" --metadata "sha256=${source_sha256}" \
    --content-type application/gzip --if-none-match '*' \
    --no-cli-pager >/dev/null
fi

aws s3api head-object --region "$ZERO5_REGION" \
  --bucket "$ZERO5_TRAINING_BUCKET" --key "$asset_key" \
  --no-cli-pager >"$head_file"
test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = "$asset_sha256"

jq -n --arg source_commit "$source_commit" \
  --arg source_key "$source_key" --arg source_sha256 "$source_sha256" \
  --arg asset_key "$asset_key" --arg asset_sha256 "$asset_sha256" \
  --arg bucket "$ZERO5_TRAINING_BUCKET" \
  '{schema:"zero.aws_avx512_linear_stage.v1",source_commit:$source_commit,
    training_bucket:$bucket,
    source:{key:$source_key,sha256:$source_sha256},
    assets:{key:$asset_key,sha256:$asset_sha256}}'

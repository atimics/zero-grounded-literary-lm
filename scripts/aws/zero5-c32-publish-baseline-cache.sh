#!/bin/bash

set -Eeuo pipefail

: "${ZERO5_TRAINING_BUCKET:?ZERO5_TRAINING_BUCKET is required}"
ZERO5_REGION=${ZERO5_REGION:-us-east-1}
ZERO5_BASELINE_SOURCE_RUN_ID=${ZERO5_BASELINE_SOURCE_RUN_ID:-}
ZERO5_BASELINE_SOURCE=${ZERO5_BASELINE_SOURCE:-}
test "$ZERO5_REGION" = us-east-1
test -n "$ZERO5_BASELINE_SOURCE_RUN_ID"
[[ "$ZERO5_BASELINE_SOURCE_RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
source_file=$ZERO5_BASELINE_SOURCE
if [ -z "$source_file" ]; then
  source_file="$stage/source-baseline.json"
  aws s3 cp \
    "s3://${ZERO5_TRAINING_BUCKET}/experiments/zero5-c32-v1/${ZERO5_BASELINE_SOURCE_RUN_ID}/state/baseline.json" \
    "$source_file" --region "$ZERO5_REGION" --only-show-errors
fi
test -f "$source_file"

cache_file="$stage/baseline-cache.json"
receipt_file="$stage/receipt.json"
node scripts/zero5_c32_baseline_cache.mjs --mode create \
  --input "$source_file" --output "$cache_file" --backend openblas \
  --source-run-id "$ZERO5_BASELINE_SOURCE_RUN_ID" > "$receipt_file"
cache_id=$(jq -r .cache_id "$receipt_file")
[[ "$cache_id" =~ ^[0-9a-f]{64}$ ]]
cache_sha256=$(digest_file "$cache_file")
test "$cache_sha256" = "$(jq -r .file_sha256 "$receipt_file")"
cache_key="experiments/zero5-c32-v1/baselines/${cache_id}.json"

if aws s3api head-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$cache_key" \
    --no-cli-pager > "$stage/head.json" 2>/dev/null; then
  test "$(jq -r '.Metadata.sha256 // ""' "$stage/head.json")" = \
    "$cache_sha256"
else
  aws s3api put-object --region "$ZERO5_REGION" \
    --bucket "$ZERO5_TRAINING_BUCKET" --key "$cache_key" \
    --body "$cache_file" --content-type application/json \
    --metadata "sha256=${cache_sha256}" --if-none-match '*' \
    --no-cli-pager >/dev/null
fi

jq -n --arg source_run_id "$ZERO5_BASELINE_SOURCE_RUN_ID" \
  --arg cache_id "$cache_id" --arg key "$cache_key" \
  --arg sha256 "$cache_sha256" \
  '{schema:"zero.c32_baseline_cache_publication.v1",
    source_run_id:$source_run_id,cache_id:$cache_id,private:true,
    key:$key,sha256:$sha256,
    launch_environment:{ZERO5_BASELINE_CACHE_KEY:$key,
      ZERO5_BASELINE_CACHE_SHA256:$sha256}}'

#!/bin/bash

set -Eeuo pipefail

action=${1:-dry-run}
test "$action" = dry-run || test "$action" = stage
contract=benchmarks/reasoner40-active-representation-v1/aws-contract.json
source_commit=73b721a00f8e5737cf0fcfb47b14c90b1e832e70
expected_sha256=06432af1ef731d637f8fb09a2aaf1d9b1929fd34a2cba40ebae5db6a7fb5afe9
expected_bytes=50211
source_files=(
  Makefile
  reasoner0.c
  reasoner0.h
  reasoner310.c
  reasoner310.h
  reasoner40.c
  reasoner40.h
  reasoner40_cli.c
)

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

node scripts/check_reasoner40_contract.mjs
test "$(jq -r .authorized "$contract")" = true
test "$(jq -r .source.implementation_commit "$contract")" = \
  "$source_commit"
bundle=$(mktemp)
trap 'rm -f "$bundle"' EXIT
git archive --format=tar.gz --output="$bundle" "$source_commit" \
  "${source_files[@]}"
source_sha256=$(digest_file "$bundle")
source_bytes=$(wc -c < "$bundle" | tr -d ' ')
test "$source_sha256" = "$expected_sha256"
test "$source_bytes" = "$expected_bytes"
test "$(jq -r .source.bundle_sha256 "$contract")" = "$source_sha256"
test "$(jq -r .source.bundle_bytes "$contract")" = "$source_bytes"
destination=$(jq -r .source.destination "$contract")
case "$destination" in
  s3://*/*) ;;
  *) echo "invalid source destination" >&2; exit 1 ;;
esac
without_scheme=${destination#s3://}
bucket=${without_scheme%%/*}
key=${without_scheme#*/}
test "$bucket" = "$(jq -r .execution.training_bucket "$contract")"

if [ "$action" = dry-run ]; then
  jq -n --arg source_commit "$source_commit" \
    --arg source_sha256 "$source_sha256" \
    --argjson source_bytes "$source_bytes" --arg destination "$destination" \
    '{schema:"zero.reasoner40_aws_stage.v1",action:"dry-run",
      source_commit:$source_commit,source_sha256:$source_sha256,
      source_bytes:$source_bytes,destination:$destination}'
  exit 0
fi

head_file=$(mktemp)
trap 'rm -f "$bundle" "$head_file"' EXIT
if aws s3api head-object --region us-east-1 --bucket "$bucket" --key "$key" \
    --no-cli-pager >"$head_file" 2>/dev/null; then
  test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = \
    "$source_sha256"
else
  aws s3api put-object --region us-east-1 --bucket "$bucket" --key "$key" \
    --body "$bundle" --metadata "sha256=${source_sha256}" \
    --content-type application/gzip --if-none-match '*' \
    --no-cli-pager >"$head_file"
fi
jq -n --arg source_commit "$source_commit" \
  --arg source_sha256 "$source_sha256" \
  --argjson source_bytes "$source_bytes" --arg destination "$destination" \
  --slurpfile receipt "$head_file" \
  '{schema:"zero.reasoner40_aws_stage.v1",action:"stage",
    source_commit:$source_commit,source_sha256:$source_sha256,
    source_bytes:$source_bytes,destination:$destination,
    storage_receipt:($receipt[0] // null)}'

#!/bin/bash

set -Eeuo pipefail

: "${ZERO5_TRAINING_BUCKET:?ZERO5_TRAINING_BUCKET is required}"
ZERO5_REGION=${ZERO5_REGION:-us-east-1}
ZERO5_ASSET_ROOT=${ZERO5_ASSET_ROOT:-$PWD}
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

node scripts/check_zero5_c33_parallel.mjs
source_commit=$(git rev-parse HEAD)
contract_sha256=$(digest_file benchmarks/zero5-c33-parallel-v1/contract.json)
required=(
  build/zero5-c0-v1/corpus-one/byte-bpe512.sero
  build/zero5-c2-v1/run/best.ckpt
  build/zero5-c33-v1/import-final/train.interleaved.z5pack
  build/zero5-c33-v1/import-final/validation.interleaved.z5pack
)
for file in "${required[@]}"; do
  test -e "$ZERO5_ASSET_ROOT/$file" || {
    echo "missing replay asset: $ZERO5_ASSET_ROOT/$file" >&2
    exit 1
  }
done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/source" "$stage/assets"
git archive "$source_commit" | tar -xf - -C "$stage/source"
printf '%s\n' "$source_commit" > "$stage/source/SOURCE_COMMIT"
COPYFILE_DISABLE=1 tar -czf "$stage/source.tar.gz" -C "$stage/source" .
for file in "${required[@]}"; do
  mkdir -p "$stage/assets/$(dirname "$file")"
  cp -R "$ZERO5_ASSET_ROOT/$file" "$stage/assets/$file"
done
COPYFILE_DISABLE=1 tar -czf "$stage/assets.tar.gz" -C "$stage/assets" .

source_sha256=$(digest_file "$stage/source.tar.gz")
asset_sha256=$(digest_file "$stage/assets.tar.gz")
prefix=experiments/zero5-c33-parallel-v1/inputs
source_key="${prefix}/source-${source_commit}-${source_sha256}.tar.gz"
asset_key="${prefix}/assets-${asset_sha256}.tar.gz"

put_immutable() {
  file=$1
  key=$2
  digest=$3
  content_type=$4
  head_file=$(mktemp)
  if aws s3api head-object --region "$ZERO5_REGION" \
      --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" \
      --no-cli-pager >"$head_file" 2>/dev/null; then
    test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = "$digest"
  else
    aws s3api put-object --region "$ZERO5_REGION" \
      --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" --body "$file" \
      --metadata "sha256=${digest}" --content-type "$content_type" \
      --if-none-match '*' --no-cli-pager >/dev/null
  fi
}
put_immutable "$stage/source.tar.gz" "$source_key" "$source_sha256" \
  application/gzip
put_immutable "$stage/assets.tar.gz" "$asset_key" "$asset_sha256" \
  application/gzip

jq -n --arg source_commit "$source_commit" \
  --arg contract_sha256 "$contract_sha256" \
  --arg source_key "$source_key" --arg source_sha256 "$source_sha256" \
  --arg asset_key "$asset_key" --arg asset_sha256 "$asset_sha256" \
  --arg bucket "$ZERO5_TRAINING_BUCKET" \
  '{schema:"zero.c33_parallel_aws_stage.v1",source_commit:$source_commit,
    contract_sha256:$contract_sha256,training_bucket:$bucket,
    source:{key:$source_key,sha256:$source_sha256},
    assets:{key:$asset_key,sha256:$asset_sha256}}'

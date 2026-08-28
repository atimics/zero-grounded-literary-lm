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

node scripts/check_zero5_c42_aws.mjs
source_commit=$(git rev-parse HEAD)
contract_sha256=$(digest_file benchmarks/zero5-c42-v1/contract.json)
required=(
  build/zero5-c0-v1/corpus-one/byte-bpe512.sero
  build/zero5-c0-v1/corpus-one/train.byte-bpe512.tok
  build/zero5-c0-v1/corpus-one/validation.byte-bpe512.tok
  build/zero5-c2-v1/run/best.ckpt
  build/zero5-c2-v1/import-final/atlas.train.byte-bpe512.tok
  build/zero5-c2-v1/import-final/atlas.validation.byte-bpe512.tok
  build/zero5-c42-v1/import-final/import.json
  build/zero5-c42-v1/import-final/train.primary.grouped.z5pack
  build/zero5-c42-v1/import-final/validation.z5pack
  build/zero5-c42-v1/import-final/evidence-bundle.validation.z5pack
  build/zero5-c42-v1/import-final/cloze.validation.completion-eval.bin
  build/zero5-c42-v1/import-final/claim.validation.span-choice-eval.bin
  build/zero5-c42-v1/import-final/retrieval.validation.span-choice-eval.bin
)
for file in "${required[@]}"; do
  test -f "$ZERO5_ASSET_ROOT/$file" || {
    echo "missing replay asset: $ZERO5_ASSET_ROOT/$file" >&2
    exit 1
  }
done

node scripts/run_zero5_c42.mjs \
  --import-dir "$ZERO5_ASSET_ROOT/build/zero5-c42-v1/import-final" \
  --c0-dir "$ZERO5_ASSET_ROOT/build/zero5-c0-v1/corpus-one" \
  --c2-dir "$ZERO5_ASSET_ROOT/build/zero5-c2-v1/run" \
  --c2-import-dir "$ZERO5_ASSET_ROOT/build/zero5-c2-v1/import-final" \
  --preflight-only >/dev/null

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/source"
git archive "$source_commit" | tar -xf - -C "$stage/source"
printf '%s\n' "$source_commit" > "$stage/source/SOURCE_COMMIT"
COPYFILE_DISABLE=1 tar -czf "$stage/source.tar.gz" -C "$stage/source" .
COPYFILE_DISABLE=1 tar -czf "$stage/assets.tar.gz" \
  -C "$ZERO5_ASSET_ROOT" "${required[@]}"

source_sha256=$(digest_file "$stage/source.tar.gz")
asset_sha256=$(digest_file "$stage/assets.tar.gz")
prefix=experiments/zero5-c42-v1/inputs
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
  '{schema:"zero.c42_aws_stage.v1",source_commit:$source_commit,
    contract_sha256:$contract_sha256,source_key:$source_key,
    source_sha256:$source_sha256,asset_key:$asset_key,
    asset_sha256:$asset_sha256}'
